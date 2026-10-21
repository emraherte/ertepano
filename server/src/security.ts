import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// ---- Ed25519 duyuru imzası -------------------------------------------------------------------
// Özel anahtar data/keys altında, yalnızca sunucuda. Genel anahtar ajanların agent.json'ına gömülür.

const keyDir = path.join(config.dataDir, 'keys');
const keyFile = path.join(keyDir, 'ed25519-private.pem');

function loadOrCreateKey(): crypto.KeyObject {
  if (fs.existsSync(keyFile)) {
    return crypto.createPrivateKey(fs.readFileSync(keyFile));
  }
  fs.mkdirSync(keyDir, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}

const privateKey = loadOrCreateKey();
const publicKey = crypto.createPublicKey(privateKey);

/** Ham 32 baytlık Ed25519 genel anahtarı, base64. (SPKI DER'in son 32 baytı.) */
export const publicKeyBase64 = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64');

export function sign(payload: string): string {
  return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}

// ---- Parolalar, jetonlar ---------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const uuid = () => crypto.randomUUID();

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Okunaklı kayıt anahtarı: EK-7KQ2-M9XA-P4TD (karışan harfler yok). */
export function newEnrollKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `EK-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function newPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join('');
}
