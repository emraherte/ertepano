/**
 * Duyuru onay akışı. Kategori başına (İK / İSG / IT / Genel) sıralı adımlar tanımlanır; her adımda onaycılar
 * (kişi ya da rol) ve gereken onay sayısı vardır (ör. "İK müdürü: 1 onay" → "Genel müdür: 1 onay").
 * Son adım onaylanınca duyuru yayına girer (başlangıç zamanı gelecekteyse planlanır).
 *
 * Kurallar
 * - Görevler ayrılığı: duyuruyu hazırlayan onaylayamaz (politika izin vermedikçe); aynı kişi bir turda yalnızca bir
 *   kez onay verir (iki adımı tek başına geçemez).
 * - Vekalet: onaycı, belirli bir tarih aralığı için yetkisini başka bir panel kullanıcısına devreder (izin, rapor…).
 *   Vekil onayı denetim kaydına "X adına Y" olarak yazılır. Vekalet devredilemez (tek seviye).
 * - Onaydan sonra içerik değişirse yeniden onay gerekir; yalnızca bitiş zamanını değiştirmek onayı bozmaz.
 * - Acil durum (tam ekran) yayınları ve otomatik kutlamalar onay beklemez — can güvenliği gecikmeye gelmez,
 *   otomatik kutlamaların kuralları İK yetkisindedir.
 */
import type { FastifyInstance } from 'fastify';
import { CATEGORIES, CATEGORY_LABELS, type Category, ROLES, type Role } from '@ertepano/shared';
import { z } from 'zod';
import { requireRole, type SessionUser } from './auth.js';
import { audit, db, nowIso } from './db.js';
import { annDto, type AnnRow } from './announcements.js';
import { publish } from './lifecycle.js';
import { revokeAnnouncement } from './hub.js';
import { uuid } from './security.js';

export interface ApprovalStep {
  name: string;
  /** "user:ayse.demir" ya da "role:ik" */
  approvers: string[];
  /** bu adımda gereken farklı kişi onayı */
  min: number;
}

export interface ApprovalPolicy {
  category: Category;
  enabled: boolean;
  steps: ApprovalStep[];
  /** hazırlayan kendi duyurusunu onaylayabilir (küçük ekipler) */
  allowSelf: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface PolicyRow {
  category: Category;
  enabled: number;
  steps: string;
  allow_self: number;
  updated_by: string | null;
  updated_at: string | null;
}

interface ApprovalRow {
  id: string;
  announcement_id: string;
  round: number;
  step: number;
  user_id: string;
  username: string;
  on_behalf_of: string | null;
  decision: 'approved' | 'rejected';
  note: string | null;
  created_at: string;
}

interface UserLite {
  id: string;
  username: string;
  full_name: string;
  role: Role;
}

const getAnn = (id: string) => db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnRow | undefined;
const activeUser = (id: string) =>
  db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ? AND is_active = 1').get(id) as UserLite | undefined;

export function getPolicy(category: Category): ApprovalPolicy {
  const r = db.prepare('SELECT * FROM approval_policies WHERE category = ?').get(category) as PolicyRow | undefined;
  return {
    category,
    enabled: !!r?.enabled,
    steps: r ? (JSON.parse(r.steps) as ApprovalStep[]) : [],
    allowSelf: !!r?.allow_self,
    updatedBy: r?.updated_by ?? null,
    updatedAt: r?.updated_at ?? null,
  };
}

/** Bu kategoride yayın onaya tabi mi? */
export const approvalRequired = (category: Category) => {
  const p = getPolicy(category);
  return p.enabled && p.steps.length > 0;
};

// ---- vekalet -----------------------------------------------------------------------------------

/** Kullanıcının şu an adına onay verebileceği kişiler (kendisi + yürürlükteki vekaletler). */
function principals(u: SessionUser): { user: UserLite; onBehalfOf: UserLite | null }[] {
  const me = { id: u.id, username: u.username, full_name: u.fullName, role: u.role };
  const now = nowIso();
  const from = db
    .prepare('SELECT from_user_id FROM delegations WHERE to_user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND ends_at > ?')
    .all(u.id, now, now) as { from_user_id: string }[];
  const out: { user: UserLite; onBehalfOf: UserLite | null }[] = [{ user: me, onBehalfOf: null }];
  for (const f of from) {
    const d = activeUser(f.from_user_id);
    if (d && d.id !== u.id) out.push({ user: d, onBehalfOf: d });
  }
  return out;
}

const matches = (u: UserLite, step: ApprovalStep) =>
  step.approvers.some((a) => a.toLowerCase() === `user:${u.username.toLowerCase()}` || a === `role:${u.role}`);

/** Adımdaki onaycılar arasında en az bir etkin kullanıcı var mı (yoksa duyuru sonsuza dek bekler). */
function stepHasApprover(step: ApprovalStep) {
  const users = db.prepare('SELECT id, username, full_name, role FROM users WHERE is_active = 1').all() as UserLite[];
  return users.filter((u) => matches(u, step)).length >= step.min;
}

// ---- durum -------------------------------------------------------------------------------------

function roundApprovals(a: AnnRow) {
  return db
    .prepare('SELECT * FROM approvals WHERE announcement_id = ? AND round = ? ORDER BY created_at')
    .all(a.id, a.approval_round) as ApprovalRow[];
}

const author = (a: AnnRow) => (a.submitted_by ?? a.created_by ?? '').toLowerCase();

/** Kullanıcı bu duyurunun şu anki adımını onaylayabilir mi; evet ise kimin adına. */
export function canApprove(a: AnnRow, u: SessionUser): { ok: true; as: UserLite; onBehalfOf: UserLite | null } | { ok: false; reason: string } {
  if (a.status !== 'pending') return { ok: false, reason: 'Duyuru onay beklemiyor' };
  const policy = getPolicy(a.category);
  const step = policy.steps[a.approval_step];
  if (!step) return { ok: false, reason: 'Onay adımı bulunamadı' };
  const done = roundApprovals(a).filter((x) => x.decision === 'approved');
  const usedIds = new Set(done.flatMap((x) => [x.user_id, ...(x.on_behalf_of ? [x.on_behalf_of] : [])]));
  const usedNames = new Set(done.flatMap((x) => [x.username.toLowerCase(), ...(x.on_behalf_of ? [x.on_behalf_of.toLowerCase()] : [])]));
  let reason = 'Bu adımın onaycıları arasında değilsiniz';
  for (const p of principals(u)) {
    if (!matches(p.user, step)) continue;
    if (!policy.allowSelf && (p.user.username.toLowerCase() === author(a) || u.username.toLowerCase() === author(a))) {
      reason = 'Kendi hazırladığınız duyuruyu onaylayamazsınız';
      continue;
    }
    if (usedIds.has(u.id) || usedNames.has(u.username.toLowerCase()) || usedNames.has(p.user.username.toLowerCase())) {
      reason = 'Bu turda zaten onay verdiniz';
      continue;
    }
    return { ok: true, as: p.user, onBehalfOf: p.onBehalfOf };
  }
  return { ok: false, reason };
}

export function approvalState(a: AnnRow, u?: SessionUser) {
  const policy = getPolicy(a.category);
  const all = db.prepare('SELECT * FROM approvals WHERE announcement_id = ? ORDER BY created_at').all(a.id) as ApprovalRow[];
  const current = all.filter((x) => x.round === a.approval_round);
  const check = u ? canApprove(a, u) : null;
  const inFlow = ['pending', 'rejected'].includes(a.status) || a.approval_round > 0;
  return {
    required: policy.enabled && policy.steps.length > 0,
    round: a.approval_round,
    currentStep: a.status === 'pending' ? a.approval_step : null,
    steps: policy.steps.map((s, i) => {
      const got = current.filter((x) => x.step === i && x.decision === 'approved');
      return {
        name: s.name,
        min: s.min,
        approvers: s.approvers,
        approvals: got.map((x) => ({ username: x.username, onBehalfOf: x.on_behalf_of, note: x.note, at: x.created_at })),
        state: !inFlow ? 'idle' : a.status === 'pending' && i === a.approval_step ? 'current' : got.length >= s.min || (a.status !== 'pending' && a.status !== 'rejected' && a.approval_round > 0) ? 'done' : 'waiting',
      };
    }),
    history: all.map((x) => ({ round: x.round, step: x.step, username: x.username, onBehalfOf: x.on_behalf_of, decision: x.decision, note: x.note, at: x.created_at })),
    canApprove: !!check?.ok,
    approveAs: check?.ok ? (check.onBehalfOf ? check.onBehalfOf.username : null) : null,
    reason: check && !check.ok ? check.reason : null,
  };
}

// ---- geçişler ----------------------------------------------------------------------------------

/**
 * Yayın isteği: onay gerekmiyorsa doğrudan yayınlar, gerekiyorsa yeni bir onay turu açar.
 * Dönüş: güncel satır ya da hata metni.
 */
export function submitForPublish(id: string, u: SessionUser, ip?: string): AnnRow | string {
  const a = getAnn(id);
  if (!a) return 'Duyuru bulunamadı';
  if (a.status === 'ended') return 'Biten duyuru yayınlanamaz';
  if (a.ends_at && a.ends_at <= nowIso()) return 'Bitiş zamanı geçmiş; tarihleri güncelleyin';
  const policy = getPolicy(a.category);
  if (!policy.enabled || !policy.steps.length) {
    const row = publish(id)!;
    audit(u.username, 'announcement_published', 'announcement', id, undefined, ip);
    return row;
  }
  if (a.status === 'pending') return a;
  const missing = policy.steps.find((s) => !stepHasApprover(s));
  if (missing) return `"${missing.name}" adımında yeterli etkin onaycı yok. Yönetici onay akışını güncellemeli.`;
  const now = nowIso();
  db.prepare(
    "UPDATE announcements SET status = 'pending', approval_round = approval_round + 1, approval_step = 0, submitted_by = ?, submitted_at = ?, rejected_reason = NULL, updated_at = ? WHERE id = ?",
  ).run(u.username, now, now, id);
  audit(u.username, 'announcement_submitted', 'announcement', id, { steps: policy.steps.map((s) => s.name) }, ip);
  return getAnn(id)!;
}

/** Onaydan sonra içerik değişti: yayından kaldır, yeni onay turu aç. */
export function requireReapproval(id: string, u: SessionUser, ip?: string) {
  const a = getAnn(id);
  if (!a || !['scheduled', 'active', 'pending'].includes(a.status)) return;
  if (a.status === 'active') revokeAnnouncement(id);
  const now = nowIso();
  db.prepare(
    "UPDATE announcements SET status = 'pending', approval_round = approval_round + 1, approval_step = 0, submitted_by = ?, submitted_at = ?, updated_at = ? WHERE id = ?",
  ).run(u.username, now, now, id);
  audit(u.username, 'announcement_resubmitted', 'announcement', id, { reason: 'içerik onaydan sonra değişti' }, ip);
}

function approve(a: AnnRow, u: SessionUser, note: string | null, ip?: string): AnnRow | string {
  const c = canApprove(a, u);
  if (!c.ok) return c.reason;
  if (a.ends_at && a.ends_at <= nowIso()) return 'Bitiş zamanı geçmiş; hazırlayan tarihleri güncellemeli';
  const policy = getPolicy(a.category);
  const step = policy.steps[a.approval_step];
  db.prepare(
    "INSERT INTO approvals(id, announcement_id, round, step, user_id, username, on_behalf_of, decision, note, created_at) VALUES(?,?,?,?,?,?,?,'approved',?,?)",
  ).run(uuid(), a.id, a.approval_round, a.approval_step, u.id, u.username, c.onBehalfOf?.username ?? null, note, nowIso());
  audit(u.username, 'announcement_approved', 'announcement', a.id, { step: step.name, onBehalfOf: c.onBehalfOf?.username ?? null, note }, ip);
  const got = roundApprovals(a).filter((x) => x.step === a.approval_step && x.decision === 'approved').length;
  if (got < step.min) return getAnn(a.id)!;
  if (a.approval_step + 1 < policy.steps.length) {
    db.prepare('UPDATE announcements SET approval_step = approval_step + 1, updated_at = ? WHERE id = ?').run(nowIso(), a.id);
    return getAnn(a.id)!;
  }
  const row = publish(a.id)!;
  audit(u.username, 'announcement_published', 'announcement', a.id, { by: 'onay akışı' }, ip);
  return row;
}

function reject(a: AnnRow, u: SessionUser, reason: string, ip?: string): AnnRow | string {
  const c = canApprove(a, u);
  if (!c.ok) return c.reason;
  db.prepare(
    "INSERT INTO approvals(id, announcement_id, round, step, user_id, username, on_behalf_of, decision, note, created_at) VALUES(?,?,?,?,?,?,?,'rejected',?,?)",
  ).run(uuid(), a.id, a.approval_round, a.approval_step, u.id, u.username, c.onBehalfOf?.username ?? null, reason, nowIso());
  db.prepare("UPDATE announcements SET status = 'rejected', rejected_reason = ?, updated_at = ? WHERE id = ?").run(reason, nowIso(), a.id);
  audit(u.username, 'announcement_rejected', 'announcement', a.id, { reason, onBehalfOf: c.onBehalfOf?.username ?? null }, ip);
  return getAnn(a.id)!;
}

/** Kullanıcının onayını bekleyen duyurular */
export function inboxFor(u: SessionUser): AnnRow[] {
  const rows = db.prepare("SELECT * FROM announcements WHERE status = 'pending' ORDER BY submitted_at").all() as AnnRow[];
  return rows.filter((a) => canApprove(a, u).ok);
}

// ---- yollar ------------------------------------------------------------------------------------

const approverRef = z.string().regex(/^(user:[\w.@-]{1,64}|role:[a-z]+)$/, 'Onaycı "user:kullanici" ya da "role:rol" olmalı');

const policyInput = z.object({
  enabled: z.boolean(),
  allowSelf: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        name: z.string().trim().min(2, 'Adım adı gerekli').max(60),
        approvers: z.array(approverRef).min(1, 'Her adımda en az bir onaycı olmalı').max(20),
        min: z.number().int().min(1).max(10),
      }),
    )
    .max(5),
});

const handle = (r: AnnRow | string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
  typeof r === 'string' ? reply.code(400).send({ error: r }) : { item: annDto(r) };

export async function approvalRoutes(app: FastifyInstance) {
  app.get('/api/approval-policies', { preHandler: requireRole() }, async () => ({
    items: CATEGORIES.map((c) => ({ ...getPolicy(c), label: CATEGORY_LABELS[c] })),
  }));

  app.put('/api/approval-policies/:category', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { category } = req.params as { category: string };
    if (!(CATEGORIES as readonly string[]).includes(category)) return reply.code(404).send({ error: 'Kategori yok' });
    const b = policyInput.parse(req.body);
    for (const s of b.steps) {
      const roles = s.approvers.filter((a) => a.startsWith('role:')).map((a) => a.slice(5));
      const bad = roles.find((r) => !(ROLES as readonly string[]).includes(r));
      if (bad) return reply.code(400).send({ error: `Bilinmeyen rol: ${bad}` });
      if (b.enabled && !stepHasApprover(s)) {
        return reply.code(400).send({ error: `"${s.name}" adımında en az ${s.min} etkin onaycı bulunmalı` });
      }
    }
    if (b.enabled && !b.steps.length) return reply.code(400).send({ error: 'Onay akışını açmak için en az bir adım ekleyin' });
    db.prepare(
      `INSERT INTO approval_policies(category, enabled, steps, allow_self, updated_by, updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(category) DO UPDATE SET enabled=excluded.enabled, steps=excluded.steps, allow_self=excluded.allow_self,
         updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    ).run(category, b.enabled ? 1 : 0, JSON.stringify(b.steps), b.allowSelf ? 1 : 0, req.user!.username, nowIso());
    audit(req.user!.username, 'approval_policy_updated', 'settings', category, b, req.ip);
    return { item: { ...getPolicy(category as Category), label: CATEGORY_LABELS[category as Category] } };
  });

  /** Onayımı bekleyenler + benim gönderdiğim ve bekleyenler */
  app.get('/api/approvals/inbox', { preHandler: requireRole() }, async (req) => {
    const u = req.user!;
    const mine = db
      .prepare("SELECT * FROM announcements WHERE status IN ('pending','rejected') AND submitted_by = ? COLLATE NOCASE ORDER BY submitted_at DESC")
      .all(u.username) as AnnRow[];
    return {
      waiting: inboxFor(u).map((a) => ({ ...annDto(a), approval: approvalState(a, u) })),
      mine: mine.map((a) => ({ ...annDto(a), approval: approvalState(a, u) })),
    };
  });

  app.post('/api/announcements/:id/approve', { preHandler: requireRole() }, async (req, reply) => {
    const a = getAnn((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    return handle(approve(a, req.user!, b.note || null, req.ip), reply);
  });

  app.post('/api/announcements/:id/reject', { preHandler: requireRole() }, async (req, reply) => {
    const a = getAnn((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    const b = z.object({ reason: z.string().trim().min(5, 'Ret gerekçesi yazın (en az 5 karakter)').max(500) }).parse(req.body);
    return handle(reject(a, req.user!, b.reason, req.ip), reply);
  });

  /** Hazırlayan onay isteğini geri çeker (taslağa döner) */
  app.post('/api/announcements/:id/withdraw', { preHandler: requireRole('ik', 'isg', 'it') }, async (req, reply) => {
    const a = getAnn((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'Duyuru bulunamadı' });
    if (!['pending', 'rejected'].includes(a.status)) return reply.code(400).send({ error: 'Duyuru onay sürecinde değil' });
    if (author(a) !== req.user!.username.toLowerCase() && req.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Yalnızca hazırlayan geri çekebilir' });
    }
    db.prepare("UPDATE announcements SET status = 'draft', updated_at = ? WHERE id = ?").run(nowIso(), a.id);
    audit(req.user!.username, 'announcement_withdrawn', 'announcement', a.id, undefined, req.ip);
    return { item: annDto(getAnn(a.id)!) };
  });

  // ---- kullanıcı rehberi (onaycı / vekil seçimi) ----
  app.get('/api/users/directory', { preHandler: requireRole() }, async () => ({
    items: db.prepare('SELECT id, username, full_name fullName, role FROM users WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE').all(),
  }));

  // ---- vekalet ----
  const delegationDto = (r: Record<string, unknown>) => ({
    id: r.id,
    from: { id: r.from_user_id, username: r.from_username, fullName: r.from_name },
    to: { id: r.to_user_id, username: r.to_username, fullName: r.to_name },
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by,
    active: !r.revoked_at && String(r.starts_at) <= nowIso() && String(r.ends_at) > nowIso(),
  });
  const DELEGATION_SQL = `SELECT d.*, f.username from_username, f.full_name from_name, t.username to_username, t.full_name to_name
    FROM delegations d JOIN users f ON f.id = d.from_user_id JOIN users t ON t.id = d.to_user_id`;

  app.get('/api/delegations', { preHandler: requireRole() }, async (req) => {
    const u = req.user!;
    const rows =
      u.role === 'admin'
        ? db.prepare(`${DELEGATION_SQL} ORDER BY d.created_at DESC LIMIT 200`).all()
        : db.prepare(`${DELEGATION_SQL} WHERE d.from_user_id = ? OR d.to_user_id = ? ORDER BY d.created_at DESC LIMIT 200`).all(u.id, u.id);
    return { items: (rows as Record<string, unknown>[]).map(delegationDto) };
  });

  app.post('/api/delegations', { preHandler: requireRole() }, async (req, reply) => {
    const u = req.user!;
    const b = z
      .object({
        fromUserId: z.string().optional(),
        toUserId: z.string(),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        reason: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const fromId = b.fromUserId && u.role === 'admin' ? b.fromUserId : u.id;
    if (b.fromUserId && b.fromUserId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'Yalnızca kendi yetkinizi devredebilirsiniz' });
    const from = activeUser(fromId);
    const to = activeUser(b.toUserId);
    if (!from || !to) return reply.code(404).send({ error: 'Kullanıcı bulunamadı ya da pasif' });
    if (from.id === to.id) return reply.code(400).send({ error: 'Kişi kendine vekalet veremez' });
    const start = new Date(b.startsAt).toISOString();
    const end = new Date(b.endsAt).toISOString();
    if (end <= start) return reply.code(400).send({ error: 'Bitiş başlangıçtan sonra olmalı' });
    if (end <= nowIso()) return reply.code(400).send({ error: 'Bitiş geçmişte olamaz' });
    if (Date.parse(end) - Date.parse(start) > 92 * 86400_000) return reply.code(400).send({ error: 'Vekalet en fazla 3 ay olabilir' });
    const id = uuid();
    db.prepare(
      'INSERT INTO delegations(id, from_user_id, to_user_id, starts_at, ends_at, reason, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(id, from.id, to.id, start, end, b.reason ?? null, u.username, nowIso());
    audit(u.username, 'delegation_created', 'delegation', id, { from: from.username, to: to.username, startsAt: start, endsAt: end, reason: b.reason }, req.ip);
    return { item: delegationDto(db.prepare(`${DELEGATION_SQL} WHERE d.id = ?`).get(id) as Record<string, unknown>) };
  });

  app.post('/api/delegations/:id/revoke', { preHandler: requireRole() }, async (req, reply) => {
    const u = req.user!;
    const { id } = req.params as { id: string };
    const d = db.prepare('SELECT * FROM delegations WHERE id = ?').get(id) as { from_user_id: string; to_user_id: string; revoked_at: string | null } | undefined;
    if (!d) return reply.code(404).send({ error: 'Vekalet bulunamadı' });
    if (u.role !== 'admin' && d.from_user_id !== u.id && d.to_user_id !== u.id) return reply.code(403).send({ error: 'Bu vekaleti yalnızca veren, alan ya da yönetici kaldırabilir' });
    if (d.revoked_at) return reply.code(400).send({ error: 'Vekalet zaten kaldırılmış' });
    db.prepare('UPDATE delegations SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(nowIso(), u.username, id);
    audit(u.username, 'delegation_revoked', 'delegation', id, undefined, req.ip);
    return { ok: true };
  });
}
