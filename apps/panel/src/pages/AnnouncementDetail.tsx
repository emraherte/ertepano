import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CheckCheck,
  Download,
  Eye,
  Hourglass,
  ListChecks,
  MonitorSmartphone,
  Pencil,
  Rocket,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import { KIND_LABELS, ROLE_CATEGORIES } from '@ertepano/shared';
import { api, fmtDateTime, pct, useApi } from '../api';
import type { Announcement, Stats } from '../types';
import { Preview } from '../components/Preview';
import { useLicense } from '../components/license';
import {
  Badge,
  Button,
  CAT,
  Card,
  CardHeader,
  Cat,
  cn,
  EmptyState,
  KeyValue,
  listItem,
  Modal,
  PageHeader,
  PageSkeleton,
  Progress,
  Select,
  StatCard,
  StatusBadge,
  td,
  th,
  trCls,
  useAuth,
  useToast,
} from '../ui';
import { TargetIcon, targetLabel } from './Announcements';

interface DeliveryRow {
  deviceId: string;
  hostname: string;
  userLogin: string | null;
  location: string | null;
  department: string | null;
  sentAt: string | null;
  seenAt: string | null;
  readAt: string | null;
  ackedAt: string | null;
  dismissedAt: string | null;
  answeredAt: string | null;
}

type Confirm = { kind: 'end' | 'delete' } | null;

export function AnnouncementDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { categoriesFor } = useLicense();
  const nav = useNavigate();
  const toast = useToast();
  const { data, reload } = useApi<{ item: Announcement; stats: Stats; answers: Record<string, number>; deliveries: DeliveryRow[]; personal?: boolean }>(`/api/announcements/${id}`, 10000);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const byLocation = useMemo(() => {
    const m = new Map<string, { sent: number; seen: number; acked: number }>();
    (data?.deliveries ?? []).forEach((d) => {
      const k = d.location ?? 'Lokasyonsuz';
      const e = m.get(k) ?? { sent: 0, seen: 0, acked: 0 };
      e.sent++;
      if (d.seenAt) e.seen++;
      if (d.ackedAt) e.acked++;
      m.set(k, e);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [data]);

  if (!data) return <PageSkeleton />;
  const a = data.item;
  const s = data.stats;
  const canEdit = categoriesFor(user.role).includes(a.category) && a.kind !== 'fullscreen';
  const base = Math.max(s.sent, 1);
  const doneCount = a.requireAck ? s.acked : a.kind === 'survey' ? s.answered : s.seen;
  const doneLabel = a.requireAck ? 'Onayladı' : a.kind === 'survey' ? 'Oy verdi' : 'Okudu / kapattı';

  const act = async (path: string, msg: string) => {
    setBusy(true);
    try {
      await api(`/api/announcements/${a.id}${path}`, { method: 'POST' });
      toast(msg);
      setConfirm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/announcements/${a.id}`, { method: 'DELETE' });
      toast('Silindi');
      nav('/duyurular');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const doneKey: keyof DeliveryRow = a.requireAck ? 'ackedAt' : a.kind === 'survey' ? 'answeredAt' : 'seenAt';
  const rows = data.deliveries.filter((d) => (filter === 'all' ? true : filter === 'done' ? !!d[doneKey] : !d[doneKey]));

  const exportCsv = () => {
    const head = ['Bilgisayar', 'Kullanıcı', 'Lokasyon', 'Departman', 'Gönderildi', 'Görüldü', 'Onaylandı', 'Kapatıldı'];
    const lines = data.deliveries.map((d) =>
      [d.hostname, d.userLogin, d.location, d.department, d.sentAt, d.seenAt, d.ackedAt, d.dismissedAt].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'),
    );
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `onay-raporu-${a.title.slice(0, 30)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalAnswers = Object.values(data.answers).reduce((x, y) => x + y, 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-3 normal-case tracking-normal">
            <StatusBadge s={a.status} />
            <Cat c={a.category} />
          </span>
        }
        title={
          <span className="flex items-center gap-4">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl', CAT[a.category].soft)}>{a.emoji ?? '📢'}</span>
            <span className="min-w-0">{a.title}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            <span className="flex items-center gap-1.5"><MonitorSmartphone size={14} className="text-slate-400" /> {KIND_LABELS[a.kind]}</span>
            <span className="flex items-center gap-1.5"><TargetIcon targets={a.targets} /> {targetLabel(a.targets)}</span>
            {a.createdBy && <span className="text-slate-400">· {a.createdBy}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={ArrowLeft} to="/duyurular">Duyurular</Button>
            {canEdit && a.status !== 'ended' && <Button icon={Pencil} to={`/duyurular/${a.id}/duzenle`}>Düzenle</Button>}
            {canEdit && a.status === 'draft' && (
              <Button variant="primary" icon={Rocket} loading={busy} onClick={() => act('/publish', 'Yayınlandı')}>Yayınla</Button>
            )}
            {canEdit && (a.status === 'active' || a.status === 'scheduled') && (
              <Button variant="danger" icon={Square} onClick={() => setConfirm({ kind: 'end' })}>Yayını bitir</Button>
            )}
            {canEdit && a.status !== 'active' && <Button variant="ghost" icon={Trash2} onClick={() => setConfirm({ kind: 'delete' })}>Sil</Button>}
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatCard icon={Send} tone="sky" label="Gönderildi" value={s.sent} sub={`hedefte ${s.targets} cihaz`} />
            <StatCard
              icon={Eye}
              tone="emerald"
              label="Gördü"
              value={s.seen}
              delay={0.05}
              sub={`%${pct(s.seen, base)} erişim`}
              footer={<Progress segments={[{ value: pct(s.seen, base) }]} />}
            />
            <StatCard
              icon={a.kind === 'survey' ? BarChart3 : CheckCheck}
              tone="violet"
              label={doneLabel}
              value={doneCount}
              delay={0.1}
              sub={`%${pct(doneCount, base)}`}
              footer={<Progress segments={[{ value: pct(doneCount, base), className: 'bg-linear-to-r from-violet-500 to-fuchsia-500' }]} />}
            />
          </div>

          {a.kind === 'survey' && (
            <Card delay={0.1}>
              <CardHeader icon={BarChart3} title="Anket sonuçları" description={`${totalAnswers} oy · yanıtlar kişi bazında gösterilmez`} />
              <div className="space-y-5 px-6 pb-6">
                {(a.options ?? []).map((o, i) => {
                  const n = data.answers[o] ?? 0;
                  const p = pct(n, totalAnswers);
                  const max = Math.max(...Object.values(data.answers), 0);
                  return (
                    <motion.div key={o} variants={listItem} initial="hidden" animate="show" custom={i}>
                      <div className="flex items-center justify-between gap-3 text-[14px]">
                        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                          {o}
                          {n > 0 && n === max && <Badge tone="success">önde</Badge>}
                        </span>
                        <span className="text-slate-500 tabular-nums">
                          <b className="text-slate-900 dark:text-white">{n}</b> · %{p}
                        </span>
                      </div>
                      <Progress className="mt-2" height="h-2.5" segments={[{ value: p }]} />
                    </motion.div>
                  );
                })}
              </div>
            </Card>
          )}

          {byLocation.length > 1 && (
            <Card delay={0.15}>
              <CardHeader icon={Building2} title="Lokasyona göre" description="Hangi binada eksik kaldı?" />
              <div className="grid grid-cols-1 gap-4 px-6 pb-6 md:grid-cols-2">
                {byLocation.map(([loc, v]) => (
                  <div key={loc} className="rounded-2xl border border-slate-200/60 bg-white/40 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{loc}</span>
                      <span className="text-slate-500 tabular-nums">
                        {v.seen}/{v.sent} gördü{a.requireAck && ` · ${v.acked} onay`}
                      </span>
                    </div>
                    <Progress
                      className="mt-3"
                      segments={[
                        ...(a.requireAck ? [{ value: pct(v.acked, v.sent) }] : []),
                        { value: pct(v.seen - (a.requireAck ? v.acked : 0), v.sent), className: a.requireAck ? 'bg-emerald-500/35' : undefined },
                      ]}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card delay={0.2} className="overflow-hidden">
            <CardHeader
              icon={ListChecks}
              title={a.requireAck ? 'Onay listesi' : 'Teslim listesi'}
              description={a.requireAck ? 'Denetim kanıtı: kim, ne zaman onayladı' : 'Cihaz bazında görülme durumu'}
              action={
                <>
                  <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-48">
                    <option value="all">Tümü ({data.deliveries.length})</option>
                    <option value="pending">{a.requireAck ? 'Onaylamayanlar' : 'Görmeyenler'}</option>
                    <option value="done">{a.requireAck ? 'Onaylayanlar' : 'Görenler'}</option>
                  </Select>
                  {a.kind !== 'survey' && <Button size="sm" icon={Download} onClick={exportCsv}>CSV</Button>}
                </>
              }
            />
            {data.personal === false ? (
              <EmptyState icon={Hourglass} title="Kişi bazında liste gizli" description="KVKK gereği kim, ne zaman onayladı bilgisi yalnızca bu kategoride yayın yetkisi olan rollere gösterilir. Yukarıdaki sayılar herkese açıktır." />
            ) : rows.length === 0 ? (
              <EmptyState icon={Hourglass} title="Henüz kayıt yok" description="Duyuru hedefteki cihazlara ulaştıkça burada listelenir." />
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl dark:bg-slate-900/80">
                    <tr>
                      <th className={th}>Bilgisayar</th>
                      <th className={th}>Kullanıcı</th>
                      <th className={th}>Lokasyon</th>
                      <th className={th}>Gördü</th>
                      <th className={th}>{a.requireAck ? 'Onay' : a.kind === 'survey' ? 'Oy' : 'Kapattı'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.deviceId} className={trCls}>
                        <td className={cn(td, 'font-mono text-[12.5px] text-slate-700 dark:text-slate-300')}>{d.hostname}</td>
                        <td className={cn(td, 'text-slate-700 dark:text-slate-300')}>{d.userLogin ?? <span className="text-slate-400">—</span>}</td>
                        <td className={cn(td, 'text-[13px] text-slate-500')}>{d.location ?? '—'}</td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500')}>{d.seenAt ? fmtDateTime(d.seenAt) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap')}>
                          {a.requireAck ? (
                            d.ackedAt ? <Badge tone="success" icon={CheckCheck}>{fmtDateTime(d.ackedAt)}</Badge> : <Badge tone="warning" dot>Bekliyor</Badge>
                          ) : a.kind === 'survey' ? (
                            d.answeredAt ? <Badge tone="success" icon={CheckCheck}>Oyladı</Badge> : <span className="text-slate-400">—</span>
                          ) : d.dismissedAt ? (
                            <span className="text-slate-500">{fmtDateTime(d.dismissedAt)}</span>
                          ) : d.readAt ? (
                            <Badge tone="info">okudu</Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-24">
          <Card className="p-6" delay={0.05}>
            <div className="mb-5 flex items-center gap-2 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-white">
              <MonitorSmartphone size={16} className="text-emerald-500" /> Çalışanın ekranında
            </div>
            <Preview d={{ ...a, emergency: !!a.emergencyId }} />
          </Card>
          <Card className="p-6" delay={0.1}>
            <KeyValue
              items={[
                ['Başlangıç', fmtDateTime(a.startsAt)],
                ['Bitiş', a.endsAt ? fmtDateTime(a.endsAt) : 'Süresiz (elle bitirilir)'],
                ['Kiosk/TV', a.showOnKiosk ? 'Gösteriliyor' : 'Hayır'],
                ['Oluşturan', a.createdBy ?? '—'],
              ]}
            />
            {a.body && <p className="mt-5 border-t border-slate-200/60 pt-5 text-[14px] leading-relaxed whitespace-pre-wrap text-slate-600 dark:border-white/10 dark:text-slate-300">{a.body}</p>}
          </Card>
        </div>
      </div>

      <Modal
        open={confirm?.kind === 'end'}
        title="Yayın bitirilsin mi?"
        description="Duyuru tüm ekranlardan hemen kaldırılır. Teslim ve onay kayıtları saklanır."
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Vazgeç</Button>
            <Button variant="danger" icon={Square} loading={busy} onClick={() => act('/end', 'Yayın bitirildi')}>Yayını bitir</Button>
          </>
        }
      >
        <div className="flex items-center gap-4 rounded-2xl bg-slate-900/[0.03] p-4 dark:bg-white/[0.04]">
          <span className="text-2xl">{a.emoji ?? '📢'}</span>
          <div>
            <div className="font-semibold text-slate-900 dark:text-white">{a.title}</div>
            <div className="text-[13px] text-slate-500">{s.seen} kişi gördü · {s.acked} onay</div>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirm?.kind === 'delete'}
        title="Duyuru silinsin mi?"
        description="Bu işlem geri alınamaz."
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Vazgeç</Button>
            <Button variant="danger" icon={Trash2} loading={busy} onClick={remove}>Sil</Button>
          </>
        }
      >
        <p className="text-[14px] text-slate-600 dark:text-slate-300">
          <b>{a.title}</b> kalıcı olarak silinecek.
        </p>
      </Modal>
    </>
  );
}
