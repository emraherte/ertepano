import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ReportKind, Role } from '@ertepano/shared';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { audit, db, nowIso } from '../db.js';
import { disconnectDevice, isOnline, syncDevice } from '../hub.js';
import { newEnrollKey, publicKeyBase64, uuid } from '../security.js';
import { deviceLimitReached, hasModule, licenseInfo, REPORT_MODULE, requireModule } from '../license.js';

interface DeviceFull {
  id: string;
  hostname: string;
  mac: string | null;
  ip: string | null;
  os: string | null;
  agent_version: string | null;
  last_user: string | null;
  location: string | null;
  department: string | null;
  note: string | null;
  status: string;
  cpu_model: string | null;
  cpu_load: number | null;
  ram_total_mb: number | null;
  ram_free_mb: number | null;
  disk_total_gb: number | null;
  disk_free_gb: number | null;
  uptime_sec: number | null;
  first_seen: string;
  last_seen: string;
  cert_subject: string | null;
  cert_valid_to: string | null;
}

const DAY = 86400_000;

/** Cihaz için IT uyarıları (panelde rozet olarak gösterilir). */
export function deviceAlerts(d: DeviceFull, online: boolean): string[] {
  const out: string[] = [];
  if (d.status === 'pending') out.push('Onay bekliyor');
  if (d.disk_total_gb && d.disk_free_gb != null && (1 - d.disk_free_gb / d.disk_total_gb) >= 0.9) out.push('Disk %90+ dolu');
  if (d.uptime_sec && d.uptime_sec >= 14 * 86400) out.push(`${Math.floor(d.uptime_sec / 86400)} gündür yeniden başlatılmadı`);
  if (!online && Date.now() - Date.parse(d.last_seen) > 7 * DAY) out.push('7+ gündür görünmüyor');
  if (d.ram_total_mb && d.ram_total_mb < 6000) out.push('RAM 8 GB altı');
  if (d.cert_valid_to && Date.parse(d.cert_valid_to) - Date.now() < 14 * DAY) out.push('İstemci sertifikası 14 gün içinde doluyor');
  return out;
}

export function deviceDto(d: DeviceFull) {
  const online = isOnline(d.id);
  // Donanım ayrıntıları ve uyarılar IT modülünde; temel pakette yalnızca kimlik/durum
  if (!hasModule('it')) {
    return {
      id: d.id, hostname: d.hostname, mac: null, ip: null, os: null, agentVersion: d.agent_version, lastUser: d.last_user,
      location: d.location, department: d.department, note: d.note, status: d.status, cpuModel: null, cpuLoad: null,
      ramTotalMb: null, ramFreeMb: null, diskTotalGb: null, diskFreeGb: null, uptimeSec: null, firstSeen: d.first_seen,
      lastSeen: d.last_seen, online, alerts: d.status === 'pending' ? ['Onay bekliyor'] : [],
    };
  }
  return {
    id: d.id, hostname: d.hostname, mac: d.mac, ip: d.ip, os: d.os, agentVersion: d.agent_version, lastUser: d.last_user,
    location: d.location, department: d.department, note: d.note, status: d.status, cpuModel: d.cpu_model, cpuLoad: d.cpu_load,
    ramTotalMb: d.ram_total_mb, ramFreeMb: d.ram_free_mb, diskTotalGb: d.disk_total_gb, diskFreeGb: d.disk_free_gb,
    uptimeSec: d.uptime_sec, firstSeen: d.first_seen, lastSeen: d.last_seen, online, alerts: deviceAlerts(d, online),
    certSubject: d.cert_subject, certValidTo: d.cert_valid_to,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Excel formül enjeksiyonuna karşı = + - @ ile başlayanlara ' ekle
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

function baseUrl(req: FastifyRequest) {
  return config.publicUrl || `${req.protocol}://${req.headers.host}`;
}

export async function deviceRoutes(app: FastifyInstance) {
  const itOnly = { preHandler: requireRole('it') };

  app.get('/api/devices', itOnly, async () => {
    const rows = db.prepare('SELECT * FROM devices ORDER BY hostname').all() as DeviceFull[];
    return { items: rows.map(deviceDto) };
  });

  app.get('/api/devices.csv', { preHandler: [requireRole('it'), requireModule('it')] }, async (req, reply) => {
    const rows = (db.prepare('SELECT * FROM devices ORDER BY hostname').all() as DeviceFull[]).map(deviceDto);
    const head = ['Bilgisayar', 'Durum', 'Çevrimiçi', 'Kullanıcı', 'Lokasyon', 'Departman', 'IP', 'MAC', 'İşletim sistemi', 'CPU', 'RAM (GB)',
      'Disk (GB)', 'Disk boş (GB)', 'Açık kalma (gün)', 'Ajan sürümü', 'Son görülme', 'Uyarılar'];
    const lines = rows.map((d) =>
      [d.hostname, d.status, d.online ? 'Evet' : 'Hayır', d.lastUser, d.location, d.department, d.ip, d.mac, d.os, d.cpuModel,
        d.ramTotalMb ? (d.ramTotalMb / 1024).toFixed(1) : '', d.diskTotalGb?.toFixed(0), d.diskFreeGb?.toFixed(0),
        d.uptimeSec ? (d.uptimeSec / 86400).toFixed(1) : '', d.agentVersion, d.lastSeen, d.alerts.join(' | ')].map(csvCell).join(';'),
    );
    audit(req.user!.username, 'devices_exported', 'device', null, { count: rows.length }, req.ip);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="cihazlar.csv"');
    return '﻿' + [head.join(';'), ...lines].join('\r\n');
  });

  app.get('/api/devices/:id', itOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceFull | undefined;
    if (!d) return reply.code(404).send({ error: 'Cihaz bulunamadı' });
    const telemetry = db
      .prepare('SELECT cpu_load cpuLoad, ram_free_mb ramFreeMb, disk_free_gb diskFreeGb, collected_at at FROM telemetry WHERE device_id = ? AND collected_at >= ? ORDER BY collected_at')
      .all(id, new Date(Date.now() - 7 * DAY).toISOString());
    const kinds = visibleKinds(req.user!.role);
    const reports = kinds.length
      ? db.prepare(`SELECT id, kind, text, status, created_at createdAt FROM reports WHERE device_id = ? AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 20`).all(id, ...kinds)
      : [];
    return { item: deviceDto(d), telemetry, reports };
  });

  app.patch('/api/devices/:id', itOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        location: z.string().trim().max(80).nullable().optional(),
        department: z.string().trim().max(80).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        status: z.enum(['pending', 'approved', 'blocked']).optional(),
      })
      .parse(req.body);
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceFull | undefined;
    if (!d) return reply.code(404).send({ error: 'Cihaz bulunamadı' });
    if (b.status === 'approved' && d.status !== 'approved' && deviceLimitReached()) {
      return reply.code(402).send({ error: `Lisans cihaz sınırına ulaşıldı (${licenseInfo().maxDevices}). Lisansınızı yükseltin ya da kullanılmayan cihazları silin.`, code: 'device_limit' });
    }
    db.prepare('UPDATE devices SET location = ?, department = ?, note = ?, status = ? WHERE id = ?').run(
      b.location === undefined ? d.location : b.location || null,
      b.department === undefined ? d.department : b.department || null,
      b.note === undefined ? d.note : b.note,
      b.status ?? d.status,
      id,
    );
    audit(req.user!.username, 'device_updated', 'device', id, b, req.ip);
    if (b.status === 'blocked') disconnectDevice(id);
    else syncDevice(id);
    return { item: deviceDto(db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceFull) };
  });

  /** Toplu işlem: onayla / lokasyon-departman ata. */
  app.post('/api/devices/bulk', itOnly, async (req) => {
    const b = z
      .object({
        ids: z.array(z.string()).min(1).max(5000),
        approve: z.boolean().optional(),
        location: z.string().trim().max(80).optional(),
        department: z.string().trim().max(80).optional(),
      })
      .parse(req.body);
    let room = Math.max(0, licenseInfo().maxDevices - licenseInfo().deviceCount);
    let skipped = 0;
    const tx = db.transaction(() => {
      for (const id of b.ids) {
        if (b.approve) {
          const pending = db.prepare("SELECT 1 FROM devices WHERE id = ? AND status = 'pending'").get(id);
          if (pending && room > 0) {
            db.prepare("UPDATE devices SET status = 'approved' WHERE id = ?").run(id);
            room--;
          } else if (pending) skipped++;
        }
        if (b.location !== undefined) db.prepare('UPDATE devices SET location = ? WHERE id = ?').run(b.location || null, id);
        if (b.department !== undefined) db.prepare('UPDATE devices SET department = ? WHERE id = ?').run(b.department || null, id);
      }
    });
    tx();
    b.ids.forEach(syncDevice);
    audit(req.user!.username, 'devices_bulk_updated', 'device', null, b, req.ip);
    return { ok: true, count: b.ids.length, skipped, ...(skipped ? { error: `${skipped} cihaz lisans sınırı nedeniyle onaylanmadı` } : {}) };
  });

  app.delete('/api/devices/:id', itOnly, async (req) => {
    const { id } = req.params as { id: string };
    disconnectDevice(id);
    db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    audit(req.user!.username, 'device_deleted', 'device', id, undefined, req.ip);
    return { ok: true };
  });

  // ---- Kayıt anahtarları ve ajan yapılandırması ----

  app.get('/api/enroll-keys', itOnly, async () => ({
    items: db.prepare('SELECT id, key, label, auto_approve autoApprove, default_location defaultLocation, default_department defaultDepartment, uses, revoked, created_by createdBy, created_at createdAt FROM enroll_keys ORDER BY created_at DESC').all(),
    publicKey: publicKeyBase64,
  }));

  app.post('/api/enroll-keys', itOnly, async (req) => {
    const b = z
      .object({
        label: z.string().trim().min(1).max(80),
        autoApprove: z.boolean().default(false),
        defaultLocation: z.string().trim().max(80).optional(),
        defaultDepartment: z.string().trim().max(80).optional(),
      })
      .parse(req.body);
    const id = uuid();
    const key = newEnrollKey();
    db.prepare('INSERT INTO enroll_keys(id, key, label, auto_approve, default_location, default_department, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, key, b.label, b.autoApprove ? 1 : 0, b.defaultLocation || null, b.defaultDepartment || null, req.user!.username, nowIso(),
    );
    audit(req.user!.username, 'enroll_key_created', 'enroll_key', id, { label: b.label, autoApprove: b.autoApprove }, req.ip);
    return { id, key };
  });

  app.post('/api/enroll-keys/:id/revoke', itOnly, async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('UPDATE enroll_keys SET revoked = 1 WHERE id = ?').run(id);
    audit(req.user!.username, 'enroll_key_revoked', 'enroll_key', id, undefined, req.ip);
    return { ok: true };
  });

  /** GPO ile dağıtılacak agent.json içeriği. */
  app.get('/api/enroll-keys/:id/agent-config', itOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const k = db.prepare('SELECT key FROM enroll_keys WHERE id = ? AND revoked = 0').get(id) as { key: string } | undefined;
    if (!k) return reply.code(404).send({ error: 'Anahtar bulunamadı' });
    return { serverUrl: baseUrl(req), enrollKey: k.key, publicKey: publicKeyBase64 };
  });

  // ---- Çalışan bildirimleri (IT'ye bildir) ----

  const visibleKinds = (role: Role): ReportKind[] =>
    (role === 'admin' || role === 'it' ? (['it_help'] as ReportKind[]) : []).filter((k) =>
      hasModule(REPORT_MODULE[k]),
    );

  app.get('/api/reports', { preHandler: requireRole('it') }, async (req) => {
    const kinds = visibleKinds(req.user!.role);
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const rows = db
      .prepare(
        `SELECT r.id, r.kind, r.text, r.anonymous, r.user_login userLogin, r.device_summary deviceSummary, r.location, r.status,
                r.handled_by handledBy, r.handler_note handlerNote, r.created_at createdAt, r.updated_at updatedAt, d.hostname, r.device_id deviceId
         FROM reports r LEFT JOIN devices d ON d.id = r.device_id
         WHERE r.kind IN (${kinds.map(() => '?').join(',') || "''"}) ${q.status ? 'AND r.status = ?' : ''}
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 500`,
      )
      .all(...kinds, ...(q.status ? [q.status] : [])) as Record<string, unknown>[];
    return { items: rows.map((r) => ({ ...r, anonymous: !!r.anonymous, deviceSummary: r.deviceSummary ? JSON.parse(String(r.deviceSummary)) : null })) };
  });

  app.patch('/api/reports/:id', { preHandler: requireRole('it') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['open', 'in_progress', 'closed']), handlerNote: z.string().max(1000).optional() }).parse(req.body);
    const r = db.prepare('SELECT kind FROM reports WHERE id = ?').get(id) as { kind: ReportKind } | undefined;
    if (!r || !visibleKinds(req.user!.role).includes(r.kind)) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    db.prepare('UPDATE reports SET status = ?, handler_note = COALESCE(?, handler_note), handled_by = ?, updated_at = ? WHERE id = ?').run(
      b.status, b.handlerNote ?? null, req.user!.username, nowIso(), id,
    );
    audit(req.user!.username, 'report_updated', 'report', id, b, req.ip);
    return { ok: true };
  });
}
