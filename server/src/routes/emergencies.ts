import type { FastifyInstance } from 'fastify';
import { EMERGENCY_ROLES, EMERGENCY_TYPES, type Role } from '@ertepano/shared';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { audit, db, nowIso } from '../db.js';
import { approvedDevices, countTargets, deviceMatches, parseTargets } from '../announcements.js';
import { endAnnouncement, publish } from '../lifecycle.js';
import { isOnline } from '../hub.js';
import { uuid } from '../security.js';
import { EMERGENCY_TEMPLATES } from '../templates.js';
import { hasModule } from '../license.js';

interface EmergencyRow {
  id: string;
  type: string;
  title: string;
  body: string;
  drill: number;
  targets: string;
  announcement_id: string | null;
  started_by: string | null;
  started_at: string;
  ended_by: string | null;
  ended_at: string | null;
  end_note: string | null;
  target_count: number;
}

/** IT yalnızca siber olay yayınlar; İSG ve yönetici hepsini. */
const canStart = (role: Role, type: string) => role === 'admin' || role === 'isg' || (role === 'it' && type === 'siber');
/** Siber olay IT modülünde, diğer acil durumlar İSG modülünde */
const typeLicensed = (type: string) => (type === 'siber' ? hasModule('it') : hasModule('isg'));

/** Yoklamadaki kişi adları ve "yardım" notları (sağlık verisi olabilir) yalnızca olayı yönetebilen rollere. */
function detailFor(e: EmergencyRow, role: Role) {
  const d = detail(e);
  if (canStart(role, e.type)) return { ...d, personal: true };
  return { ...d, personal: false, help: [], safe: [], noResponse: [] };
}

function detail(e: EmergencyRow) {
  const targets = parseTargets(e.targets);
  const devices = approvedDevices().filter((d) => deviceMatches(d, targets));
  const responses = db
    .prepare(
      `SELECT r.device_id deviceId, r.status, r.note, r.responded_at respondedAt, r.user_login userLogin, v.hostname, v.location, v.department
       FROM roll_calls r JOIN devices v ON v.id = r.device_id WHERE r.emergency_id = ? ORDER BY r.responded_at`,
    )
    .all(e.id) as { deviceId: string; status: 'safe' | 'help'; note: string | null; respondedAt: string; userLogin: string | null; hostname: string; location: string | null; department: string | null }[];
  const responded = new Set(responses.map((r) => r.deviceId));
  const noResponse = devices
    .filter((d) => !responded.has(d.id))
    .map((d) => ({ deviceId: d.id, hostname: d.hostname, userLogin: d.last_user, location: d.location, department: d.department, online: isOnline(d.id) }));

  const byLocation = new Map<string, { location: string; total: number; safe: number; help: number; noResponse: number }>();
  const loc = (l: string | null) => l || 'Lokasyonsuz';
  const bucket = (l: string | null) => {
    const k = loc(l);
    if (!byLocation.has(k)) byLocation.set(k, { location: k, total: 0, safe: 0, help: 0, noResponse: 0 });
    return byLocation.get(k)!;
  };
  devices.forEach((d) => bucket(d.location).total++);
  responses.forEach((r) => bucket(r.location)[r.status]++);
  noResponse.forEach((n) => bucket(n.location).noResponse++);

  const startMs = Date.parse(e.started_at);
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    body: e.body,
    drill: !!e.drill,
    targets,
    startedBy: e.started_by,
    startedAt: e.started_at,
    endedBy: e.ended_by,
    endedAt: e.ended_at,
    endNote: e.end_note,
    counts: {
      targets: devices.length,
      safe: responses.filter((r) => r.status === 'safe').length,
      help: responses.filter((r) => r.status === 'help').length,
      noResponse: noResponse.length,
    },
    byLocation: [...byLocation.values()].sort((a, b) => b.help - a.help || b.noResponse - a.noResponse),
    help: responses.filter((r) => r.status === 'help'),
    safe: responses.filter((r) => r.status === 'safe').map((r) => ({ ...r, afterSec: Math.round((Date.parse(r.respondedAt) - startMs) / 1000) })),
    noResponse,
  };
}

export async function emergencyRoutes(app: FastifyInstance) {
  app.get('/api/emergency-templates', { preHandler: requireRole() }, async () => ({ items: EMERGENCY_TEMPLATES.filter((t) => typeLicensed(t.type)) }));

  app.get('/api/emergencies', { preHandler: requireRole() }, async () => {
    const rows = db.prepare('SELECT * FROM emergencies ORDER BY started_at DESC LIMIT 100').all() as EmergencyRow[];
    return {
      items: rows.map((e) => {
        const c = db
          .prepare("SELECT SUM(status='safe') safe, SUM(status='help') help FROM roll_calls WHERE emergency_id = ?")
          .get(e.id) as { safe: number | null; help: number | null };
        return {
          id: e.id, type: e.type, title: e.title, drill: !!e.drill, startedBy: e.started_by, startedAt: e.started_at, endedAt: e.ended_at,
          targetCount: e.target_count, safe: c.safe ?? 0, help: c.help ?? 0,
        };
      }),
    };
  });

  app.get('/api/emergencies/active', { preHandler: requireRole() }, async (req) => {
    const e = db.prepare('SELECT * FROM emergencies WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as EmergencyRow | undefined;
    return { item: e ? detailFor(e, req.user!.role) : null };
  });

  app.get('/api/emergencies/:id', { preHandler: requireRole() }, async (req, reply) => {
    const e = db.prepare('SELECT * FROM emergencies WHERE id = ?').get((req.params as { id: string }).id) as EmergencyRow | undefined;
    if (!e) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    return { item: detailFor(e, req.user!.role) };
  });

  app.post('/api/emergencies', { preHandler: requireRole(...EMERGENCY_ROLES) }, async (req, reply) => {
    const b = z
      .object({
        type: z.enum(EMERGENCY_TYPES),
        title: z.string().trim().max(140).optional(),
        body: z.string().max(1000).optional(),
        drill: z.boolean().default(false),
        targets: z.array(z.string()).min(1).default(['all']),
      })
      .parse(req.body);
    if (!canStart(req.user!.role, b.type)) return reply.code(403).send({ error: 'Bu acil durum türünü başlatma yetkiniz yok' });
    if (!typeLicensed(b.type)) return reply.code(402).send({ error: b.type === 'siber' ? 'Siber olay uyarısı IT modülündedir' : 'Acil durum yayını İSG modülündedir', code: 'module_not_licensed' });
    const active = db.prepare('SELECT id FROM emergencies WHERE ended_at IS NULL').get();
    if (active) return reply.code(409).send({ error: 'Zaten devam eden bir acil durum var. Önce onu bitirin.' });

    const tpl = EMERGENCY_TEMPLATES.find((t) => t.type === b.type)!;
    const title = b.title || tpl.title;
    const body = b.body ?? tpl.body;
    if (!title) return reply.code(400).send({ error: 'Başlık gerekli' });
    const now = nowIso();
    const emergencyId = uuid();
    const annId = uuid();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO announcements(id, kind, category, title, body, emoji, color, require_ack, sound, targets, show_on_kiosk, status, starts_at,
           emergency_id, drill, created_by, created_at, updated_at)
         VALUES(?, 'fullscreen', ?, ?, ?, ?, ?, 1, 1, ?, 1, 'draft', ?, ?, ?, ?, ?, ?)`,
      ).run(annId, b.type === 'siber' ? 'it' : 'isg', title, body, tpl.emoji, tpl.color, JSON.stringify(b.targets), now, emergencyId,
        b.drill ? 1 : 0, req.user!.username, now, now);
      db.prepare(
        `INSERT INTO emergencies(id, type, title, body, drill, targets, announcement_id, started_by, started_at, target_count)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run(emergencyId, b.type, title, body, b.drill ? 1 : 0, JSON.stringify(b.targets), annId, req.user!.username, now, countTargets(b.targets));
    })();
    publish(annId);
    audit(req.user!.username, b.drill ? 'drill_started' : 'emergency_started', 'emergency', emergencyId, { type: b.type, targets: b.targets }, req.ip);
    return { item: detailFor(db.prepare('SELECT * FROM emergencies WHERE id = ?').get(emergencyId) as EmergencyRow, req.user!.role) };
  });

  app.post('/api/emergencies/:id/end', { preHandler: requireRole(...EMERGENCY_ROLES) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({ note: z.string().max(1000).optional(), mode: z.enum(['all_clear', 'false_alarm', 'silent']).default('all_clear') })
      .parse(req.body ?? {});
    const e = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id) as EmergencyRow | undefined;
    if (!e) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    if (e.ended_at) return reply.code(400).send({ error: 'Bu acil durum zaten bitmiş' });
    // IT yangın/deprem alarmını bitirip "tehlike geçti" yayınlayamaz; yalnızca başlatabileceği türü bitirir
    if (!canStart(req.user!.role, e.type)) return reply.code(403).send({ error: 'Bu acil durumu sonlandırma yetkiniz yok' });
    const now = nowIso();
    db.prepare('UPDATE emergencies SET ended_at = ?, ended_by = ?, end_note = ? WHERE id = ?').run(now, req.user!.username, b.note ?? null, id);
    if (e.announcement_id) endAnnouncement(e.announcement_id);

    // Bilgilendirme kartı: "Tehlike geçti" ya da "Yanlış alarm" — 30 dk ekranda.
    if (b.mode !== 'silent') {
      const annId = uuid();
      const allClear = b.mode === 'all_clear';
      db.prepare(
        `INSERT INTO announcements(id, kind, category, title, body, emoji, color, require_ack, targets, show_on_kiosk, status, starts_at, ends_at,
           drill, created_by, created_at, updated_at)
         VALUES(?, 'toast', ?, ?, ?, ?, ?, 0, ?, 1, 'draft', ?, ?, ?, ?, ?, ?)`,
      ).run(
        annId, e.type === 'siber' ? 'it' : 'isg',
        allClear ? (e.drill ? 'Tatbikat tamamlandı' : 'Tehlike geçti') : 'Yanlış alarm — iptal',
        b.note || (allClear ? 'Görevlilerin talimatıyla çalışma alanlarınıza dönebilirsiniz. Katılımınız için teşekkürler.' : 'Az önceki acil durum uyarısı yanlışlıkla gönderildi. Lütfen dikkate almayın.'),
        allClear ? '✅' : 'ℹ️', allClear ? '#079455' : '#475467', e.targets, now, new Date(Date.now() + 30 * 60_000).toISOString(),
        e.drill, req.user!.username, now, now,
      );
      publish(annId);
    }
    audit(req.user!.username, e.drill ? 'drill_ended' : 'emergency_ended', 'emergency', id, { mode: b.mode, note: b.note }, req.ip);
    return { item: detailFor(db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id) as EmergencyRow, req.user!.role) };
  });
}
