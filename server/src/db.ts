import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, 'ertepano.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** Sıralı şema göçleri. Yeni değişiklik = listeye yeni eleman; eskileri asla düzenleme. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip TEXT
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE enroll_keys (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    default_location TEXT,
    default_department TEXT,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    hostname TEXT NOT NULL,
    mac TEXT,
    ip TEXT,
    os TEXT,
    agent_version TEXT,
    last_user TEXT,
    location TEXT,
    department TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cpu_model TEXT,
    cpu_load REAL,
    ram_total_mb INTEGER,
    ram_free_mb INTEGER,
    disk_total_gb REAL,
    disk_free_gb REAL,
    uptime_sec INTEGER,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  CREATE UNIQUE INDEX devices_host_mac ON devices(hostname, mac);

  CREATE TABLE telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    cpu_load REAL, ram_free_mb INTEGER, disk_free_gb REAL, uptime_sec INTEGER,
    collected_at TEXT NOT NULL
  );
  CREATE INDEX telemetry_device ON telemetry(device_id, collected_at);

  CREATE TABLE announcements (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    emoji TEXT,
    image_url TEXT,
    color TEXT,
    require_ack INTEGER NOT NULL DEFAULT 0,
    ack_label TEXT,
    options TEXT,
    countdown_to TEXT,
    position TEXT,
    sound INTEGER NOT NULL DEFAULT 0,
    targets TEXT NOT NULL DEFAULT '["all"]',
    show_on_kiosk INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at TEXT,
    ends_at TEXT,
    emergency_id TEXT,
    drill INTEGER NOT NULL DEFAULT 0,
    auto_key TEXT UNIQUE,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX announcements_status ON announcements(status);

  CREATE TABLE deliveries (
    announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_login TEXT,
    sent_at TEXT,
    seen_at TEXT,
    read_at TEXT,
    acked_at TEXT,
    dismissed_at TEXT,
    answer TEXT,
    answered_at TEXT,
    PRIMARY KEY (announcement_id, device_id)
  );

  CREATE TABLE emergencies (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    drill INTEGER NOT NULL DEFAULT 0,
    targets TEXT NOT NULL DEFAULT '["all"]',
    announcement_id TEXT,
    started_by TEXT,
    started_at TEXT NOT NULL,
    ended_by TEXT,
    ended_at TEXT,
    end_note TEXT,
    target_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE roll_calls (
    emergency_id TEXT NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_login TEXT,
    status TEXT NOT NULL,
    note TEXT,
    responded_at TEXT NOT NULL,
    PRIMARY KEY (emergency_id, device_id)
  );

  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    anonymous INTEGER NOT NULL DEFAULT 0,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    user_login TEXT,
    device_summary TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    handled_by TEXT,
    handler_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE employees (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    full_name TEXT NOT NULL,
    birth_md TEXT,
    start_date TEXT,
    department TEXT,
    location TEXT,
    celebrate INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE special_days (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    month_day TEXT,
    date TEXT,
    emoji TEXT,
    image_url TEXT,
    message TEXT,
    kind TEXT NOT NULL DEFAULT 'badge',
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log salt eklenir'); END;
  `,
  // 2: Active Directory kullanıcıları
  `
  ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE users ADD COLUMN email TEXT;
  ALTER TABLE users ADD COLUMN ldap_dn TEXT;
  `,
  // 3: rozet yerleşimi (konum, boyut, saydamlık) — duyurular ve özel günler
  `
  ALTER TABLE announcements ADD COLUMN pos_x REAL;
  ALTER TABLE announcements ADD COLUMN pos_y REAL;
  ALTER TABLE announcements ADD COLUMN size INTEGER;
  ALTER TABLE announcements ADD COLUMN opacity REAL;
  ALTER TABLE special_days ADD COLUMN position TEXT;
  ALTER TABLE special_days ADD COLUMN pos_x REAL;
  ALTER TABLE special_days ADD COLUMN pos_y REAL;
  ALTER TABLE special_days ADD COLUMN size INTEGER;
  ALTER TABLE special_days ADD COLUMN opacity REAL;
  UPDATE special_days SET kind = 'badge', position = 'bottom-right' WHERE month_day = '11-10' AND kind = 'banner';
  `,
  // 4: iki faktörlü doğrulama + kısıtlı (yalnız 2FA kurulumu) oturumlar
  `
  ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN mfa_secret TEXT;
  ALTER TABLE users ADD COLUMN mfa_pending_secret TEXT;
  ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;
  ALTER TABLE users ADD COLUMN mfa_recovery TEXT;
  ALTER TABLE users ADD COLUMN mfa_enrolled_at TEXT;
  ALTER TABLE users ADD COLUMN password_changed_at TEXT;
  ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  `,
  // 5: denetim kaydı bütünlüğü — her satır öncekinin özetini taşır; son 1 yılın kaydı silinemez
  `
  ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
  ALTER TABLE audit_log ADD COLUMN hash TEXT;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
    WHEN OLD.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
    BEGIN SELECT RAISE(ABORT, 'audit_log: son 1 yılın kaydı silinemez'); END;
  `,
  // 6: (kaldırıldı — uzaktan destek tablosu; sürüm numarası korunur)
  `SELECT 1;`,
  // 7: eski kurulumlarda oluşmuş uzaktan destek tablosunu kaldır
  `
  DROP INDEX IF EXISTS support_device;
  DROP TABLE IF EXISTS support_sessions;
  `,
];

function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
migrate();

export const nowIso = () => new Date().toISOString();

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export interface AuditFields {
  actor: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
}

/** Satırın özeti: önceki satırın özeti + bu satırın alanları. Bir satır değişir/silinirse zincir kırılır. */
export function auditHash(prev: string, r: AuditFields) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([prev, r.actor, r.action, r.entity, r.entity_id, r.details, r.ip, r.created_at]))
    .digest('hex');
}

const insertAudit = db.transaction((r: AuditFields) => {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string | null } | undefined;
  const prev = last?.hash ?? 'genesis';
  db.prepare('INSERT INTO audit_log(actor, action, entity, entity_id, details, ip, created_at, prev_hash, hash) VALUES(?,?,?,?,?,?,?,?,?)').run(
    r.actor, r.action, r.entity, r.entity_id, r.details, r.ip, r.created_at, prev, auditHash(prev, r),
  );
});

export function audit(actor: string | null, action: string, entity?: string, entityId?: string | null, details?: unknown, ip?: string) {
  insertAudit({
    actor,
    action,
    entity: entity ?? null,
    entity_id: entityId ?? null,
    details: details === undefined ? null : JSON.stringify(details),
    ip: ip ?? null,
    created_at: nowIso(),
  });
}

/** Zinciri baştan doğrula (zincir öncesi eski kayıtlar ve süresi dolup silinen baş kısım hariç). */
export function verifyAuditChain(): { ok: boolean; checked: number; brokenAt: number | null } {
  const rows = db.prepare('SELECT id, actor, action, entity, entity_id, details, ip, created_at, prev_hash, hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id').iterate() as Iterable<
    AuditFields & { id: number; prev_hash: string; hash: string }
  >;
  let prev: string | null = null;
  let checked = 0;
  for (const r of rows) {
    if (prev !== null && r.prev_hash !== prev) return { ok: false, checked, brokenAt: r.id };
    if (auditHash(r.prev_hash, r) !== r.hash) return { ok: false, checked, brokenAt: r.id };
    prev = r.hash;
    checked++;
  }
  return { ok: true, checked, brokenAt: null };
}
