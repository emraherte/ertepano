import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROLES, type Role } from '@ertepano/shared';
import { config } from './config.js';
import { audit, db, getSetting, nowIso, setSetting } from './db.js';
import { ldapAuthenticate, LdapUnavailableError, normalizeUsername } from './ldap.js';
import { ldapSettings } from './ldap-settings.js';
import {
  consumeRecovery,
  decryptSecret,
  encryptSecret,
  formatSecret,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  qrSvg,
  verifyTotp,
} from './mfa.js';
import { hashPassword, randomToken, sha256, uuid, verifyPassword } from './security.js';
import { z } from 'zod';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  authSource: 'local' | 'ldap';
  mfaEnabled: boolean;
  /** Rolü 2FA gerektiriyor ama kurulmamış: oturum yalnızca kurulum uç noktalarına açık */
  mfaSetupRequired: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    sessionHash?: string;
  }
}

const COOKIE = 'ep_sid';
/** Hareketsiz kalan oturum bu süre sonunda düşer (mutlak süre: SESSION_HOURS) */
const IDLE_MS = 2 * 3600_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_TRIES = 5;

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  password_hash: string;
  is_active: number;
  auth_source: 'local' | 'ldap';
  mfa_enabled: number;
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  mfa_last_step: number | null;
  mfa_recovery: string | null;
}

// ---- Güvenlik ayarları (Sistem sayfası) ------------------------------------------------------

export interface RemoteSupportPolicy {
  enabled: boolean;
  /** Teknisyenin kendi hesabında 2FA açık olmalı */
  requireMfa: boolean;
  /** Fare/klavye kontrolü istenebilir mi (kapalıysa yalnız görüntüleme) */
  allowControl: boolean;
  maxMinutes: number;
}

export interface SecuritySettings {
  /** Bu rollerde 2FA zorunlu */
  mfaRequiredRoles: Role[];
  remoteSupport: RemoteSupportPolicy;
}

const DEFAULT_SUPPORT: RemoteSupportPolicy = { enabled: true, requireMfa: true, allowControl: true, maxMinutes: 60 };

export function getSecurity(): SecuritySettings {
  try {
    const v = JSON.parse(getSetting('security') ?? '{}') as Partial<SecuritySettings>;
    return {
      mfaRequiredRoles: (v.mfaRequiredRoles ?? ['admin']).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
      remoteSupport: { ...DEFAULT_SUPPORT, ...(v.remoteSupport ?? {}) },
    };
  } catch {
    return { mfaRequiredRoles: ['admin'], remoteSupport: DEFAULT_SUPPORT };
  }
}

export function setSecurity(s: SecuritySettings) {
  setSetting('security', JSON.stringify(s));
}

const mfaRequired = (role: Role) => getSecurity().mfaRequiredRoles.includes(role);

const toSession = (r: Pick<UserRow, 'id' | 'username' | 'full_name' | 'role' | 'auth_source' | 'mfa_enabled'>): SessionUser => ({
  id: r.id,
  username: r.username,
  fullName: r.full_name,
  role: r.role,
  authSource: r.auth_source,
  mfaEnabled: !!r.mfa_enabled,
  mfaSetupRequired: !r.mfa_enabled && mfaRequired(r.role),
});

// ---- Oturumlar -------------------------------------------------------------------------------

function readSession(req: FastifyRequest): { user: SessionUser; scope: string; hash: string } | undefined {
  const token = req.cookies[COOKIE];
  if (!token || token.length > 128) return undefined;
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at, s.scope, s.last_seen_at, s.created_at session_created FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.is_active = 1`,
    )
    .get(hash) as (UserRow & { expires_at: string; scope: string; last_seen_at: string | null; session_created: string }) | undefined;
  if (!row) return undefined;
  const now = Date.now();
  const lastSeen = Date.parse(row.last_seen_at ?? row.session_created);
  if (row.expires_at < nowIso() || now - lastSeen > IDLE_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return undefined;
  }
  // her istekte yazmamak için dakikada bir güncelle
  if (now - lastSeen > 60_000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(nowIso(), hash);
  return { user: toSession(row), scope: row.scope, hash };
}

/** WebSocket gibi preHandler kullanılamayan yerler için: tam yetkili oturumun kullanıcısı. */
export function sessionUser(req: FastifyRequest): SessionUser | undefined {
  const s = readSession(req);
  return s && s.scope === 'full' && !s.user.mfaSetupRequired ? s.user : undefined;
}

/** preHandler: oturum zorunlu, rol listesi verilirse rol de kontrol edilir (admin her zaman geçer). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const s = readSession(req);
    if (!s) return reply.code(401).send({ error: 'Oturum gerekli' });
    if (s.scope !== 'full' || s.user.mfaSetupRequired) {
      return reply.code(403).send({ error: 'Devam etmek için iki faktörlü doğrulamayı kurun', code: 'mfa_setup_required' });
    }
    if (roles.length && s.user.role !== 'admin' && !roles.includes(s.user.role)) {
      return reply.code(403).send({ error: 'Bu işlem için yetkiniz yok' });
    }
    req.user = s.user;
    req.sessionHash = s.hash;
  };
}

/** Kısıtlı oturumla da erişilebilen uç noktalar (ben kimim, 2FA kurulumu, çıkış). */
export function requireAnySession() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const s = readSession(req);
    if (!s) return reply.code(401).send({ error: 'Oturum gerekli' });
    req.user = s.user;
    req.sessionHash = s.hash;
  };
}

function createSession(reply: FastifyReply, userId: string, ip: string, scope: 'full' | 'setup') {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  const now = nowIso();
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip, scope, last_seen_at) VALUES(?,?,?,?,?,?,?)').run(
    sha256(token), userId, expires.toISOString(), now, ip, scope, now,
  );
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, expires });
}

/** Kullanıcının (isteğe bağlı olarak şimdiki hariç) tüm oturumlarını kapat. */
export function revokeSessions(userId: string, exceptHash?: string) {
  if (exceptHash) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptHash);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---- Kaba kuvvet koruması --------------------------------------------------------------------

/** Anahtar başına kayan pencere sayacı. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  blocked(key: string) {
    const since = Date.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list.length >= this.max;
  }
  hit(key: string) {
    const list = this.hits.get(key) ?? [];
    list.push(Date.now());
    this.hits.set(key, list);
  }
  clear(key: string) {
    this.hits.delete(key);
  }
}
/** IP + kullanıcı: 10 dk'da 8 hatalı parola */
const loginUserLimiter = new Limiter(8, 10 * 60_000);
/** IP başına: 10 dk'da 30 hatalı giriş (parola püskürtme) */
const loginIpLimiter = new Limiter(30, 10 * 60_000);
/** Kullanıcı başına: 15 dk'da 10 hatalı 2FA kodu */
const mfaUserLimiter = new Limiter(10, 15 * 60_000);

// Bilinmeyen kullanıcıda da aynı scrypt maliyeti — yanıt süresinden kullanıcı adı tahmin edilmesin
const DUMMY_HASH = hashPassword(randomToken(16));

// ---- 2FA giriş biletleri (parola doğru, kod bekleniyor) --------------------------------------

interface Challenge {
  userId: string;
  ip: string;
  expires: number;
  tries: number;
  via: 'local' | 'ldap';
}
const challenges = new Map<string, Challenge>();
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of challenges) if (c.expires < now) challenges.delete(k);
}, 60_000).unref();

/** TOTP ya da kurtarma kodu; geçerliyse kullanıcıyı günceller (son adım / kalan kodlar). */
function checkSecondFactor(u: UserRow, code: string): 'totp' | 'recovery' | null {
  const secret = u.mfa_secret ? decryptSecret(u.mfa_secret) : null;
  if (!secret) return null;
  const step = verifyTotp(secret, code, u.mfa_last_step);
  if (step !== null) {
    db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ?').run(step, u.id);
    return 'totp';
  }
  if (/[A-Za-z]/.test(code)) {
    const left = consumeRecovery(JSON.parse(u.mfa_recovery ?? '[]') as string[], code);
    if (left) {
      db.prepare('UPDATE users SET mfa_recovery = ? WHERE id = ?').run(JSON.stringify(left), u.id);
      return 'recovery';
    }
  }
  return null;
}

// ---- Birinci faktör --------------------------------------------------------------------------

/**
 * Yerel hesapsa yalnızca yerel parola denenir (AD çökse bile yönetici girebilsin diye "cam kırma" hesabı).
 * Değilse ve LDAP açıksa AD'ye sorulur; başarılı AD girişinde kullanıcı oluşturulur/güncellenir ve rolü AD grubundan
 * yeniden hesaplanır.
 */
async function authenticate(username: string, password: string, ip: string): Promise<{ user?: UserRow; error?: string; status?: number }> {
  const local = db.prepare("SELECT * FROM users WHERE username = ? AND auth_source = 'local'").get(username) as UserRow | undefined;
  if (local) {
    if (!verifyPassword(password, local.password_hash) || !local.is_active) return {};
    return { user: local };
  }
  if (!ldapSettings().enabled) {
    verifyPassword(password, DUMMY_HASH);
    return {};
  }

  let ad;
  try {
    ad = await ldapAuthenticate(username, password);
  } catch (e) {
    if (e instanceof LdapUnavailableError) {
      return { status: 503, error: `${e.message}. Yerel yönetici hesabıyla giriş yapabilirsiniz.` };
    }
    throw e;
  }
  if (!ad) {
    audit(normalizeUsername(username), 'ldap_login_failed', 'user', null, undefined, ip);
    return {};
  }
  if (!ad.role) {
    audit(ad.username, 'ldap_login_failed', 'user', null, { reason: 'grup yok', dn: ad.dn }, ip);
    return { status: 403, error: 'Active Directory hesabınız ErtePano gruplarından hiçbirinde değil. IT ile iletişime geçin.' };
  }

  const existing = db.prepare("SELECT * FROM users WHERE username = ? AND auth_source = 'ldap'").get(ad.username) as UserRow | undefined;
  if (existing) {
    if (!existing.is_active) return { status: 403, error: 'Panel erişiminiz yönetici tarafından kapatılmış.' };
    db.prepare('UPDATE users SET full_name = ?, role = ?, email = ?, ldap_dn = ? WHERE id = ?').run(ad.fullName, ad.role, ad.email, ad.dn, existing.id);
    return { user: { ...existing, full_name: ad.fullName, role: ad.role } };
  }
  // '!' asla doğrulanmayan parola özeti
  const id = uuid();
  db.prepare("INSERT INTO users(id, username, full_name, role, password_hash, created_at, auth_source, email, ldap_dn) VALUES(?,?,?,?,'!',?, 'ldap', ?, ?)").run(
    id, ad.username, ad.fullName, ad.role, nowIso(), ad.email, ad.dn,
  );
  audit(ad.username, 'ldap_user_provisioned', 'user', id, { role: ad.role, dn: ad.dn }, ip);
  return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow };
}

const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
const codeSchema = z.string().trim().min(6).max(20);

export async function authRoutes(app: FastifyInstance) {
  /** Giriş ekranı için: AD açık mı, hangi alan adı? (gizli bilgi içermez) */
  app.get('/api/auth/config', async () => ({ ldap: ldapSettings().enabled, domain: ldapSettings().domain, org: getSetting('org_name') }));

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim().min(1).max(128), password: z.string().min(1).max(256) }).parse(req.body);
    const userKey = `${req.ip}|${normalizeUsername(body.username).toLowerCase()}`;
    if (loginUserLimiter.blocked(userKey) || loginIpLimiter.blocked(req.ip)) {
      return reply.code(429).send({ error: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.' });
    }

    const res = await authenticate(body.username, body.password, req.ip);
    if (!res.user) {
      if (res.status !== 503) {
        loginUserLimiter.hit(userKey);
        loginIpLimiter.hit(req.ip);
      }
      const known = db.prepare('SELECT username FROM users WHERE username = ?').get(normalizeUsername(body.username)) as { username: string } | undefined;
      audit(known?.username ?? '(bilinmeyen kullanıcı)', 'login_failed', 'user', null, undefined, req.ip);
      return reply.code(res.status ?? 401).send({ error: res.error ?? 'Kullanıcı adı veya parola hatalı' });
    }
    loginUserLimiter.clear(userKey);
    const u = res.user;

    if (u.mfa_enabled) {
      const challenge = randomToken(24);
      challenges.set(challenge, { userId: u.id, ip: req.ip, expires: Date.now() + CHALLENGE_TTL_MS, tries: 0, via: u.auth_source });
      return { mfa: 'required', challenge };
    }

    const setup = mfaRequired(u.role);
    createSession(reply, u.id, req.ip, setup ? 'setup' : 'full');
    audit(u.username, u.auth_source === 'ldap' ? 'ldap_login' : 'login', 'user', u.id, setup ? { mfa: 'kurulum gerekli' } : undefined, req.ip);
    return { user: toSession(u) };
  });

  /** İkinci adım: Authenticator kodu ya da kurtarma kodu */
  app.post('/api/auth/login/mfa', async (req, reply) => {
    const b = z.object({ challenge: z.string().min(10).max(100), code: codeSchema }).parse(req.body);
    const c = challenges.get(b.challenge);
    if (!c || c.expires < Date.now() || c.ip !== req.ip) {
      challenges.delete(b.challenge);
      return reply.code(401).send({ error: 'Doğrulama süresi doldu, yeniden giriş yapın', code: 'challenge_expired' });
    }
    const u = getUser(c.userId);
    if (!u || !u.is_active || !u.mfa_enabled) {
      challenges.delete(b.challenge);
      return reply.code(401).send({ error: 'Yeniden giriş yapın', code: 'challenge_expired' });
    }
    if (mfaUserLimiter.blocked(u.id)) {
      challenges.delete(b.challenge);
      return reply.code(429).send({ error: 'Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.' });
    }
    const kind = checkSecondFactor(u, b.code);
    if (!kind) {
      mfaUserLimiter.hit(u.id);
      c.tries++;
      if (c.tries >= CHALLENGE_MAX_TRIES) challenges.delete(b.challenge);
      audit(u.username, 'mfa_failed', 'user', u.id, undefined, req.ip);
      return reply.code(401).send({ error: 'Kod hatalı', triesLeft: Math.max(0, CHALLENGE_MAX_TRIES - c.tries) });
    }
    challenges.delete(b.challenge);
    mfaUserLimiter.clear(u.id);
    createSession(reply, u.id, req.ip, 'full');
    const left = (JSON.parse(getUser(u.id)!.mfa_recovery ?? '[]') as string[]).length;
    audit(u.username, c.via === 'ldap' ? 'ldap_login' : 'login', 'user', u.id, { mfa: kind, ...(kind === 'recovery' ? { kalanKod: left } : {}) }, req.ip);
    return { user: toSession(getUser(u.id)!), recoveryUsed: kind === 'recovery', recoveryLeft: left };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAnySession() }, async (req) => ({ user: req.user }));

  // ---- 2FA kurulum ve yönetim ----

  app.get('/api/auth/mfa', { preHandler: requireAnySession() }, async (req) => {
    const u = getUser(req.user!.id)!;
    return {
      enabled: !!u.mfa_enabled,
      required: mfaRequired(u.role),
      recoveryLeft: (JSON.parse(u.mfa_recovery ?? '[]') as string[]).length,
    };
  });

  /** Yeni gizli anahtar üret (henüz etkin değil; doğru kod girilince etkinleşir). */
  app.post('/api/auth/mfa/setup', { preHandler: requireAnySession() }, async (req, reply) => {
    const u = getUser(req.user!.id)!;
    if (u.mfa_enabled) return reply.code(400).send({ error: 'İki faktörlü doğrulama zaten açık' });
    const secret = newSecret();
    db.prepare('UPDATE users SET mfa_pending_secret = ? WHERE id = ?').run(encryptSecret(secret), u.id);
    const uri = otpauthUri(secret, u.username);
    return { secret: formatSecret(secret), otpauth: uri, qrSvg: await qrSvg(uri) };
  });

  app.post('/api/auth/mfa/enable', { preHandler: requireAnySession() }, async (req, reply) => {
    const { code } = z.object({ code: codeSchema }).parse(req.body);
    const u = getUser(req.user!.id)!;
    if (u.mfa_enabled) return reply.code(400).send({ error: 'İki faktörlü doğrulama zaten açık' });
    const pending = u.mfa_pending_secret ? decryptSecret(u.mfa_pending_secret) : null;
    if (!pending) return reply.code(400).send({ error: 'Önce kurulumu başlatın' });
    if (mfaUserLimiter.blocked(u.id)) return reply.code(429).send({ error: 'Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.' });
    const step = verifyTotp(pending, code, null);
    if (step === null) {
      mfaUserLimiter.hit(u.id);
      return reply.code(400).send({ error: 'Kod hatalı. Telefonun saatinin doğru olduğundan emin olun.' });
    }
    const rc = newRecoveryCodes();
    db.prepare(
      'UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_pending_secret = NULL, mfa_last_step = ?, mfa_recovery = ?, mfa_enrolled_at = ? WHERE id = ?',
    ).run(encryptSecret(pending), step, JSON.stringify(rc.hashes), nowIso(), u.id);
    // bu oturum tam yetkiye geçer, diğer oturumlar kapanır
    db.prepare("UPDATE sessions SET scope = 'full' WHERE token_hash = ?").run(req.sessionHash);
    revokeSessions(u.id, req.sessionHash);
    audit(u.username, 'mfa_enabled', 'user', u.id, undefined, req.ip);
    return { recoveryCodes: rc.codes, user: toSession(getUser(u.id)!) };
  });

  app.post('/api/auth/mfa/recovery-codes', { preHandler: requireRole() }, async (req, reply) => {
    const { code } = z.object({ code: codeSchema }).parse(req.body);
    const u = getUser(req.user!.id)!;
    if (!u.mfa_enabled) return reply.code(400).send({ error: 'İki faktörlü doğrulama kapalı' });
    if (mfaUserLimiter.blocked(u.id)) return reply.code(429).send({ error: 'Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.' });
    if (!checkSecondFactor(u, code)) {
      mfaUserLimiter.hit(u.id);
      return reply.code(400).send({ error: 'Kod hatalı' });
    }
    const rc = newRecoveryCodes();
    db.prepare('UPDATE users SET mfa_recovery = ? WHERE id = ?').run(JSON.stringify(rc.hashes), u.id);
    audit(u.username, 'mfa_recovery_regenerated', 'user', u.id, undefined, req.ip);
    return { recoveryCodes: rc.codes };
  });

  app.post('/api/auth/mfa/disable', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ code: codeSchema, password: z.string().max(256).optional() }).parse(req.body);
    const u = getUser(req.user!.id)!;
    if (!u.mfa_enabled) return reply.code(400).send({ error: 'İki faktörlü doğrulama zaten kapalı' });
    if (mfaRequired(u.role)) return reply.code(400).send({ error: 'Rolünüz için iki faktörlü doğrulama zorunlu; kapatılamaz' });
    if (u.auth_source === 'local' && (!b.password || !verifyPassword(b.password, u.password_hash))) {
      return reply.code(400).send({ error: 'Parola hatalı' });
    }
    if (mfaUserLimiter.blocked(u.id)) return reply.code(429).send({ error: 'Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.' });
    if (!checkSecondFactor(u, b.code)) {
      mfaUserLimiter.hit(u.id);
      return reply.code(400).send({ error: 'Kod hatalı' });
    }
    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_last_step = NULL, mfa_recovery = NULL, mfa_enrolled_at = NULL WHERE id = ?').run(u.id);
    revokeSessions(u.id, req.sessionHash);
    audit(u.username, 'mfa_disabled', 'user', u.id, undefined, req.ip);
    return { ok: true, user: toSession(getUser(u.id)!) };
  });

  // ---- Yönetici: 2FA sıfırlama ve politika ----

  app.post('/api/users/:id/mfa/reset', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) return reply.code(400).send({ error: 'Kendi 2FA kaydınızı Hesabım sayfasından yönetin' });
    const u = getUser(id);
    if (!u) return reply.code(404).send({ error: 'Kullanıcı bulunamadı' });
    db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_last_step = NULL, mfa_recovery = NULL, mfa_enrolled_at = NULL WHERE id = ?').run(id);
    revokeSessions(id);
    audit(req.user!.username, 'mfa_reset', 'user', id, { username: u.username }, req.ip);
    return { ok: true };
  });

  app.get('/api/settings/security', { preHandler: requireRole('admin') }, async () => {
    const counts = db.prepare('SELECT role, COUNT(*) total, SUM(mfa_enabled) mfa FROM users WHERE is_active = 1 GROUP BY role').all();
    return { ...getSecurity(), counts };
  });

  app.put('/api/settings/security', { preHandler: requireRole('admin') }, async (req, reply) => {
    const b = z
      .object({
        mfaRequiredRoles: z.array(z.enum(ROLES)).max(ROLES.length),
        remoteSupport: z
          .object({ enabled: z.boolean(), requireMfa: z.boolean(), allowControl: z.boolean(), maxMinutes: z.number().int().min(5).max(240) })
          .optional(),
      })
      .parse(req.body);
    const me = getUser(req.user!.id)!;
    // kendini kilitleme: yöneticinin kendisi henüz 2FA kurmadıysa zorunluluğu açması sorun değil (kurulum ekranına düşer)
    if (b.mfaRequiredRoles.includes(me.role) && !me.mfa_enabled) {
      return reply.code(400).send({ error: 'Kendi rolünüz için zorunlu kılmadan önce Hesabım sayfasından 2FA kurun' });
    }
    setSecurity({ mfaRequiredRoles: [...new Set(b.mfaRequiredRoles)], remoteSupport: b.remoteSupport ?? getSecurity().remoteSupport });
    audit(req.user!.username, 'security_settings_updated', 'settings', null, b, req.ip);
    return getSecurity();
  });
}
