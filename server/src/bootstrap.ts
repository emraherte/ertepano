import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, getSetting, nowIso, setSetting } from './db.js';
import { hashPassword, newEnrollKey, newPassword, randomToken, uuid } from './security.js';

/** Resmî ve millî günler (sabit tarihli). Dinî bayramlar her yıl değiştiği için İK tarafından "tek seferlik tarih" olarak eklenir. */
const TR_DAYS: { name: string; md: string; emoji: string; message: string }[] = [
  { name: 'Yeni Yıl', md: '01-01', emoji: '🎆', message: 'Mutlu yıllar! Yeni yılın herkese sağlık ve başarı getirmesini dileriz.' },
  { name: '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı', md: '04-23', emoji: '🇹🇷', message: 'Ulusal Egemenlik ve Çocuk Bayramımız kutlu olsun!' },
  { name: '1 Mayıs Emek ve Dayanışma Günü', md: '05-01', emoji: '🤝', message: 'Emek ve Dayanışma Günü kutlu olsun.' },
  { name: "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı", md: '05-19', emoji: '🇹🇷', message: "Atatürk'ü Anma, Gençlik ve Spor Bayramımız kutlu olsun!" },
  { name: '15 Temmuz Demokrasi ve Millî Birlik Günü', md: '07-15', emoji: '🇹🇷', message: 'Demokrasi ve Millî Birlik Günü.' },
  { name: '30 Ağustos Zafer Bayramı', md: '08-30', emoji: '🇹🇷', message: 'Zafer Bayramımız kutlu olsun!' },
  { name: '29 Ekim Cumhuriyet Bayramı', md: '10-29', emoji: '🇹🇷', message: 'Cumhuriyetimizin yıl dönümü kutlu olsun!' },
  { name: "10 Kasım Atatürk'ü Anma Günü", md: '11-10', emoji: '🖤', message: "Ulu Önder Mustafa Kemal Atatürk'ü saygı, sevgi ve özlemle anıyoruz. Saat 09:05'te saygı duruşu." },
  { name: 'Öğretmenler Günü', md: '11-24', emoji: '🍎', message: 'Tüm öğretmenlerimizin Öğretmenler Günü kutlu olsun.' },
  { name: 'Dünya İş Sağlığı ve Güvenliği Günü', md: '04-28', emoji: '⛑️', message: 'Güvenli çalışma hepimizin sorumluluğu. Bir tehlike görürseniz İSG ekibine haber verin.' },
  { name: 'Kadınlar Günü', md: '03-08', emoji: '🌷', message: 'Dünya Kadınlar Günü kutlu olsun.' },
];

/** İlk açılışta: yönetici hesabı, kiosk anahtarı, varsayılan kayıt anahtarı ve özel gün takvimi. */
export function bootstrap() {
  if (!getSetting('kiosk_key')) setSetting('kiosk_key', randomToken(12));

  const users = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  if (users === 0) {
    const password = process.env.ADMIN_PASSWORD || newPassword();
    db.prepare('INSERT INTO users(id, username, full_name, role, password_hash, created_at) VALUES(?,?,?,?,?,?)').run(
      uuid(), 'admin', 'Sistem Yöneticisi', 'admin', hashPassword(password), nowIso(),
    );
    const file = path.join(config.dataDir, 'ILK-YONETICI-PAROLASI.txt');
    fs.writeFileSync(file, `Kullanıcı adı: admin\nParola: ${password}\n\nGiriş yaptıktan sonra parolanızı değiştirip bu dosyayı silin.\n`);
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  İlk yönetici hesabı oluşturuldu');
    console.log('  Kullanıcı adı: admin');
    console.log(`  Parola dosyası: ${file}`);
    console.log('  (parola güvenlik için günlüğe yazılmaz; ilk girişte değiştirin)');
    console.log('══════════════════════════════════════════════════════\n');
  }

  const keys = (db.prepare('SELECT COUNT(*) c FROM enroll_keys').get() as { c: number }).c;
  if (keys === 0) {
    db.prepare('INSERT INTO enroll_keys(id, key, label, auto_approve, created_by, created_at) VALUES(?,?,?,?,?,?)').run(
      uuid(), newEnrollKey(), 'Varsayılan (IT onayı gerekir)', 0, 'sistem', nowIso(),
    );
  }

  const days = (db.prepare('SELECT COUNT(*) c FROM special_days').get() as { c: number }).c;
  if (days === 0) {
    const ins = db.prepare('INSERT INTO special_days(id, name, month_day, emoji, message, kind, enabled) VALUES(?,?,?,?,?,?,1)');
    db.transaction(() => TR_DAYS.forEach((d) => ins.run(uuid(), d.name, d.md, d.emoji, d.message, d.md === '11-10' ? 'banner' : 'badge')))();
  }
}
