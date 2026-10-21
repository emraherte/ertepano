import type { AnnouncementStatus, Category, Kind, Role } from '@ertepano/shared';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  /** 'ldap' = Active Directory hesabı (parola AD'de yönetilir) */
  authSource?: 'local' | 'ldap';
}

export interface Stats {
  targets: number;
  sent: number;
  seen: number;
  acked: number;
  answered: number;
}

export interface Announcement {
  id: string;
  kind: Kind;
  category: Category;
  title: string;
  body: string;
  emoji: string | null;
  imageUrl: string | null;
  color: string | null;
  requireAck: boolean;
  ackLabel: string | null;
  options: string[] | null;
  countdownTo: string | null;
  position: string | null;
  sound: boolean;
  targets: string[];
  showOnKiosk: boolean;
  status: AnnouncementStatus;
  startsAt: string | null;
  endsAt: string | null;
  emergencyId: string | null;
  drill: boolean;
  auto: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: Stats;
}

export interface Template {
  id: string;
  category: Category;
  kind: Kind;
  name: string;
  title: string;
  body: string;
  emoji: string;
  requireAck?: boolean;
  ackLabel?: string;
  options?: string[];
  countdownMinutes?: number;
}

export interface Device {
  id: string;
  hostname: string;
  mac: string | null;
  ip: string | null;
  os: string | null;
  agentVersion: string | null;
  lastUser: string | null;
  location: string | null;
  department: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'blocked';
  cpuModel: string | null;
  cpuLoad: number | null;
  ramTotalMb: number | null;
  ramFreeMb: number | null;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  uptimeSec: number | null;
  firstSeen: string;
  lastSeen: string;
  online: boolean;
  alerts: string[];
}

export interface EmergencyDetail {
  id: string;
  type: string;
  title: string;
  body: string;
  drill: boolean;
  targets: string[];
  startedBy: string | null;
  startedAt: string;
  endedBy: string | null;
  endedAt: string | null;
  endNote: string | null;
  counts: { targets: number; safe: number; help: number; noResponse: number };
  byLocation: { location: string; total: number; safe: number; help: number; noResponse: number }[];
  help: { deviceId: string; hostname: string; userLogin: string | null; location: string | null; note: string | null; respondedAt: string }[];
  safe: { deviceId: string; hostname: string; userLogin: string | null; location: string | null; respondedAt: string; afterSec: number }[];
  noResponse: { deviceId: string; hostname: string; userLogin: string | null; location: string | null; department: string | null; online: boolean }[];
}

export interface EmergencyTemplate {
  type: string;
  label: string;
  emoji: string;
  color: string;
  title: string;
  body: string;
}
