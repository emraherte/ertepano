import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@ertepano/shared';
import { config } from './config.js';
import { audit, db, nowIso } from './db.js';
import { randomToken, sha256, verifyPassword } from './security.js';
import { z } from 'zod';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const COOKIE = 'ep_sid';

function userFromCookie(req: FastifyRequest): SessionUser | undefined {
  const token = req.cookies[COOKIE];
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.is_active = 1`,
    )
    .get(sha256(token)) as { id: string; username: string; full_name: string; role: Role; expires_at: string } | undefined;
  if (!row || row.expires_at < nowIso()) return undefined;
  return { id: row.id, username: row.username, fullName: row.full_name, role: row.role };
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

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).parse(req.body);
    const key = `${req.ip}|${body.username.toLowerCase()}`;
    if (tooManyFailures(key)) return reply.code(429).send({ error: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.' });

    const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(body.username) as
      | { id: string; username: string; full_name: string; role: Role; password_hash: string }
      | undefined;
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      failures.get(key)!.push(Date.now());
      audit(body.username, 'login_failed', 'user', null, undefined, req.ip);
      return reply.code(401).send({ error: 'Kullanıcı adı veya parola hatalı' });
    }
    failures.delete(key);
    const token = randomToken();
    const expires = new Date(Date.now() + config.sessionHours * 3600_000);
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at, ip) VALUES(?,?,?,?,?)').run(
      sha256(token),
      row.id,
      expires.toISOString(),
      nowIso(),
      req.ip,
    );
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit(row.username, 'login', 'user', row.id, undefined, req.ip);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      expires,
    });
    return { user: { id: row.id, username: row.username, fullName: row.full_name, role: row.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireRole() }, async (req) => ({ user: req.user }));
}
