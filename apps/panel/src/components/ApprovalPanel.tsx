// Duyuru ayrıntısında onay akışı: adımlar, kim ne zaman onayladı (vekaleten dahil), onayla / reddet / geri çek.
import { useState } from 'react';
import { Check, CircleDashed, Clock, GitPullRequestArrow, Undo2, UserCheck, X } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@ertepano/shared';
import { api, fmtDateTime } from '../api';
import type { Announcement, ApprovalState } from '../types';
import { Badge, Button, Callout, Card, CardHeader, cn, Field, Modal, Textarea, useAuth, useToast } from '../ui';

export function approverLabel(a: string) {
  if (a.startsWith('role:')) return `${ROLE_LABELS[a.slice(5) as Role] ?? a.slice(5)} (rol)`;
  return a.replace(/^user:/, '');
}

const STEP_STYLE = {
  done: 'bg-emerald-500 text-white shadow-emerald-500/30',
  current: 'bg-amber-500 text-white shadow-amber-500/30 animate-pulse',
  waiting: 'bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400',
  idle: 'bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400',
} as const;

export function ApprovalPanel({ a, approval, onChange }: { a: Announcement; approval: ApprovalState; onChange: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (!approval.required && approval.round === 0) return null;
  const author = (a.submittedBy ?? a.createdBy ?? '').toLowerCase();
  const isAuthor = author === user.username.toLowerCase();

  const call = async (path: string, body: unknown, msg: string) => {
    setBusy(path);
    try {
      await api(`/api/announcements/${a.id}/${path}`, { body });
      toast(msg);
      setNote('');
      setReason('');
      setRejecting(false);
      onChange();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const lastReject = [...approval.history].reverse().find((h) => h.decision === 'rejected' && h.round === approval.round);

  return (
    <Card className={cn(a.status === 'pending' && 'ring-2 ring-amber-500/30')}>
      <CardHeader
        icon={GitPullRequestArrow}
        title="Onay akışı"
        description={
          a.status === 'pending'
            ? `Tur ${approval.round} · ${a.submittedBy ?? '—'} gönderdi ${a.submittedAt ? fmtDateTime(a.submittedAt) : ''}`
            : a.status === 'rejected'
              ? 'Reddedildi — düzenleyip yeniden gönderin'
              : approval.round > 0
                ? `Tur ${approval.round} onaylandı`
                : 'Yayınlanırken bu adımlardan geçer'
        }
      />
      <div className="space-y-5 px-6 pb-6">
        {a.status === 'rejected' && lastReject && (
          <Callout tone="danger" title={`${lastReject.username}${lastReject.onBehalfOf ? ` (${lastReject.onBehalfOf} adına)` : ''} reddetti`}>
            {lastReject.note}
          </Callout>
        )}

        <ol className="relative space-y-4">
          {approval.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold shadow-md', STEP_STYLE[s.state])}>
                {s.state === 'done' ? <Check size={14} /> : s.state === 'current' ? <Clock size={14} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-900 dark:text-white">{s.name}</span>
                  {s.min > 1 && <Badge>{s.min} onay</Badge>}
                </div>
                <div className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">{s.approvers.map(approverLabel).join(' · ')}</div>
                {s.approvals.map((x, j) => (
                  <div key={j} className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-emerald-700 dark:text-emerald-300">
                    <UserCheck size={13} /> {x.username}
                    {x.onBehalfOf && <Badge tone="violet">{x.onBehalfOf} adına (vekil)</Badge>}
                    <span className="text-slate-400">{fmtDateTime(x.at)}</span>
                    {x.note && <span className="text-slate-600 dark:text-slate-300">“{x.note}”</span>}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {approval.canApprove && (
          <div className="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
            {approval.approveAs && (
              <div className="text-[13px] text-amber-800 dark:text-amber-200">
                <b>{approval.approveAs}</b> adına vekaleten onaylıyorsunuz; denetim kaydına böyle yazılır.
              </div>
            )}
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (isteğe bağlı)" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" icon={X} onClick={() => setRejecting(true)}>
                Reddet
              </Button>
              <Button variant="primary" icon={Check} loading={busy === 'approve'} onClick={() => call('approve', { note: note || undefined }, 'Onaylandı')}>
                Onayla
              </Button>
            </div>
          </div>
        )}
        {!approval.canApprove && a.status === 'pending' && approval.reason && !isAuthor && (
          <div className="flex items-center gap-2 text-[12.5px] text-slate-500"><CircleDashed size={14} /> {approval.reason}</div>
        )}
        {(isAuthor || user.role === 'admin') && (a.status === 'pending' || a.status === 'rejected') && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" icon={Undo2} loading={busy === 'withdraw'} onClick={() => call('withdraw', {}, 'Taslağa geri alındı')}>
              Taslağa geri al
            </Button>
          </div>
        )}

        {approval.history.some((h) => h.round < approval.round) && (
          <details className="text-[12.5px] text-slate-500">
            <summary className="cursor-pointer select-none">Önceki turlar</summary>
            <ul className="mt-2 space-y-1">
              {approval.history
                .filter((h) => h.round < approval.round)
                .map((h, i) => (
                  <li key={i}>
                    Tur {h.round} · {approval.steps[h.step]?.name ?? `Adım ${h.step + 1}`} · {h.username}
                    {h.onBehalfOf ? ` (${h.onBehalfOf} adına)` : ''} · {h.decision === 'approved' ? 'onayladı' : 'reddetti'} · {fmtDateTime(h.at)}
                    {h.note ? ` — ${h.note}` : ''}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>

      <Modal
        open={rejecting}
        title="Duyuruyu reddet"
        description="Gerekçe hazırlayana gösterilir ve denetim kaydına yazılır."
        onClose={() => setRejecting(false)}
        footer={
          <Button variant="danger" icon={X} loading={busy === 'reject'} disabled={reason.trim().length < 5} onClick={() => call('reject', { reason }, 'Reddedildi')}>
            Reddet
          </Button>
        }
      >
        <Field label="Gerekçe" hint="en az 5 karakter">
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn: Hukuk görüşü alınmalı, tarih yanlış…" autoFocus />
        </Field>
      </Modal>
    </Card>
  );
}
