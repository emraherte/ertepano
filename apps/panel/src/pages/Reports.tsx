import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock, EyeOff, Inbox, MapPin, Monitor, PlayCircle, RotateCcw, Wrench } from 'lucide-react';
import { REPORT_LABELS, type ReportKind } from '@ertepano/shared';
import { api, fmtAgo, fmtDateTime, useApi } from '../api';
import { Badge, Button, Card, cn, EmptyState, Field, KeyValue, listItem, Modal, PageHeader, SkeletonCard, StatusBadge, Tabs, Textarea, useToast } from '../ui';

interface Report {
  id: string;
  kind: ReportKind;
  text: string;
  anonymous: boolean;
  userLogin: string | null;
  hostname: string | null;
  location: string | null;
  status: 'open' | 'in_progress' | 'closed';
  handledBy: string | null;
  handlerNote: string | null;
  createdAt: string;
  deviceSummary: Record<string, string | number | null> | null;
}

const KIND_META: Record<ReportKind, { icon: typeof Wrench; label: string; tile: string; tone: 'info' | 'danger' }> = {
  it_help: { icon: Wrench, label: 'IT talebi', tile: 'from-sky-500 to-indigo-500 shadow-sky-500/25', tone: 'info' },
  near_miss: { icon: AlertTriangle, label: 'Ramak kala', tile: 'from-rose-500 to-orange-500 shadow-rose-500/25', tone: 'danger' },
};

const TABS = [
  { value: '', label: 'Tümü' },
  { value: 'open', label: 'Açık' },
  { value: 'in_progress', label: 'İşlemde' },
  { value: 'closed', label: 'Kapanan' },
];

const num = (v: unknown) => Number(v ?? 0);

export function Reports() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { data, reload } = useApi<{ items: Report[] }>(`/api/reports${status ? `?status=${status}` : ''}`, 15000);
  const [open, setOpen] = useState<Report | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const update = async (r: Report, s: Report['status']) => {
    setBusy(true);
    try {
      await api(`/api/reports/${r.id}`, { method: 'PATCH', body: { status: s, handlerNote: note || undefined } });
      toast('Güncellendi');
      setOpen(null);
      setNote('');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const ds = open?.deviceSummary;

  return (
    <>
      <PageHeader
        eyebrow={<><Inbox size={14} /> Gelen kutusu</>}
        title="Çalışan bildirimleri"
        description="Çalışanların ekrandaki ErtePano simgesinden gönderdiği IT talepleri ve ramak kala bildirimleri."
      />

      <div className="mb-6">
        <Tabs value={status} onChange={setStatus} items={TABS} />
      </div>

      {!data ? (
        <SkeletonCard rows={5} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Bildirim yok"
              description={'Çalışanlar sağ alttaki simgeden "IT\'ye bildir" veya "Ramak kala bildir" seçeneğini kullandığında burada görünür.'}
            />
          ) : (
            <div className="divide-y divide-slate-200/60 dark:divide-white/5">
              {items.map((r, i) => {
                const meta = KIND_META[r.kind];
                return (
                  <motion.button
                    key={r.id}
                    type="button"
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    custom={i}
                    onClick={() => {
                      setOpen(r);
                      setNote(r.handlerNote ?? '');
                    }}
                    className={cn(
                      'group flex w-full items-start gap-4 px-6 py-5 text-left transition-colors duration-200 hover:bg-slate-900/[0.025] dark:hover:bg-white/[0.03]',
                      r.status === 'closed' && 'opacity-60',
                    )}
                  >
                    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br text-white shadow-lg transition-transform duration-300 group-hover:scale-105', meta.tile)}>
                      <meta.icon size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {r.anonymous && <Badge icon={EyeOff}>Anonim</Badge>}
                        <span className="text-[12px] text-slate-400">{fmtAgo(r.createdAt)}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">{r.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
                        {!r.anonymous && (
                          <span className="flex items-center gap-1.5">
                            <Monitor size={13} /> {r.userLogin ?? '—'}
                            {r.hostname && <span className="font-mono text-slate-400">· {r.hostname}</span>}
                          </span>
                        )}
                        {r.location && (
                          <span className="flex items-center gap-1.5">
                            <MapPin size={13} /> {r.location}
                          </span>
                        )}
                        {r.handledBy && <span>İlgilenen: {r.handledBy}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <StatusBadge s={r.status} />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={!!open}
        title={open ? REPORT_LABELS[open.kind] : ''}
        description={open ? fmtDateTime(open.createdAt) : undefined}
        onClose={() => setOpen(null)}
        width={620}
        footer={
          open && (
            <>
              {open.status !== 'in_progress' && open.status !== 'closed' && (
                <Button icon={PlayCircle} disabled={busy} onClick={() => update(open, 'in_progress')}>
                  İşleme al
                </Button>
              )}
              {open.status !== 'closed' ? (
                <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={() => update(open, 'closed')}>
                  Kapat
                </Button>
              ) : (
                <Button icon={RotateCcw} disabled={busy} onClick={() => update(open, 'open')}>
                  Yeniden aç
                </Button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_META[open.kind].tone} icon={KIND_META[open.kind].icon}>
                {KIND_META[open.kind].label}
              </Badge>
              <StatusBadge s={open.status} />
              {open.anonymous && <Badge icon={EyeOff}>Anonim</Badge>}
            </div>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-100">{open.text}</p>
            <KeyValue
              items={[
                ['Gönderen', open.anonymous ? 'Anonim' : (open.userLogin ?? '—')],
                ['Lokasyon', open.location ?? '—'],
                ['Zaman', fmtDateTime(open.createdAt)],
                ...(open.handledBy ? ([['İlgilenen', open.handledBy]] as [string, string][]) : []),
              ]}
            />
            {ds && (
              <div className="rounded-2xl border border-slate-200/60 bg-slate-900/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  <Monitor size={15} className="text-sky-500" /> Otomatik eklenen cihaz özeti
                </div>
                <KeyValue
                  items={[
                    ['Bilgisayar', <span className="font-mono">{ds.hostname} · {ds.ip}</span>],
                    ['Sistem', ds.os ?? '—'],
                    ['CPU', `${ds.cpuModel ?? '—'} · %${num(ds.cpuLoad).toFixed(0)}`],
                    ['RAM', `${Math.round(num(ds.ramFreeMb) / 1024)} / ${Math.round(num(ds.ramTotalMb) / 1024)} GB boş`],
                    ['Disk', `${num(ds.diskFreeGb).toFixed(0)} / ${num(ds.diskTotalGb).toFixed(0)} GB boş`],
                    ['Açık kalma', <span className="flex items-center gap-1.5"><Clock size={13} className="text-slate-400" /> {(num(ds.uptimeSec) / 86400).toFixed(1)} gün</span>],
                  ]}
                />
              </div>
            )}
            <Field label="İşlem notu" hint="yapılan işlem / alınan önlem">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn: Yazıcı sürücüsü güncellendi." />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
