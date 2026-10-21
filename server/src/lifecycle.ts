import { db, nowIso } from './db.js';
import type { AnnRow } from './announcements.js';
import { pushAnnouncement, revokeAnnouncement } from './hub.js';

const getAnn = (id: string) => db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;

/** Yayınla: başlangıç zamanı gelmişse hemen aktif + ajanlara it; değilse planlı. */
export function publish(id: string) {
  const a = getAnn(id);
  if (!a || a.status === 'ended') return a;
  const now = nowIso();
  const startsAt = a.starts_at ?? now;
  const status = startsAt <= now ? 'active' : 'scheduled';
  db.prepare('UPDATE announcements SET status = ?, starts_at = ?, updated_at = ? WHERE id = ?').run(status, startsAt, now, id);
  const updated = getAnn(id)!;
  if (status === 'active') pushAnnouncement(updated);
  return updated;
}

export function endAnnouncement(id: string) {
  const now = nowIso();
  const res = db
    .prepare("UPDATE announcements SET status = 'ended', ends_at = COALESCE(MIN(ends_at, ?), ?), updated_at = ? WHERE id = ? AND status != 'ended'")
    .run(now, now, now, id);
  if (res.changes) revokeAnnouncement(id);
}

/** Aktif bir duyuru düzenlendi: ajanlardaki kopyayı yenile. */
export function republish(id: string) {
  const a = getAnn(id);
  if (a?.status === 'active') pushAnnouncement(a);
}

/** Her 15 sn: zamanı gelen planlıları başlat, süresi dolanları bitir. */
export function tickLifecycle() {
  const now = nowIso();
  const due = db.prepare("SELECT id FROM announcements WHERE status = 'scheduled' AND starts_at <= ?").all(now) as { id: string }[];
  due.forEach((r) => publish(r.id));
  const expired = db
    .prepare("SELECT id FROM announcements WHERE status IN ('active','scheduled') AND ends_at IS NOT NULL AND ends_at <= ?")
    .all(now) as { id: string }[];
  expired.forEach((r) => endAnnouncement(r.id));
}
