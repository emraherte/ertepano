// Uzaktan destek (docs/PROTOKOL.md §7): çalışanın onayıyla ekran paylaşımı ve isteğe bağlı kontrol.
// Sunucu görüntüyü SAKLAMAZ; ajanın kanalından teknisyenin tarayıcısına aktarır. Kim, ne zaman, neden, ne kadar süre
// bağlandı bilgisi support_sessions ve denetim kaydında tutulur.
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { getSecurity, requireRole, sessionUser } from './auth.js';
import { audit, db, nowIso } from './db.js';
import { isOnline, sendToDevice, setSupportResponseHandler } from './hub.js';
import { hasModule, requireModule } from './license.js';
import { randomToken, safeEqualHex, sha256, sign, uuid } from './security.js';

/** Çalışanın onay penceresinin açık kalabileceği süre */
const REQUEST_TTL_MS = 90_000;
/** Onaydan sonra ajanın görüntü kanalını açması için süre */
const CONNECT_TTL_MS = 30_000;

type Status = 'requested' | 'accepted' | 'active' | 'denied' | 'expired' | 'ended' | 'failed';

interface Row {
  id: string;
  device_id: string;
  technician_id: string;
  technician: string;
  reason: string;
  mode: 'view' | 'control';
  allow_control: number;
  status: Status;
  user_login: string | null;
  relay_token_hash: string | null;
  requested_at: string;
  responded_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  end_reason: string | null;
}

/** Bellekteki canlı durum: ajan kanalı, teknisyen tarayıcıları, zamanlayıcılar */
interface Live {
  agent: WebSocket | null;
  viewers: Set<WebSocket>;
  timers: NodeJS.Timeout[];
  lastScreen: string | null;
}
const live = new Map<string, Live>();

const getRow = (id: string) => db.prepare('SELECT * FROM support_sessions WHERE id = ?').get(id) as Row | undefined;

function liveOf(id: string): Live {
  let l = live.get(id);
  if (!l) {
    l = { agent: null, viewers: new Set(), timers: [], lastScreen: null };
    live.set(id, l);
  }
  return l;
}

function dto(r: Row) {
  return {
    id: r.id,
    deviceId: r.device_id,
    technician: r.technician,
    reason: r.reason,
    mode: r.mode,
    allowControl: !!r.allow_control,
    status: r.status,
    userLogin: r.user_login,
    requestedAt: r.requested_at,
    respondedAt: r.responded_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    endedBy: r.ended_by,
    endReason: r.end_reason,
    durationSec: r.started_at ? Math.round((Date.parse(r.ended_at ?? nowIso()) - Date.parse(r.started_at)) / 1000) : null,
  };
}

function toViewers(id: string, msg: object) {
  const text = JSON.stringify(msg);
  for (const v of liveOf(id).viewers) if (v.readyState === v.OPEN) v.send(text);
}

function pushStatus(id: string) {
  const r = getRow(id);
  if (r) toViewers(id, { t: 'status', session: dto(r) });
}

/** Oturumu kapat: durum, denetim kaydı, ajana ve tarayıcılara bildirim. Birden çok kez çağrılabilir. */
function finish(id: string, status: Status, by: string, reason: string) {
  const r = getRow(id);
  if (!r || ['denied', 'expired', 'ended', 'failed'].includes(r.status)) return;
  db.prepare('UPDATE support_sessions SET status = ?, ended_at = ?, ended_by = ?, end_reason = ?, relay_token_hash = NULL WHERE id = ?').run(
    status, nowIso(), by, reason, id,
  );
  const l = live.get(id);
  pushStatus(id);
  sendToDevice(r.device_id, { t: 'support_end', sessionId: id });
  if (l) {
    l.timers.forEach(clearTimeout);
    if (l.agent && l.agent.readyState === l.agent.OPEN) {
      l.agent.send(JSON.stringify({ t: 'end' }));
      l.agent.close(1000, 'end');
    }
    for (const v of l.viewers) v.close(1000, 'end');
    live.delete(id);
  }
  const done = getRow(id)!;
  audit(by === 'technician' ? r.technician : by, `support_${status}`, 'device', r.device_id, {
    sessionId: id,
    reason,
    user: r.user_login,
    durationSec: dto(done).durationSec,
  });
}

/** Ajan → sunucu: çalışan onayladı / reddetti */
function onResponse(deviceId: string, msg: { sessionId: string; accepted: boolean; allowControl?: boolean; user?: string; reason?: string }) {
  const r = getRow(msg.sessionId);
  if (!r || r.device_id !== deviceId || r.status !== 'requested') return;
  if (!msg.accepted) {
    db.prepare('UPDATE support_sessions SET responded_at = ?, user_login = ? WHERE id = ?').run(nowIso(), msg.user ?? null, r.id);
    finish(r.id, 'denied', msg.user ?? 'kullanıcı', msg.reason ?? 'çalışan reddetti');
    return;
  }
  const allow = r.mode === 'control' && !!msg.allowControl;
  db.prepare("UPDATE support_sessions SET status = 'accepted', responded_at = ?, user_login = ?, allow_control = ? WHERE id = ?").run(
    nowIso(), msg.user ?? null, allow ? 1 : 0, r.id,
  );
  audit(msg.user ?? 'kullanıcı', 'support_accepted', 'device', deviceId, { sessionId: r.id, technician: r.technician, allowControl: allow });
  const l = liveOf(r.id);
  l.timers.push(
    setTimeout(() => {
      if (getRow(r.id)?.status === 'accepted') finish(r.id, 'failed', 'sunucu', 'ajan görüntü bağlantısını açmadı');
    }, CONNECT_TTL_MS),
  );
  pushStatus(r.id);
}

const inputSchema = z.object({
  t: z.literal('input'),
  kind: z.enum(['move', 'down', 'up', 'wheel', 'keydown', 'keyup']),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  button: z.number().int().min(0).max(2).optional(),
  dy: z.number().min(-2400).max(2400).optional(),
  code: z.string().max(32).optional(),
  key: z.string().max(32).optional(),
});

export async function supportRoutes(app: FastifyInstance) {
  setSupportResponseHandler(onResponse);

  /** Teknisyen bağlantı ister. Çalışanın ekranında onay penceresi açılır. */
  app.post('/api/support/sessions', { preHandler: [requireRole('it'), requireModule('it')] }, async (req, reply) => {
    const b = z
      .object({ deviceId: z.string().max(64), reason: z.string().trim().min(5, 'Bağlantı nedenini yazın (en az 5 karakter)').max(300), mode: z.enum(['view', 'control']) })
      .parse(req.body);
    const policy = getSecurity().remoteSupport;
    if (!policy.enabled) return reply.code(403).send({ error: 'Uzaktan destek yönetici tarafından kapatılmış' });
    if (policy.requireMfa && !req.user!.mfaEnabled) {
      return reply.code(403).send({ error: 'Uzaktan destek için hesabınızda iki faktörlü doğrulama açık olmalı (Hesabım)', code: 'mfa_required' });
    }
    const mode = b.mode === 'control' && !policy.allowControl ? 'view' : b.mode;
    const d = db.prepare('SELECT id, hostname, status FROM devices WHERE id = ?').get(b.deviceId) as { id: string; hostname: string; status: string } | undefined;
    if (!d || d.status !== 'approved') return reply.code(404).send({ error: 'Cihaz bulunamadı ya da onaylı değil' });
    if (!isOnline(d.id)) return reply.code(409).send({ error: 'Cihaz şu an çevrimdışı' });
    const busy = db.prepare("SELECT id FROM support_sessions WHERE device_id = ? AND status IN ('requested','accepted','active')").get(d.id);
    if (busy) return reply.code(409).send({ error: 'Bu cihazda devam eden bir destek oturumu var' });

    const id = uuid();
    const token = randomToken();
    const now = new Date();
    db.prepare(
      `INSERT INTO support_sessions(id, device_id, technician_id, technician, reason, mode, status, relay_token_hash, requested_at)
       VALUES(?,?,?,?,?,?,'requested',?,?)`,
    ).run(id, d.id, req.user!.id, req.user!.fullName, b.reason, mode, sha256(token), now.toISOString());

    const payload = JSON.stringify({
      type: 'support_request',
      sessionId: id,
      technician: req.user!.fullName,
      technicianUser: req.user!.username,
      reason: b.reason,
      mode,
      relayToken: token,
      maxMinutes: policy.maxMinutes,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
    });
    if (!sendToDevice(d.id, { t: 'support_request', req: { payload, sig: sign(payload) } })) {
      finish(id, 'failed', 'sunucu', 'cihaza ulaşılamadı');
      return reply.code(409).send({ error: 'Cihaza ulaşılamadı' });
    }
    audit(req.user!.username, 'support_requested', 'device', d.id, { sessionId: id, hostname: d.hostname, mode, reason: b.reason }, req.ip);
    const l = liveOf(id);
    l.timers.push(
      setTimeout(() => {
        if (getRow(id)?.status === 'requested') finish(id, 'expired', 'sunucu', 'çalışan yanıt vermedi');
      }, REQUEST_TTL_MS + 5_000),
    );
    l.timers.push(setTimeout(() => finish(id, 'ended', 'sunucu', `azami süre (${policy.maxMinutes} dk) doldu`), policy.maxMinutes * 60_000 + REQUEST_TTL_MS));
    return { session: dto(getRow(id)!) };
  });

  app.get('/api/support/sessions', { preHandler: requireRole('it') }, async (req) => {
    const q = z.object({ deviceId: z.string().max(64).optional() }).parse(req.query);
    const rows = (
      q.deviceId
        ? db.prepare('SELECT * FROM support_sessions WHERE device_id = ? ORDER BY requested_at DESC LIMIT 50').all(q.deviceId)
        : db.prepare('SELECT * FROM support_sessions ORDER BY requested_at DESC LIMIT 200').all()
    ) as Row[];
    const host = db.prepare('SELECT hostname FROM devices WHERE id = ?');
    return { items: rows.map((r) => ({ ...dto(r), hostname: (host.get(r.device_id) as { hostname: string } | undefined)?.hostname ?? null })) };
  });

  app.get('/api/support/sessions/:id', { preHandler: requireRole('it') }, async (req, reply) => {
    const r = getRow((req.params as { id: string }).id);
    if (!r || (r.technician_id !== req.user!.id && req.user!.role !== 'admin')) return reply.code(404).send({ error: 'Oturum bulunamadı' });
    const d = db.prepare('SELECT hostname, last_user lastUser, location FROM devices WHERE id = ?').get(r.device_id);
    return { session: dto(r), device: d };
  });

  app.post('/api/support/sessions/:id/end', { preHandler: requireRole('it') }, async (req, reply) => {
    const r = getRow((req.params as { id: string }).id);
    if (!r || (r.technician_id !== req.user!.id && req.user!.role !== 'admin')) return reply.code(404).send({ error: 'Oturum bulunamadı' });
    finish(r.id, r.status === 'requested' ? 'expired' : 'ended', 'technician', 'teknisyen bitirdi');
    return { session: dto(getRow(r.id)!) };
  });

  /** Ajanın görüntü kanalı (çalışanın oturumundaki arayüz açar). */
  app.get('/ws/support/agent', { websocket: true }, (socket: WebSocket) => {
    let sid: string | null = null;
    const helloTimer = setTimeout(() => !sid && socket.close(4001, 'hello'), 10_000);
    socket.on('message', (raw, isBinary) => {
      if (!sid) {
        if (isBinary) return socket.close(4003, 'auth');
        let m: { t?: string; sessionId?: string; relayToken?: string };
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return socket.close(4003, 'auth');
        }
        const r = m.sessionId ? getRow(m.sessionId) : undefined;
        const tok = m.relayToken ?? '';
        if (m.t !== 'hello' || !r || r.status !== 'accepted' || !r.relay_token_hash || !/^[0-9a-f]{64}$/.test(tok) || !safeEqualHex(r.relay_token_hash, sha256(tok))) {
          return socket.close(4003, 'auth');
        }
        clearTimeout(helloTimer);
        sid = r.id;
        // jeton tek kullanımlık
        db.prepare("UPDATE support_sessions SET status = 'active', started_at = ?, relay_token_hash = NULL WHERE id = ?").run(nowIso(), sid);
        const l = liveOf(sid);
        l.agent = socket;
        socket.send(JSON.stringify({ t: 'control', allowed: !!r.allow_control }));
        audit(r.user_login ?? 'kullanıcı', 'support_started', 'device', r.device_id, { sessionId: sid, technician: r.technician });
        pushStatus(sid);
        return;
      }
      const l = live.get(sid);
      if (!l) return;
      if (isBinary) {
        // kare: yalnızca canlı teknisyen tarayıcılarına aktar, saklama
        for (const v of l.viewers) if (v.readyState === v.OPEN && v.bufferedAmount < 4 * 1024 * 1024) v.send(raw, { binary: true });
        return;
      }
      let m: { t?: string; w?: number; h?: number; allowed?: boolean };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.t === 'screen' && Number.isFinite(m.w) && Number.isFinite(m.h)) {
        l.lastScreen = JSON.stringify({ t: 'screen', w: m.w, h: m.h });
        toViewers(sid, { t: 'screen', w: m.w, h: m.h });
      } else if (m.t === 'control' && m.allowed === false) {
        db.prepare('UPDATE support_sessions SET allow_control = 0 WHERE id = ?').run(sid);
        audit('kullanıcı', 'support_control_revoked', 'support', sid);
        pushStatus(sid);
      } else if (m.t === 'ended') {
        finish(sid, 'ended', getRow(sid)?.user_login ?? 'kullanıcı', 'çalışan bitirdi');
      }
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (sid && getRow(sid)?.status === 'active') finish(sid, 'ended', 'sunucu', 'ajan bağlantısı kapandı');
    });
    socket.on('error', () => socket.close());
  });

  /** Teknisyenin tarayıcısı: kareleri alır, girdi gönderir. Yalnızca oturumu açan teknisyen. */
  app.get('/ws/support/viewer', { websocket: true }, (socket: WebSocket, req) => {
    // başka bir siteden açılan WebSocket (CSWSH) reddedilir
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      socket.close(4003, 'origin');
      return;
    }
    const user = sessionUser(req);
    const sid = (req.query as { sid?: string }).sid ?? '';
    const r = sid ? getRow(sid) : undefined;
    if (!user || !r || r.technician_id !== user.id || !hasModule('it') || !['requested', 'accepted', 'active'].includes(r.status)) {
      socket.close(4003, 'auth');
      return;
    }
    const l = liveOf(sid);
    l.viewers.add(socket);
    socket.send(JSON.stringify({ t: 'status', session: dto(r) }));
    if (l.lastScreen) socket.send(l.lastScreen);
    let inputs = 0;
    const resetInputs = setInterval(() => (inputs = 0), 1000);
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let m: unknown;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if ((m as { t?: string }).t === 'end') {
        finish(sid, 'ended', 'technician', 'teknisyen bitirdi');
        return;
      }
      const parsed = inputSchema.safeParse(m);
      if (!parsed.success || ++inputs > 120) return; // saniyede en fazla 120 girdi
      const row = getRow(sid);
      // çalışan kontrol izni vermediyse ya da geri aldıysa girdiler ajana HİÇ iletilmez
      if (!row || row.status !== 'active' || !row.allow_control || !l.agent) return;
      l.agent.send(JSON.stringify(parsed.data));
    });
    socket.on('close', () => {
      clearInterval(resetInputs);
      l.viewers.delete(socket);
    });
    socket.on('error', () => socket.close());
  });
}
