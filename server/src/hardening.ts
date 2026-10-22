// İstek düzeyinde savunmalar: güvenlik başlıkları, köken (Origin) denetimi, veri klasörü izinleri.
import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

/** Panel için sıkı CSP: yalnızca kendi kökenimizden betik; satır içi stil Framer Motion/Tailwind için gerekli. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function registerHardening(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('content-security-policy', CSP);
    if (config.secureCookies) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    // API yanıtları önbelleğe alınmasın (paylaşılan PC'lerde kişisel veri kalmasın)
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  /**
   * CSRF savunması (SameSite=Strict çerezine ek): tarayıcıdan gelen durum değiştiren isteklerde Origin bizim
   * kökenimiz olmalı. Aynı "site"daki kardeş alan adından (ör. intranet.sirket.local) gönderilen form da reddedilir.
   * Ajanlar Origin göndermez; onlar cihaz sırrıyla kimlik doğrular.
   */
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/agent/')) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return reply.code(403).send({ error: 'Kökenler arası istek reddedildi' });
    }
    if (!origin) return;
    const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`]);
    if (config.publicUrl) allowed.add(new URL(config.publicUrl).origin);
    for (const extra of config.allowedOrigins) allowed.add(extra);
    if (!allowed.has(origin)) return reply.code(403).send({ error: 'Kökenler arası istek reddedildi' });
  });
}

/**
 * Windows'ta veri klasörü (veritabanı, imza anahtarı, 2FA anahtarı) yalnızca SYSTEM, Yöneticiler ve sunucuyu
 * çalıştıran hesaba açık olmalı. `C:\ErtePano\data` gibi bir yol "Authenticated Users: Değiştir" iznini devralır.
 * Bir kez uygulanır; DATA_DIR_ACL=off ile kapatılabilir.
 */
export function lockDataDir() {
  if (process.platform !== 'win32' || process.env.DATA_DIR_ACL === 'off') return;
  // kurulum betiği (deploy/server/Install-ErtePanoServer.ps1) izinleri NETWORK SERVICE için kendisi ayarladı
  if (process.env.DATA_DIR_ACL === 'managed') {
    setSetting('data_acl_v1', config.dataDir);
    return;
  }
  if (getSetting('data_acl_v1') === config.dataDir) return;
  const user = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  if (!user || !fs.existsSync(config.dataDir)) return;
  try {
    // 1) yalnızca klasörün kendisine korumalı DACL (OI/CI bayrakları dosyalara uygulanamaz — /T burada kullanılmaz)
    execFileSync('icacls', [config.dataDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', `${user}:(OI)(CI)F`, '/C', '/Q'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    // 2) içerik açık izinlerini bırakıp yeni klasör DACL'ini devralsın
    execFileSync('icacls', [`${config.dataDir}\\*`, '/reset', '/T', '/C', '/Q'], { stdio: 'ignore', windowsHide: true });
    // 3) sunucu hesabı hâlâ yazabiliyor mu? (kendimizi kilitlemediğimizden emin ol)
    const probe = `${config.dataDir}\\.acl-probe`;
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    setSetting('data_acl_v1', config.dataDir);
    console.log(`Veri klasörü izinleri kısıtlandı: ${config.dataDir} (SYSTEM, Yöneticiler, ${user})`);
  } catch (e) {
    console.warn(`UYARI: veri klasörü izinleri ayarlanamadı (${(e as Error).message}). Elle kısıtlayın: ${config.dataDir}`);
  }
}
