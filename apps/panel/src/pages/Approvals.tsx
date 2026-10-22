// Onaylar: onayımı bekleyen duyurular, gönderdiklerim, vekalet ve (yönetici) kategori bazında onay akışları.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarRange, GitPullRequestArrow, Handshake, Inbox, ListOrdered, Plus, Send, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { ROLE_LABELS, ROLES } from '@ertepano/shared';
import { api, fmtDateTime, useApi } from '../api';
import type { Announcement, ApprovalPolicy, ApprovalState, DirectoryUser } from '../types';
import { approverLabel } from '../components/ApprovalPanel';
import {
  Badge,
  Button,
  CAT,
  Callout,
  Card,
  CardHeader,
  Cat,
  cn,
  EmptyState,
  Field,
  Input,
  listItem,
  Modal,
  PageHeader,
  Select,
  SkeletonCard,
  StatusBadge,
  Switch,
  Tabs,
  useAuth,
  useConfirm,
  useToast,
} from '../ui';

type Row = Announcement & { approval: ApprovalState };

function AnnList({ items, empty }: { items: Row[]; empty: { title: string; description: string } }) {
  const nav = useNavigate();
  if (!items.length) return <EmptyState icon={Inbox} title={empty.title} description={empty.description} />;
  return (
    <div className="divide-y divide-slate-200/60 dark:divide-white/5">
      {items.map((a, i) => {
        const step = a.approval.currentStep != null ? a.approval.steps[a.approval.currentStep] : null;
        return (
          <motion.div
            key={a.id}
            role="link"
            tabIndex={0}
            onClick={() => nav(`/duyurular/${a.id}`)}
            onKeyDown={(e) => e.key === 'Enter' && nav(`/duyurular/${a.id}`)}
            variants={listItem}
            initial="hidden"
            animate="show"
            custom={i}
            className="group flex cursor-pointer items-center gap-4 px-6 py-4 transition-colors hover:bg-slate-900/[0.025] dark:hover:bg-white/[0.03]"
          >
            <span className="text-2xl">{a.emoji ?? '📢'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-slate-900 dark:text-white">{a.title}</span>
                <Cat c={a.category} />
                <StatusBadge s={a.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px] text-slate-500 dark:text-slate-400">
                <span>{a.submittedBy ?? a.createdBy} · {a.submittedAt ? fmtDateTime(a.submittedAt) : '—'}</span>
                {step && <span>Adım {a.approval.currentStep! + 1}/{a.approval.steps.length}: {step.name}</span>}
                {a.approval.approveAs && <Badge tone="violet">{a.approval.approveAs} adına</Badge>}
                {a.status === 'rejected' && a.rejectedReason && <span className="text-rose-600 dark:text-rose-400">Ret: {a.rejectedReason}</span>}
              </div>
            </div>
            <ArrowRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1" />
          </motion.div>
        );
      })}
    </div>
  );
}

// ---- vekalet ----

interface Delegation {
  id: string;
  from: { id: string; username: string; fullName: string };
  to: { id: string; username: string; fullName: string };
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdBy: string;
  revokedAt: string | null;
  active: boolean;
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Delegations({ users }: { users: DirectoryUser[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { data, reload } = useApi<{ items: Delegation[] }>('/api/delegations');
  const [form, setForm] = useState<{ fromUserId: string; toUserId: string; startsAt: string; endsAt: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = () => {
    const now = new Date();
    setForm({ fromUserId: user.id, toUserId: '', startsAt: localInput(now), endsAt: localInput(new Date(now.getTime() + 7 * 86400_000)), reason: '' });
  };
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await api('/api/delegations', {
        body: { ...form, fromUserId: user.role === 'admin' ? form.fromUserId : undefined, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), reason: form.reason || undefined },
      });
      toast('Vekalet verildi');
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (d: Delegation) => {
    if (!(await confirm({ title: 'Vekalet kaldırılsın mı?', description: `${d.to.fullName} artık ${d.from.fullName} adına onay veremez.`, confirmLabel: 'Kaldır', tone: 'danger' }))) return;
    try {
      await api(`/api/delegations/${d.id}/revoke`, { method: 'POST' });
      toast('Vekalet kaldırıldı');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <Card>
        <CardHeader
          icon={Handshake}
          title="Vekalet"
          description="İzin, rapor ya da seyahatte onay yetkinizi belirli bir süre için başka birine devredin. Vekil onayları “X adına” kaydedilir."
          action={<Button variant="primary" icon={UserPlus} onClick={open}>Vekalet ver</Button>}
        />
        {!data ? (
          <div className="px-6 pb-6"><SkeletonCard rows={2} /></div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={Handshake} title="Vekalet yok" description="Yokken onay bekleyen duyurular sizi beklemesin." />
        ) : (
          <div className="divide-y divide-slate-200/60 dark:divide-white/5">
            {data.items.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[14px]">
                    <b className="text-slate-900 dark:text-white">{d.from.fullName}</b>
                    <ArrowRight size={14} className="text-slate-400" />
                    <b className="text-slate-900 dark:text-white">{d.to.fullName}</b>
                    {d.revokedAt ? <Badge>Kaldırıldı</Badge> : d.active ? <Badge tone="success" dot>Yürürlükte</Badge> : Date.parse(d.endsAt) < Date.now() ? <Badge>Süresi doldu</Badge> : <Badge tone="info">Planlandı</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[12.5px] text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1.5"><CalendarRange size={13} /> {fmtDateTime(d.startsAt)} → {fmtDateTime(d.endsAt)}</span>
                    {d.reason && <span>{d.reason}</span>}
                    <span>veren: {d.createdBy}</span>
                  </div>
                </div>
                {!d.revokedAt && Date.parse(d.endsAt) > Date.now() && (
                  <Button variant="ghost" size="sm" icon={X} onClick={() => revoke(d)}>Kaldır</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal
        open={!!form}
        title="Vekalet ver"
        description="Vekil, bu süre içinde sizin onaycı olduğunuz adımları sizin adınıza onaylayabilir. Vekalet başkasına devredilemez."
        onClose={() => setForm(null)}
        footer={<Button variant="primary" icon={Handshake} loading={busy} disabled={!form?.toUserId} onClick={save}>Vekalet ver</Button>}
      >
        {form && (
          <div className="space-y-5">
            {user.role === 'admin' && (
              <Field label="Yetkisini devreden">
                <Select value={form.fromUserId} onChange={(e) => setForm({ ...form, fromUserId: e.target.value })}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>)}
                </Select>
              </Field>
            )}
            <Field label="Vekil">
              <Select value={form.toUserId} onChange={(e) => setForm({ ...form, toUserId: e.target.value })} placeholder="Kişi seçin">
                {users.filter((u) => u.id !== form.fromUserId).map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username} · {ROLE_LABELS[u.role]})</option>)}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Başlangıç"><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
              <Field label="Bitiş" hint="en fazla 3 ay"><Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
            </div>
            <Field label="Gerekçe" hint="isteğe bağlı"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Örn: Yıllık izin" /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---- onay akışları (yönetici) ----

type Step = ApprovalPolicy['steps'][number];

function PolicyEditor({ p, users, canEdit, onSaved }: { p: ApprovalPolicy; users: DirectoryUser[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(p);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(p), [p]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p);

  const setStep = (i: number, s: Partial<Step>) => setDraft({ ...draft, steps: draft.steps.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/approval-policies/${p.category}`, { method: 'PUT', body: { enabled: draft.enabled, allowSelf: draft.allowSelf, steps: draft.steps } });
      toast(`${p.label} onay akışı kaydedildi`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn(draft.enabled && 'ring-1 ring-emerald-500/30')}>
      <CardHeader
        title={<span className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-full', CAT[p.category].dot)} /> {p.label}</span>}
        description={draft.enabled ? `${draft.steps.length} adımlı onay` : 'Onaysız yayın'}
        action={canEdit && dirty && <Button size="sm" variant="primary" loading={busy} onClick={save}>Kaydet</Button>}
      />
      <div className="space-y-4 px-6 pb-6">
        <Switch checked={draft.enabled} onChange={(v) => canEdit && setDraft({ ...draft, enabled: v, steps: v && !draft.steps.length ? [{ name: 'Birim müdürü', approvers: [], min: 1 }] : draft.steps })} label="Yayından önce onay gerekli" />
        {draft.enabled && (
          <>
            {draft.steps.map((s, i) => (
              <div key={i} className="space-y-3 rounded-2xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-500 to-teal-600 text-[12px] font-bold text-white">{i + 1}</span>
                  <Input value={s.name} disabled={!canEdit} onChange={(e) => setStep(i, { name: e.target.value })} placeholder="Adım adı (ör. İK müdürü)" />
                  <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-slate-500">
                    En az
                    <Input type="number" min={1} max={10} value={s.min} disabled={!canEdit} onChange={(e) => setStep(i, { min: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="w-16" />
                    onay
                  </label>
                  {canEdit && <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })} aria-label="Adımı sil" />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {s.approvers.map((a) => (
                    <Badge key={a} tone={a.startsWith('role:') ? 'info' : 'violet'}>
                      {approverLabel(a)}
                      {canEdit && (
                        <button className="ml-1 opacity-60 hover:opacity-100" aria-label="Kaldır" onClick={() => setStep(i, { approvers: s.approvers.filter((x) => x !== a) })}>
                          ×
                        </button>
                      )}
                    </Badge>
                  ))}
                  {canEdit && (
                    <div className="w-64">
                      <Select value="" placeholder="+ Onaycı ekle" onChange={(e) => e.target.value && !s.approvers.includes(e.target.value) && setStep(i, { approvers: [...s.approvers, e.target.value] })}>
                        {users.map((u) => <option key={u.id} value={`user:${u.username}`}>{u.fullName} ({u.username})</option>)}
                        {ROLES.map((r) => <option key={r} value={`role:${r}`}>Rol: {ROLE_LABELS[r]} (herhangi biri)</option>)}
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {canEdit && draft.steps.length < 5 && (
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { name: '', approvers: [], min: 1 }] })}>
                Adım ekle
              </Button>
            )}
            <Switch checked={draft.allowSelf} onChange={(v) => canEdit && setDraft({ ...draft, allowSelf: v })} label="Hazırlayan kendi duyurusunu onaylayabilir" description="Önerilmez; tek kişilik ekipler için" />
          </>
        )}
        {p.updatedBy && <div className="text-[12px] text-slate-400">Son değişiklik: {p.updatedBy} · {p.updatedAt ? fmtDateTime(p.updatedAt) : ''}</div>}
      </div>
    </Card>
  );
}

function Policies({ users }: { users: DirectoryUser[] }) {
  const { user } = useAuth();
  const { data, reload } = useApi<{ items: ApprovalPolicy[] }>('/api/approval-policies');
  const canEdit = user.role === 'admin';
  return (
    <div className="space-y-6">
      <Callout tone="info" icon={ShieldCheck} title="Nasıl çalışır?">
        Onay gereken kategoride “Yayınla” yerine “Onaya gönder” çıkar. Adımlar sırayla ilerler; son adım onaylanınca duyuru yayına girer.
        Hazırlayan kendi duyurusunu onaylayamaz, bir kişi aynı turda yalnızca bir adımı onaylar. Onaydan sonra içerik değişirse yeniden onay gerekir.
        Acil durum yayınları ve otomatik kutlamalar onay beklemez.
      </Callout>
      {!canEdit && <Callout tone="warning">Onay akışlarını yalnızca yönetici değiştirebilir.</Callout>}
      {!data ? (
        <SkeletonCard rows={4} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.items.map((p) => <PolicyEditor key={p.category} p={p} users={users} canEdit={canEdit} onSaved={reload} />)}
        </div>
      )}
    </div>
  );
}

export function Approvals() {
  const { user } = useAuth();
  const inbox = useApi<{ waiting: Row[]; mine: Row[] }>('/api/approvals/inbox', 20000);
  const dir = useApi<{ items: DirectoryUser[] }>('/api/users/directory');
  const [tab, setTab] = useState<'waiting' | 'mine' | 'delegations' | 'policies'>('waiting');
  const users = dir.data?.items ?? [];
  const w = inbox.data?.waiting.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={<><GitPullRequestArrow size={14} /> Onay süreci</>}
        title="Onaylar"
        description="Yayından önce yetkili onayı, çok adımlı akış ve vekalet."
      />
      <Tabs
        className="mb-8"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'waiting', label: `Onayımı bekleyenler${w ? ` (${w})` : ''}`, icon: Inbox },
          { value: 'mine', label: 'Gönderdiklerim', icon: Send },
          { value: 'delegations', label: 'Vekalet', icon: Handshake },
          { value: 'policies', label: user.role === 'admin' ? 'Onay akışları' : 'Akışlar', icon: ListOrdered },
        ]}
      />
      {tab === 'waiting' && (
        <Card className="overflow-hidden">
          {!inbox.data ? <div className="p-6"><SkeletonCard rows={3} /></div> : (
            <AnnList items={inbox.data.waiting} empty={{ title: 'Bekleyen onay yok', description: 'Onayınıza düşen duyurular burada görünür.' }} />
          )}
        </Card>
      )}
      {tab === 'mine' && (
        <Card className="overflow-hidden">
          {!inbox.data ? <div className="p-6"><SkeletonCard rows={3} /></div> : (
            <AnnList items={inbox.data.mine} empty={{ title: 'Onayda duyurunuz yok', description: 'Onaya gönderdiğiniz ya da reddedilen duyurular burada izlenir.' }} />
          )}
        </Card>
      )}
      {tab === 'delegations' && <Delegations users={users} />}
      {tab === 'policies' && <Policies users={users} />}
    </>
  );
}
