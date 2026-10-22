// mTLS (ajan istemci sertifikası) uçtan uca testi. Test CA'sı, sunucu ve istemci sertifikaları openssl ile üretilir;
// openssl bulunamazsa test atlanır. Sunucu doğrudan HTTPS (PFX) + TLS_CLIENT_CA_PATH ile ayrı süreçte başlatılır.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ertepano-mtls-'));
const PKI = path.join(DATA, 'pki');
const PORT = 4900 + Math.floor(Math.random() * 300);
const BASE = `https://127.0.0.1:${PORT}`;
const ENROLL_KEY = 'EK-MTLS-TEST-0001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findOpenssl(): string | null {
  for (const c of ['openssl', 'C:/Program Files/Git/mingw64/bin/openssl.exe', 'C:/Program Files/Git/usr/bin/openssl.exe']) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* sıradaki */
    }
  }
  return null;
}
const OPENSSL = findOpenssl();

const p = (f: string) => path.join(PKI, f);
const ssl = (...args: string[]) => execFileSync(OPENSSL!, args, { stdio: 'pipe', cwd: PKI });

/** CA ile imzalı sertifika (anahtar + sertifika PEM). */
function issue(name: string, cn: string, ext: string, ca = 'ca') {
  fs.writeFileSync(p(`${name}.ext`), ext);
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', p(`${name}.key`), '-out', p(`${name}.csr`), '-subj', `/CN=${cn}`);
  ssl('x509', '-req', '-in', p(`${name}.csr`), '-CA', p(`${ca}.crt`), '-CAkey', p(`${ca}.key`), '-CAcreateserial', '-out', p(`${name}.crt`), '-days', '2', '-extfile', p(`${name}.ext`));
  return { key: fs.readFileSync(p(`${name}.key`)), cert: fs.readFileSync(p(`${name}.crt`)) };
}

let proc: ChildProcess;
let ca: Buffer;
let pc1: { key: Buffer; cert: Buffer };
let pc2: { key: Buffer; cert: Buffer };
let rogue: { key: Buffer; cert: Buffer };

function post(url: string, body: unknown, id?: { key: Buffer; cert: Buffer }) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = https.request(
      BASE + url,
      { method: 'POST', ca, ...(id ?? {}), headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : {} }));
      },
    );
    r.on('error', reject);
    r.end(data);
  });
}

function get(url: string) {
  return new Promise<number>((resolve, reject) => {
    https.get(BASE + url, { ca }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

/** /ws/agent hello → ilk yanıt */
function hello(deviceId: string, deviceSecret: string, id: { key: Buffer; cert: Buffer }) {
  return new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${PORT}/ws/agent`, { ca, ...id });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', deviceId, deviceSecret, agentVersion: 'test', user: 'test' })));
    ws.on('message', (m) => {
      resolve(JSON.parse(m.toString()));
      ws.close();
    });
    ws.on('error', reject);
  });
}

const enrollBody = (hostname: string) => ({ enrollKey: ENROLL_KEY, hostname, mac: `00:11:22:33:44:${hostname.slice(-2)}`, os: 'Windows 11', agentVersion: 'test', user: 'ali' });

describe('mTLS: ajan istemci sertifikası', { skip: OPENSSL ? false : 'openssl bulunamadı' }, () => {
  before(async () => {
    fs.mkdirSync(PKI, { recursive: true });
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.crt'), '-days', '2', '-subj', '/CN=ErtePano Test CA');
    ca = fs.readFileSync(p('ca.crt'));
    issue('srv', 'localhost', 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
    ssl('pkcs12', '-export', '-out', p('srv.pfx'), '-inkey', p('srv.key'), '-in', p('srv.crt'), '-passout', 'pass:test');
    const client = (h: string) => `subjectAltName=DNS:${h}.test.local\nextendedKeyUsage=clientAuth\n`;
    pc1 = issue('pc1', 'PC-01.test.local', client('pc-01'));
    pc2 = issue('pc2', 'PC-02.test.local', client('pc-02'));
    // kurum CA'sı dışından, aynı ada verilmiş sertifika
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('rogueca.key'), '-out', p('rogueca.crt'), '-days', '2', '-subj', '/CN=Sahte CA');
    rogue = issue('rogue', 'PC-01.test.local', client('pc-01'), 'rogueca');

    proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DATA_DIR: DATA,
        ADMIN_PASSWORD: 'Test-Yonetici-2026!',
        DATA_DIR_ACL: 'off',
        NODE_ENV: 'test',
        LDAP_URL: '',
        TRUST_PROXY: '',
        PUBLIC_URL: BASE,
        TLS_PFX_PATH: p('srv.pfx'),
        TLS_PFX_PASSWORD: 'test',
        TLS_CLIENT_CA_PATH: p('ca.crt'),
        MTLS: 'required',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proc.stdout!.on('data', (d) => (log += d));
    proc.stderr!.on('data', (d) => (log += d));
    for (let i = 0; i < 80; i++) {
      try {
        if ((await get('/api/health')) === 200) break;
      } catch {
        /* henüz açılmadı */
      }
      await sleep(250);
      if (i === 79) throw new Error('sunucu açılmadı:\n' + log);
    }
    const db = new Database(path.join(DATA, 'ertepano.db'));
    db.prepare("INSERT INTO enroll_keys(id, key, label, auto_approve, created_at) VALUES('k1', ?, 'mTLS testi', 1, ?)").run(ENROLL_KEY, new Date().toISOString());
    db.close();
  });

  after(async () => {
    if (proc && proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await exited;
    }
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(DATA, { recursive: true, force: true });
        return;
      } catch {
        await sleep(300);
      }
    }
  });

  it('panel (tarayıcı) sertifikasız açılır', async () => {
    assert.equal(await get('/api/health'), 200);
  });

  it('sertifikasız, sahte CA sertifikalı ya da başka bilgisayarın sertifikasıyla kayıt reddedilir', async () => {
    const none = await post('/api/agent/enroll', enrollBody('PC-01'));
    assert.equal(none.status, 403);
    assert.equal(none.json.code, 'client_cert');
    const fake = await post('/api/agent/enroll', enrollBody('PC-01'), rogue);
    assert.equal(fake.status, 403);
    assert.equal(fake.json.code, 'client_cert');
    const other = await post('/api/agent/enroll', enrollBody('PC-01'), pc2);
    assert.equal(other.status, 403);
    assert.match(other.json.error, /başka bilgisayara ait/);
  });

  let dev1 = { id: '', secret: '' };

  it('kendi sertifikasıyla kayıt olur ve bağlanır; sertifika bilgisi cihaza yazılır', async () => {
    const r = await post('/api/agent/enroll', enrollBody('PC-01'), pc1);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    dev1 = { id: r.json.deviceId, secret: r.json.deviceSecret };
    const w = await hello(dev1.id, dev1.secret, pc1);
    assert.equal(w.t, 'welcome');
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const row = db.prepare('SELECT cert_subject, cert_valid_to FROM devices WHERE id = ?').get(dev1.id) as { cert_subject: string; cert_valid_to: string };
    db.close();
    assert.equal(row.cert_subject, 'PC-01.test.local');
    assert.ok(Date.parse(row.cert_valid_to) > Date.now());
  });

  it('çalınan cihaz sırrı başka bilgisayardan kullanılamaz', async () => {
    const w = await hello(dev1.id, dev1.secret, pc2);
    assert.equal(w.t, 'error');
    assert.equal(w.code, 'client_cert');
  });
});
