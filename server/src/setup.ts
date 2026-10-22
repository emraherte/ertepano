// İlk kurulum sihirbazı, güvenlik kontrol listesi ve otomatik yedekleme.
// Amaç: bir kuruma kurulum yapan kişi tek ekrandan "güvenli mi?" sorusunu cevaplayabilsin.
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getSecurity, requireRole } from './auth.js';
import { config } from './config.js';
import { audit, db, getSetting, nowIso, setSetting } from './db.js';
import { ldapSettings } from './ldap-settings.js';
import { licenseInfo } from './license.js';
import { verifyPassword } from './security.js';

const BACKUP_DIR = path.join(config.dataDir, 'backups');
const KEEP_BACKUPS = 14;
const DEMO_PASSWORD = 'Demo12345!';

export interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  /** panelde düzeltme sayfası */
  action?: string;
}

export const orgName = () => getSetting('org_name');

/** Veritabanı + anahtar klasörünün günlük yedeği. Anahtarlar olmadan 2FA ve LDAP parolası çözülemez — birlikte alınır. */
export async function backupNow(): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  await db.backup(path.join(dir, 'ertepano.db'));
  fs.cpSync(path.join(config.dataDir, 'keys'), path.join(dir, 'keys'), { recursive: true });
  // eski yedekleri temizle
  const all = fs.readdirSync(BACKUP_DIR).filter((d) => /^\d{4}-/.test(d)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  setSetting('last_backup_at', nowIso());
  return dir;
}

export function startBackups() {
  const run = () => backupNow().catch((e) => console.error('[yedek]', e));
  const last = getSetting('last_backup_at');
  if (!last || Date.now() - Date.parse(last) > 20 * 3600_000) setTimeout(run, 60_000);
  return setInterval(run, 24 * 3600_000);
}

export function securityChecks(): Check[] {
  const checks: Check[] = [];
  const initialFile = path.join(config.dataDir, 'ILK-YONETICI-PAROLASI.txt');
  checks.push(
    fs.existsSync(initialFile)
      ? { id: 'initial_password', label: 'İlk yönetici parolası', status: 'fail', detail: 'Kurulumda üretilen parola hâlâ geçerli ve diskte duruyor. Değiştirin (dosya otomatik silinir).', action: '/hesabim' }
      : { id: 'initial_password', label: 'İlk yönetici parolası', status: 'ok', detail: 'Değiştirildi, dosya silindi.' },
  );

  const admins = db.prepare("SELECT username, mfa_enabled FROM users WHERE role = 'admin' AND is_active = 1").all() as { username: string; mfa_enabled: number }[];
  const noMfa = admins.filter((a) => !a.mfa_enabled).map((a) => a.username);
  checks.push(
    noMfa.length
      ? { id: 'admin_mfa', label: 'Yönetici 2FA', status: 'fail', detail: `2FA kurmamış yönetici: ${noMfa.join(', ')}`, action: '/kullanicilar' }
      : { id: 'admin_mfa', label: 'Yönetici 2FA', status: 'ok', detail: 'Tüm yöneticilerde açık.' },
  );
  const sec = getSecurity();
  const emergencyRoles = ['isg', 'it'].filter((r) => !sec.mfaRequiredRoles.includes(r as never));
  checks.push(
    emergencyRoles.length
      ? { id: 'mfa_policy', label: '2FA politikası', status: 'warn', detail: `Acil durum yayını yapabilen rollerde zorunlu değil: ${emergencyRoles.map((r) => r.toUpperCase()).join(', ')}`, action: '/sistem' }
      : { id: 'mfa_policy', label: '2FA politikası', status: 'ok', detail: 'Acil durum yetkili rollerde zorunlu.' },
  );

  // demo kullanıcılar / anahtar (seed:demo) üretimde kalmamalı
  const demoUsers = (db.prepare("SELECT username, password_hash FROM users WHERE auth_source = 'local' AND is_active = 1").all() as { username: string; password_hash: string }[])
    .filter((u) => verifyPassword(DEMO_PASSWORD, u.password_hash))
    .map((u) => u.username);
  checks.push(
    demoUsers.length
      ? { id: 'demo_users', label: 'Demo hesaplar', status: 'fail', detail: `Bilinen demo parolalı hesaplar: ${demoUsers.join(', ')} — silin ya da devre dışı bırakın.`, action: '/kullanicilar' }
      : { id: 'demo_users', label: 'Demo hesaplar', status: 'ok', detail: 'Yok.' },
  );
  const demoKey = db.prepare("SELECT 1 FROM enroll_keys WHERE key = 'EK-DEMO-DEMO-DEMO' AND revoked = 0").get();
  const autoKeys = (db.prepare('SELECT COUNT(*) c FROM enroll_keys WHERE auto_approve = 1 AND revoked = 0').get() as { c: number }).c;
  checks.push(
    demoKey
      ? { id: 'enroll_keys', label: 'Ajan kayıt anahtarları', status: 'fail', detail: 'Demo kayıt anahtarı etkin — iptal edin.', action: '/ajan-kurulumu' }
      : autoKeys
        ? { id: 'enroll_keys', label: 'Ajan kayıt anahtarları', status: 'warn', detail: `${autoKeys} otomatik onaylı anahtar var; yalnızca GPO dağıtımı sırasında açık tutun.`, action: '/ajan-kurulumu' }
        : { id: 'enroll_keys', label: 'Ajan kayıt anahtarları', status: 'ok', detail: 'Yeni cihazlar IT onayıyla katılıyor.' },
  );

  const https = config.publicUrl.startsWith('https://');
  checks.push(
    https && config.secureCookies
      ? { id: 'https', label: 'HTTPS', status: 'ok', detail: `${config.publicUrl} — güvenli çerez açık.` }
      : { id: 'https', label: 'HTTPS', status: 'warn', detail: 'Panel ve ajan trafiği şifresiz olabilir. İç CA sertifikalı reverse proxy arkasında PUBLIC_URL=https://… ve SECURE_COOKIES=true verin.' },
  );

  const l = ldapSettings();
  checks.push(
    !l.enabled
      ? { id: 'ldap', label: 'Active Directory', status: 'info', detail: 'Kapalı — yalnızca yerel hesaplar. AD ile tek oturum için ayarlayın.', action: '/sistem' }
      : l.url?.startsWith('ldaps://') || l.startTls
        ? { id: 'ldap', label: 'Active Directory', status: 'ok', detail: `${l.url} — şifreli bağlantı.` }
        : { id: 'ldap', label: 'Active Directory', status: 'warn', detail: 'ldap:// şifresiz; parolalar ağda açık gider. LDAPS (636) kullanın.', action: '/sistem' },
  );

  if (process.platform === 'win32') {
    checks.push(
      getSetting('data_acl_v1') === config.dataDir
        ? { id: 'data_acl', label: 'Veri klasörü izinleri', status: 'ok', detail: `${config.dataDir} yalnızca SYSTEM, Yöneticiler ve sunucu hesabına açık.` }
        : { id: 'data_acl', label: 'Veri klasörü izinleri', status: 'warn', detail: `${config.dataDir} kısıtlanamadı; veritabanı ve anahtarlar başka kullanıcılarca okunabilir.` },
    );
  }

  const last = getSetting('last_backup_at');
  checks.push(
    last && Date.now() - Date.parse(last) < 30 * 3600_000
      ? { id: 'backup', label: 'Yedek', status: 'ok', detail: `Son yedek ${new Date(last).toLocaleString('tr-TR')} — ${BACKUP_DIR} (son ${KEEP_BACKUPS} gün). Bu klasörü ayrıca sunucu dışına kopyalayın.` }
      : { id: 'backup', label: 'Yedek', status: 'warn', detail: 'Son 24 saatte yedek yok. "Şimdi yedekle"ye basın; sunucu her gün kendiliğinden yedekler.' },
  );

  const lic = licenseInfo();
  checks.push(
    lic.mode === 'licensed'
      ? { id: 'license', label: 'Lisans', status: 'ok', detail: `${lic.customer} · ${lic.modules.map((m) => m.toUpperCase()).join(', ') || 'temel'} · ${lic.deviceCount}/${lic.maxDevices} cihaz` }
      : lic.mode === 'trial'
        ? { id: 'license', label: 'Lisans', status: 'info', detail: `Deneme sürümü, ${lic.daysLeft} gün kaldı.`, action: '/lisans' }
        : { id: 'license', label: 'Lisans', status: 'warn', detail: 'Lisans süresi dolmuş ya da geçersiz.', action: '/lisans' },
  );
  return checks;
}

export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup', { preHandler: requireRole('admin') }, async () => ({
    completed: getSetting('setup_completed') === '1',
    orgName: orgName(),
    publicUrl: config.publicUrl || null,
    checks: securityChecks(),
  }));

  app.post('/api/setup/org', { preHandler: requireRole('admin') }, async (req) => {
    const b = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    setSetting('org_name', b.name);
    audit(req.user!.username, 'org_updated', 'settings', null, b, req.ip);
    return { ok: true };
  });

  app.post('/api/setup/complete', { preHandler: requireRole('admin') }, async (req) => {
    setSetting('setup_completed', '1');
    audit(req.user!.username, 'setup_completed', 'settings', null, { checks: securityChecks().map((c) => `${c.id}:${c.status}`) }, req.ip);
    return { ok: true };
  });

  app.post('/api/setup/backup', { preHandler: requireRole('admin') }, async (req) => {
    const dir = await backupNow();
    audit(req.user!.username, 'backup_created', 'settings', null, { dir }, req.ip);
    return { ok: true, dir };
  });
}
