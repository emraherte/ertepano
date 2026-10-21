import type { AgentAnnouncement, Category, Kind, SignedItem } from '@ertepano/shared';
import { db } from './db.js';
import { sign } from './security.js';

export interface AnnRow {
  id: string;
  kind: Kind;
  category: Category;
  title: string;
  body: string;
  emoji: string | null;
  image_url: string | null;
  color: string | null;
  require_ack: number;
  ack_label: string | null;
  options: string | null;
  countdown_to: string | null;
  position: string | null;
  sound: number;
  targets: string;
  show_on_kiosk: number;
  status: 'draft' | 'scheduled' | 'active' | 'ended';
  starts_at: string | null;
  ends_at: string | null;
  emergency_id: string | null;
  drill: number;
  auto_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceRow {
  id: string;
  hostname: string;
  status: 'pending' | 'approved' | 'blocked';
  location: string | null;
  department: string | null;
  last_user: string | null;
  [k: string]: unknown;
}

export const parseTargets = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.length ? v.map(String) : ['all'];
  } catch {
    return ['all'];
  }
};

/** Hedefler: "all" | "loc:<lokasyon>" | "dep:<departman>" | "dev:<cihazId>" | "user:<kullanıcı>" — biri tutarsa yeter. */
export function deviceMatches(d: DeviceRow, targets: string[]): boolean {
  const lc = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('tr');
  return targets.some((t) => {
    if (t === 'all') return true;
    const i = t.indexOf(':');
    const type = t.slice(0, i);
    const value = t.slice(i + 1);
    switch (type) {
      case 'loc':
        return lc(d.location) === lc(value);
      case 'dep':
        return lc(d.department) === lc(value);
      case 'dev':
        return d.id === value;
      case 'user':
        return !!d.last_user && lc(d.last_user) === lc(value);
      default:
        return false;
    }
  });
}

export function approvedDevices(): DeviceRow[] {
  return db.prepare("SELECT * FROM devices WHERE status = 'approved'").all() as DeviceRow[];
}

export function countTargets(targets: string[]): number {
  return approvedDevices().filter((d) => deviceMatches(d, targets)).length;
}

export function activeAnnouncements(): AnnRow[] {
  return db.prepare("SELECT * FROM announcements WHERE status = 'active' ORDER BY created_at").all() as AnnRow[];
}

export function activeForDevice(d: DeviceRow): AnnRow[] {
  if (d.status !== 'approved') return [];
  return activeAnnouncements().filter((a) => deviceMatches(d, parseTargets(a.targets)));
}

export function toAgentPayload(a: AnnRow): AgentAnnouncement {
  const now = new Date();
  const fallbackDays = a.kind === 'fullscreen' ? 1 : 7;
  const expiresAt = a.ends_at ?? new Date(now.getTime() + fallbackDays * 86400_000).toISOString();
  return {
    id: a.id,
    kind: a.kind,
    category: a.category,
    title: a.title,
    body: a.body,
    emoji: a.emoji,
    imageUrl: a.image_url,
    color: a.color,
    requireAck: !!a.require_ack,
    ackLabel: a.ack_label,
    options: a.options ? (JSON.parse(a.options) as string[]) : null,
    countdownTo: a.countdown_to,
    position: a.position,
    sound: !!a.sound,
    emergencyId: a.emergency_id,
    drill: !!a.drill,
    startsAt: a.starts_at ?? a.created_at,
    endsAt: a.ends_at,
    issuedAt: now.toISOString(),
    expiresAt,
  };
}

/** Görsel adresleri ajanın erişebileceği tam URL'ye çevrilir (panel göreli yol saklar). */
export function signItem(a: AnnRow, baseUrl: string): SignedItem {
  const p = toAgentPayload(a);
  if (p.imageUrl && p.imageUrl.startsWith('/')) p.imageUrl = baseUrl + p.imageUrl;
  const payload = JSON.stringify(p);
  return { payload, sig: sign(payload) };
}

export function annDto(a: AnnRow) {
  return {
    id: a.id,
    kind: a.kind,
    category: a.category,
    title: a.title,
    body: a.body,
    emoji: a.emoji,
    imageUrl: a.image_url,
    color: a.color,
    requireAck: !!a.require_ack,
    ackLabel: a.ack_label,
    options: a.options ? (JSON.parse(a.options) as string[]) : null,
    countdownTo: a.countdown_to,
    position: a.position,
    sound: !!a.sound,
    targets: parseTargets(a.targets),
    showOnKiosk: !!a.show_on_kiosk,
    status: a.status,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    emergencyId: a.emergency_id,
    drill: !!a.drill,
    auto: !!a.auto_key,
    createdBy: a.created_by,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}
