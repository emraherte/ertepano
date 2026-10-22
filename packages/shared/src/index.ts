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

/** Rozet için hazır konumlar → merkez noktası (ekranın % olarak yatay, dikey konumu). */
export const BADGE_POSITIONS = {
  'top-left': [7, 10],
  'top-center': [50, 10],
  'top-right': [93, 10],
  'middle-left': [7, 50],
  center: [50, 50],
  'middle-right': [93, 50],
  'bottom-left': [7, 86],
  'bottom-center': [50, 86],
  'bottom-right': [93, 86],
} as const satisfies Record<string, readonly [number, number]>;
export type BadgePosition = keyof typeof BADGE_POSITIONS | 'custom';
export const BADGE_POSITION_LABELS: Record<BadgePosition, string> = {
  'top-left': 'Sol üst',
  'top-center': 'Üst orta',
  'top-right': 'Sağ üst',
  'middle-left': 'Sol orta',
  center: 'Ekran ortası',
  'middle-right': 'Sağ orta',
  'bottom-left': 'Sol alt',
  'bottom-center': 'Alt orta',
  'bottom-right': 'Sağ alt',
  custom: 'Serbest konum',
};
export const BADGE_SIZE = { min: 64, max: 480, default: 160 } as const;

/** pending: onay bekliyor · rejected: onaycı reddetti (düzenlenip yeniden gönderilir) */
export type AnnouncementStatus = 'draft' | 'pending' | 'rejected' | 'scheduled' | 'active' | 'ended';

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
  /** Rozet merkezinin ekrandaki yeri (çalışma alanının yüzdesi, 0–100) */
  posX: number | null;
  posY: number | null;
  /** Rozet boyutu (mantıksal px) ve saydamlık (0.2–1) */
  size: number | null;
  opacity: number | null;
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
  | { t: 'report'; kind: 'it_help'; text: string }
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

export const REPORT_KINDS = ['it_help'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABELS: Record<ReportKind, string> = {
  it_help: 'IT destek talebi',
};

// ---- Modüler lisans ----------------------------------------------------------------------------

/** Ayrı satılan modüller. Temel paket (genel duyurular, özel gün rozetleri, kiosk, cihaz kaydı) her lisansta vardır. */
export const MODULES = ['ik', 'isg', 'it'] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  ik: 'İK modülü',
  isg: 'İSG modülü',
  it: 'IT modülü',
};

export const MODULE_FEATURES: Record<Module, string[]> = {
  ik: ['İK duyuruları ve zorunlu okuma', 'Mini anketler', 'Doğum günü, kıdem ve hoş geldin kutlamaları (İK listesi, AD, kiosk)'],
  isg: ['Tam ekran acil durum yayını', 'Canlı "Güvendeyim / Yardım lazım" yoklaması', 'Tatbikat modu ve tutanak', 'İSG talimatları ve zorunlu onay'],
  it: ['Donanım envanteri ve sağlık uyarıları', 'Excel/CSV dışa aktarım', 'Bakım geri sayımı ve IT duyuruları', 'Siber olay acil uyarısı', '"IT\'ye bildir" talepleri'],
};

export type LicenseMode = 'trial' | 'licensed' | 'grace' | 'expired';

export interface LicenseInfo {
  mode: LicenseMode;
  modules: Module[];
  customer: string | null;
  maxDevices: number;
  deviceCount: number;
  validUntil: string | null;
  daysLeft: number | null;
  licenseId: string | null;
  /** Yalnızca yöneticiye: lisansı sunucuya bağlamak için kimlik */
  serverId?: string;
}

/** Lisanslı modüllere göre yayın yapılabilecek kategoriler (genel her zaman açık). */
export const licensedCategories = (modules: readonly Module[]): Category[] => ['genel', ...modules];
