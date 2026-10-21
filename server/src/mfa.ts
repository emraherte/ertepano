// İki faktörlü doğrulama: TOTP (RFC 6238 — Google/Microsoft Authenticator, 30 sn, 6 hane) + tek kullanımlık kurtarma kodları.
// Gizli anahtarlar veritabanında AES-256-GCM ile şifreli durur; anahtar data/keys/mfa.key dosyasındadır.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { config } from './config.js';

const STEP_SEC = 30;
const DIGITS = 6;
/** Saat kaymasına tolerans: önceki ve sonraki 30 sn'lik adım da kabul edilir */
const WINDOW = 1;
const ISSUER = 'ErtePano';

// ---- Şifreleme anahtarı ----------------------------------------------------------------------
const keyFile = path.join(config.dataDir, 'keys', 'mfa.key');
function loadKey(): Buffer {
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, k.toString('base64'), { mode: 0o600 });
  return k;
}
const KEY = loadKey();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string | null {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---- Base32 (RFC 4648) -----------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('geçersiz base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---- TOTP ------------------------------------------------------------------------------------
export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SEC);

/**
 * Kodu doğrular; geçerliyse kullanılan adımı döner. `lastStep`ten eski ya da aynı adım reddedilir
 * (aynı kod iki kez kullanılamaz — tekrar oynatma saldırısına karşı).
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = cur + d;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = totpAt(secretB32, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

export const qrSvg = (uri: string) => QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 });

/** Elle girilecek gösterim: 4'lü gruplar */
export const formatSecret = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

// ---- Kurtarma kodları ------------------------------------------------------------------------
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 10 adet "XXXX-XXXX" (~40 bit); veritabanında yalnızca HMAC özetleri tutulur. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => {
    const b = crypto.randomBytes(8);
    const s = Array.from(b, (x) => RC_ALPHABET[x % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

export function hashRecovery(code: string): string {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHmac('sha256', KEY).update(`rc:${norm}`).digest('hex');
}

/** Eşleşen kurtarma kodunu listeden düşer; kalan liste döner (eşleşme yoksa null). */
export function consumeRecovery(hashes: string[], code: string): string[] | null {
  const h = hashRecovery(code);
  const i = hashes.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (i < 0) return null;
  return hashes.filter((_, j) => j !== i);
}
