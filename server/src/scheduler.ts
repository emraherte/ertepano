import { config } from './config.js';
import { db, nowIso } from './db.js';
import { publish, tickLifecycle } from './lifecycle.js';
import { uuid } from './security.js';

/** Kurumun saat dilimindeki bugünün tarihi: "2026-10-29". */
export function localToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Saat dilimindeki bir günün başlangıcının UTC karşılığı. */
function zonedMidnight(date: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface AutoAnn {
  autoKey: string;
  kind: 'badge' | 'toast' | 'banner';
  category: 'ik' | 'genel';
  title: string;
  body: string;
  emoji: string | null;
  imageUrl?: string | null;
  /** rozet yerleşimi (özel günler) */
  position?: string | null;
  posX?: number | null;
  posY?: number | null;
  size?: number | null;
  opacity?: number | null;
  targets: string[];
  showOnKiosk: boolean;
  startsAt: string;
  endsAt: string;
}

/** auto_key benzersiz → aynı gün tekrar çalışsa da aynı duyuru ikinci kez oluşmaz. */
function ensureAuto(a: AutoAnn) {
  if (db.prepare('SELECT 1 FROM announcements WHERE auto_key = ?').get(a.autoKey)) return;
  const id = uuid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO announcements(id, kind, category, title, body, emoji, image_url, require_ack, position, pos_x, pos_y, size, opacity, targets, show_on_kiosk,
       status, starts_at, ends_at, auto_key, created_by, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,'draft',?,?,?,'otomatik',?,?)`,
  ).run(id, a.kind, a.category, a.title, a.body, a.emoji, a.imageUrl ?? null, a.kind === 'badge' ? (a.position ?? 'top-right') : null,
    a.posX ?? null, a.posY ?? null, a.size ?? null, a.opacity ?? null,
    JSON.stringify(a.targets), a.showOnKiosk ? 1 : 0, a.startsAt, a.endsAt, a.autoKey, now, now);
  publish(id);
}

/** Özel günler + doğum günü + kıdem yılı + hoş geldin. Gün içinde birçok kez çağrılabilir. */
export function runDailyAutomation() {
  const today = localToday();
  const md = today.slice(5);
  const dayStart = zonedMidnight(today);
  const dayEnd = zonedMidnight(addDays(today, 1)).toISOString();
  // Kişisel kartlar sabah 08:30'dan önce düşmesin (gece açık kalan PC'ye gece yarısı kutlama gitmesin)
  const morning = new Date(dayStart.getTime() + 8.5 * 3600_000).toISOString();

  const days = db.prepare('SELECT * FROM special_days WHERE enabled = 1 AND (month_day = ? OR date = ?)').all(md, today) as {
    id: string; name: string; emoji: string | null; image_url: string | null; message: string | null; kind: 'badge' | 'toast' | 'banner';
    position: string | null; pos_x: number | null; pos_y: number | null; size: number | null; opacity: number | null;
  }[];
  for (const d of days) {
    ensureAuto({
      autoKey: `sd:${d.id}:${today}`, kind: d.kind, category: 'genel', title: d.name, body: d.message ?? '', emoji: d.emoji,
      imageUrl: d.image_url, position: d.position, posX: d.pos_x, posY: d.pos_y, size: d.size, opacity: d.opacity,
      targets: ['all'], showOnKiosk: true, startsAt: dayStart.toISOString(), endsAt: dayEnd,
    });
  }

  const people = db
    .prepare('SELECT * FROM employees WHERE celebrate = 1 AND (birth_md = ? OR substr(start_date, 6) = ?)')
    .all(md, md) as { username: string; full_name: string; birth_md: string | null; start_date: string | null }[];
  for (const p of people) {
    const first = p.full_name.split(' ')[0];
    const target = [`user:${p.username}`];
    if (p.birth_md === md) {
      ensureAuto({
        autoKey: `bd:${p.username}:${today}`, kind: 'toast', category: 'ik', title: `İyi ki doğdun ${first}!`, emoji: '🎂',
        body: 'Tüm çalışma arkadaşların adına doğum gününü kutlar, sağlık ve mutluluk dolu bir yıl dileriz.',
        targets: target, showOnKiosk: false, startsAt: morning, endsAt: dayEnd,
      });
    }
    if (p.start_date && p.start_date.slice(5) === md) {
      const years = Number(today.slice(0, 4)) - Number(p.start_date.slice(0, 4));
      if (years === 0) {
        ensureAuto({
          autoKey: `hg:${p.username}:${today}`, kind: 'toast', category: 'ik', title: `Aramıza hoş geldin ${first}!`, emoji: '👋',
          body: 'İlk gününde başarılar dileriz. Sorun olursa sağ alttaki ErtePano simgesinden IT\'ye ulaşabilirsin.',
          targets: target, showOnKiosk: false, startsAt: morning, endsAt: dayEnd,
        });
      } else if (years > 0) {
        ensureAuto({
          autoKey: `kd:${p.username}:${today}`, kind: 'toast', category: 'ik', title: `${years}. yılın kutlu olsun ${first}!`, emoji: '🏅',
          body: `${years} yıldır bizimlesin. Emeğin ve katkın için teşekkür ederiz.`,
          targets: target, showOnKiosk: false, startsAt: morning, endsAt: dayEnd,
        });
      }
    }
  }
}

/** KVKK saklama süreleri: süresi dolan kayıtları sil. */
export function purge() {
  const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  const r = config.retention;
  db.prepare('DELETE FROM telemetry WHERE collected_at < ?').run(ago(r.telemetryDays));
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  // Zorunlu onaysız duyuruların teslim kayıtları daha kısa tutulur; onaylı olanlar denetim kanıtı.
  db.prepare(
    "DELETE FROM deliveries WHERE announcement_id IN (SELECT id FROM announcements WHERE status = 'ended' AND require_ack = 0 AND ends_at < ?)",
  ).run(ago(r.deliveryDays));
  db.prepare("DELETE FROM announcements WHERE status = 'ended' AND auto_key IS NOT NULL AND ends_at < ?").run(ago(r.deliveryDays));
  db.prepare('DELETE FROM deliveries WHERE announcement_id IN (SELECT id FROM announcements WHERE status = \'ended\' AND ends_at < ?)').run(ago(r.complianceDays));
  db.prepare('DELETE FROM emergencies WHERE ended_at < ?').run(ago(r.complianceDays));
  db.prepare("DELETE FROM reports WHERE status = 'closed' AND updated_at < ?").run(ago(r.complianceDays));
  db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(ago(r.complianceDays));
}

export function startScheduler() {
  const safe = (fn: () => void, name: string) => () => {
    try {
      fn();
    } catch (e) {
      console.error(`[zamanlayıcı] ${name}:`, e);
    }
  };
  const timers = [
    setInterval(safe(tickLifecycle, 'yaşam döngüsü'), 15_000),
    setInterval(safe(runDailyAutomation, 'günlük otomasyon'), 5 * 60_000),
    setInterval(safe(purge, 'temizlik'), 60 * 60_000),
  ];
  safe(tickLifecycle, 'yaşam döngüsü')();
  safe(runDailyAutomation, 'günlük otomasyon')();
  safe(purge, 'temizlik')();
  return () => timers.forEach(clearInterval);
}
