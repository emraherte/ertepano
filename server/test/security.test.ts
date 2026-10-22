// Uçtan uca güvenlik + 2FA + lisans testleri. Sunucuyu geçici veri klasörüyle ayrı süreçte başlatır.
// Çalıştırma: npm test   (kök dizinden)
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ertepano-test-'));
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = 'Test-Yonetici-2026!';

// Testin kendi satıcı anahtarı (gerçek satıcı anahtarı gerekmez)
const vendor = crypto.generateKeyPairSync('ed25519');
const vendorPub = (vendor.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64');

let proc: ChildProcess;

// ---- yardımcılar ----
class Client {
  cookie = '';
  constructor(public origin: string | null = BASE) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.origin && method !== 'GET') h.origin = this.origin;
    if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json, headers: res.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown) => this.req('POST', u, b ?? {});
}

const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, offsetSteps = 0) {
  const clean = secret.replace(/\s/g, '');
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | b32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const step = Math.floor(Date.now() / 30000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

function issueLicense(p: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify({ v: 1, id: crypto.randomUUID(), customer: 'Test A.Ş.', validFrom: '2020-01-01', serverId: null, issuedAt: new Date().toISOString(), ...p }));
  return `ERTEPANO-LICENSE-1\n${body.toString('base64url')}.${crypto.sign(null, body, vendor.privateKey).toString('base64url')}`;
}

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- kurulum ----
before(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: DATA,
      ADMIN_PASSWORD: ADMIN_PW,
      DATA_DIR_ACL: 'off',
      NODE_ENV: 'test',
      ERTEPANO_VENDOR_KEY_OVERRIDE: vendorPub,
      LDAP_URL: '',
      TRUST_PROXY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout!.on('data', (d) => (log += d));
  proc.stderr!.on('data', (d) => (log += d));
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE + '/api/health')).ok) return;
    } catch {
      /* henüz açılmadı */
    }
    await sleep(250);
  }
  throw new Error('sunucu açılmadı:\n' + log);
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
  }
  // Windows dosya kilidi sürecin kapanmasından kısa süre sonra kalkar
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(DATA, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
});

// paylaşılan durum
const admin = new Client();
let adminSecret = '';
let recovery: string[] = [];

describe('HTTP güvenlik başlıkları ve CSRF', () => {
  it('CSP, nosniff, frame, permissions-policy, no-store', async () => {
    const r = await new Client().get('/api/health');
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'.*frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('permissions-policy'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  it('başka kökenden gelen POST reddedilir', async () => {
    const r = await new Client('http://intranet.sirket.local').post('/api/auth/login', { username: 'admin', password: ADMIN_PW });
    assert.equal(r.status, 403);
  });

  it('cross-site fetch başlığı reddedilir', async () => {
    const r = await new Client(null).req('POST', '/api/auth/logout', {}, { 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 403);
  });

  it('X-Forwarded-For ile IP sahtelenemez (TRUST_PROXY boş)', async () => {
    const c = new Client();
    for (let i = 0; i < 8; i++) await c.req('POST', '/api/auth/login', { username: 'xff.test', password: 'yanlis' + i }, { 'x-forwarded-for': `10.0.0.${i}` });
    const r = await c.req('POST', '/api/auth/login', { username: 'xff.test', password: 'yanlis' }, { 'x-forwarded-for': '10.9.9.9' });
    assert.equal(r.status, 429, 'farklı XFF ile sınır atlatılamamalı');
  });
});

describe('Giriş ve 2FA', () => {
  it('bilinmeyen kullanıcı ve yanlış parola aynı yanıtı alır', async () => {
    const a = await new Client().post('/api/auth/login', { username: 'yok-boyle-biri', password: 'x' });
    assert.equal(a.status, 401);
    assert.equal(a.json.error, 'Kullanıcı adı veya parola hatalı');
  });

  it('yönetici ilk girişte kısıtlı oturum alır (2FA zorunlu)', async () => {
    const r = await admin.post('/api/auth/login', { username: 'admin', password: ADMIN_PW });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const me = await admin.get('/api/auth/me');
    assert.equal(me.json.user.mfaSetupRequired, true);
    const blocked = await admin.get('/api/devices');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'mfa_setup_required');
  });

  it('kurulum: yanlış kod reddedilir, doğru kod 2FA açar ve 10 kurtarma kodu verir', async () => {
    const s = await admin.post('/api/auth/mfa/setup');
    assert.equal(s.status, 200);
    assert.match(s.json.otpauth, /^otpauth:\/\/totp\/ErtePano%3Aadmin\?secret=[A-Z2-7]{32}&issuer=ErtePano/);
    assert.match(s.json.qrSvg, /^<svg/);
    adminSecret = s.json.secret;
    assert.equal((await admin.post('/api/auth/mfa/enable', { code: '000000' })).status, 400);
    const e = await admin.post('/api/auth/mfa/enable', { code: totp(adminSecret) });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    recovery = e.json.recoveryCodes;
    assert.equal(recovery.length, 10);
    assert.equal((await admin.get('/api/devices')).status, 200, 'kurulumdan sonra tam yetki');
  });

  it('gizli anahtar veritabanında düz metin durmaz', () => {
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const row = db.prepare("SELECT mfa_secret, mfa_recovery FROM users WHERE username = 'admin'").get() as { mfa_secret: string; mfa_recovery: string };
    db.close();
    assert.ok(row.mfa_secret.startsWith('v1.'));
    assert.ok(!row.mfa_secret.includes(adminSecret.replace(/\s/g, '')));
    assert.ok(!row.mfa_recovery.includes(recovery[0]));
  });

  it('2FA açıkken parola tek başına oturum açmaz; kod ister', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
    const j = await r.json();
    assert.equal(j.mfa, 'required');
    assert.equal(r.headers.get('set-cookie'), null, 'ikinci adımdan önce çerez verilmez');
  });

  it('aynı kod iki kez kullanılamaz; kurtarma kodu bir kez çalışır', async () => {
    await sleep(31_000 - (Date.now() % 30_000)); // yeni 30 sn'lik adıma geç
    const login = async () => {
      const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
      return (await r.json()).challenge as string;
    };
    const mfa = (challenge: string, code: string) =>
      fetch(BASE + '/api/auth/login/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code }) });

    const code = totp(adminSecret);
    const ok = await mfa(await login(), code);
    assert.equal(ok.status, 200);
    assert.ok(ok.headers.get('set-cookie'));
    const replay = await mfa(await login(), code);
    assert.equal(replay.status, 401, 'aynı kod ikinci kez reddedilmeli');

    const rc = await mfa(await login(), recovery[0].toLowerCase());
    assert.equal(rc.status, 200);
    assert.equal((await rc.json()).recoveryLeft, 9);
    const rc2 = await mfa(await login(), recovery[0]);
    assert.equal(rc2.status, 401, 'kurtarma kodu tek kullanımlık');
  });

  it('bilet 5 hatalı denemeden sonra geçersiz olur', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
    const { challenge } = await r.json();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const x = await fetch(BASE + '/api/auth/login/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code: '111111' }) });
      last = x.status;
    }
    assert.equal(last, 401);
    const x = await fetch(BASE + '/api/auth/login/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code: totp(adminSecret, 1) }) });
    assert.equal(x.status, 401, 'tükenmiş bilet doğru kodla da açılmaz');
  });
});

// yönetici adına diğer kullanıcılar
const ik = new Client();
const viewer = new Client();
let ikPassword = '';

describe('Rol yetkileri ve KVKK', () => {
  it('yönetici İK ve izleyici kullanıcı oluşturur', async () => {
    const a = await admin.post('/api/users', { username: 'ik.test', fullName: 'İK Test', role: 'ik' });
    assert.equal(a.status, 200);
    ikPassword = a.json.password;
    const v = await admin.post('/api/users', { username: 'izleyici.test', fullName: 'İzleyici', role: 'viewer' });
    assert.equal((await ik.post('/api/auth/login', { username: 'ik.test', password: ikPassword })).status, 200);
    assert.equal((await viewer.post('/api/auth/login', { username: 'izleyici.test', password: v.json.password })).status, 200);
  });

  it('İK cihazlara ve acil duruma erişemez', async () => {
    assert.equal((await ik.get('/api/devices')).status, 403);
    assert.equal((await ik.post('/api/emergencies', { type: 'yangin' })).status, 403);
    assert.equal((await ik.get('/api/users')).status, 403);
    assert.equal((await ik.get('/api/audit')).status, 403);
  });

  it('İK yalnızca kendi kategorisinde yayın yapar', async () => {
    assert.equal((await ik.post('/api/announcements', { kind: 'toast', category: 'isg', title: 'x', targets: ['all'] })).status, 403);
    assert.equal((await ik.post('/api/announcements', { kind: 'toast', category: 'ik', title: 'Taslak', targets: ['all'] })).status, 200);
  });

  it('dış görsel adresi reddedilir (NTLM sızıntısı / iz sürme)', async () => {
    const r = await ik.post('/api/announcements', { kind: 'toast', category: 'ik', title: 'x', imageUrl: 'http://kotu.example/x.png', targets: ['all'] });
    assert.equal(r.status, 400);
  });

  it('görsel türü dosya içeriğinden doğrulanır', async () => {
    const good = new FormData();
    good.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    const g = await ik.req('POST', '/api/media', good);
    assert.equal(g.status, 200);
    assert.match(g.json.url, /^\/media\/[0-9a-f-]{36}\.png$/);
    const bad = new FormData();
    bad.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
    assert.equal((await ik.req('POST', '/api/media', bad)).status, 400);
  });

  it('yönetici olmayan parola değişimi diğer oturumları kapatır', async () => {
    const other = new Client();
    await other.post('/api/auth/login', { username: 'ik.test', password: ikPassword });
    assert.equal((await other.get('/api/auth/me')).status, 200);
    const ch = await ik.post('/api/auth/password', { current: ikPassword, next: 'Yeni-Parola-2026' });
    assert.equal(ch.status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401, 'eski oturum düşmeli');
    assert.equal((await ik.get('/api/auth/me')).status, 200, 'değiştiren oturum kalır');
  });
});

// ---- ajan ----
let enrollKey = '';
let devA = { id: '', secret: '' };

async function enroll(body: Record<string, unknown>) {
  const r = await fetch(BASE + '/api/agent/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
}

function wsSession(id: string, secret: string) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws/agent');
  const msgs: any[] = [];
  ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
  const ready = new Promise<void>((res) => ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'hello', deviceId: id, deviceSecret: secret }));
    res();
  }));
  return { ws, msgs, ready, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

describe('Ajan kaydı ve WebSocket', () => {
  it('otomatik onaylı anahtarla cihaz kaydolur', async () => {
    const k = await admin.post('/api/enroll-keys', { label: 'test', autoApprove: true });
    enrollKey = k.json.key;
    const r = await enroll({ enrollKey, hostname: 'PC-A', mac: 'AA:AA:AA:AA:AA:01', user: 'ali' });
    assert.equal(r.json.status, 'approved');
    devA = { id: r.json.deviceId, secret: r.json.deviceSecret };
  });

  it('anahtarı bilen biri onaylı cihazı ele geçiremez (yeniden kayıt beklemeye düşer)', async () => {
    const r = await enroll({ enrollKey, hostname: 'PC-A', mac: 'AA:AA:AA:AA:AA:01' });
    assert.equal(r.json.deviceId, devA.id);
    assert.equal(r.json.status, 'pending');
    // eski sırrı kanıtlayan meşru yeniden kayıt (ör. ajan yeniden kuruldu) — önce IT tekrar onaylar
    await admin.req('PATCH', `/api/devices/${devA.id}`, { status: 'approved' });
    const proven = await enroll({ enrollKey, hostname: 'PC-A', mac: 'AA:AA:AA:AA:AA:01', deviceSecret: r.json.deviceSecret });
    assert.equal(proven.json.status, 'approved');
    devA = { id: proven.json.deviceId, secret: proven.json.deviceSecret };
  });

  it('cihaz yalnızca kendisine gönderilen duyuruya yanıt yazabilir', async () => {
    const b = await enroll({ enrollKey, hostname: 'PC-B', mac: 'AA:AA:AA:AA:AA:02' });
    const ann = await admin.post('/api/announcements', { kind: 'toast', category: 'genel', title: 'Yalnız B', targets: [`dev:${b.json.deviceId}`], publish: true });
    assert.equal(ann.status, 200);
    const s = wsSession(devA.id, devA.secret);
    await s.ready;
    await sleep(400);
    assert.equal(s.msgs[0]?.t, 'welcome');
    s.send({ t: 'ack', id: ann.json.item.id, action: 'acked' });
    s.send({ t: 'report', kind: 'it_help', text: 'deneme' });
    await sleep(400);
    s.ws.close();
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const row = db.prepare('SELECT 1 FROM deliveries WHERE announcement_id = ? AND device_id = ?').get(ann.json.item.id, devA.id);
    db.close();
    assert.equal(row, undefined, 'hedef dışı cihazın onayı kaydedilmemeli');
  });

  it('hatalı sırla WebSocket kimlik doğrulaması reddedilir', async () => {
    const s = wsSession(devA.id, 'deadbeef');
    await s.ready;
    await sleep(300);
    assert.equal(s.msgs[0]?.t, 'error');
    s.ws.close();
  });
});

describe('Denetim kaydı bütünlüğü', () => {
  it('zincir doğrulanır', async () => {
    const r = await admin.get('/api/audit/verify');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.checked > 5);
  });

  it('kayıt değiştirilemez ve yakın tarihli kayıt silinemez', () => {
    const db = new Database(path.join(DATA, 'ertepano.db'));
    assert.throws(() => db.prepare("UPDATE audit_log SET actor = 'sahte' WHERE id = 1").run(), /salt eklenir/);
    assert.throws(() => db.prepare('DELETE FROM audit_log WHERE id = 1').run(), /silinemez/);
    db.close();
  });

  it('hatalı girişte yazılan bilinmeyen kullanıcı adı (yanlış alana yazılmış parola olabilir) saklanmaz', () => {
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const leaked = db.prepare("SELECT 1 FROM audit_log WHERE actor = 'yok-boyle-biri'").get();
    db.close();
    assert.equal(leaked, undefined);
  });
});

describe('Active Directory ayarları ve kurulum kontrol listesi', () => {
  it('ulaşılamayan AD ile LDAP açılamaz (yerel girişe dokunulmaz)', async () => {
    const r = await admin.req('PUT', '/api/settings/ldap', {
      enabled: true, url: 'ldaps://127.0.0.1:1', baseDn: 'DC=yok,DC=local', bindDn: 'CN=svc', bindPassword: 'Gizli-Parola-1',
      startTls: false, rejectUnauthorized: true, groups: { admin: 'ErtePano-Yonetici' }, defaultRole: null,
    });
    assert.equal(r.status, 400);
    assert.equal((await new Client().get('/api/auth/config')).json.ldap, false);
  });

  it('kapalı olarak kaydedilir; parola geri döndürülmez ve veritabanında şifrelidir', async () => {
    const r = await admin.req('PUT', '/api/settings/ldap', {
      enabled: false, url: 'ldaps://dc01.test.local:636', baseDn: 'DC=test,DC=local', bindDn: 'CN=svc', bindPassword: 'Gizli-Parola-1',
      startTls: false, rejectUnauthorized: true, groups: {}, defaultRole: null,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = await admin.get('/api/settings/ldap');
    assert.equal(g.json.source, 'panel');
    assert.equal(g.json.bindPasswordSet, true);
    assert.ok(!JSON.stringify(g.json).includes('Gizli-Parola-1'));
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const raw = (db.prepare("SELECT value FROM settings WHERE key = 'ldap'").get() as { value: string }).value;
    db.close();
    assert.ok(!raw.includes('Gizli-Parola-1'), 'parola düz metin saklanmamalı');
    assert.equal((await admin.req('DELETE', '/api/settings/ldap')).status, 200);
  });

  it('kontrol listesi riskleri gösterir; yedek alınabilir', async () => {
    const s = await admin.get('/api/setup');
    assert.equal(s.status, 200);
    const c = Object.fromEntries(s.json.checks.map((x: any) => [x.id, x.status]));
    assert.equal(c.initial_password, 'fail', 'ilk parola değişmedi');
    assert.equal(c.admin_mfa, 'ok');
    assert.equal(c.demo_users, 'ok');
    const b = await admin.post('/api/setup/backup');
    assert.equal(b.status, 200);
    assert.ok(fs.existsSync(path.join(b.json.dir, 'ertepano.db')));
    assert.ok(fs.existsSync(path.join(b.json.dir, 'keys', 'mfa.key')), 'anahtarlar yedekte');
    const s2 = await admin.get('/api/setup');
    assert.equal(s2.json.checks.find((x: any) => x.id === 'backup').status, 'ok');
    assert.equal((await ik.get('/api/setup')).status, 403);
  });
});

describe('Duyuru onay akışı ve vekalet', () => {
  const mudur = new Client();
  const gm = new Client();
  const vekil = new Client();
  const users: Record<string, string> = {};
  let annId = '';

  before(async () => {
    for (const [c, username, role] of [[mudur, 'ik.mudur', 'ik'], [gm, 'gm.test', 'viewer'], [vekil, 'vekil.test', 'viewer']] as const) {
      const u = await admin.post('/api/users', { username, fullName: username, role });
      assert.equal(u.status, 200, JSON.stringify(u.json));
      users[username] = u.json.item?.id ?? u.json.id;
      const l = await c.post('/api/auth/login', { username, password: u.json.password });
      assert.equal(l.status, 200, JSON.stringify(l.json));
    }
  });

  it('yalnızca yönetici akış tanımlar; etkin onaycısı olmayan adım reddedilir', async () => {
    const steps = [
      { name: 'İK müdürü', approvers: ['user:ik.mudur'], min: 1 },
      { name: 'Genel müdür', approvers: ['user:gm.test'], min: 1 },
    ];
    assert.equal((await ik.req('PUT', '/api/approval-policies/ik', { enabled: true, steps })).status, 403);
    const bad = await admin.req('PUT', '/api/approval-policies/ik', { enabled: true, steps: [{ name: 'Hayalet', approvers: ['user:yok.boyle'], min: 1 }] });
    assert.equal(bad.status, 400);
    const ok = await admin.req('PUT', '/api/approval-policies/ik', { enabled: true, steps });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.item.steps.length, 2);
  });

  it('yayın isteği onaya düşer, ekranlara gitmez', async () => {
    const r = await ik.post('/api/announcements', { kind: 'toast', category: 'ik', title: 'Yan haklar güncellendi', body: 'Ayrıntılar intranette.', publish: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    annId = r.json.item.id;
    assert.equal(r.json.item.status, 'pending');
    const d = await ik.get(`/api/announcements/${annId}`);
    assert.equal(d.json.approval.required, true);
    assert.equal(d.json.approval.currentStep, 0);
    assert.equal(d.json.approval.canApprove, false);
  });

  it('hazırlayan ve yetkisiz kişi onaylayamaz', async () => {
    const self = await ik.post(`/api/announcements/${annId}/approve`, {});
    assert.equal(self.status, 400);
    assert.equal((await viewer.post(`/api/announcements/${annId}/approve`, {})).status, 400);
    assert.equal((await gm.post(`/api/announcements/${annId}/approve`, {})).status, 400, 'ikinci adımın onaycısı sırası gelmeden onaylayamaz');
  });

  it('adım adım onay; aynı kişi iki adımı geçemez; ret gerekçe ister', async () => {
    const inbox = await mudur.get('/api/approvals/inbox');
    assert.ok(inbox.json.waiting.some((x: any) => x.id === annId));
    const a1 = await mudur.post(`/api/announcements/${annId}/approve`, { note: 'Uygundur' });
    assert.equal(a1.status, 200, JSON.stringify(a1.json));
    assert.equal(a1.json.item.status, 'pending');
    assert.equal(a1.json.item.approvalStep, 1);
    assert.equal((await mudur.post(`/api/announcements/${annId}/approve`, {})).status, 400);
    assert.equal((await gm.post(`/api/announcements/${annId}/reject`, { reason: 'x' })).status, 400);
    const rj = await gm.post(`/api/announcements/${annId}/reject`, { reason: 'Hukuk görüşü alınsın' });
    assert.equal(rj.status, 200);
    assert.equal(rj.json.item.status, 'rejected');
    assert.equal(rj.json.item.rejectedReason, 'Hukuk görüşü alınsın');
  });

  it('düzeltilip yeniden gönderilir; vekil "adına" onaylar; son adımda yayına girer', async () => {
    const re = await ik.req('PATCH', `/api/announcements/${annId}`, { body: 'Hukuk onaylı metin.', publish: true });
    assert.equal(re.status, 200, JSON.stringify(re.json));
    assert.equal(re.json.item.status, 'pending');
    assert.equal(re.json.item.approvalStep, 0);

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 86400_000).toISOString();
    assert.equal((await vekil.post('/api/delegations', { fromUserId: users['ik.mudur'], toUserId: users['vekil.test'], startsAt: start, endsAt: end })).status, 403);
    const dg = await mudur.post('/api/delegations', { toUserId: users['vekil.test'], startsAt: start, endsAt: end, reason: 'Yıllık izin' });
    assert.equal(dg.status, 200, JSON.stringify(dg.json));
    assert.equal(dg.json.item.active, true);

    const v = await vekil.post(`/api/announcements/${annId}/approve`, {});
    assert.equal(v.status, 200, JSON.stringify(v.json));
    const g = await gm.post(`/api/announcements/${annId}/approve`, {});
    assert.equal(g.status, 200);
    assert.equal(g.json.item.status, 'active');
    const d = await admin.get(`/api/announcements/${annId}`);
    const round2 = d.json.approval.history.filter((h: any) => h.round === 2);
    assert.deepEqual(round2.map((h: any) => [h.username, h.onBehalfOf, h.decision]), [['vekil.test', 'ik.mudur', 'approved'], ['gm.test', null, 'approved']]);

    assert.equal((await mudur.post(`/api/delegations/${dg.json.item.id}/revoke`)).status, 200);
  });

  it('onaylı duyurunun içeriği değişirse yeniden onaya döner; yalnızca bitiş değişirse dönmez', async () => {
    const endOnly = await ik.req('PATCH', `/api/announcements/${annId}`, { endsAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
    assert.equal(endOnly.json.item.status, 'active');
    const changed = await ik.req('PATCH', `/api/announcements/${annId}`, { title: 'Yan haklar — güncel' });
    assert.equal(changed.json.item.status, 'pending');
    assert.match(changed.json.warning, /yeniden onaya/);
  });

  it('akışı olmayan kategori doğrudan yayınlanır', async () => {
    const r = await ik.post('/api/announcements', { kind: 'toast', category: 'genel', title: 'Servis saatleri', body: '', publish: true });
    assert.equal(r.json.item.status, 'active');
  });
});

describe('Personel listesi ve kutlamalar', () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [yy, mm, dd] = today.split('-');
  const csv = [
    'Sicil No;Adı Soyadı;Doğum Tarihi;İşe Giriş Tarihi;Bölüm;Şube;Kullanıcı Adı',
    `1001;Ayşe Demir;${dd}.${mm}.1990;01.09.2019;İK;Merkez;ayse.demir`,
    '1002;Mehmet Kaya;03.02.1985;15.03.2015;Üretim;Gebze;',
    `1003;Zeynep Ak;${dd}.${mm}.1995;10.01.2024;Üretim;Gebze;`,
  ].join('\n');

  it('başlıkları tanır, önizlemede yazmaz, doğum yılını atar', async () => {
    const p = await ik.post('/api/employees/import', { text: csv, dryRun: true });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.mapping.employeeNo, 'Sicil No');
    assert.equal(p.json.mapping.birth, 'Doğum Tarihi');
    assert.equal(p.json.mapping.username, 'Kullanıcı Adı');
    assert.equal(p.json.created, 3);
    assert.equal(p.json.withoutPc, 2);
    assert.equal(p.json.yearsDropped, 3);
    assert.equal((await ik.get('/api/employees')).json.items.length, 0, 'önizleme yazmaz');
  });

  it('uygulanır; aynı liste tekrar yüklenince değişiklik olmaz; veritabanında yıl yok', async () => {
    const r = await ik.post('/api/employees/import', { text: csv, dryRun: false });
    assert.equal(r.json.created, 3);
    const again = await ik.post('/api/employees/import', { text: csv, dryRun: false });
    assert.equal(again.json.unchanged, 3);
    const db = new Database(path.join(DATA, 'ertepano.db'), { readonly: true });
    const rows = db.prepare('SELECT birth_md FROM employees').all() as { birth_md: string }[];
    db.close();
    assert.ok(rows.every((x) => /^\d{2}-\d{2}$/.test(x.birth_md)));
  });

  it('bilgisayarı olmayan çalışan elle eklenir; liste değiştirildiğinde elle girilen korunur', async () => {
    const m = await ik.post('/api/employees', { fullName: 'Hasan Usta', birthMd: '12.04', department: 'Bakım', location: 'Gebze' });
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.equal(m.json.item.hasPc, false);
    assert.equal((await ik.post('/api/employees', { fullName: 'Başka Ayşe', username: 'AYSE.DEMIR' })).status, 409);
    const r = await ik.post('/api/employees/import', { text: csv.split('\n').slice(0, 2).join('\n'), dryRun: false, replace: true });
    assert.equal(r.json.removed, 2);
    const names = (await ik.get('/api/employees')).json.items.map((e: any) => e.fullName).sort();
    assert.deepEqual(names, ['Ayşe Demir', 'Hasan Usta']);
  });

  it('bugünkü doğum günleri kişinin ekranına ve lokasyonun kiosk ekranına düşer', async () => {
    await ik.post('/api/employees', { fullName: 'Zeynep Ak', birthMd: `${dd}.${mm}`, department: 'Üretim', location: 'Gebze' });
    const s = await ik.req('PUT', '/api/celebrations/settings', { personal: true, team: false, kiosk: true, anniversaries: true });
    assert.equal(s.status, 200);
    const key = (await ik.get('/api/settings/kiosk')).json.key;
    const k = await fetch(`${BASE}/api/kiosk?key=${key}&loc=Gebze`).then((r) => r.json());
    const cel = k.items.find((i: any) => i.title === 'Bugün kutladıklarımız');
    assert.ok(cel, JSON.stringify(k.items));
    assert.match(cel.body, /Zeynep A\./);
    const list = await admin.get('/api/announcements?limit=500');
    assert.ok(list.json.items.some((a: any) => a.auto && a.targets.includes('user:ayse.demir') && a.title.includes('Ayşe')));
    assert.ok(!yy.startsWith('0'));
  });

  it('AD bağlantısı yokken eşitleme açıkça hata verir; yetkisiz rol erişemez', async () => {
    const r = await ik.post('/api/employees/sync', { dryRun: true });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Active Directory/);
    assert.equal((await viewer.get('/api/employees')).status, 403);
  });
});

describe('Modüler lisans', () => {
  it('lisanssız kurulum 30 gün tüm modüllerle deneme modunda', async () => {
    const r = await admin.get('/api/license');
    assert.equal(r.json.mode, 'trial');
    assert.deepEqual(r.json.modules.sort(), ['ik', 'isg', 'it']);
    assert.match(r.json.serverId, /^[0-9A-F]{16}$/);
  });

  it('sahte imzalı lisans reddedilir', async () => {
    const other = crypto.generateKeyPairSync('ed25519');
    const body = Buffer.from(JSON.stringify({ v: 1, id: 'x', customer: 'Korsan', modules: ['ik', 'isg', 'it'], maxDevices: 99999, validFrom: '2020-01-01', validUntil: '2099-01-01' }));
    const lic = `ERTEPANO-LICENSE-1\n${body.toString('base64url')}.${crypto.sign(null, body, other.privateKey).toString('base64url')}`;
    const r = await admin.post('/api/license', { license: lic });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /imza/);
  });

  it('başka sunucuya bağlı lisans reddedilir', async () => {
    const r = await admin.post('/api/license', { license: issueLicense({ modules: ['ik'], maxDevices: 10, validUntil: '2099-01-01', serverId: 'FFFFFFFFFFFFFFFF' }) });
    assert.equal(r.status, 400);
  });

  it('yalnız İK modülü: İSG ve IT özellikleri kapanır, İK açık kalır', async () => {
    const r = await admin.post('/api/license', { license: issueLicense({ modules: ['ik'], maxDevices: 2, validUntil: '2099-01-01' }) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.modules, ['ik']);
    assert.equal(r.json.mode, 'licensed');
    assert.equal((await admin.post('/api/emergencies', { type: 'yangin', drill: true })).status, 402, 'acil durum İSG modülünde');
    assert.equal((await admin.post('/api/emergencies', { type: 'siber', drill: true })).status, 402, 'siber olay IT modülünde');
    assert.equal((await admin.get('/api/devices.csv')).status, 402, 'envanter IT modülünde');
    assert.equal((await admin.post('/api/announcements', { kind: 'toast', category: 'isg', title: 'x', targets: ['all'] })).status, 403);
    assert.equal((await admin.post('/api/announcements', { kind: 'toast', category: 'ik', title: 'x', targets: ['all'] })).status, 200);
    assert.equal((await ik.get('/api/employees')).status, 200, 'İK modülü açık');
    const dev = (await admin.get('/api/devices')).json.items[0];
    assert.equal(dev.cpuModel, null, 'temel pakette donanım ayrıntısı yok');
  });

  it('cihaz sınırı aşılamaz', async () => {
    // sınır 2; PC-A ve PC-B onaylı
    const c = await enroll({ enrollKey, hostname: 'PC-C', mac: 'AA:AA:AA:AA:AA:03' });
    assert.equal(c.json.status, 'pending', 'otomatik onay sınırda durur');
    const ap = await admin.req('PATCH', `/api/devices/${c.json.deviceId}`, { status: 'approved' });
    assert.equal(ap.status, 402);
    assert.equal(ap.json.code, 'device_limit');
  });

  it('İSG modülü eklenince acil durum açılır', async () => {
    const r = await admin.post('/api/license', { license: issueLicense({ modules: ['ik', 'isg'], maxDevices: 50, validUntil: '2099-01-01' }) });
    assert.deepEqual(r.json.modules.sort(), ['ik', 'isg']);
    const e = await admin.post('/api/emergencies', { type: 'yangin', drill: true, targets: ['all'] });
    assert.equal(e.status, 200);
    const end = await admin.post(`/api/emergencies/${e.json.item.id}/end`, { mode: 'silent' });
    assert.equal(end.status, 200);
  });

  it('süresi geçmiş lisans: ek süre sonrası modüller kapanır', async () => {
    const r = await admin.post('/api/license', { license: issueLicense({ modules: ['ik', 'isg', 'it'], maxDevices: 50, validUntil: '2021-01-01' }) });
    assert.equal(r.json.mode, 'expired');
    assert.deepEqual(r.json.modules, []);
    assert.equal((await admin.post('/api/announcements', { kind: 'toast', category: 'genel', title: 'Temel paket çalışır', targets: ['all'] })).status, 200);
  });
});

describe('İzleyici kişisel veriyi görmez', () => {
  it('duyuru ayrıntısında kişi listesi boş', async () => {
    const list = await viewer.get('/api/announcements');
    const id = list.json.items[0]?.id;
    assert.ok(id);
    const d = await viewer.get(`/api/announcements/${id}`);
    assert.equal(d.json.personal, false);
    assert.deepEqual(d.json.deliveries, []);
  });
});
