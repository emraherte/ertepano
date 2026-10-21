// Modüler lisans: İK, İSG ve IT modülleri ayrı satılır. Lisans dosyası satıcının (Erte) Ed25519 özel anahtarıyla
// imzalıdır; sunucu yalnızca aşağıdaki genel anahtarla doğrular — müşteri lisansı üretemez ya da değiştiremez.
// Lisans basma aracı: tools/license (yalnızca satıcıda).
import crypto from 'node:crypto';
import os from 'node:os';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Category, type LicenseInfo, type LicenseMode, licensedCategories, type Module, MODULES, type ReportKind, type Role, ROLE_CATEGORIES } from '@ertepano/shared';
import { db, getSetting, nowIso, setSetting } from './db.js';

/** Satıcı genel anahtarı (tools/license keygen çıktısı). Değiştirilirse eski lisanslar geçersiz olur. */
const VENDOR_PUBLIC_KEY = process.env.ERTEPANO_VENDOR_KEY_OVERRIDE && process.env.NODE_ENV === 'test'
  ? process.env.ERTEPANO_VENDOR_KEY_OVERRIDE
  : '4Vvlx8A050LJNJz0iJzI/4jFDDRtZmfdWoqIHr0caQM=';
const HEADER = 'ERTEPANO-LICENSE-1';
const TRIAL_DAYS = 30;
const TRIAL_DEVICES = 25;
/** Süresi dolan lisans bu kadar gün daha çalışır (yenileme için zaman) */
const GRACE_DAYS = 14;
const DAY = 86400_000;

const vendorKey = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(VENDOR_PUBLIC_KEY, 'base64')]),
  format: 'der',
  type: 'spki',
});

export interface LicensePayload {
  v: 1;
  id: string;
  customer: string;
  modules: Module[];
  maxDevices: number;
  validFrom: string;
  validUntil: string;
  serverId: string | null;
  issuedAt: string;
}

/** Bu sunucunun kimliği: makine adı + ilk fiziksel ağ kartı. Lisans isteğe bağlı olarak buna bağlanır. */
export function serverId(): string {
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map((n) => n!.mac)
    .sort();
  return crypto.createHash('sha256').update(`${os.hostname().toLowerCase()}|${macs[0] ?? ''}`).digest('hex').slice(0, 16).toUpperCase();
}

/** Lisans metnini doğrula; geçersizse nedenini fırlatır. */
export function parseLicense(text: string): LicensePayload {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== HEADER || !lines[1]) throw new Error('Lisans biçimi tanınmadı');
  const [p, s] = lines[1].split('.');
  if (!p || !s) throw new Error('Lisans biçimi tanınmadı');
  const body = Buffer.from(p, 'base64url');
  if (!crypto.verify(null, body, vendorKey, Buffer.from(s, 'base64url'))) throw new Error('Lisans imzası geçersiz');
  const lic = JSON.parse(body.toString('utf8')) as LicensePayload;
  if (lic.v !== 1 || !Array.isArray(lic.modules) || !lic.validUntil) throw new Error('Lisans sürümü desteklenmiyor');
  lic.modules = lic.modules.filter((m): m is Module => (MODULES as readonly string[]).includes(m));
  if (lic.serverId && lic.serverId !== serverId()) throw new Error(`Bu lisans başka bir sunucuya ait (bu sunucu: ${serverId()})`);
  return lic;
}

let cache: { at: number; info: Omit<LicenseInfo, 'deviceCount'> } | null = null;

function compute(): Omit<LicenseInfo, 'deviceCount'> {
  const now = Date.now();
  const raw = getSetting('license');
  if (raw) {
    try {
      const lic = parseLicense(raw);
      const end = Date.parse(`${lic.validUntil}T23:59:59`);
      const start = Date.parse(`${lic.validFrom}T00:00:00`);
      let mode: LicenseMode = 'licensed';
      if (now < start) mode = 'expired';
      else if (now > end + GRACE_DAYS * DAY) mode = 'expired';
      else if (now > end) mode = 'grace';
      return {
        mode,
        modules: mode === 'expired' ? [] : lic.modules,
        customer: lic.customer,
        maxDevices: lic.maxDevices,
        validUntil: lic.validUntil,
        daysLeft: Math.ceil(((mode === 'grace' ? end + GRACE_DAYS * DAY : end) - now) / DAY),
        licenseId: lic.id,
      };
    } catch {
      // bozuk/başka sunucunun lisansı: deneme süresine düşmez, süresi dolmuş sayılır
      return { mode: 'expired', modules: [], customer: null, maxDevices: TRIAL_DEVICES, validUntil: null, daysLeft: 0, licenseId: null };
    }
  }
  // Lisans yok: ilk açılıştan itibaren 30 gün tüm modüller açık deneme
  let started = getSetting('trial_started');
  if (!started) {
    started = nowIso();
    setSetting('trial_started', started);
  }
  const end = Date.parse(started) + TRIAL_DAYS * DAY;
  const active = now < end;
  return {
    mode: active ? 'trial' : 'expired',
    modules: active ? [...MODULES] : [],
    customer: null,
    maxDevices: TRIAL_DEVICES,
    validUntil: new Date(end).toISOString().slice(0, 10),
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY)),
    licenseId: null,
  };
}

export function licenseInfo(): LicenseInfo {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), info: compute() };
  const deviceCount = (db.prepare("SELECT COUNT(*) c FROM devices WHERE status = 'approved'").get() as { c: number }).c;
  return { ...cache.info, deviceCount };
}

export const invalidateLicense = () => {
  cache = null;
};

export const hasModule = (m: Module) => licenseInfo().modules.includes(m);

/** Onaylı cihaz sayısı lisans sınırında mı? */
export const deviceLimitReached = () => {
  const l = licenseInfo();
  return l.deviceCount >= l.maxDevices;
};

/** Rolün yayın yapabileceği VE lisansı olan kategoriler */
export const publishCategories = (role: Role): Category[] => {
  const lic = licensedCategories(licenseInfo().modules);
  return ROLE_CATEGORIES[role].filter((c) => lic.includes(c));
};

/** Çalışan bildirim türlerinin modülü */
export const REPORT_MODULE: Record<ReportKind, Module> = { it_help: 'it', near_miss: 'isg' };

/** preHandler: modül lisanslı değilse 402 */
export function requireModule(...mods: Module[]) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!mods.some(hasModule)) {
      return reply.code(402).send({ error: 'Bu özellik lisansınızda yok', code: 'module_not_licensed', modules: mods });
    }
  };
}
