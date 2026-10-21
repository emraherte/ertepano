// Ortak sözleşme: sunucu, panel ve simülatör aynı tipleri kullanır. Ajan tarafı için bkz. docs/PROTOKOL.md.

export const ROLES = ['admin', 'it', 'isg', 'ik', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Yönetici',
  it: 'IT',
  isg: 'İSG',
  ik: 'İK',
  viewer: 'İzleyici',
};

export const CATEGORIES = ['ik', 'isg', 'it', 'genel'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ik: 'İnsan Kaynakları',
  isg: 'İş Sağlığı ve Güvenliği',
  it: 'Bilgi Teknolojileri',
  genel: 'Genel',
};

export const CATEGORY_COLORS: Record<Category, string> = {
  ik: '#7c3aed',
  isg: '#d92d20',
  it: '#2563eb',
  genel: '#0f766e',
};

export const KINDS = ['toast', 'banner', 'badge', 'survey', 'countdown', 'fullscreen'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  toast: 'Kart (sağ alt)',
  banner: 'Üst şerit',
  badge: 'Köşe rozeti',
  survey: 'Mini anket',
  countdown: 'Geri sayım',
  fullscreen: 'Tam ekran (acil)',
};

/** Hangi rol hangi kategoride duyuru yayınlayabilir. */
export const ROLE_CATEGORIES: Record<Role, Category[]> = {
  admin: ['ik', 'isg', 'it', 'genel'],
  it: ['it', 'genel'],
  isg: ['isg', 'genel'],
  ik: ['ik', 'genel'],
  viewer: [],
};

export const EMERGENCY_ROLES: Role[] = ['admin', 'isg', 'it'];

export type AnnouncementStatus = 'draft' | 'scheduled' | 'active' | 'ended';

/** Ajanın ekranda gösterdiği, imzalanan yük (docs/PROTOKOL.md §4). */
export interface AgentAnnouncement {
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
  emergencyId: string | null;
  drill: boolean;
  startsAt: string;
  endsAt: string | null;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedItem {
  payload: string;
  sig: string;
}

export interface Telemetry {
  hostname: string;
  ip: string;
  mac: string;
  user: string;
  os: string;
  cpuModel: string;
  cpuLoad: number;
  ramTotalMb: number;
  ramFreeMb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  uptimeSec: number;
  agentVersion: string;
}

export type AgentToServer =
  | { t: 'hello'; deviceId: string; deviceSecret: string; agentVersion?: string; user?: string }
  | { t: 'telemetry'; data: Telemetry }
  | { t: 'ack'; id: string; action: 'seen' | 'read' | 'acked' | 'dismissed' | 'answered'; answer?: string }
  | { t: 'safety'; emergencyId: string; status: 'safe' | 'help'; note?: string }
  | { t: 'report'; kind: 'it_help' | 'near_miss'; text: string; anonymous?: boolean }
  | { t: 'pong' };

export type ServerToAgent =
  | { t: 'welcome'; status: 'approved' | 'pending'; serverTime: string }
  | { t: 'sync'; items: SignedItem[] }
  | { t: 'show'; item: SignedItem }
  | { t: 'revoke'; id: string }
  | { t: 'ping' }
  | { t: 'error'; code: string };

export const EMERGENCY_TYPES = ['yangin', 'deprem', 'tahliye', 'gaz', 'kimyasal', 'siber', 'diger'] as const;
export type EmergencyType = (typeof EMERGENCY_TYPES)[number];

export const REPORT_KINDS = ['it_help', 'near_miss'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABELS: Record<ReportKind, string> = {
  it_help: 'IT destek talebi',
  near_miss: 'Ramak kala bildirimi',
};
