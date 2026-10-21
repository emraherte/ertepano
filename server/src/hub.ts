import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AgentToServer, ServerToAgent, Telemetry } from '@ertepano/shared';
import { z } from 'zod';
import { config } from './config.js';
import { audit, db, nowIso } from './db.js';
import { activeForDevice, type AnnRow, type DeviceRow, deviceMatches, parseTargets, signItem } from './announcements.js';
import { publicKeyBase64, randomToken, safeEqualHex, sha256, uuid } from './security.js';
import { Limiter } from './auth.js';
import { deviceLimitReached, hasModule, REPORT_MODULE } from './license.js';

// ---- Bağlı ajanlar ---------------------------------------------------------------------------

interface Conn {
  socket: WebSocket;
  deviceId: string;
  base: string;
  alive: boolean;
  /** jeton kovası: saniyede 1 mesaj, en fazla 30 birikir */
  tokens: number;
  refillAt: number;
  dropped: number;
}

const BUCKET_MAX = 30;
/** Cihaz başına saatte en fazla bu kadar çalışan bildirimi (IT/İSG kuyruğu doldurulamasın) */
const REPORTS_PER_HOUR = 10;
const reportTimes = new Map<string, number[]>();

function takeToken(c: Conn): boolean {
  const now = Date.now();
  c.tokens = Math.min(BUCKET_MAX, c.tokens + (now - c.refillAt) / 1000);
  c.refillAt = now;
  if (c.tokens < 1) return false;
  c.tokens -= 1;
  return true;
}

/** Duyuru bu cihaza gerçekten gönderildi mi? (başka cihazın duyurusuna onay/yanıt yazılamasın) */
const wasSentTo = (annId: string, deviceId: string) =>
  !!db.prepare('SELECT 1 FROM deliveries WHERE announcement_id = ? AND device_id = ? AND sent_at IS NOT NULL').get(annId, deviceId);

const conns = new Map<string, Conn>();
const lastTelemetryRow = new Map<string, number>();
const TELEMETRY_ROW_EVERY_MS = 10 * 60_000;

const enrollLimiter = new Limiter(30, 10 * 60_000);

export const isOnline = (deviceId: string) => conns.has(deviceId);
export const onlineCount = () => conns.size;

function send(c: Conn, msg: ServerToAgent) {
  if (c.socket.readyState === c.socket.OPEN) c.socket.send(JSON.stringify(msg));
}

const getDevice = (id: string) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;

function markSent(annId: string, d: DeviceRow) {
  db.prepare(
    `INSERT INTO deliveries(announcement_id, device_id, user_login, sent_at) VALUES(?,?,?,?)
     ON CONFLICT(announcement_id, device_id) DO UPDATE SET sent_at = COALESCE(sent_at, excluded.sent_at), user_login = excluded.user_login`,
  ).run(annId, d.id, d.last_user, nowIso());
}

/** Cihaza tüm aktif duyurularının tam listesini gönder (listede olmayanı ajan kaldırır). */
export function syncDevice(deviceId: string) {
  const c = conns.get(deviceId);
  const d = getDevice(deviceId);
  if (!c || !d || d.status !== 'approved') return;
  const items = activeForDevice(d);
  items.forEach((a) => markSent(a.id, d));
  send(c, { t: 'sync', items: items.map((a) => signItem(a, c.base)) });
}

export function syncAll() {
  for (const id of conns.keys()) syncDevice(id);
}

/** Yeni aktif olan duyuruyu hedefteki bağlı cihazlara anında it. */
export function pushAnnouncement(a: AnnRow) {
  const targets = parseTargets(a.targets);
  for (const c of conns.values()) {
    const d = getDevice(c.deviceId);
    if (!d || d.status !== 'approved' || !deviceMatches(d, targets)) continue;
    markSent(a.id, d);
    send(c, { t: 'show', item: signItem(a, c.base) });
  }
}

export function revokeAnnouncement(id: string) {
  for (const c of conns.values()) send(c, { t: 'revoke', id });
}

/** Cihaz engellendi/silindi: bağlantısını kes. */
export function disconnectDevice(deviceId: string) {
  const c = conns.get(deviceId);
  if (c) {
    send(c, { t: 'error', code: 'auth' });
    c.socket.close();
    conns.delete(deviceId);
  }
}

// ---- Mesaj işleme ----------------------------------------------------------------------------

const telemetrySchema = z.object({
  hostname: z.string().max(128),
  ip: z.string().max(64).default(''),
  mac: z.string().max(64).default(''),
  user: z.string().max(128).default(''),
  os: z.string().max(128).default(''),
  cpuModel: z.string().max(128).default(''),
  cpuLoad: z.number().finite().default(0),
  ramTotalMb: z.number().finite().default(0),
  ramFreeMb: z.number().finite().default(0),
  diskTotalGb: z.number().finite().default(0),
  diskFreeGb: z.number().finite().default(0),
  uptimeSec: z.number().finite().default(0),
  agentVersion: z.string().max(32).default(''),
});

function onTelemetry(c: Conn, t: Telemetry) {
  const before = getDevice(c.deviceId);
  const now = nowIso();
  if (!hasModule('it')) {
    // Envanter IT modülünde: temel pakette donanım verisi saklanmaz (KVKK veri minimizasyonu)
    db.prepare("UPDATE devices SET hostname = ?, last_user = NULLIF(?, ''), agent_version = COALESCE(NULLIF(?, ''), agent_version), last_seen = ? WHERE id = ?").run(
      t.hostname, t.user, t.agentVersion, now, c.deviceId,
    );
    if ((before?.last_user ?? '') !== (t.user || '')) syncDevice(c.deviceId);
    return;
  }
  db.prepare(
    `UPDATE devices SET hostname=?, ip=?, mac=COALESCE(NULLIF(?, ''), mac), last_user=NULLIF(?, ''), os=?, cpu_model=?, cpu_load=?,
       ram_total_mb=?, ram_free_mb=?, disk_total_gb=?, disk_free_gb=?, uptime_sec=?, agent_version=COALESCE(NULLIF(?, ''), agent_version), last_seen=?
     WHERE id=?`,
  ).run(
    t.hostname, t.ip, t.mac, t.user, t.os, t.cpuModel, t.cpuLoad, Math.round(t.ramTotalMb), Math.round(t.ramFreeMb),
    t.diskTotalGb, t.diskFreeGb, Math.round(t.uptimeSec), t.agentVersion, now, c.deviceId,
  );
  const last = lastTelemetryRow.get(c.deviceId) ?? 0;
  if (Date.now() - last > TELEMETRY_ROW_EVERY_MS) {
    lastTelemetryRow.set(c.deviceId, Date.now());
    db.prepare('INSERT INTO telemetry(device_id, cpu_load, ram_free_mb, disk_free_gb, uptime_sec, collected_at) VALUES(?,?,?,?,?,?)').run(
      c.deviceId, t.cpuLoad, Math.round(t.ramFreeMb), t.diskFreeGb, Math.round(t.uptimeSec), now,
    );
  }
  // oturum açan kişi değiştiyse kişiye özel duyurular (doğum günü vb.) değişir
  if ((before?.last_user ?? '') !== (t.user || '')) syncDevice(c.deviceId);
}

const ACK_COLUMN = { seen: 'seen_at', read: 'read_at', acked: 'acked_at', dismissed: 'dismissed_at', answered: 'answered_at' } as const;

function onAck(c: Conn, id: string, action: keyof typeof ACK_COLUMN, answer?: string) {
  const d = getDevice(c.deviceId);
  if (!d || d.status !== 'approved' || !wasSentTo(id, d.id)) return;
  const col = ACK_COLUMN[action];
  const now = nowIso();
  db.prepare(
    `UPDATE deliveries SET ${col} = COALESCE(${col}, @now)${col === 'seen_at' ? '' : ', seen_at = COALESCE(seen_at, @now)'},
       user_login = COALESCE(@user, user_login)${action === 'answered' ? ', answer = COALESCE(answer, @answer)' : ''}
     WHERE announcement_id = @id AND device_id = @device`,
  ).run({ now, user: d.last_user, id, device: d.id, ...(action === 'answered' ? { answer: String(answer ?? '').slice(0, 200) } : {}) });
}

function onSafety(c: Conn, emergencyId: string, status: 'safe' | 'help', note?: string) {
  const d = getDevice(c.deviceId);
  const e = db.prepare('SELECT id, announcement_id, ended_at FROM emergencies WHERE id = ?').get(emergencyId) as
    | { id: string; announcement_id: string; ended_at: string | null }
    | undefined;
  if (!d || d.status !== 'approved' || !e || e.ended_at) return;
  // yalnızca bu acil durumun gönderildiği cihaz yanıt verebilir
  if (!e.announcement_id || !wasSentTo(e.announcement_id, d.id)) return;
  db.prepare(
    `INSERT INTO roll_calls(emergency_id, device_id, user_login, status, note, responded_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(emergency_id, device_id) DO UPDATE SET status = excluded.status, note = excluded.note, responded_at = excluded.responded_at,
       user_login = excluded.user_login`,
  ).run(emergencyId, d.id, d.last_user, status, note?.slice(0, 500) ?? null, nowIso());
  if (e.announcement_id) onAck(c, e.announcement_id, 'acked');
}

function onReport(c: Conn, kind: 'it_help' | 'near_miss', text: string, anonymous: boolean) {
  const d = getDevice(c.deviceId) as (DeviceRow & Record<string, unknown>) | undefined;
  if (!d || d.status !== 'approved' || !text.trim()) return;
  if (!hasModule(REPORT_MODULE[kind])) return; // modül lisanslı değil
  const hourAgo = Date.now() - 3600_000;
  const times = (reportTimes.get(d.id) ?? []).filter((t) => t > hourAgo);
  if (times.length >= REPORTS_PER_HOUR) return;
  times.push(Date.now());
  reportTimes.set(d.id, times);
  // Anonim ramak kala: kişi ve cihaz saklanmaz, sadece lokasyon (İSG analizi için) kalır.
  const anon = kind === 'near_miss' && anonymous;
  const summary = anon
    ? null
    : JSON.stringify({
        hostname: d.hostname, ip: d.ip, os: d.os, cpuModel: d.cpu_model, cpuLoad: d.cpu_load,
        ramTotalMb: d.ram_total_mb, ramFreeMb: d.ram_free_mb, diskTotalGb: d.disk_total_gb, diskFreeGb: d.disk_free_gb,
        uptimeSec: d.uptime_sec, agentVersion: d.agent_version,
      });
  const now = nowIso();
  db.prepare(
    `INSERT INTO reports(id, kind, text, anonymous, device_id, user_login, device_summary, location, status, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,'open',?,?)`,
  ).run(uuid(), kind, text.slice(0, 2000), anon ? 1 : 0, anon ? null : d.id, anon ? null : d.last_user, summary, d.location, now, now);
}

const agentMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), deviceId: z.string(), deviceSecret: z.string(), agentVersion: z.string().optional(), user: z.string().optional() }),
  z.object({ t: z.literal('telemetry'), data: telemetrySchema }),
  z.object({ t: z.literal('ack'), id: z.string(), action: z.enum(['seen', 'read', 'acked', 'dismissed', 'answered']), answer: z.string().optional() }),
  z.object({ t: z.literal('safety'), emergencyId: z.string(), status: z.enum(['safe', 'help']), note: z.string().optional() }),
  z.object({ t: z.literal('report'), kind: z.enum(['it_help', 'near_miss']), text: z.string().max(4000), anonymous: z.boolean().optional() }),
  z.object({ t: z.literal('pong') }),
]);

function baseUrlOf(req: FastifyRequest) {
  if (config.publicUrl) return config.publicUrl;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return `${proto}://${req.headers.host}`;
}

// ---- Rotalar ---------------------------------------------------------------------------------

export async function agentRoutes(app: FastifyInstance) {
  app.post('/api/agent/enroll', async (req, reply) => {
    const body = z
      .object({
        enrollKey: z.string().max(64),
        hostname: z.string().min(1).max(128),
        mac: z.string().max(64).default(''),
        os: z.string().max(128).default(''),
        agentVersion: z.string().max(32).default(''),
        user: z.string().max(128).default(''),
        // GPO (ErtePano.admx) ile OU başına verilebilen öneri; kayıt anahtarının varsayılanı varsa o kazanır
        location: z.string().trim().max(80).optional(),
        department: z.string().trim().max(80).optional(),
        /** Yeniden kayıtta eski cihaz sırrı: doğruysa onay durumu korunur */
        deviceSecret: z.string().max(128).optional(),
      })
      .parse(req.body);
    if (enrollLimiter.blocked(req.ip)) return reply.code(429).send({ error: 'Çok fazla kayıt denemesi' });
    const key = db.prepare('SELECT * FROM enroll_keys WHERE key = ? AND revoked = 0').get(body.enrollKey.trim().toUpperCase()) as
      | { id: string; auto_approve: number; default_location: string | null; default_department: string | null }
      | undefined;
    if (!key) {
      enrollLimiter.hit(req.ip);
      audit(null, 'enroll_rejected', 'device', null, { hostname: body.hostname }, req.ip);
      return reply.code(403).send({ error: 'Geçersiz kayıt anahtarı' });
    }
    const location = key.default_location || body.location || null;
    const department = key.default_department || body.department || null;
    const secret = randomToken();
    const now = nowIso();
    const existing = db.prepare('SELECT id, status, secret_hash FROM devices WHERE hostname = ? AND mac = ?').get(body.hostname, body.mac) as
      | { id: string; status: string; secret_hash: string }
      | undefined;
    let deviceId: string;
    let status: string;
    if (existing) {
      if (existing.status === 'blocked') return reply.code(403).send({ error: 'Bu cihaz engellenmiş' });
      deviceId = existing.id;
      // Hostname + MAC istemcinin beyanıdır: eski sırrı kanıtlayamayan yeniden kayıt IT onayına düşer.
      // Böylece kayıt anahtarını bilen biri onaylı bir cihazın kimliğine bürünemez.
      const proven = !!body.deviceSecret && /^[0-9a-f]+$/.test(body.deviceSecret) && safeEqualHex(existing.secret_hash, sha256(body.deviceSecret));
      status = proven || existing.status === 'pending' ? existing.status : key.auto_approve && existing.status !== 'approved' ? 'approved' : 'pending';
      if (!proven && existing.status === 'approved') {
        disconnectDevice(deviceId);
        audit(null, 'device_reenrolled_pending', 'device', deviceId, { hostname: body.hostname, reason: 'eski cihaz sırrı kanıtlanmadı' }, req.ip);
      }
      db.prepare('UPDATE devices SET secret_hash = ?, status = ?, os = ?, agent_version = ?, last_user = ?, ip = ?, last_seen = ? WHERE id = ?').run(
        sha256(secret), status, body.os, body.agentVersion, body.user || null, req.ip, now, deviceId,
      );
      // IT'nin panelde verdiği etiketi ezme; yalnızca boşsa doldur
      db.prepare('UPDATE devices SET location = COALESCE(location, ?), department = COALESCE(department, ?) WHERE id = ?').run(location, department, deviceId);
    } else {
      deviceId = uuid();
      status = key.auto_approve && !deviceLimitReached() ? 'approved' : 'pending';
      db.prepare(
        `INSERT INTO devices(id, secret_hash, hostname, mac, ip, os, agent_version, last_user, location, department, status, first_seen, last_seen)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(deviceId, sha256(secret), body.hostname, body.mac, req.ip, body.os, body.agentVersion, body.user || null,
        location, department, status, now, now);
    }
    db.prepare('UPDATE enroll_keys SET uses = uses + 1 WHERE id = ?').run(key.id);
    audit(null, 'device_enrolled', 'device', deviceId, { hostname: body.hostname, status }, req.ip);
    return { deviceId, deviceSecret: secret, status, publicKey: publicKeyBase64 };
  });

  /** WebSocket kurulamayan ortamlar için yedek: aktif duyuruların imzalı listesi. */
  app.get('/api/agent/announcements', async (req, reply) => {
    const auth = String(req.headers.authorization ?? '');
    const m = /^Device ([\w-]+):([0-9a-f]+)$/.exec(auth);
    const d = m ? (db.prepare('SELECT * FROM devices WHERE id = ?').get(m[1]) as (DeviceRow & { secret_hash: string }) | undefined) : undefined;
    if (!m || !d || !safeEqualHex(d.secret_hash, sha256(m[2]))) return reply.code(401).send({ error: 'auth' });
    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(nowIso(), d.id);
    const base = baseUrlOf(req);
    return { status: d.status, items: activeForDevice(d).map((a) => signItem(a, base)) };
  });

  app.get('/ws/agent', { websocket: true }, (socket: WebSocket, req) => {
    const base = baseUrlOf(req);
    let conn: Conn | null = null;
    const helloTimer = setTimeout(() => {
      if (!conn) socket.close(4001, 'hello timeout');
    }, 5000);

    socket.on('message', (raw) => {
      let msg: AgentToServer;
      try {
        msg = agentMsg.parse(JSON.parse(raw.toString())) as AgentToServer;
      } catch {
        return; // bozuk mesajı yok say
      }
      if (!conn) {
        if (msg.t !== 'hello') return;
        const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(msg.deviceId) as (DeviceRow & { secret_hash: string }) | undefined;
        if (!d || d.status === 'blocked' || !/^[0-9a-f]+$/.test(msg.deviceSecret) || !safeEqualHex(d.secret_hash, sha256(msg.deviceSecret))) {
          socket.send(JSON.stringify({ t: 'error', code: 'auth' } satisfies ServerToAgent));
          socket.close(4003, 'auth');
          return;
        }
        clearTimeout(helloTimer);
        conns.get(d.id)?.socket.close(4000, 'replaced');
        conn = { socket, deviceId: d.id, base, alive: true, tokens: BUCKET_MAX, refillAt: Date.now(), dropped: 0 };
        conns.set(d.id, conn);
        db.prepare('UPDATE devices SET last_seen = ?, agent_version = COALESCE(?, agent_version), last_user = COALESCE(?, last_user), ip = ? WHERE id = ?').run(
          nowIso(), msg.agentVersion ?? null, msg.user || null, req.ip, d.id,
        );
        send(conn, { t: 'welcome', status: d.status === 'approved' ? 'approved' : 'pending', serverTime: nowIso() });
        syncDevice(d.id);
        return;
      }
      conn.alive = true;
      if (msg.t !== 'pong' && !takeToken(conn)) {
        // sürekli taşan bağlantı kapatılır
        if (++conn.dropped > 200) socket.close(4008, 'rate');
        return;
      }
      switch (msg.t) {
        case 'telemetry':
          onTelemetry(conn, msg.data);
          break;
        case 'ack':
          onAck(conn, msg.id, msg.action, msg.answer);
          break;
        case 'safety':
          onSafety(conn, msg.emergencyId, msg.status, msg.note);
          break;
        case 'report':
          onReport(conn, msg.kind, msg.text, !!msg.anonymous);
          break;
        default:
          break;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (conn && conns.get(conn.deviceId) === conn) {
        conns.delete(conn.deviceId);
        db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(nowIso(), conn.deviceId);
      }
    });
    socket.on('error', () => socket.close());
  });

  // Kalp atışı: 30 sn'de bir ping; önceki ping'e yanıt vermeyen bağlantı kapatılır.
  const timer = setInterval(() => {
    for (const c of conns.values()) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      send(c, { t: 'ping' });
    }
  }, 30_000);
  app.addHook('onClose', async () => clearInterval(timer));
}
