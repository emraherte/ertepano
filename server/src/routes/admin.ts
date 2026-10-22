import type { FastifyInstance } from 'fastify';
import { ROLES, ROLE_CATEGORIES } from '@ertepano/shared';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { requireRole, revokeSessions } from '../auth.js';
import { config } from '../config.js';
import { audit, db, getSetting, nowIso, setSetting, verifyAuditChain } from '../db.js';
import { annDto, type AnnRow, approvedDevices, parseTargets, placementColumns, placementSchema } from '../announcements.js';
import { endAnnouncement } from '../lifecycle.js';
import { onlineCount, syncAll } from '../hub.js';
import { hashPassword, newPassword, randomToken, uuid, verifyPassword } from '../security.js';
import { localToday, runDailyAutomation } from '../scheduler.js';
import { ldapTest } from '../ldap.js';
import { clearLdapSettings, ldapSettings, saveLdapSettings, settingsFromInput } from '../ldap-settings.js';
import { hasModule, invalidateLicense, licenseInfo, parseLicense, publishCategories, REPORT_MODULE, requireModule, serverId } from '../license.js';
import type { ReportKind } from '@ertepano/shared';
import { deviceAlerts } from './devices.js';

const mediaDir = path.join(config.dataDir, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
const IMAGE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/** Dosyanın sihirli baytlarından görsel türü (uzantı) — tarayıcının bildirdiği MIME türüne güvenilmez. */
function sniffImage(file: string): string | null {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') return '.gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

/** "15.07", "15.07.1990", "1990-07-15", "07-15" → "07-15" */
function toMonthDay(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/.exec(t);
  if (m) return `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

/** "01.09.2019" | "2019-09-01" → "2019-09-01" */
function toDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? t : null;
}

export async function adminRoutes(app: FastifyInstance) {
  // ---- Pano (dashboard) ----
  app.get('/api/dashboard', { preHandler: requireRole() }, async (req) => {
    const role = req.user!.role;
    const devices = db.prepare('SELECT * FROM devices').all() as Parameters<typeof deviceAlerts>[0][];
    const approved = devices.filter((d) => d.status === 'approved');
    const alertCount = role === 'admin' || role === 'it' ? devices.filter((d) => deviceAlerts(d, false).some((a) => a !== 'Onay bekliyor')).length : null;
    const active = db.prepare("SELECT * FROM announcements WHERE status = 'active' AND kind != 'fullscreen' ORDER BY created_at DESC").all() as AnnRow[];
    const recent = db.prepare("SELECT * FROM announcements WHERE status IN ('active','ended') AND kind != 'fullscreen' AND auto_key IS NULL ORDER BY starts_at DESC LIMIT 6").all() as AnnRow[];
    const stat = db.prepare('SELECT COUNT(sent_at) sent, COUNT(seen_at) seen, COUNT(acked_at) acked, COUNT(answered_at) answered FROM deliveries WHERE announcement_id = ?');
    const reportKinds = (role === 'admin' ? ['it_help', 'near_miss'] : role === 'it' ? ['it_help'] : role === 'isg' ? ['near_miss'] : []).filter((k) => hasModule(REPORT_MODULE[k as ReportKind]));
    const openReports = reportKinds.length
      ? (db.prepare(`SELECT kind, COUNT(*) c FROM reports WHERE status != 'closed' AND kind IN (${reportKinds.map(() => '?').join(',')}) GROUP BY kind`).all(...reportKinds) as { kind: string; c: number }[])
      : [];
    const emergency = db.prepare('SELECT id, title, drill, started_at startedAt FROM emergencies WHERE ended_at IS NULL LIMIT 1').get() as
      | { id: string; title: string; drill: number; startedAt: string }
      | undefined;
    const today = localToday();
    const md = today.slice(5);
    const celebrations = db
      .prepare("SELECT full_name fullName, department, CASE WHEN birth_md = ? THEN 'birthday' ELSE 'anniversary' END type FROM employees WHERE celebrate = 1 AND (birth_md = ? OR (substr(start_date, 6) = ? AND start_date < ?))")
      .all(md, md, md, today);
    const pendingAcks = db
      .prepare(
        `SELECT a.id, a.title, a.category, COUNT(d.device_id) sent, COUNT(d.acked_at) acked FROM announcements a
         LEFT JOIN deliveries d ON d.announcement_id = a.id WHERE a.require_ack = 1 AND a.status = 'active' AND a.kind != 'fullscreen'
         GROUP BY a.id ORDER BY a.created_at DESC LIMIT 5`,
      )
      .all();
    return {
      devices: { total: approved.length, online: onlineCount(), pending: devices.filter((d) => d.status === 'pending').length, alerts: alertCount },
      activeCount: active.length,
      active: active.slice(0, 8).map(annDto),
      recent: recent.map((a) => ({ ...annDto(a), stats: stat.get(a.id) })),
      openReports: Object.fromEntries(openReports.map((r) => [r.kind, r.c])),
      emergency: emergency ? { ...emergency, drill: !!emergency.drill } : null,
      celebrations,
      pendingAcks,
      canPublish: publishCategories(role),
    };
  });

  // ---- Kiosk / TV ekranı (oturumsuz, anahtar ile salt-okur) ----
  app.get('/api/kiosk', async (req, reply) => {
    const q = z.object({ key: z.string(), loc: z.string().optional() }).parse(req.query);
    const key = getSetting('kiosk_key');
    if (!key || q.key !== key) return reply.code(403).send({ error: 'Geçersiz kiosk anahtarı' });
    const fits = (targets: string[]) =>
      targets.includes('all') || (q.loc ? targets.some((t) => t.toLocaleLowerCase('tr') === `loc:${q.loc}`.toLocaleLowerCase('tr')) : false);
    const rows = db.prepare("SELECT * FROM announcements WHERE status = 'active' AND show_on_kiosk = 1 ORDER BY created_at DESC").all() as AnnRow[];
    const emergencyRow = rows.find((a) => a.kind === 'fullscreen' && fits(parseTargets(a.targets)));
    const items = rows
      .filter((a) => a.kind !== 'fullscreen' && a.kind !== 'survey' && fits(parseTargets(a.targets)))
      .map((a) => ({ id: a.id, kind: a.kind, category: a.category, title: a.title, body: a.body, emoji: a.emoji, imageUrl: a.image_url, color: a.color, countdownTo: a.countdown_to }));
    return {
      serverTime: nowIso(),
      emergency: emergencyRow ? { title: emergencyRow.title, body: emergencyRow.body, emoji: emergencyRow.emoji, color: emergencyRow.color, drill: !!emergencyRow.drill } : null,
      items,
    };
  });

  app.get('/api/settings/kiosk', { preHandler: requireRole('isg', 'ik', 'it') }, async () => {
    const locations = [...new Set(approvedDevices().map((d) => d.location).filter(Boolean))];
    return { key: getSetting('kiosk_key'), locations };
  });

  app.post('/api/settings/kiosk/rotate', { preHandler: requireRole('admin') }, async (req) => {
    const key = randomToken(12);
    setSetting('kiosk_key', key);
    audit(req.user!.username, 'kiosk_key_rotated', 'settings', null, undefined, req.ip);
    return { key };
  });

  // ---- Görsel yükleme ----
  app.post('/api/media', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Dosya yok' });
    if (!IMAGE_TYPES[file.mimetype]) return reply.code(400).send({ error: 'Sadece PNG, JPG, GIF veya WEBP yüklenebilir' });
    const tmp = path.join(mediaDir, `.yukleniyor-${uuid()}`);
    await pipeline(file.file, fs.createWriteStream(tmp));
    if (file.file.truncated) {
      fs.rmSync(tmp, { force: true });
      return reply.code(413).send({ error: 'Görsel en fazla 5 MB olabilir' });
    }
    const ext = sniffImage(tmp);
    if (!ext) {
      fs.rmSync(tmp, { force: true });
      return reply.code(400).send({ error: 'Dosya içeriği geçerli bir PNG, JPG, GIF veya WEBP değil' });
    }
    const name = `${uuid()}${ext}`;
    fs.renameSync(tmp, path.join(mediaDir, name));
    audit(req.user!.username, 'media_uploaded', 'media', name, { original: file.filename }, req.ip);
    return { url: `/media/${name}` };
  });

  // ---- Özel günler ----
  const dayInput = z.object({
    name: z.string().trim().min(1).max(80),
    monthDay: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    emoji: z.string().max(16).nullable().optional(),
    imageUrl: z.string().regex(/^\/media\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/, 'Görsel yalnızca panelden yüklenebilir').nullable().optional(),
    message: z.string().max(500).nullable().optional(),
    kind: z.enum(['badge', 'toast', 'banner']).default('badge'),
    enabled: z.boolean().default(true),
    ...placementSchema,
  });

  const DAY_COLS =
    'id, name, month_day monthDay, date, emoji, image_url imageUrl, message, kind, enabled, position, pos_x posX, pos_y posY, size, opacity';

  /** Bugün yayında olan otomatik duyuruyu kaldırıp yeniden üret (düzenleme anında ekranlara yansısın). */
  function refreshToday(dayId: string) {
    const key = `sd:${dayId}:${localToday()}`;
    const row = db.prepare('SELECT id FROM announcements WHERE auto_key = ?').get(key) as { id: string } | undefined;
    if (row) {
      endAnnouncement(row.id);
      db.prepare('DELETE FROM announcements WHERE id = ?').run(row.id);
    }
    runDailyAutomation();
  }

  app.get('/api/special-days', { preHandler: requireRole() }, async () => ({
    items: db
      .prepare(`SELECT ${DAY_COLS} FROM special_days ORDER BY COALESCE(substr(date, 6), month_day)`)
      .all()
      .map((r) => ({ ...(r as object), enabled: !!(r as { enabled: number }).enabled })),
    today: localToday(),
  }));

  app.post('/api/special-days', { preHandler: requireRole('ik') }, async (req, reply) => {
    const b = dayInput.parse(req.body);
    if (!b.monthDay && !b.date) return reply.code(400).send({ error: 'Her yıl tekrar eden gün (GG.AA) veya tek seferlik tarih gerekli' });
    const id = uuid();
    const p = placementColumns(b);
    db.prepare(
      `INSERT INTO special_days(id, name, month_day, date, emoji, image_url, message, kind, enabled, position, pos_x, pos_y, size, opacity)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, b.name, b.monthDay ?? null, b.date ?? null, b.emoji ?? null, b.imageUrl ?? null, b.message ?? null, b.kind, b.enabled ? 1 : 0,
      b.position ?? null, p.pos_x, p.pos_y, p.size, p.opacity);
    audit(req.user!.username, 'special_day_created', 'special_day', id, b, req.ip);
    runDailyAutomation();
    return { id };
  });

  app.patch('/api/special-days/:id', { preHandler: requireRole('ik') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = dayInput.partial().parse(req.body);
    const current = db.prepare('SELECT * FROM special_days WHERE id = ?').get(id) as { month_day: string | null; date: string | null } | undefined;
    if (!current) return reply.code(404).send({ error: 'Özel gün bulunamadı' });
    const hasPlacement = ['position', 'posX', 'posY', 'size', 'opacity'].some((k) => k in b);
    const p = hasPlacement ? placementColumns(b) : null;
    const cols: Record<string, unknown> = {
      name: b.name, month_day: b.monthDay, date: b.date, emoji: b.emoji, image_url: b.imageUrl, message: b.message, kind: b.kind,
      enabled: b.enabled === undefined ? undefined : b.enabled ? 1 : 0,
      ...(p ? { position: b.position ?? null, ...p } : {}),
    };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    const nextMd = b.monthDay === undefined ? current.month_day : b.monthDay;
    const nextDate = b.date === undefined ? current.date : b.date;
    if (!nextMd && !nextDate) return reply.code(400).send({ error: 'Tarih gerekli' });
    if (set.length) db.prepare(`UPDATE special_days SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...set.map(([, v]) => v), id);
    audit(req.user!.username, 'special_day_updated', 'special_day', id, b, req.ip);
    refreshToday(id);
    return { item: db.prepare(`SELECT ${DAY_COLS} FROM special_days WHERE id = ?`).get(id) };
  });

  app.delete('/api/special-days/:id', { preHandler: requireRole('ik') }, async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM special_days WHERE id = ?').run(id);
    refreshToday(id);
    audit(req.user!.username, 'special_day_deleted', 'special_day', id, undefined, req.ip);
    return { ok: true };
  });

  // ---- Çalışanlar (kutlama otomasyonu) ----
  app.get('/api/employees', { preHandler: [requireRole('ik'), requireModule('ik')] }, async () => ({
    items: db
      .prepare('SELECT username, full_name fullName, birth_md birthMd, start_date startDate, department, location, celebrate FROM employees ORDER BY full_name')
      .all()
      .map((r) => ({ ...(r as object), celebrate: !!(r as { celebrate: number }).celebrate })),
  }));

  /** CSV: kullanıcı adı; ad soyad; doğum günü (GG.AA); işe giriş (GG.AA.YYYY); departman; lokasyon */
  app.post('/api/employees/import', { preHandler: [requireRole('ik'), requireModule('ik')] }, async (req) => {
    const b = z.object({ csv: z.string().max(2_000_000), replace: z.boolean().default(false) }).parse(req.body);
    const lines = b.csv.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sep = [';', '\t', ','].find((s) => lines[0]?.includes(s)) ?? ';';
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
    if (rows[0] && /kullan|user/i.test(rows[0][0])) rows.shift();
    const errors: string[] = [];
    let imported = 0;
    db.transaction(() => {
      if (b.replace) db.prepare('DELETE FROM employees').run();
      const up = db.prepare(
        `INSERT INTO employees(username, full_name, birth_md, start_date, department, location) VALUES(?,?,?,?,?,?)
         ON CONFLICT(username) DO UPDATE SET full_name=excluded.full_name, birth_md=excluded.birth_md, start_date=excluded.start_date,
           department=excluded.department, location=excluded.location`,
      );
      rows.forEach((r, i) => {
        const [username, fullName, birth, start, department, location] = r;
        if (!username || !fullName) {
          errors.push(`Satır ${i + 1}: kullanıcı adı ve ad soyad gerekli`);
          return;
        }
        up.run(username, fullName, toMonthDay(birth), toDate(start), department || null, location || null);
        imported++;
      });
    })();
    audit(req.user!.username, 'employees_imported', 'employee', null, { imported, replace: b.replace, errors: errors.length }, req.ip);
    runDailyAutomation();
    return { imported, errors: errors.slice(0, 20) };
  });

  app.patch('/api/employees/:username', { preHandler: [requireRole('ik'), requireModule('ik')] }, async (req) => {
    const { username } = req.params as { username: string };
    const b = z.object({ celebrate: z.boolean() }).parse(req.body);
    db.prepare('UPDATE employees SET celebrate = ? WHERE username = ?').run(b.celebrate ? 1 : 0, username);
    audit(req.user!.username, 'employee_updated', 'employee', username, b, req.ip);
    return { ok: true };
  });

  app.delete('/api/employees/:username', { preHandler: [requireRole('ik'), requireModule('ik')] }, async (req) => {
    const { username } = req.params as { username: string };
    db.prepare('DELETE FROM employees WHERE username = ?').run(username);
    audit(req.user!.username, 'employee_deleted', 'employee', username, undefined, req.ip);
    return { ok: true };
  });

  // ---- Panel kullanıcıları ----
  app.get('/api/users', { preHandler: requireRole('admin') }, async () => ({
    items: db
      .prepare('SELECT id, username, full_name fullName, role, is_active isActive, auth_source authSource, email, mfa_enabled mfaEnabled, mfa_enrolled_at mfaEnrolledAt, created_at createdAt, last_login_at lastLoginAt FROM users ORDER BY username')
      .all()
      .map((u) => ({ ...(u as object), isActive: !!(u as { isActive: number }).isActive, mfaEnabled: !!(u as { mfaEnabled: number }).mfaEnabled })),
  }));

  app.post('/api/users', { preHandler: requireRole('admin') }, async (req, reply) => {
    const b = z
      .object({ username: z.string().trim().min(2).max(64).regex(/^[\w.@-]+$/), fullName: z.string().trim().min(1).max(100), role: z.enum(ROLES) })
      .parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) return reply.code(409).send({ error: 'Bu kullanıcı adı kullanılıyor' });
    const password = newPassword();
    const id = uuid();
    db.prepare('INSERT INTO users(id, username, full_name, role, password_hash, created_at) VALUES(?,?,?,?,?,?)').run(
      id, b.username, b.fullName, b.role, hashPassword(password), nowIso(),
    );
    audit(req.user!.username, 'user_created', 'user', id, { username: b.username, role: b.role }, req.ip);
    return { id, password };
  });

  app.patch('/api/users/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({ fullName: z.string().trim().min(1).max(100).optional(), role: z.enum(ROLES).optional(), isActive: z.boolean().optional(), resetPassword: z.boolean().optional() })
      .parse(req.body);
    if (id === req.user!.id && (b.isActive === false || (b.role && b.role !== 'admin'))) {
      return reply.code(400).send({ error: 'Kendi yönetici hesabınızı kapatamaz veya rolünü düşüremezsiniz' });
    }
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as { full_name: string; role: string; is_active: number; auth_source: string } | undefined;
    if (!u) return reply.code(404).send({ error: 'Kullanıcı bulunamadı' });
    if (u.auth_source === 'ldap' && ((b.role && b.role !== u.role) || b.resetPassword || b.fullName)) {
      return reply.code(400).send({ error: "Active Directory kullanıcısının rolü, adı ve parolası AD'den gelir; panelden yalnızca erişimi açılıp kapatılabilir" });
    }
    db.prepare('UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?').run(
      b.fullName ?? u.full_name, b.role ?? u.role, b.isActive === undefined ? u.is_active : b.isActive ? 1 : 0, id,
    );
    let password: string | undefined;
    if (b.resetPassword) {
      password = newPassword();
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    }
    if (b.isActive === false || b.resetPassword) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(req.user!.username, 'user_updated', 'user', id, { ...b, resetPassword: !!b.resetPassword }, req.ip);
    return { ok: true, password };
  });

  app.post('/api/auth/password', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ current: z.string().min(1), next: z.string().min(10, 'Yeni parola en az 10 karakter olmalı').max(256) }).parse(req.body);
    if (req.user!.authSource === 'ldap') return reply.code(400).send({ error: "Parolanız Active Directory'de yönetilir" });
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(b.current, u.password_hash)) return reply.code(400).send({ error: 'Mevcut parola hatalı' });
    if (b.next === b.current) return reply.code(400).send({ error: 'Yeni parola eskisiyle aynı olamaz' });
    if (b.next.toLowerCase().includes(req.user!.username.toLowerCase())) return reply.code(400).send({ error: 'Parola kullanıcı adınızı içeremez' });
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hashPassword(b.next), nowIso(), req.user!.id);
    // diğer cihazlardaki oturumlar kapanır; ilk kurulum parolası dosyası artık geçersiz → silinir
    revokeSessions(req.user!.id, req.sessionHash);
    if (req.user!.username === 'admin') fs.rmSync(path.join(config.dataDir, 'ILK-YONETICI-PAROLASI.txt'), { force: true });
    audit(req.user!.username, 'password_changed', 'user', req.user!.id, undefined, req.ip);
    return { ok: true };
  });

  // ---- Active Directory / LDAP: panelden ayarlanır (servis parolası şifreli saklanır) ya da .env ----
  const ldapInput = z.object({
    enabled: z.boolean(),
    url: z.string().trim().regex(/^ldaps?:\/\/[^\s/]+(:\d+)?\/?$/, 'Adres ldap://sunucu:389 ya da ldaps://sunucu:636 biçiminde olmalı'),
    baseDn: z.string().trim().min(3).max(500),
    bindDn: z.string().trim().max(500),
    bindPassword: z.string().max(256).optional(),
    userFilter: z.string().trim().max(500).refine((v) => !v || v.includes('{{username}}'), 'Filtre {{username}} içermeli').optional(),
    domain: z.string().trim().max(64).nullable().optional(),
    startTls: z.boolean(),
    rejectUnauthorized: z.boolean(),
    caPem: z.string().trim().max(20_000).refine((v) => !v || v.includes('BEGIN CERTIFICATE'), 'PEM biçiminde sertifika yapıştırın').nullable().optional(),
    groups: z.object({ admin: z.string().max(500).optional(), it: z.string().max(500).optional(), isg: z.string().max(500).optional(), ik: z.string().max(500).optional(), viewer: z.string().max(500).optional() }),
    defaultRole: z.enum(ROLES).nullable(),
  });

  app.get('/api/settings/ldap', { preHandler: requireRole('admin') }, async () => {
    const l = ldapSettings();
    const counts = db.prepare('SELECT auth_source s, COUNT(*) c FROM users GROUP BY auth_source').all() as { s: string; c: number }[];
    return {
      enabled: l.enabled,
      source: l.source,
      url: l.url ?? null,
      baseDn: l.baseDn ?? null,
      bindDn: l.bindDn ?? null,
      bindPasswordSet: !!l.bindPassword,
      userFilter: l.userFilter,
      domain: l.domain,
      startTls: l.startTls,
      caFile: l.caFile ?? null,
      caPemSet: !!l.caPem,
      rejectUnauthorized: l.rejectUnauthorized,
      groups: l.groups,
      defaultRole: l.defaultRole,
      users: Object.fromEntries(counts.map((r) => [r.s, r.c])),
    };
  });

  /** Kayıtlı ayarla ya da (gövdede config varsa) KAYDETMEDEN önce yeni ayarla test */
  app.post('/api/settings/ldap/test', { preHandler: requireRole('admin') }, async (req) => {
    const b = z.object({ username: z.string().trim().max(128).optional(), config: ldapInput.optional() }).parse(req.body ?? {});
    const result = await ldapTest(b.username || undefined, b.config ? settingsFromInput({ ...b.config, enabled: true }) : undefined);
    audit(req.user!.username, 'ldap_tested', 'settings', null, { ok: result.ok, username: b.username, unsaved: !!b.config }, req.ip);
    return result;
  });

  app.put('/api/settings/ldap', { preHandler: requireRole('admin') }, async (req, reply) => {
    const b = ldapInput.parse(req.body);
    if (b.enabled) {
      // açılacaksa önce bağlantı denenir: yanlış ayarla kimse kilitlenmesin (yerel yönetici hesabı her durumda çalışır)
      const t = await ldapTest(undefined, settingsFromInput(b));
      if (!t.ok) return reply.code(400).send({ error: `Bağlantı denemesi başarısız: ${t.message}`, test: t });
    }
    saveLdapSettings(b);
    audit(req.user!.username, 'ldap_settings_saved', 'settings', null, { ...b, bindPassword: b.bindPassword ? '(değişti)' : undefined, caPem: b.caPem ? '(var)' : undefined }, req.ip);
    return { ok: true };
  });

  app.delete('/api/settings/ldap', { preHandler: requireRole('admin') }, async (req) => {
    clearLdapSettings();
    audit(req.user!.username, 'ldap_settings_cleared', 'settings', null, undefined, req.ip);
    return { ok: true };
  });

  // ---- Lisans ----
  app.get('/api/license', { preHandler: requireRole() }, async (req) => ({
    ...licenseInfo(),
    ...(req.user!.role === 'admin' ? { serverId: serverId() } : {}),
  }));

  app.post('/api/license', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { license } = z.object({ license: z.string().min(20).max(10_000) }).parse(req.body);
    let lic;
    try {
      lic = parseLicense(license);
    } catch (e) {
      audit(req.user!.username, 'license_rejected', 'license', null, { reason: (e as Error).message }, req.ip);
      return reply.code(400).send({ error: (e as Error).message });
    }
    setSetting('license', license.trim());
    invalidateLicense();
    audit(req.user!.username, 'license_installed', 'license', lic.id, { customer: lic.customer, modules: lic.modules, maxDevices: lic.maxDevices, validUntil: lic.validUntil }, req.ip);
    syncAll();
    return licenseInfo();
  });

  // ---- Denetim kaydı ----
  app.get('/api/audit/verify', { preHandler: requireRole('admin') }, async (req) => {
    const r = verifyAuditChain();
    audit(req.user!.username, 'audit_verified', 'audit', null, r, req.ip);
    return r;
  });

  app.get('/api/audit', { preHandler: requireRole('admin') }, async (req) => {
    const q = z.object({ q: z.string().optional(), limit: z.coerce.number().min(1).max(1000).default(300) }).parse(req.query);
    const like = q.q ? `%${q.q}%` : null;
    return {
      items: db
        .prepare(
          `SELECT id, actor, action, entity, entity_id entityId, details, ip, created_at createdAt FROM audit_log
           ${like ? 'WHERE actor LIKE ? OR action LIKE ? OR details LIKE ?' : ''} ORDER BY id DESC LIMIT ?`,
        )
        .all(...(like ? [like, like, like] : []), q.limit),
    };
  });
}
