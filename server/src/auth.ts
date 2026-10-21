import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@ertepano/shared';
import { config } from './config.js';
import { audit, db, nowIso } from './db.js';
import { ldapAuthenticate, LdapUnavailableError, normalizeUsername } from './ldap.js';
import { randomToken, sha256, uuid, verifyPassword } from './security.js';
import { z } from 'zod';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  authSource: 'local' | 'ldap';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const COOKIE = 'ep_sid';

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  password_hash: string;
  is_active: number;
  auth_source: 'local' | 'ldap';
}

const toSession = (r: Pick<UserRow, 'id' | 'username' | 'full_name' | 'role' | 'auth_source'>): SessionUser => ({
  id: r.id,
  username: r.username,
  fullName: r.full_name,
  role: r.role,
  authSource: r.auth_source,
});

function userFromCookie(req: FastifyRequest): SessionUser | undefined {
  const token = req.cookies[COOKIE];
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, u.auth_source, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.is_active = 1`,
    )
    .get(sha256(token)) as (UserRow & { expires_at: string }) | undefined;
  if (!row || row.expires_at < nowIso()) return undefined;
  return toSession(row);
}

/** preHandler: oturum zorunlu, rol listesi verilirse rol de kontrol edilir (admin her zaman geçer). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = userFromCookie(req);
    if (!user) return reply.code(401).send({ error: 'Oturum gerekli' });
    if (roles.length && user.role !== 'admin' && !roles.includes(user.role)) {
      return reply.code(403).send({ error: 'Bu işlem için yetkiniz yok' });
    }
    req.user = user;
  };
}

/** Basit kaba kuvvet koruması: IP+kullanıcı başına 10 dakikada 8 hatalı deneme. */
const failures = new Map<string, number[]>();
function tooManyFailures(key: string) {
  const since = Date.now() - 10 * 60_000;
  const list = (failures.get(key) ?? []).filter((t) => t > since);
  failures.set(key, list);
  return list.length >= 8;
}

/**
 * Giriş kuralı: kullanıcı adı yerel hesapsa yalnızca yerel parola denenir (AD çökse bile yönetici girebilsin diye
 * "cam kırma" hesabı). Değilse ve LDAP açıksa AD'ye sorulur; başarılı AD girişinde kullanıcı oluşturulur/güncellenir
 * ve rolü AD grubundan yeniden hesaplanır.
 */
async function authenticate(username: string, password: string, ip: string): Promise<{ user?: SessionUser; error?: string; status?: number }> {
  const local = db.prepare("SELECT * FROM users WHERE username = ? AND auth_source = 'local'").get(username) as UserRow | undefined;
  if (local) {
    if (!local.is_active || !verifyPassword(password, local.password_hash)) return {};
    return { user: toSession(local) };
  }
  if (!config.ldap.enabled) return {};

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
    return { user: toSession({ ...existing, full_name: ad.fullName, role: ad.role }) };
  }
  // Aynı adla yerel hesap varsa yukarıda yakalanırdı; burada yeni AD kullanıcısı oluşturulur ('!' asla doğrulanmayan parola özeti).
  const id = uuid();
  db.prepare("INSERT INTO users(id, username, full_name, role, password_hash, created_at, auth_source, email, ldap_dn) VALUES(?,?,?,?,'!',?, 'ldap', ?, ?)").run(
    id, ad.username, ad.fullName, ad.role, nowIso(), ad.email, ad.dn,
  );
  audit(ad.username, 'ldap_user_provisioned', 'user', id, { role: ad.role, dn: ad.dn }, ip);
  return { user: { id, username: ad.username, fullName: ad.fullName, role: ad.role, authSource: 'ldap' } };
}

export async function authRoutes(app: FastifyInstance) {
  /** Giriş ekranı için: AD açık mı, hangi alan adı? (gizli bilgi içermez) */
  app.get('/api/auth/config', async () => ({ ldap: config.ldap.enabled, domain: config.ldap.domain }));

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim().min(1).max(128), password: z.string().min(1).max(256) }).parse(req.body);
    const key = `${req.ip}|${normalizeUsername(body.username).toLowerCase()}`;
    if (tooManyFailures(key)) return reply.code(429).send({ error: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.' });

    const res = await authenticate(body.username, body.password, req.ip);
    if (!res.user) {
      if (res.status !== 503) failures.get(key)!.push(Date.now());
      audit(body.username, 'login_failed', 'user', null, undefined, req.ip);
      return reply.code(res.status ?? 401).send({ error: res.error ?? 'Kullanıcı adı veya parola hatalı' });
    }
    const user = res.user;
    failures.delete(key);
    const token = randomToken();
    const expires = new Date(Date.now() + config.sessionHours * 3600_000);
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip) VALUES(?,?,?,?,?)').run(sha256(token), user.id, expires.toISOString(), nowIso(), req.ip);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    audit(user.username, user.authSource === 'ldap' ? 'ldap_login' : 'login', 'user', user.id, undefined, req.ip);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      expires,
    });
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireRole() }, async (req) => ({ user: req.user }));
}
