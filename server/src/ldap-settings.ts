// LDAP / Active Directory ayarları: panelden (veritabanı, servis parolası şifreli) ya da .env'den.
// Panelde kayıt varsa o kullanılır; yoksa .env (config.ts). Böylece kurulumda dosya düzenlemeden ayarlanabilir.
import type { Role } from '@ertepano/shared';
import { config } from './config.js';
import { getSetting, setSetting, db } from './db.js';
import { decryptSecret, encryptSecret } from './mfa.js';

export interface LdapSettings {
  url?: string;
  baseDn?: string;
  bindDn?: string;
  bindPassword?: string;
  userFilter: string;
  domain: string | null;
  startTls: boolean;
  caFile?: string;
  /** Panelden yapıştırılan kurumsal kök sertifika (PEM) */
  caPem?: string;
  rejectUnauthorized: boolean;
  groups: Record<Role, string | undefined>;
  defaultRole: Role | null;
  source: 'panel' | 'env' | 'none';
  enabled: boolean;
}

export const DEFAULT_USER_FILTER = '(&(objectClass=user)(objectCategory=person)(sAMAccountName={{username}}))';

interface Stored {
  enabled: boolean;
  url: string;
  baseDn: string;
  bindDn: string;
  bindPasswordEnc: string | null;
  userFilter: string;
  domain: string | null;
  startTls: boolean;
  rejectUnauthorized: boolean;
  caPem: string | null;
  groups: Partial<Record<Role, string>>;
  defaultRole: Role | null;
}

let cache: LdapSettings | null = null;

export function ldapSettings(): LdapSettings {
  if (cache) return cache;
  const raw = getSetting('ldap');
  if (raw) {
    const s = JSON.parse(raw) as Stored;
    cache = {
      url: s.url || undefined,
      baseDn: s.baseDn || undefined,
      bindDn: s.bindDn || undefined,
      bindPassword: s.bindPasswordEnc ? (decryptSecret(s.bindPasswordEnc) ?? undefined) : undefined,
      userFilter: s.userFilter || DEFAULT_USER_FILTER,
      domain: s.domain,
      startTls: s.startTls,
      caPem: s.caPem ?? undefined,
      rejectUnauthorized: s.rejectUnauthorized,
      groups: { admin: s.groups.admin, it: s.groups.it, isg: s.groups.isg, ik: s.groups.ik, viewer: s.groups.viewer },
      defaultRole: s.defaultRole,
      source: 'panel',
      enabled: s.enabled && !!s.url && !!s.baseDn,
    };
    return cache;
  }
  const e = config.ldap;
  cache = {
    url: e.url,
    baseDn: e.baseDn,
    bindDn: e.bindDn,
    bindPassword: e.bindPassword,
    userFilter: e.userFilter,
    domain: e.domain,
    startTls: e.startTls,
    caFile: e.caFile,
    rejectUnauthorized: e.rejectUnauthorized,
    groups: e.groups,
    defaultRole: e.defaultRole,
    source: e.enabled ? 'env' : 'none',
    enabled: e.enabled,
  };
  return cache;
}

export interface LdapInput {
  enabled: boolean;
  url: string;
  baseDn: string;
  bindDn: string;
  /** boş/undefined = mevcut parolayı koru */
  bindPassword?: string;
  userFilter?: string;
  domain?: string | null;
  startTls: boolean;
  rejectUnauthorized: boolean;
  caPem?: string | null;
  groups: Partial<Record<Role, string>>;
  defaultRole: Role | null;
}

/** Kaydetmeden önce test edebilmek için girdiyi ayarlara çevir (parola boşsa kayıtlıdaki kullanılır). */
export function settingsFromInput(i: LdapInput): LdapSettings {
  const current = ldapSettings();
  return {
    url: i.url,
    baseDn: i.baseDn,
    bindDn: i.bindDn || undefined,
    bindPassword: i.bindPassword ? i.bindPassword : current.bindPassword,
    userFilter: i.userFilter?.trim() || DEFAULT_USER_FILTER,
    domain: i.domain ?? null,
    startTls: i.startTls,
    caPem: i.caPem ?? undefined,
    rejectUnauthorized: i.rejectUnauthorized,
    groups: { admin: i.groups.admin || undefined, it: i.groups.it || undefined, isg: i.groups.isg || undefined, ik: i.groups.ik || undefined, viewer: i.groups.viewer || undefined },
    defaultRole: i.defaultRole,
    source: 'panel',
    enabled: i.enabled && !!i.url && !!i.baseDn,
  };
}

export function saveLdapSettings(i: LdapInput) {
  const s = settingsFromInput(i);
  const stored: Stored = {
    enabled: i.enabled,
    url: i.url,
    baseDn: i.baseDn,
    bindDn: i.bindDn,
    bindPasswordEnc: s.bindPassword ? encryptSecret(s.bindPassword) : null,
    userFilter: s.userFilter,
    domain: s.domain,
    startTls: s.startTls,
    rejectUnauthorized: s.rejectUnauthorized,
    caPem: s.caPem ?? null,
    groups: i.groups,
    defaultRole: i.defaultRole,
  };
  setSetting('ldap', JSON.stringify(stored));
  cache = null;
}

/** Panel ayarını sil → .env'e dön */
export function clearLdapSettings() {
  db.prepare("DELETE FROM settings WHERE key = 'ldap'").run();
  cache = null;
}
