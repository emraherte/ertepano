// Sahte ajan simülatörü — Tauri ajanını derlemeden panel ve protokolü uçtan uca dener.
// Kullanım: npm run sim -- --count 40 [--server http://localhost:4100] [--key EK-DEMO-DEMO-DEMO] [--no-tag]
import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { AgentAnnouncement, ServerToAgent, SignedItem, Telemetry } from '@ertepano/shared';

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SERVER = arg('server', 'http://localhost:4100').replace(/\/$/, '');
const KEY = arg('key', 'EK-DEMO-DEMO-DEMO');
const COUNT = Number(arg('count', '25'));
const TAG = !process.argv.includes('--no-tag');

const LOCATIONS = [
  { name: 'İstanbul Merkez', prefix: 'IST', deps: ['Muhasebe', 'İK', 'Satış', 'IT'] },
  { name: 'Gebze Fabrika', prefix: 'GBZ', deps: ['Üretim', 'Kalite', 'Bakım', 'Lojistik'] },
  { name: 'İzmir Depo', prefix: 'IZM', deps: ['Lojistik', 'Sevkiyat'] },
];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const later = (sec: [number, number], fn: () => void) => setTimeout(fn, rnd(sec[0], sec[1]) * 1000);

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const stats = { verified: 0, rejected: 0, shown: 0, acks: 0, safety: 0 };

class FakeAgent {
  hostname: string;
  mac: string;
  user: string;
  location: (typeof LOCATIONS)[number];
  department: string;
  deviceId = '';
  secret = '';
  pubKey!: crypto.KeyObject;
  ws?: WebSocket;
  handled = new Set<string>();
  problem: 'disk' | 'uptime' | null;
  constructor(public n: number) {
    this.location = LOCATIONS[n % LOCATIONS.length];
    this.department = this.location.deps[Math.floor(n / LOCATIONS.length) % this.location.deps.length];
    this.hostname = `PC-${this.location.prefix}-${String(n + 1).padStart(3, '0')}`;
    this.mac = Array.from({ length: 6 }, (_, i) => (i === 0 ? 0x02 : (n * 37 + i * 11) & 0xff).toString(16).padStart(2, '0')).join(':').toUpperCase();
    this.user = `sim.user${n + 1}`;
    this.problem = n % 11 === 3 ? 'disk' : n % 13 === 5 ? 'uptime' : null;
  }

  async enroll() {
    const res = await fetch(`${SERVER}/api/agent/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollKey: KEY, hostname: this.hostname, mac: this.mac, os: 'Windows 11 Pro 10.0.26100', agentVersion: '0.1.0-sim', user: this.user }),
    });
    if (!res.ok) throw new Error(`kayıt başarısız (${res.status}): ${await res.text()}`);
    const j = (await res.json()) as { deviceId: string; deviceSecret: string; publicKey: string };
    this.deviceId = j.deviceId;
    this.secret = j.deviceSecret;
    this.pubKey = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(j.publicKey, 'base64')]), format: 'der', type: 'spki' });
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  telemetry(): Telemetry {
    const diskTotal = 476;
    return {
      hostname: this.hostname,
      ip: `10.${LOCATIONS.indexOf(this.location) + 1}.0.${this.n + 10}`,
      mac: this.mac,
      user: this.user,
      os: 'Windows 11 Pro 10.0.26100',
      cpuModel: this.n % 3 ? 'Intel Core i5-12400' : 'AMD Ryzen 5 5600G',
      cpuLoad: Math.round(rnd(3, 45) * 10) / 10,
      ramTotalMb: this.n % 7 === 2 ? 4096 : 16384,
      ramFreeMb: Math.round(rnd(1500, 9000)),
      diskTotalGb: diskTotal,
      diskFreeGb: this.problem === 'disk' ? 21 : Math.round(rnd(80, 300)),
      uptimeSec: this.problem === 'uptime' ? 21 * 86400 : Math.round(rnd(3600, 5 * 86400)),
      agentVersion: '0.1.0-sim',
    };
  }

  verify(item: SignedItem): AgentAnnouncement | null {
    const ok = crypto.verify(null, Buffer.from(item.payload, 'utf8'), this.pubKey, Buffer.from(item.sig, 'base64'));
    if (!ok) {
      stats.rejected++;
      console.warn(`[${this.hostname}] İMZA GEÇERSİZ — duyuru reddedildi`);
      return null;
    }
    stats.verified++;
    return JSON.parse(item.payload) as AgentAnnouncement;
  }

  /** Gerçek bir çalışanın davranışını taklit et. */
  react(a: AgentAnnouncement) {
    if (this.handled.has(a.id)) return;
    this.handled.add(a.id);
    stats.shown++;
    const ack = (action: string, extra: object = {}) => {
      stats.acks++;
      this.send({ t: 'ack', id: a.id, action, ...extra });
    };
    later([0.5, 4], () => ack('seen'));
    if (a.kind === 'fullscreen' && a.emergencyId) {
      const r = Math.random();
      if (r < 0.9) {
        later([3, 45], () => {
          stats.safety++;
          const help = r < 0.04;
          this.send({ t: 'safety', emergencyId: a.emergencyId, status: help ? 'help' : 'safe', note: help ? 'Merdivende mahsur kaldık, 2. kat' : undefined });
        });
      }
      return;
    }
    if (a.kind === 'survey' && a.options?.length && Math.random() < 0.75) {
      later([5, 60], () => ack('answered', { answer: pick(a.options!) }));
      return;
    }
    if (a.requireAck) {
      if (Math.random() < 0.85) later([5, 90], () => ack('acked'));
      return;
    }
    if (a.kind === 'toast' || a.kind === 'banner') later([5, 60], () => ack(Math.random() < 0.6 ? 'read' : 'dismissed'));
  }

  connect() {
    const ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws/agent`);
    this.ws = ws;
    let tele: NodeJS.Timeout | undefined;
    ws.on('open', () => {
      this.send({ t: 'hello', deviceId: this.deviceId, deviceSecret: this.secret, agentVersion: '0.1.0-sim', user: this.user });
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerToAgent;
      switch (msg.t) {
        case 'welcome':
          this.send({ t: 'telemetry', data: this.telemetry() });
          tele = setInterval(() => this.send({ t: 'telemetry', data: this.telemetry() }), 30_000);
          break;
        case 'sync':
          msg.items.map((i) => this.verify(i)).forEach((a) => a && this.react(a));
          break;
        case 'show': {
          const a = this.verify(msg.item);
          if (a) {
            this.handled.delete(a.id); // güncellenen duyuru yeniden gösterilir
            this.react(a);
          }
          break;
        }
        case 'ping':
          this.send({ t: 'pong' });
          break;
        case 'error':
          console.warn(`[${this.hostname}] sunucu hatası: ${msg.code}`);
          break;
        default:
          break;
      }
    });
    ws.on('close', () => {
      clearInterval(tele);
      setTimeout(() => this.connect(), rnd(1000, 5000));
    });
    ws.on('error', () => {});
  }
}

/** Demo: cihazlara lokasyon/departman atamak için IT demo kullanıcısıyla giriş yap. */
async function tagDevices(agents: FakeAgent[]) {
  const login = await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'it', password: 'Demo12345!' }),
  });
  if (!login.ok) {
    console.log('(etiketleme atlandı: demo "it" kullanıcısı yok — npm run seed:demo)');
    return;
  }
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  for (const a of agents) {
    await fetch(`${SERVER}/api/devices/${a.deviceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ location: a.location.name, department: a.department }),
    });
  }
  await fetch(`${SERVER}/api/auth/logout`, { method: 'POST', headers: { cookie } });
}

const agents = Array.from({ length: COUNT }, (_, i) => new FakeAgent(i));
console.log(`${COUNT} sahte ajan ${SERVER} adresine kaydoluyor...`);
for (const a of agents) await a.enroll();
if (TAG) await tagDevices(agents);
agents.forEach((a, i) => setTimeout(() => a.connect(), i * 40));

// Birkaç çalışan bildirimi
setTimeout(() => {
  agents[1]?.send({ t: 'report', kind: 'it_help', text: 'Yazıcı kağıt sıkıştırıyor ve yazdırma kuyruğu takılı kalıyor.' });
}, 4000);

setInterval(() => {
  console.log(`imza ✓ ${stats.verified}  ✗ ${stats.rejected} | gösterilen ${stats.shown} | onay mesajı ${stats.acks} | yoklama yanıtı ${stats.safety}`);
}, 15_000);
