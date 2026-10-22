// Active Directory / LDAP ile kimlik doğrulama.
// Akış: servis hesabıyla bağlan → kullanıcıyı ara → kullanıcının DN'i ve parolasıyla yeniden bağlan → grup üyeliğinden rol çıkar.
import fs from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import { Client, type Entry, InvalidCredentialsError } from 'ldapts';
import type { Role } from '@ertepano/shared';
import { type LdapSettings, ldapSettings } from './ldap-settings.js';

export class LdapUnavailableError extends Error {}

export interface LdapUser {
  dn: string;
  username: string;
  fullName: string;
  email: string | null;
  role: Role | null;
}

/** Rol önceliği: birden fazla gruba üye olan en yetkili rolü alır. */
const ROLE_ORDER: Role[] = ['admin', 'isg', 'it', 'ik', 'viewer'];
/** AD "iç içe grup" eşleme kuralı (LDAP_MATCHING_RULE_IN_CHAIN) */
const IN_CHAIN = '1.2.840.113556.1.4.1941';

/** RFC 4515: filtre içindeki özel karakterleri kaçır (LDAP enjeksiyonuna karşı). */
export function escapeFilter(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** "SIRKET\ahmet", "ahmet@sirket.local" → "ahmet" */
export function normalizeUsername(input: string): string {
  let u = input.trim();
  if (u.includes('\\')) u = u.slice(u.lastIndexOf('\\') + 1);
  if (u.includes('@')) u = u.slice(0, u.indexOf('@'));
  return u;
}

/** Öznitelik adları sunucuya göre farklı büyük/küçük harfle gelebilir (memberOf / memberof). */
const attr = (e: Entry, name: string): Entry[string] | undefined => {
  const key = Object.keys(e).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : e[key];
};

const str = (v: Entry[string] | undefined): string | null => {
  if (v === undefined) return null;
  const first = Array.isArray(v) ? v[0] : v;
  return first === undefined ? null : Buffer.isBuffer(first) ? first.toString('utf8') : String(first);
};
const list = (v: Entry[string] | undefined): string[] => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x))));

/** "CN=ErtePano-IK,OU=Gruplar,DC=sirket,DC=local" → "ErtePano-IK" */
const cnOf = (dn: string) => /^CN=((?:\\,|[^,])+)/i.exec(dn)?.[1]?.replace(/\\,/g, ',') ?? dn;
const isDn = (s: string) => /^(CN|OU|DC)=/i.test(s) && s.includes(',');

function tlsOptions(l: LdapSettings): ConnectionOptions {
  return {
    rejectUnauthorized: l.rejectUnauthorized,
    ...(l.caPem ? { ca: [l.caPem] } : l.caFile ? { ca: [fs.readFileSync(l.caFile)] } : {}),
  };
}

async function connect(l: LdapSettings): Promise<Client> {
  const client = new Client({
    url: l.url!,
    timeout: 8000,
    connectTimeout: 5000,
    ...(l.url!.startsWith('ldaps://') ? { tlsOptions: tlsOptions(l) } : {}),
  });
  try {
    if (l.startTls) await client.startTLS(tlsOptions(l));
    if (l.bindDn) await client.bind(l.bindDn, l.bindPassword ?? '');
  } catch (e) {
    await client.unbind().catch(() => {});
    if (e instanceof InvalidCredentialsError) throw new LdapUnavailableError('LDAP servis hesabı reddedildi (servis hesabı DN ya da parolası hatalı)');
    throw new LdapUnavailableError(`Active Directory'ye ulaşılamıyor: ${(e as Error).message}`);
  }
  return client;
}

async function findUser(client: Client, username: string, l: LdapSettings): Promise<Entry | null> {
  const filter = l.userFilter.replace(/\{\{username\}\}/g, escapeFilter(username));
  const { searchEntries } = await client.search(l.baseDn!, {
    scope: 'sub',
    filter,
    sizeLimit: 2,
    attributes: ['dn', 'sAMAccountName', 'uid', 'displayName', 'cn', 'mail', 'memberOf', 'userAccountControl'],
  });
  return searchEntries.length === 1 ? searchEntries[0] : null;
}

/** Kullanıcının rolü: memberOf (doğrudan) ya da DN verilen gruplar için AD zincir kuralı (iç içe gruplar). */
async function resolveRole(client: Client, entry: Entry, l: LdapSettings): Promise<Role | null> {
  const memberOf = list(attr(entry, 'memberOf')).map((g) => g.toLowerCase());
  const memberCns = memberOf.map((g) => cnOf(g).toLowerCase());
  for (const role of ROLE_ORDER) {
    const group = l.groups[role];
    if (!group) continue;
    const g = group.toLowerCase();
    if (isDn(group) ? memberOf.includes(g) : memberCns.includes(g)) return role;
    if (isDn(group)) {
      const { searchEntries } = await client.search(entry.dn, {
        scope: 'base',
        filter: `(memberOf:${IN_CHAIN}:=${escapeFilter(group)})`,
        attributes: ['dn'],
      });
      if (searchEntries.length) return role;
    }
  }
  return l.defaultRole;
}

/** Parola doğrulanırsa kullanıcıyı döner; yanlış parola / bulunamayan / kapalı hesapta null. */
export async function ldapAuthenticate(rawUsername: string, password: string): Promise<LdapUser | null> {
  // Boş parola AD'de "anonim bağlanma" olarak başarılı sayılabilir — asla kabul etme.
  if (!password) return null;
  const username = normalizeUsername(rawUsername);
  if (!username) return null;

  const l = ldapSettings();
  const client = await connect(l);
  try {
    const entry = await findUser(client, username, l);
    if (!entry) return null;
    const uac = Number(str(attr(entry, 'userAccountControl')) ?? 0);
    if (uac & 2) return null; // ACCOUNTDISABLE

    const userClient = new Client({ url: l.url!, timeout: 8000, connectTimeout: 5000, ...(l.url!.startsWith('ldaps://') ? { tlsOptions: tlsOptions(l) } : {}) });
    try {
      if (l.startTls) await userClient.startTLS(tlsOptions(l));
      await userClient.bind(entry.dn, password);
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return null;
      throw new LdapUnavailableError(`Active Directory doğrulaması başarısız: ${(e as Error).message}`);
    } finally {
      await userClient.unbind().catch(() => {});
    }

    return {
      dn: entry.dn,
      username: (str(attr(entry, 'sAMAccountName')) ?? str(attr(entry, 'uid')) ?? username).toLowerCase(),
      fullName: str(attr(entry, 'displayName')) ?? str(attr(entry, 'cn')) ?? username,
      email: str(attr(entry, 'mail')),
      role: await resolveRole(client, entry, l),
    };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export interface LdapTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  groups: { role: Role; group: string; found: boolean }[];
  user?: { found: boolean; dn?: string; fullName?: string; role?: Role | null; disabled?: boolean };
}

/** Panelden "Bağlantıyı test et": servis hesabı, temel DN, rol grupları ve (isteğe bağlı) bir kullanıcının çözülen rolü. */
export async function ldapTest(username?: string, l: LdapSettings = ldapSettings()): Promise<LdapTestResult> {
  const started = Date.now();
  const groups: LdapTestResult['groups'] = [];
  if (!l.url || !l.baseDn) return { ok: false, latencyMs: 0, message: 'Sunucu adresi ve temel DN gerekli', groups };
  let client: Client;
  try {
    client = await connect(l);
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, message: (e as Error).message, groups };
  }
  try {
    await client.search(l.baseDn!, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
    for (const role of ROLE_ORDER) {
      const group = l.groups[role];
      if (!group) continue;
      const { searchEntries } = isDn(group)
        ? await client.search(group, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] }).catch(() => ({ searchEntries: [] as Entry[] }))
        : await client.search(l.baseDn!, { scope: 'sub', filter: `(&(objectClass=group)(cn=${escapeFilter(group)}))`, attributes: ['dn'], sizeLimit: 1 });
      groups.push({ role, group, found: searchEntries.length > 0 });
    }
    let user: LdapTestResult['user'];
    if (username) {
      const entry = await findUser(client, normalizeUsername(username), l);
      user = entry
        ? {
            found: true,
            dn: entry.dn,
            fullName: str(attr(entry, 'displayName')) ?? str(attr(entry, 'cn')) ?? undefined,
            role: await resolveRole(client, entry, l),
            disabled: !!(Number(str(attr(entry, 'userAccountControl')) ?? 0) & 2),
          }
        : { found: false };
    }
    return { ok: true, latencyMs: Date.now() - started, message: 'Bağlantı başarılı', groups, user };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, message: `Arama başarısız: ${(e as Error).message}`, groups };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export interface DirectoryUser {
  username: string;
  fullName: string;
  /** istenen öznitelikler (ad → ilk değer) */
  attrs: Record<string, string>;
}

/** Personel eşitlemesi: filtreye uyan tüm kullanıcılar (sayfalı arama; büyük dizinlerde 1000 sınırına takılmaz). */
export async function ldapSearchUsers(l: LdapSettings, filter: string, extra: string[]): Promise<DirectoryUser[]> {
  const client = await connect(l);
  try {
    const { searchEntries } = await client.search(l.baseDn!, {
      scope: 'sub',
      filter,
      paged: { pageSize: 500 },
      attributes: ['sAMAccountName', 'uid', 'displayName', 'cn', ...extra],
    });
    return searchEntries.map((e) => ({
      username: (str(attr(e, 'sAMAccountName')) ?? str(attr(e, 'uid')) ?? '').toLowerCase(),
      fullName: (str(attr(e, 'displayName')) ?? str(attr(e, 'cn')) ?? '').trim(),
      attrs: Object.fromEntries(extra.map((a) => [a, (str(attr(e, a)) ?? '').trim()])),
    }));
  } finally {
    await client.unbind().catch(() => {});
  }
}
