// ErtePano lisans aracı — YALNIZCA SATICI (Erte) kullanır. Müşteriye bu araç ve özel anahtar verilmez.
//
//   npm run license -- keygen                      satıcı anahtar çifti (özel anahtar depo DIŞINDA saklanır)
//   npm run license -- issue --customer "Kastaş A.Ş." --modules ik,isg --devices 250 --until 2027-12-31 [--server-id ABCD…] [--out kastas.lic]
//   npm run license -- show kastas.lic             içeriği göster + imzayı doğrula
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODULES, type Module } from '@ertepano/shared';

const HEADER = 'ERTEPANO-LICENSE-1';
const DEFAULT_DIR = path.join(os.homedir(), '.ertepano-vendor');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : undefined;
};
const b64u = (b: Buffer) => b.toString('base64url');

function die(msg: string): never {
  console.error(`HATA: ${msg}`);
  process.exit(1);
}

function keyPath() {
  return opt('key') ?? path.join(DEFAULT_DIR, 'vendor-private.pem');
}

function publicKeyOf(priv: crypto.KeyObject) {
  return (crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64');
}

if (cmd === 'keygen') {
  const out = keyPath();
  if (fs.existsSync(out) && !args.includes('--force')) die(`${out} zaten var. Eski lisanslar geçersiz kalır; gerçekten yenilemek için --force`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Özel anahtar: ${out}`);
  console.log('  → Yedekleyin ve kimseyle paylaşmayın. Bu dosya olmadan yeni lisans basılamaz.');
  console.log(`Genel anahtar (server/src/license.ts → VENDOR_PUBLIC_KEY):\n  ${publicKeyOf(privateKey)}`);
} else if (cmd === 'issue') {
  const customer = opt('customer') ?? die('--customer gerekli');
  const modules = (opt('modules') ?? die('--modules gerekli (ör. ik,isg,it)')).split(',').map((m) => m.trim()) as Module[];
  for (const m of modules) if (!MODULES.includes(m)) die(`bilinmeyen modül: ${m} (geçerli: ${MODULES.join(', ')})`);
  const maxDevices = Number(opt('devices') ?? die('--devices gerekli'));
  if (!Number.isInteger(maxDevices) || maxDevices < 1) die('--devices pozitif tam sayı olmalı');
  const until = opt('until') ?? die('--until gerekli (YYYY-AA-GG)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) die('--until biçimi YYYY-AA-GG');
  const priv = crypto.createPrivateKey(fs.readFileSync(keyPath()));
  const payload = {
    v: 1,
    id: crypto.randomUUID(),
    customer,
    modules: [...new Set(modules)],
    maxDevices,
    validFrom: opt('from') ?? new Date().toISOString().slice(0, 10),
    validUntil: until,
    serverId: opt('server-id') ?? null,
    issuedAt: new Date().toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, priv);
  const text = `${HEADER}\n${b64u(body)}.${b64u(sig)}\n`;
  const out = opt('out');
  if (out) {
    fs.writeFileSync(out, text);
    console.log(`Lisans yazıldı: ${out}`);
  } else process.stdout.write(text);
  console.error(`(${customer} · ${payload.modules.join(', ')} · ${maxDevices} cihaz · ${until}${payload.serverId ? ` · sunucu ${payload.serverId}` : ''})`);
} else if (cmd === 'show') {
  const file = args[1] ?? die('lisans dosyası gerekli');
  const [head, token] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (head !== HEADER || !token) die('lisans biçimi tanınmadı');
  const [p, s] = token.split('.');
  const body = Buffer.from(p, 'base64url');
  console.log(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2));
  if (fs.existsSync(keyPath())) {
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyOf(crypto.createPrivateKey(fs.readFileSync(keyPath()))), 'base64')]), format: 'der', type: 'spki' });
    console.log(`İmza: ${crypto.verify(null, body, pub, Buffer.from(s, 'base64url')) ? 'GEÇERLİ' : 'GEÇERSİZ'}`);
  }
} else {
  console.log('Kullanım: keygen | issue --customer … --modules ik,isg,it --devices N --until YYYY-AA-GG [--server-id …] [--out dosya.lic] | show dosya.lic');
  process.exit(cmd ? 1 : 0);
}
