/**
 * Personel listesi (kutlamalar için): doğum günü (yalnızca gün/ay — KVKK), işe giriş, departman, lokasyon.
 * Üç kaynak, aynı tablo:
 *   - csv    İK sisteminden dışa aktarılan liste (Logo, Netsis, SAP, Excel…) — başlıklar otomatik tanınır, önce önizlenir
 *   - ldap   Active Directory öznitelikleri (doğum günü vb. AD'de tutuluyorsa ayrı listeye gerek kalmaz) — günlük eşitleme
 *   - manual Panelden elle; bilgisayarı olmayan çalışanlar (üretim, saha) dahil
 * Kural: içe aktarma/eşitleme boş değerle dolu alanı ezmez, kişinin "kutlama istemiyorum" tercihine (celebrate) dokunmaz,
 * elle girilen kaydı silmez. Bilgisayarı olmayan (kullanıcı adı boş) kişiler kiosk ekranlarında / ekibine kutlanır.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { audit, db, getSetting, nowIso, setSetting } from './db.js';
import { requireModule } from './license.js';
import { ldapSearchUsers } from './ldap.js';
import { ldapSettings } from './ldap-settings.js';
import { uuid } from './security.js';
import { runDailyAutomation } from './scheduler.js';

export type EmployeeSource = 'csv' | 'ldap' | 'manual';

interface EmployeeRow {
  id: string;
  username: string | null;
  employee_no: string | null;
  full_name: string;
  birth_md: string | null;
  start_date: string | null;
  department: string | null;
  location: string | null;
  celebrate: number;
  source: EmployeeSource;
  updated_at: string | null;
}

export interface EmployeeInput {
  username: string | null;
  employeeNo: string | null;
  fullName: string;
  birthMd: string | null;
  startDate: string | null;
  department: string | null;
  location: string | null;
}

const dto = (r: EmployeeRow) => ({
  id: r.id,
  username: r.username,
  employeeNo: r.employee_no,
  fullName: r.full_name,
  birthMd: r.birth_md,
  startDate: r.start_date,
  department: r.department,
  location: r.location,
  celebrate: !!r.celebrate,
  source: r.source,
  hasPc: !!r.username,
  updatedAt: r.updated_at,
});

// ---- tarih biçimleri -------------------------------------------------------------------------

const validMd = (mm: number, dd: number) => mm >= 1 && mm <= 12 && dd >= 1 && dd <= new Date(Date.UTC(2024, mm, 0)).getUTCDate();
const md = (mm: number, dd: number) => (validMd(mm, dd) ? `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` : null);

/**
 * Doğum günü → "AA-GG" (yıl saklanmaz). Kabul: 15.07 · 15.07.1990 · 15/07/1990 · 1990-07-15 · 07-15 ·
 * 19900715 · AD GeneralizedTime 19900715000000.0Z · Excel seri tarihi (33069).
 */
export function toMonthDay(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  // "07-15": ay-gün (eski kayıt biçimi)
  let m = /^(\d{2})-(\d{2})$/.exec(t);
  if (m) return md(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(t);
  if (m) return md(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return md(Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})(\d{6})?(\.\d+)?Z?$/.exec(t);
  if (m) return md(Number(m[2]), Number(m[3]));
  if (/^\d{5}$/.test(t)) {
    const d = excelDate(Number(t));
    return d ? md(d.getUTCMonth() + 1, d.getUTCDate()) : null;
  }
  return null;
}

/** İşe giriş → "YYYY-AA-GG" (kıdem yılı için yıl gerekir). */
export function toDate(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const iso = (y: number, mm: number, dd: number) =>
    y >= 1950 && y <= 2100 && validMd(mm, dd) ? `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` : null;
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})(\d{6})?(\.\d+)?Z?$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{5}$/.test(t)) {
    const d = excelDate(Number(t));
    return d ? iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) : null;
  }
  return null;
}

function excelDate(serial: number): Date | null {
  if (serial < 1 || serial > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400_000);
}

// ---- tablo okuma (CSV / Excel'den yapıştırma) ------------------------------------------------

type Field = 'username' | 'employeeNo' | 'fullName' | 'firstName' | 'lastName' | 'birth' | 'start' | 'department' | 'location' | 'email';

/** Türkçe/İngilizce başlık eş anlamlıları (küçük harf, aksansız, boşluksuz) */
const ALIASES: Record<Field, string[]> = {
  username: ['kullaniciadi', 'kullanici', 'username', 'user', 'samaccountname', 'windowskullaniciadi', 'windowskullanici', 'oturumadi', 'login', 'kullanicikodu'],
  email: ['eposta', 'epostaadresi', 'email', 'mail', 'emailadresi'],
  employeeNo: ['sicil', 'sicilno', 'sicilnumarasi', 'personelno', 'personelnumarasi', 'personelkodu', 'employeeid', 'employeeno', 'employeenumber', 'personnelno', 'tckimlikharic'],
  fullName: ['adsoyad', 'adisoyadi', 'adsoyadi', 'adivesoyadi', 'isimsoyisim', 'isim', 'fullname', 'name', 'displayname', 'personel', 'personeladi', 'calisan', 'calisanadi'],
  firstName: ['ad', 'adi', 'firstname', 'givenname'],
  lastName: ['soyad', 'soyadi', 'lastname', 'surname', 'sn'],
  birth: ['dogumtarihi', 'dogumgunu', 'dogum', 'dogumgunuay', 'birthdate', 'birthday', 'dateofbirth', 'dob'],
  start: ['isegiris', 'isegiristarihi', 'isebaslama', 'isebaslamatarihi', 'giristarihi', 'hiredate', 'startdate', 'kidemtarihi', 'iseiris'],
  department: ['departman', 'bolum', 'birim', 'department', 'dept', 'mudurluk', 'servis', 'gorevyeri'],
  location: ['lokasyon', 'sube', 'isyeri', 'location', 'office', 'tesis', 'fabrika', 'yerleske', 'bina'],
};

const norm = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Tırnaklı alanları (içinde ayırıcı / satır sonu olabilen) destekleyen CSV/TSV okuyucu. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = ['\t', ';', ','].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

export interface ParsedTable {
  /** alan → sütun başlığı (önizlemede gösterilir); başlıksız dosyada null */
  mapping: Partial<Record<Field, string>> | null;
  rows: EmployeeInput[];
  errors: string[];
  /** doğum tarihi yıl içerdiği için yılı atılan satır sayısı (KVKK) */
  yearsDropped: number;
}

/** Eski konumsal biçim: kullanıcı adı; ad soyad; doğum günü; işe giriş; departman; lokasyon */
const LEGACY: Field[] = ['username', 'fullName', 'birth', 'start', 'department', 'location'];

export function parseEmployees(text: string): ParsedTable {
  const all = parseDelimited(text);
  const errors: string[] = [];
  if (!all.length) return { mapping: null, rows: [], errors: ['Dosya boş'], yearsDropped: 0 };

  const header = all[0].map(norm);
  const cols: Partial<Record<Field, number>> = {};
  (Object.keys(ALIASES) as Field[]).forEach((f) => {
    const i = header.findIndex((h, idx) => ALIASES[f].includes(h) && !Object.values(cols).includes(idx));
    if (i >= 0) cols[f] = i;
  });
  const hasHeader = Object.keys(cols).length >= 2 && (cols.fullName !== undefined || cols.firstName !== undefined || cols.username !== undefined);
  let data = all;
  let mapping: ParsedTable['mapping'] = null;
  if (hasHeader) {
    data = all.slice(1);
    mapping = Object.fromEntries((Object.entries(cols) as [Field, number][]).map(([f, i]) => [f, all[0][i]]));
  } else {
    LEGACY.forEach((f, i) => (cols[f] = i));
  }

  let yearsDropped = 0;
  const rows: EmployeeInput[] = [];
  data.forEach((r, n) => {
    const line = n + (hasHeader ? 2 : 1);
    const get = (f: Field) => (cols[f] !== undefined ? (r[cols[f]!] ?? '').trim() : '');
    let username = get('username') || null;
    if (!username && get('email').includes('@')) username = get('email').split('@')[0];
    if (username?.includes('\\')) username = username.slice(username.lastIndexOf('\\') + 1);
    if (username?.includes('@')) username = username.slice(0, username.indexOf('@'));
    const fullName = (get('fullName') || [get('firstName'), get('lastName')].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    if (!fullName) {
      errors.push(`Satır ${line}: ad soyad yok`);
      return;
    }
    const birthRaw = get('birth');
    const birthMd = toMonthDay(birthRaw);
    if (birthRaw && !birthMd) errors.push(`Satır ${line}: doğum günü okunamadı ("${birthRaw}")`);
    if (birthMd && /\d{4}/.test(birthRaw)) yearsDropped++;
    const startRaw = get('start');
    const startDate = toDate(startRaw);
    if (startRaw && !startDate) errors.push(`Satır ${line}: işe giriş tarihi okunamadı ("${startRaw}")`);
    rows.push({
      username: username?.slice(0, 64) || null,
      employeeNo: get('employeeNo').slice(0, 32) || null,
      fullName: fullName.slice(0, 120),
      birthMd,
      startDate,
      department: get('department').slice(0, 80) || null,
      location: get('location').slice(0, 80) || null,
    });
  });
  return { mapping, rows, errors, yearsDropped };
}

// ---- yazma (birleştirme) ---------------------------------------------------------------------

type Outcome = 'created' | 'updated' | 'unchanged';

function findExisting(e: EmployeeInput): EmployeeRow | undefined {
  if (e.username) {
    const r = db.prepare('SELECT * FROM employees WHERE username = ?').get(e.username) as EmployeeRow | undefined;
    if (r) return r;
  }
  if (e.employeeNo) {
    const r = db.prepare('SELECT * FROM employees WHERE employee_no = ?').get(e.employeeNo) as EmployeeRow | undefined;
    if (r) return r;
  }
  // kullanıcı adı ve sicil yoksa (bilgisayarı olmayan çalışan): aynı ad soyad, kimliksiz kayıt
  if (!e.username && !e.employeeNo) {
    return db
      .prepare('SELECT * FROM employees WHERE username IS NULL AND employee_no IS NULL AND full_name = ? COLLATE NOCASE')
      .get(e.fullName) as EmployeeRow | undefined;
  }
  return undefined;
}

/** Boş gelen alan dolu alanı ezmez; celebrate'e dokunulmaz. dryRun: yazmadan sonucu hesaplar. */
export function upsertEmployee(e: EmployeeInput, source: EmployeeSource, dryRun = false): { outcome: Outcome; id: string } {
  const ex = findExisting(e);
  const now = nowIso();
  if (!ex) {
    const id = uuid();
    if (!dryRun) {
      db.prepare(
        `INSERT INTO employees(id, username, employee_no, full_name, birth_md, start_date, department, location, celebrate, source, updated_at)
         VALUES(?,?,?,?,?,?,?,?,1,?,?)`,
      ).run(id, e.username, e.employeeNo, e.fullName, e.birthMd, e.startDate, e.department, e.location, source, now);
    }
    return { outcome: 'created', id };
  }
  const next = {
    username: e.username ?? ex.username,
    employee_no: e.employeeNo ?? ex.employee_no,
    full_name: e.fullName || ex.full_name,
    birth_md: e.birthMd ?? ex.birth_md,
    start_date: e.startDate ?? ex.start_date,
    department: e.department ?? ex.department,
    location: e.location ?? ex.location,
  };
  const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => (next[k] ?? null) === (ex[k] ?? null));
  if (same) return { outcome: 'unchanged', id: ex.id };
  if (!dryRun) {
    // elle girilen kayıt elle kalır (eşitleme silmesin); diğerlerinde son kaynak yazılır
    const src = ex.source === 'manual' ? 'manual' : source;
    db.prepare(
      `UPDATE employees SET username=?, employee_no=?, full_name=?, birth_md=?, start_date=?, department=?, location=?, source=?, updated_at=? WHERE id=?`,
    ).run(next.username, next.employee_no, next.full_name, next.birth_md, next.start_date, next.department, next.location, src, now, ex.id);
  }
  return { outcome: 'updated', id: ex.id };
}

export interface MergeResult {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
}

/** Bir kaynağın tam listesini uygula. removeMissing: o kaynaktan gelip listede olmayanları sil (elle girilenler korunur). */
export function mergeEmployees(rows: EmployeeInput[], source: Exclude<EmployeeSource, 'manual'>, opts: { dryRun: boolean; removeMissing: boolean }): MergeResult {
  const res: MergeResult = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const run = () => {
    const seen = new Set<string>();
    for (const r of rows) {
      const { outcome, id } = upsertEmployee(r, source, opts.dryRun);
      res[outcome]++;
      seen.add(id);
    }
    if (opts.removeMissing) {
      const stale = (db.prepare('SELECT id FROM employees WHERE source = ?').all(source) as { id: string }[]).filter((x) => !seen.has(x.id));
      res.removed = stale.length;
      if (!opts.dryRun) stale.forEach((x) => db.prepare('DELETE FROM employees WHERE id = ?').run(x.id));
    }
  };
  if (opts.dryRun) run();
  else db.transaction(run)();
  return res;
}

// ---- Active Directory eşitleme ---------------------------------------------------------------

export interface EmployeeSyncSettings {
  enabled: boolean;
  /** AD'de doğum gününün tutulduğu öznitelik (ör. extensionAttribute1). Boşsa doğum günü AD'den alınmaz. */
  birthdayAttr: string;
  hireDateAttr: string;
  employeeNoAttr: string;
  departmentAttr: string;
  locationAttr: string;
  /** Eşitlenecek kullanıcılar (varsayılan: etkin kişi hesapları) */
  filter: string;
  /** AD'de artık bulunmayan (silinen / devre dışı) kişileri listeden kaldır */
  removeMissing: boolean;
  lastRunAt?: string | null;
  lastResult?: (MergeResult & { total: number; error?: string }) | null;
}

export const DEFAULT_SYNC: EmployeeSyncSettings = {
  enabled: false,
  birthdayAttr: '',
  hireDateAttr: '',
  employeeNoAttr: 'employeeID',
  departmentAttr: 'department',
  locationAttr: 'physicalDeliveryOfficeName',
  filter: '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
  removeMissing: true,
  lastRunAt: null,
  lastResult: null,
};

export function syncSettings(): EmployeeSyncSettings {
  try {
    return { ...DEFAULT_SYNC, ...(JSON.parse(getSetting('employee_sync') ?? '{}') as Partial<EmployeeSyncSettings>) };
  } catch {
    return DEFAULT_SYNC;
  }
}

const attrName = z.string().trim().max(64).regex(/^[A-Za-z][A-Za-z0-9-]*$|^$/, 'Öznitelik adı geçersiz');

export async function syncFromLdap(dryRun: boolean, s = syncSettings()) {
  const l = ldapSettings();
  if (!l.enabled) throw new Error('Önce Active Directory bağlantısını kurun (Sistem & güvenlik)');
  const entries = await ldapSearchUsers(l, s.filter, [s.birthdayAttr, s.hireDateAttr, s.employeeNoAttr, s.departmentAttr, s.locationAttr].filter(Boolean));
  const rows: EmployeeInput[] = entries
    .filter((e) => e.username && e.fullName)
    .map((e) => ({
      username: e.username,
      employeeNo: (s.employeeNoAttr && e.attrs[s.employeeNoAttr]) || null,
      fullName: e.fullName,
      birthMd: s.birthdayAttr ? toMonthDay(e.attrs[s.birthdayAttr]) : null,
      startDate: s.hireDateAttr ? toDate(e.attrs[s.hireDateAttr]) : null,
      department: (s.departmentAttr && e.attrs[s.departmentAttr]) || null,
      location: (s.locationAttr && e.attrs[s.locationAttr]) || null,
    }));
  const result = mergeEmployees(rows, 'ldap', { dryRun, removeMissing: s.removeMissing });
  const withBirthday = rows.filter((r) => r.birthMd).length;
  if (!dryRun) setSetting('employee_sync', JSON.stringify({ ...s, lastRunAt: nowIso(), lastResult: { ...result, total: rows.length } }));
  return { total: rows.length, withBirthday, ...result, sample: rows.slice(0, 5) };
}

/** Günlük otomasyondan çağrılır: açıksa günde bir kez eşitle. */
export async function dailyEmployeeSync() {
  const s = syncSettings();
  if (!s.enabled) return;
  if (s.lastRunAt && Date.now() - Date.parse(s.lastRunAt) < 20 * 3600_000) return;
  try {
    const r = await syncFromLdap(false, s);
    audit('otomatik', 'employees_synced', 'employee', null, { total: r.total, created: r.created, updated: r.updated, removed: r.removed });
  } catch (e) {
    setSetting('employee_sync', JSON.stringify({ ...s, lastRunAt: nowIso(), lastResult: { created: 0, updated: 0, unchanged: 0, removed: 0, total: 0, error: (e as Error).message } }));
    audit('otomatik', 'employees_sync_failed', 'employee', null, { error: (e as Error).message });
  }
}

// ---- kutlama ayarları --------------------------------------------------------------------------

export interface CelebrationSettings {
  /** Kişinin kendi ekranında sabah kart */
  personal: boolean;
  /** Aynı departmandaki bilgisayarlara "Bugün X'in doğum günü" kartı (açık rızaya dayanır; varsayılan kapalı) */
  team: boolean;
  /** Kiosk/TV ekranlarında günün kutlamaları (bilgisayarı olmayanlar için) */
  kiosk: boolean;
  /** Kıdem yıl dönümü ve hoş geldin kartları */
  anniversaries: boolean;
}

export const DEFAULT_CELEBRATIONS: CelebrationSettings = { personal: true, team: false, kiosk: true, anniversaries: true };

export function celebrationSettings(): CelebrationSettings {
  try {
    return { ...DEFAULT_CELEBRATIONS, ...(JSON.parse(getSetting('celebrations') ?? '{}') as Partial<CelebrationSettings>) };
  } catch {
    return DEFAULT_CELEBRATIONS;
  }
}

// ---- yollar ----------------------------------------------------------------------------------

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

const manualInput = z.object({
  fullName: z.string().trim().min(2, 'Ad soyad gerekli').max(120),
  username: optText(64),
  employeeNo: optText(32),
  birthMd: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const r = toMonthDay(v);
      if (!r) ctx.addIssue({ code: 'custom', message: 'Doğum günü GG.AA biçiminde olmalı' });
      return r;
    }),
  startDate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const r = toDate(v);
      if (!r) ctx.addIssue({ code: 'custom', message: 'İşe giriş tarihi GG.AA.YYYY biçiminde olmalı' });
      return r;
    }),
  department: optText(80),
  location: optText(80),
  celebrate: z.boolean().default(true),
});

const uniqueError = (e: unknown) =>
  /UNIQUE.*username/i.test(String(e)) ? 'Bu kullanıcı adı başka bir kayıtta var' : /UNIQUE.*employee_no/i.test(String(e)) ? 'Bu sicil numarası başka bir kayıtta var' : null;

export async function employeeRoutes(app: FastifyInstance) {
  const guard = { preHandler: [requireRole('ik'), requireModule('ik')] };

  app.get('/api/employees', guard, async () => ({
    items: (db.prepare('SELECT * FROM employees ORDER BY full_name COLLATE NOCASE').all() as EmployeeRow[]).map(dto),
  }));

  /** Önümüzdeki N gün içindeki doğum günleri ve kıdem yıl dönümleri (liste görünümü). */
  app.get('/api/employees/upcoming', guard, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }).parse(req.query);
    const rows = db.prepare('SELECT * FROM employees WHERE celebrate = 1 AND (birth_md IS NOT NULL OR start_date IS NOT NULL)').all() as EmployeeRow[];
    const today = new Date();
    const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const out: { date: string; inDays: number; type: 'birthday' | 'anniversary'; years?: number; employee: ReturnType<typeof dto> }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(base + i * 86400_000);
      const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const iso = d.toISOString().slice(0, 10);
      for (const r of rows) {
        if (r.birth_md === key) out.push({ date: iso, inDays: i, type: 'birthday', employee: dto(r) });
        if (r.start_date && r.start_date.slice(5) === key && r.start_date < iso) {
          out.push({ date: iso, inDays: i, type: 'anniversary', years: d.getUTCFullYear() - Number(r.start_date.slice(0, 4)), employee: dto(r) });
        }
      }
    }
    return { items: out };
  });

  app.post('/api/employees', guard, async (req, reply) => {
    const b = manualInput.parse(req.body);
    const id = uuid();
    try {
      db.prepare(
        `INSERT INTO employees(id, username, employee_no, full_name, birth_md, start_date, department, location, celebrate, source, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?, 'manual', ?)`,
      ).run(id, b.username, b.employeeNo, b.fullName, b.birthMd, b.startDate, b.department, b.location, b.celebrate ? 1 : 0, nowIso());
    } catch (e) {
      const msg = uniqueError(e);
      if (msg) return reply.code(409).send({ error: msg });
      throw e;
    }
    audit(req.user!.username, 'employee_created', 'employee', id, { fullName: b.fullName }, req.ip);
    runDailyAutomation();
    return { item: dto(db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow) };
  });

  app.put('/api/employees/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = manualInput.parse(req.body);
    const ex = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow | undefined;
    if (!ex) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    try {
      // panelden düzenlenen kayıt "elle" olur: sonraki CSV/AD eşitlemesi onu silmez
      db.prepare(
        `UPDATE employees SET username=?, employee_no=?, full_name=?, birth_md=?, start_date=?, department=?, location=?, celebrate=?, source='manual', updated_at=? WHERE id=?`,
      ).run(b.username, b.employeeNo, b.fullName, b.birthMd, b.startDate, b.department, b.location, b.celebrate ? 1 : 0, nowIso(), id);
    } catch (e) {
      const msg = uniqueError(e);
      if (msg) return reply.code(409).send({ error: msg });
      throw e;
    }
    audit(req.user!.username, 'employee_updated', 'employee', id, { fullName: b.fullName }, req.ip);
    runDailyAutomation();
    return { item: dto(db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow) };
  });

  app.patch('/api/employees/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ celebrate: z.boolean() }).parse(req.body);
    const r = db.prepare('UPDATE employees SET celebrate = ?, updated_at = ? WHERE id = ?').run(b.celebrate ? 1 : 0, nowIso(), id);
    if (!r.changes) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    audit(req.user!.username, 'employee_celebrate_changed', 'employee', id, b, req.ip);
    return { ok: true };
  });

  app.delete('/api/employees/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    if (!r.changes) return reply.code(404).send({ error: 'Kayıt bulunamadı' });
    audit(req.user!.username, 'employee_deleted', 'employee', id, undefined, req.ip);
    return { ok: true };
  });

  /** İK sisteminden liste: önce dryRun ile önizleme (tanınan sütunlar, eklenecek/güncellenecek sayıları), sonra uygula. */
  app.post('/api/employees/import', guard, async (req) => {
    const b = z.object({ text: z.string().max(5_000_000), replace: z.boolean().default(false), dryRun: z.boolean().default(true) }).parse(req.body);
    const parsed = parseEmployees(b.text);
    const result = mergeEmployees(parsed.rows, 'csv', { dryRun: b.dryRun, removeMissing: b.replace });
    if (!b.dryRun) {
      audit(req.user!.username, 'employees_imported', 'employee', null, { ...result, rows: parsed.rows.length, errors: parsed.errors.length, replace: b.replace }, req.ip);
      runDailyAutomation();
    }
    return {
      dryRun: b.dryRun,
      mapping: parsed.mapping,
      total: parsed.rows.length,
      withBirthday: parsed.rows.filter((r) => r.birthMd).length,
      withoutPc: parsed.rows.filter((r) => !r.username).length,
      yearsDropped: parsed.yearsDropped,
      ...result,
      errors: parsed.errors.slice(0, 50),
      errorCount: parsed.errors.length,
      sample: parsed.rows.slice(0, 8),
    };
  });

  app.get('/api/employees/sync-settings', guard, async () => ({ ...syncSettings(), ldapReady: ldapSettings().enabled }));

  app.put('/api/employees/sync-settings', guard, async (req) => {
    const b = z
      .object({
        enabled: z.boolean(),
        birthdayAttr: attrName,
        hireDateAttr: attrName,
        employeeNoAttr: attrName,
        departmentAttr: attrName,
        locationAttr: attrName,
        filter: z.string().trim().min(3).max(500).refine((f) => f.startsWith('(') && f.endsWith(')'), 'LDAP filtresi parantezle başlamalı ve bitmeli'),
        removeMissing: z.boolean(),
      })
      .parse(req.body);
    const cur = syncSettings();
    setSetting('employee_sync', JSON.stringify({ ...cur, ...b }));
    audit(req.user!.username, 'employee_sync_settings_updated', 'settings', null, b, req.ip);
    return { ...syncSettings(), ldapReady: ldapSettings().enabled };
  });

  app.post('/api/employees/sync', guard, async (req, reply) => {
    const b = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    try {
      const r = await syncFromLdap(b.dryRun);
      if (!b.dryRun) audit(req.user!.username, 'employees_synced', 'employee', null, { total: r.total, created: r.created, updated: r.updated, removed: r.removed }, req.ip);
      return { dryRun: b.dryRun, ...r };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/celebrations/settings', guard, async () => celebrationSettings());

  app.put('/api/celebrations/settings', guard, async (req) => {
    const b = z.object({ personal: z.boolean(), team: z.boolean(), kiosk: z.boolean(), anniversaries: z.boolean() }).parse(req.body);
    setSetting('celebrations', JSON.stringify(b));
    audit(req.user!.username, 'celebration_settings_updated', 'settings', null, b, req.ip);
    runDailyAutomation();
    return celebrationSettings();
  });
}
