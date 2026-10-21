// Demo verisi: npm run seed:demo
// Bilinen parolalı kullanıcılar ve otomatik onaylı kayıt anahtarı oluşturur — YALNIZCA deneme ortamı için.
import { bootstrap } from './bootstrap.js';
import { db, nowIso } from './db.js';
import { hashPassword, uuid } from './security.js';
import { localToday } from './scheduler.js';

if (!process.argv.includes('--demo')) {
  console.log('Kullanım: npm run seed:demo   (deneme kullanıcıları + simülatör anahtarı)');
  process.exit(0);
}

bootstrap();

const DEMO_PASSWORD = 'Demo12345!';
const users = [
  { username: 'ik', fullName: 'Ayşe Demir (İK)', role: 'ik' },
  { username: 'isg', fullName: 'Mehmet Kaya (İSG)', role: 'isg' },
  { username: 'it', fullName: 'Can Öztürk (IT)', role: 'it' },
  { username: 'izleyici', fullName: 'Genel Müdürlük', role: 'viewer' },
];
for (const u of users) {
  db.prepare('INSERT OR IGNORE INTO users(id, username, full_name, role, password_hash, created_at) VALUES(?,?,?,?,?,?)').run(
    uuid(), u.username, u.fullName, u.role, hashPassword(DEMO_PASSWORD), nowIso(),
  );
}

export const DEMO_ENROLL_KEY = 'EK-DEMO-DEMO-DEMO';
db.prepare('INSERT OR IGNORE INTO enroll_keys(id, key, label, auto_approve, created_by, created_at) VALUES(?,?,?,1,?,?)').run(
  uuid(), DEMO_ENROLL_KEY, 'Demo / simülatör (otomatik onay)', 'seed', nowIso(),
);

// Bugün doğum günü ve kıdem yılı olan örnek çalışanlar → kutlama otomasyonu hemen görülür.
const md = localToday().slice(5);
const [d, m] = [md.slice(3), md.slice(0, 2)];
const employees = [
  ['sim.user1', 'Elif Yıldız', `${d}.${m}`, '01.03.2021', 'Üretim', 'Gebze Fabrika'],
  ['sim.user2', 'Burak Çelik', '12.04', `${d}.${m}.2019`, 'Lojistik', 'Gebze Fabrika'],
  ['sim.user3', 'Zeynep Arslan', '02.11', '15.06.2018', 'Muhasebe', 'İstanbul Merkez'],
  ['sim.user4', 'Ahmet Şahin', '23.08', '01.09.2015', 'IT', 'İstanbul Merkez'],
];
const up = db.prepare(
  'INSERT OR REPLACE INTO employees(username, full_name, birth_md, start_date, department, location, celebrate) VALUES(?,?,?,?,?,?,1)',
);
for (const [username, name, birth, start, dep, loc] of employees) {
  const [bd, bm] = birth.split('.');
  const [sd, sm, sy] = start.split('.');
  up.run(username, name, `${bm}-${bd}`, `${sy}-${sm}-${sd}`, dep, loc);
}

console.log('Demo verisi hazır.');
console.log(`  Panel kullanıcıları: ${users.map((u) => u.username).join(', ')}  — parola: ${DEMO_PASSWORD}`);
console.log(`  Simülatör kayıt anahtarı: ${DEMO_ENROLL_KEY}`);
console.log('  Simülatör: npm run sim -- --count 40');
