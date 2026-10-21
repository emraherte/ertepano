import type { FastifyInstance } from 'fastify';
import { CATEGORIES, KINDS, ROLE_CATEGORIES } from '@ertepano/shared';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { audit, db, nowIso } from '../db.js';
import { annDto, type AnnRow, placementColumns, placementSchema, approvedDevices, countTargets, deviceMatches, parseTargets } from '../announcements.js';
import { endAnnouncement, publish, republish } from '../lifecycle.js';
import { uuid } from '../security.js';
import { TEMPLATES } from '../templates.js';

const isoOrNull = z.string().datetime({ offset: true }).nullable().optional();

const annInput = z.object({
  kind: z.enum(KINDS).refine((k) => k !== 'fullscreen', 'Tam ekran yalnızca Acil Durum sayfasından yayınlanır'),
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(1, 'Başlık gerekli').max(140),
  body: z.string().max(2000).default(''),
  emoji: z.string().max(16).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  requireAck: z.boolean().default(false),
  ackLabel: z.string().max(40).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6).nullable().optional(),
  countdownTo: isoOrNull,
  ...placementSchema,
  sound: z.boolean().default(false),
  targets: z.array(z.string().max(200)).min(1).default(['all']),
  showOnKiosk: z.boolean().default(true),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
  publish: z.boolean().default(false),
});

/** Yerleşim yalnızca rozet için anlamlı; diğer türlerde boş yazılır. */
function badgeCols(b: { kind?: string; position?: string | null; posX?: number | null; posY?: number | null; size?: number | null; opacity?: number | null }) {
  if (b.kind !== 'badge') return [null, null, null, null];
  const c = placementColumns(b);
  return [c.pos_x, c.pos_y, c.size, c.opacity];
}

function validateKind(b: { kind?: string; options?: string[] | null; countdownTo?: string | null; startsAt?: string | null; endsAt?: string | null }) {
  if (b.kind === 'survey' && (!b.options || b.options.length < 2)) return 'Anket için en az 2 seçenek gerekli';
  if (b.kind === 'countdown' && !b.countdownTo) return 'Geri sayım için hedef zaman gerekli';
  if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) return 'Bitiş zamanı başlangıçtan sonra olmalı';
  return null;
}

/** Duyuru başına teslim istatistikleri tek sorguda. */
function statsFor(ids: string[]) {
  if (!ids.length) return new Map<string, { sent: number; seen: number; acked: number; answered: number }>();
  const rows = db
    .prepare(
      `SELECT announcement_id id, COUNT(sent_at) sent, COUNT(seen_at) seen, COUNT(acked_at) acked, COUNT(answered_at) answered
       FROM deliveries WHERE announcement_id IN (${ids.map(() => '?').join(',')}) GROUP BY announcement_id`,
    )
    .all(...ids) as { id: string; sent: number; seen: number; acked: number; answered: number }[];
  return new Map(rows.map(({ id, ...s }) => [id, s]));
}

export async function announcementRoutes(app: FastifyInstance) {
  app.get('/api/templates', { preHandler: requireRole() }, async (req) => {
    const allowed = ROLE_CATEGORIES[req.user!.role];
    return { items: TEMPLATES.filter((t) => allowed.includes(t.category)) };
  });

  /** Hedef seçici için lokasyon/departman çipleri ve cihaz sayıları. */
  app.get('/api/targets', { preHandler: requireRole() }, async () => {
    const devices = approvedDevices();
    const tally = (key: 'location' | 'department') => {
      const m = new Map<string, number>();
      devices.forEach((d) => d[key] && m.set(d[key]!, (m.get(d[key]!) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr')).map(([name, count]) => ({ name, count }));
    };
    return { total: devices.length, locations: tally('location'), departments: tally('department') };
  });

  app.post('/api/targets/count', { preHandler: requireRole() }, async (req) => {
    const { targets } = z.object({ targets: z.array(z.string()).min(1) }).parse(req.body);
    return { count: countTargets(targets) };
  });

  app.get('/api/announcements', { preHandler: requireRole() }, async (req) => {
    const q = z
      .object({ status: z.string().optional(), category: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200) })
      .parse(req.query);
    const where: string[] = ["kind != 'fullscreen'"];
    const args: unknown[] = [];
    if (q.status) {
      where.push('status = ?');
      args.push(q.status);
    }
    if (q.category) {
      where.push('category = ?');
      args.push(q.category);
    }
    const rows = db
      .prepare(`SELECT * FROM announcements WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`)
      .all(...args, q.limit) as AnnRow[];
    const stats = statsFor(rows.map((r) => r.id));
    const devices = approvedDevices();
    return {
      items: rows.map((r) => ({
        ...annDto(r),
        stats: {
          targets: devices.filter((d) => deviceMatches(d, parseTargets(r.targets))).length,
          ...(stats.get(r.id) ?? { sent: 0, seen: 0, acked: 0, answered: 0 }),
        },
      })),
    };
  });

  app.get('/api/announcements/:id', { preHandler: requireRole() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    const deliveries = db
      .prepare(
        `SELECT d.device_id deviceId, v.hostname, d.user_login userLogin, v.location, v.department, d.sent_at sentAt, d.seen_at seenAt,
                d.read_at readAt, d.acked_at ackedAt, d.dismissed_at dismissedAt, d.answer, d.answered_at answeredAt
         FROM deliveries d JOIN devices v ON v.id = d.device_id WHERE d.announcement_id = ? ORDER BY v.hostname`,
      )
      .all(id) as Record<string, string | null>[];
    const answers: Record<string, number> = {};
    deliveries.forEach((d) => d.answer && (answers[d.answer] = (answers[d.answer] ?? 0) + 1));
    const s = statsFor([id]).get(id) ?? { sent: 0, seen: 0, acked: 0, answered: 0 };
    return {
      item: annDto(a),
      stats: { targets: countTargets(parseTargets(a.targets)), ...s },
      answers,
      // Anket yanıtları kişiden bağımsız gösterilir; zorunlu onaylarda kim/ne zaman listesi denetim kanıtıdır.
      deliveries: a.kind === 'survey' ? deliveries.map((d) => ({ ...d, answer: null, userLogin: null })) : deliveries,
    };
  });

  app.post('/api/announcements', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const b = annInput.parse(req.body);
    if (!ROLE_CATEGORIES[req.user!.role].includes(b.category)) return reply.code(403).send({ error: 'Bu kategoride yayın yetkiniz yok' });
    const err = validateKind(b);
    if (err) return reply.code(400).send({ error: err });
    const id = uuid();
    const now = nowIso();
    db.prepare(
      `INSERT INTO announcements(id, kind, category, title, body, emoji, image_url, color, require_ack, ack_label, options, countdown_to,
         position, pos_x, pos_y, size, opacity, sound, targets, show_on_kiosk, status, starts_at, ends_at, created_by, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?)`,
    ).run(
      id, b.kind, b.category, b.title, b.body, b.emoji ?? null, b.imageUrl ?? null, b.color ?? null, b.requireAck ? 1 : 0, b.ackLabel ?? null,
      b.kind === 'survey' && b.options ? JSON.stringify(b.options) : null, b.countdownTo ?? null, b.position ?? null, ...badgeCols(b), b.sound ? 1 : 0,
      JSON.stringify(b.targets), b.showOnKiosk ? 1 : 0, b.startsAt ?? null, b.endsAt ?? null, req.user!.username, now, now,
    );
    audit(req.user!.username, 'announcement_created', 'announcement', id, { title: b.title, publish: b.publish }, req.ip);
    const row = b.publish ? publish(id)! : (db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow);
    if (b.publish) audit(req.user!.username, 'announcement_published', 'announcement', id, { targets: b.targets }, req.ip);
    return { item: annDto(row) };
  });

  app.patch('/api/announcements/:id', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    if (a.kind === 'fullscreen') return reply.code(400).send({ error: 'Acil durum yayınları Acil Durum sayfasından yönetilir' });
    if (a.status === 'ended') return reply.code(400).send({ error: 'Biten duyuru düzenlenemez; kopyalayıp yeniden yayınlayın' });
    const b = annInput.partial().parse(req.body);
    const allowed = ROLE_CATEGORIES[req.user!.role];
    if (!allowed.includes(a.category) || (b.category && !allowed.includes(b.category))) {
      return reply.code(403).send({ error: 'Bu kategoride yetkiniz yok' });
    }
    const merged = { ...annDto(a), ...b };
    const err = validateKind(merged);
    if (err) return reply.code(400).send({ error: err });
    db.prepare(
      `UPDATE announcements SET kind=?, category=?, title=?, body=?, emoji=?, image_url=?, color=?, require_ack=?, ack_label=?, options=?,
         countdown_to=?, position=?, pos_x=?, pos_y=?, size=?, opacity=?, sound=?, targets=?, show_on_kiosk=?, starts_at=?, ends_at=?, updated_at=? WHERE id=?`,
    ).run(
      merged.kind, merged.category, merged.title, merged.body ?? '', merged.emoji ?? null, merged.imageUrl ?? null, merged.color ?? null,
      merged.requireAck ? 1 : 0, merged.ackLabel ?? null, merged.kind === 'survey' && merged.options ? JSON.stringify(merged.options) : null,
      merged.countdownTo ?? null, merged.position ?? null, ...badgeCols(merged), merged.sound ? 1 : 0, JSON.stringify(merged.targets), merged.showOnKiosk ? 1 : 0,
      merged.startsAt ?? null, merged.endsAt ?? null, nowIso(), id,
    );
    audit(req.user!.username, 'announcement_updated', 'announcement', id, b, req.ip);
    if (b.publish && a.status === 'draft') publish(id);
    else republish(id);
    return { item: annDto(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow) };
  });

  app.post('/api/announcements/:id/publish', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    if (!ROLE_CATEGORIES[req.user!.role].includes(a.category)) return reply.code(403).send({ error: 'Bu kategoride yetkiniz yok' });
    const row = publish(id)!;
    audit(req.user!.username, 'announcement_published', 'announcement', id, undefined, req.ip);
    return { item: annDto(row) };
  });

  app.post('/api/announcements/:id/end', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    if (!ROLE_CATEGORIES[req.user!.role].includes(a.category)) return reply.code(403).send({ error: 'Bu kategoride yetkiniz yok' });
    endAnnouncement(id);
    audit(req.user!.username, 'announcement_ended', 'announcement', id, undefined, req.ip);
    return { ok: true };
  });

  app.delete('/api/announcements/:id', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    if (!ROLE_CATEGORIES[req.user!.role].includes(a.category)) return reply.code(403).send({ error: 'Bu kategoride yetkiniz yok' });
    if (a.status === 'active') return reply.code(400).send({ error: 'Önce yayını bitirin' });
    if (a.status === 'ended' && a.require_ack) return reply.code(400).send({ error: 'Zorunlu onaylı duyurular denetim kanıtıdır, silinemez' });
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    audit(req.user!.username, 'announcement_deleted', 'announcement', id, { title: a.title }, req.ip);
    return { ok: true };
  });
}
