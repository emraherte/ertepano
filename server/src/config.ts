import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Role } from '@ertepano/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Depo kökündeki .env (varsa) — ortamda zaten tanımlı değişkenleri ezmez. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(root, '.env'));

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
const env = (k: string) => process.env[k]?.trim() || undefined;

export const config = {
  port: int(process.env.PORT, 4100),
  host: process.env.HOST ?? '0.0.0.0',
  /** Ajanların ve panelin bu sunucuya ulaştığı adres (görsel URL'leri ve agent.json için). */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, 'data')),
  panelDist: path.join(root, 'apps', 'panel', 'dist'),
  sessionHours: int(process.env.SESSION_HOURS, 12),
  /** Çerezleri yalnızca HTTPS'te gönder (üretimde reverse proxy arkasında true yapın). */
  secureCookies: process.env.SECURE_COOKIES === 'true',
  /**
   * Önünde reverse proxy (IIS/nginx) varsa onun IP'si/CIDR'ı (virgülle). Boşsa X-Forwarded-For'a güvenilmez —
   * aksi halde istemci sahte IP yazarak hız sınırlarını atlatabilir ve denetim kaydına sahte IP düşürebilir.
   */
  trustProxy: (process.env.TRUST_PROXY ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  /** Panelin açıldığı ek kökenler (ör. https://pano.sirket.local) — PUBLIC_URL kökeni zaten izinli */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean),
  retention: {
    telemetryDays: int(process.env.RETENTION_TELEMETRY_DAYS, 30),
    deliveryDays: int(process.env.RETENTION_DELIVERY_DAYS, 365),
    complianceDays: int(process.env.RETENTION_COMPLIANCE_DAYS, 730),
  },
  /** Kutlama/özel gün otomatiğinin çalıştığı saat dilimi. */
  timeZone: process.env.TZ_NAME ?? 'Europe/Istanbul',

  /** Active Directory / LDAP girişi. LDAP_URL ve LDAP_BASE_DN verilmezse kapalıdır. */
  ldap: {
    url: env('LDAP_URL'),
    baseDn: env('LDAP_BASE_DN'),
    bindDn: env('LDAP_BIND_DN'),
    bindPassword: env('LDAP_BIND_PASSWORD'),
    userFilter: env('LDAP_USER_FILTER') ?? '(&(objectClass=user)(objectCategory=person)(sAMAccountName={{username}}))',
    /** Girişte gösterilecek alan adı ipucu (örn. SIRKET) */
    domain: env('LDAP_DOMAIN') ?? null,
    startTls: process.env.LDAP_STARTTLS === 'true',
    caFile: env('LDAP_CA_FILE'),
    rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
    /** Rol → AD grubu (CN adı veya tam DN). İç içe gruplar DN verildiğinde AD'nin zincir kuralıyla çözülür. */
    groups: {
      admin: env('LDAP_GROUP_ADMIN'),
      it: env('LDAP_GROUP_IT'),
      isg: env('LDAP_GROUP_ISG'),
      ik: env('LDAP_GROUP_IK'),
      viewer: env('LDAP_GROUP_VIEWER'),
    } as Record<Role, string | undefined>,
    /** Hiçbir gruba uymayan AD kullanıcısının rolü; boşsa giriş reddedilir. */
    defaultRole: (env('LDAP_DEFAULT_ROLE') as Role | undefined) ?? null,
    get enabled() {
      return !!(this.url && this.baseDn);
    },
  },
};
