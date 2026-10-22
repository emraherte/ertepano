import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Ban, CheckCircle2, Clock, Cpu, Download, HardDrive, MapPin, Monitor, MonitorCheck, Search, ShieldCheck, Tag, Wifi, WifiOff, X } from 'lucide-react';
import { api, fmtAgo, fmtDateTime, useApi } from '../api';
import type { Device } from '../types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  EmptyState,
  Field,
  Input,
  KeyValue,
  listItem,
  LiveDot,
  Modal,
  PageHeader,
  Progress,
  Skeleton,
  SkeletonCard,
  StatCard,
  StatusBadge,
  Tabs,
  td,
  th,
  trClick,
  trCls,
  useToast,
  useConfirm,
  Callout,
} from '../ui';

type Filter = 'all' | 'online' | 'pending' | 'alerts' | 'offline';

const gb = (mb?: number | null) => (mb ? `${(mb / 1024).toFixed(0)} GB` : '—');
const diskPct = (d: Device) => (d.diskTotalGb && d.diskFreeGb != null ? Math.round((1 - d.diskFreeGb / d.diskTotalGb) * 100) : null);
const days = (s?: number | null) => (s ? `${(s / 86400).toFixed(s < 86400 ? 1 : 0)} gün` : '—');
const realAlerts = (d: Device) => d.alerts.filter((a) => a !== 'Onay bekliyor');
const diskColor = (p: number) => (p >= 90 ? 'bg-linear-to-r from-rose-500 to-red-500' : p >= 75 ? 'bg-linear-to-r from-amber-400 to-orange-500' : 'bg-linear-to-r from-emerald-500 to-teal-500');

function DiskBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-400">—</span>;
  return (
    <div className="min-w-[96px]">
      <div className={cn('mb-1.5 text-[12px] font-medium tabular-nums', pct >= 90 ? 'text-rose-600 dark:text-rose-400' : pct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300')}>%{pct}</div>
      <Progress segments={[{ value: pct, className: diskColor(pct) }]} />
    </div>
  );
}

function Spark({ values, max, color = '#10b981', label }: { values: number[]; max: number; color?: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      {values.length < 2 ? (
        <div className="flex h-12 items-center text-[12px] text-slate-400">Yeterli veri yok</div>
      ) : (
        (() => {
          const w = 280;
          const h = 48;
          const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (Math.min(v, max) / max) * (h - 4) - 2]);
          const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
          const area = `0,${h} ${line} ${w},${h}`;
          const id = `sp-${label.replace(/\W/g, '')}`;
          return (
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full">
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={area} fill={`url(#${id})`} />
              <motion.polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
            </svg>
          );
        })()
      )}
    </div>
  );
}

function DeviceModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data } = useApi<{ item: Device; telemetry: { cpuLoad: number; ramFreeMb: number; diskFreeGb: number; at: string }[]; reports: { id: string; kind: string; text: string; status: string; createdAt: string }[] }>(`/api/devices/${id}`);
  const [edit, setEdit] = useState<{ location: string; department: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = data?.item;
  const e = edit ?? { location: d?.location ?? '', department: d?.department ?? '', note: d?.note ?? '' };

  const save = async (extra: Record<string, unknown> = {}) => {
    if (!d) return;
    setBusy(true);
    try {
      await api(`/api/devices/${d.id}`, { method: 'PATCH', body: { ...e, ...extra } });
      toast('Cihaz güncellendi');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal
      title={d ? <span className="font-mono">{d.hostname}</span> : 'Cihaz'}
      description={d ? (d.online ? 'Şu an çevrimiçi' : `Son görülme ${fmtAgo(d.lastSeen)}`) : undefined}
      onClose={onClose}
      width={760}
      footer={
        d && (
          <>
            {d.status !== 'blocked' ? (
              <Button variant="ghost" icon={Ban} className="text-rose-600 dark:text-rose-400" disabled={busy} onClick={async () => (await confirm({ title: 'Cihaz engellensin mi?', description: 'Bağlantısı hemen kesilir ve engel kaldırılana kadar duyuru alamaz.', confirmLabel: 'Engelle', tone: 'danger' })) && save({ status: 'blocked' })}>
                Engelle
              </Button>
            ) : (
              <Button icon={ShieldCheck} disabled={busy} onClick={() => save({ status: 'approved' })}>
                Engeli kaldır
              </Button>
            )}
            <div className="flex-1" />
            {d.status === 'pending' && (
              <Button icon={CheckCircle2} disabled={busy} onClick={() => save({ status: 'approved' })}>
                Onayla ve kaydet
              </Button>
            )}
            <Button variant="primary" loading={busy} onClick={() => save()}>
              Kaydet
            </Button>
          </>
        )
      }
    >
      {!d ? (
        <div className="space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge s={d.status} />
            <Badge tone={d.online ? 'success' : 'neutral'} icon={d.online ? Wifi : WifiOff}>
              {d.online ? 'Çevrimiçi' : 'Çevrimdışı'}
            </Badge>
            {realAlerts(d).map((a) => (
              <Badge key={a} tone="warning" icon={AlertTriangle}>
                {a}
              </Badge>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Lokasyon">
              <Input value={e.location} onChange={(x) => setEdit({ ...e, location: x.target.value })} placeholder="Örn: Gebze Fabrika" />
            </Field>
            <Field label="Departman">
              <Input value={e.department} onChange={(x) => setEdit({ ...e, department: x.target.value })} placeholder="Örn: Üretim" />
            </Field>
            <Field label="Not">
              <Input value={e.note} onChange={(x) => setEdit({ ...e, note: x.target.value })} placeholder="Örn: Vardiya amiri PC" />
            </Field>
          </div>
          <div className="rounded-2xl border border-slate-200/60 bg-slate-50/50 p-5 dark:border-white/10 dark:bg-white/[0.02]">
            <KeyValue
              items={[
                ['Kullanıcı', d.lastUser ?? '—'],
                ['IP / MAC', <span className="font-mono text-[12.5px]">{d.ip ?? '—'} · {d.mac ?? '—'}</span>],
                ['İşletim sistemi', d.os ?? '—'],
                ['İşlemci', `${d.cpuModel ?? '—'} · anlık %${d.cpuLoad?.toFixed(0) ?? '—'}`],
                ['Bellek', `${gb(d.ramTotalMb)} (boş ${gb(d.ramFreeMb)})`],
                ['Disk (C:)', `${d.diskTotalGb?.toFixed(0) ?? '—'} GB · %${diskPct(d) ?? '—'} dolu`],
                ['Açık kalma', days(d.uptimeSec)],
                ['Ajan', `${d.agentVersion ?? '—'} · ilk kayıt ${fmtDateTime(d.firstSeen)}`],
              ]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Spark label="İşlemci yükü (7 gün, %)" values={data.telemetry.map((t) => t.cpuLoad)} max={100} />
            <Spark label="Boş disk (7 gün, GB)" values={data.telemetry.map((t) => t.diskFreeGb)} max={Math.max(...data.telemetry.map((t) => t.diskFreeGb), 1)} color="#0ea5e9" />
          </div>
          {data.reports.length > 0 && (
            <div>
              <div className="mb-3 text-[13px] font-semibold text-slate-900 dark:text-white">Bu cihazdan gelen bildirimler</div>
              <div className="space-y-2">
                {data.reports.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 rounded-xl border border-slate-200/60 px-4 py-3 text-[13px] dark:border-white/10">
                    <StatusBadge s={r.status} />
                    <span className="flex-1 text-slate-700 dark:text-slate-300">{r.text}</span>
                    <span className="shrink-0 text-[12px] text-slate-400">{fmtAgo(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
    </>
  );
}

export function Devices() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Device[] }>('/api/devices', 15000);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ location: string; department: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data?.items ?? [];
  const items = useMemo(() => {
    const s = q.toLocaleLowerCase('tr');
    return all.filter((d) => {
      if (filter === 'pending' && d.status !== 'pending') return false;
      if (filter === 'alerts' && !realAlerts(d).length) return false;
      if (filter === 'offline' && d.online) return false;
      if (filter === 'online' && !d.online) return false;
      if (!s) return true;
      return [d.hostname, d.lastUser, d.ip, d.location, d.department, d.os].some((v) => v?.toLocaleLowerCase('tr').includes(s));
    });
  }, [all, filter, q]);

  const counts = {
    all: all.length,
    online: all.filter((d) => d.online).length,
    pending: all.filter((d) => d.status === 'pending').length,
    alerts: all.filter((d) => realAlerts(d).length > 0).length,
    offline: all.filter((d) => !d.online).length,
  };

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const runBulk = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('/api/devices/bulk', { body: { ids: [...sel], ...body } });
      toast(`${sel.size} cihaz güncellendi`);
      setSel(new Set());
      setBulk(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: Filter) => setFilter((cur) => (cur === f && f !== 'all' ? 'all' : f));
  const allSelected = items.length > 0 && items.every((d) => sel.has(d.id));
  const hasIt = useLicense().has('it');

  return (
    <>
      <PageHeader
        eyebrow={<><Monitor size={14} /> Envanter</>}
        title="Cihazlar"
        description="Ajanı kurulu tüm bilgisayarlar, anlık durumları ve IT uyarıları."
        actions={
          hasIt && (
            <Button href="/api/devices.csv" icon={Download}>
              Excel / CSV
            </Button>
          )
        }
      />
      {!hasIt && (
        <Callout tone="info" className="mb-6" title="Donanım envanteri IT modülündedir">
          Temel pakette cihazlar yalnızca duyuru hedeflemek için kaydedilir. İşlemci, bellek, disk, açık kalma süresi, sağlık uyarıları ve Excel dışa aktarım için IT modülünü ekleyin.
        </Callout>
      )}

      {!data ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:gap-6 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} rows={0} />
            ))}
          </div>
          <SkeletonCard rows={8} />
        </>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:gap-6 xl:grid-cols-4">
            {(
              [
                ['all', Monitor, 'slate', 'Toplam', 'kayıtlı bilgisayar'],
                ['online', MonitorCheck, 'emerald', 'Çevrimiçi', `${counts.offline} çevrimdışı`],
                ['pending', Clock, 'amber', 'Onay bekleyen', 'IT onayı bekliyor'],
                ['alerts', AlertTriangle, 'rose', 'Uyarılı', 'disk, RAM, yeniden başlatma'],
              ] as const
            ).map(([f, icon, tone, label, sub], i) => (
              <div key={f} className={cn('rounded-3xl transition-all duration-300', filter === f && f !== 'all' && 'ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-transparent')}>
                <StatCard icon={icon} tone={tone} label={label} value={counts[f]} sub={sub} delay={i * 0.05} onClick={() => pick(f)} />
              </div>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { value: 'all', label: 'Tümü', count: counts.all },
                { value: 'pending', label: 'Onay bekleyen', count: counts.pending },
                { value: 'alerts', label: 'Uyarılı', count: counts.alerts },
                { value: 'offline', label: 'Çevrimdışı', count: counts.offline },
              ]}
            />
            <div className="flex-1" />
            <Input icon={Search} placeholder="Bilgisayar, kullanıcı, IP…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-72" />
          </div>

          {sel.size > 0 && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-5 py-3.5 backdrop-blur-sm">
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{sel.size} cihaz seçili</span>
              <div className="flex-1" />
              <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy} onClick={() => runBulk({ approve: true })}>
                Onayla
              </Button>
              <Button size="sm" icon={MapPin} onClick={() => setBulk({ location: '', department: '' })}>
                Lokasyon / departman ata
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSel(new Set())}>
                Seçimi kaldır
              </Button>
            </motion.div>
          )}

          <Card className="overflow-hidden">
            {items.length === 0 ? (
              <EmptyState icon={Monitor} title={all.length ? 'Bu filtrede cihaz yok' : 'Henüz cihaz yok'} description={all.length ? 'Filtreyi veya aramayı değiştirin.' : 'Ajan kurulumu sayfasından kayıt anahtarı oluşturup ajanı dağıtın.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={cn(th, 'w-12 pr-0')}>
                        <Checkbox checked={allSelected} onChange={(v) => setSel(v ? new Set(items.map((d) => d.id)) : new Set())} />
                      </th>
                      <th className={th}>Bilgisayar</th>
                      <th className={th}>Kullanıcı</th>
                      <th className={th}>Lokasyon</th>
                      <th className={th}>Sistem</th>
                      <th className={th}>Disk</th>
                      <th className={th}>Açık kalma</th>
                      <th className={th}>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d, i) => {
                      const alerts = realAlerts(d);
                      return (
                        <motion.tr key={d.id} variants={listItem} initial="hidden" animate="show" custom={i} className={cn(trCls, trClick, 'group', sel.has(d.id) && 'bg-emerald-500/[0.04]')} onClick={() => setOpen(d.id)}>
                          <td className={cn(td, 'w-12 pr-0')} onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
                          </td>
                          <td className={td}>
                            <div className="flex items-center gap-3">
                              <LiveDot on={d.online} />
                              <div>
                                <div className="font-mono text-[13px] font-semibold text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">{d.hostname}</div>
                                <div className="font-mono text-[12px] text-slate-400">{d.ip}</div>
                              </div>
                            </div>
                          </td>
                          <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>{d.lastUser ?? '—'}</td>
                          <td className={cn(td, 'text-[13px]')}>
                            <div className="text-slate-700 dark:text-slate-200">{d.location ?? <span className="text-slate-400">—</span>}</div>
                            {d.department && <div className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-400"><Tag size={11} /> {d.department}</div>}
                          </td>
                          <td className={cn(td, 'text-[13px]')}>
                            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><Cpu size={13} className="text-slate-400" /> {d.os?.replace('Windows', 'Win') ?? '—'}</div>
                            <div className="mt-0.5 text-[12px] text-slate-400">{gb(d.ramTotalMb)} RAM</div>
                          </td>
                          <td className={td}>
                            <DiskBar pct={diskPct(d)} />
                          </td>
                          <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-600 dark:text-slate-300')}>{days(d.uptimeSec)}</td>
                          <td className={td}>
                            <div className="flex flex-wrap gap-1.5">
                              {d.status !== 'approved' && <StatusBadge s={d.status} />}
                              {alerts.map((a) => (
                                <Badge key={a} tone="warning">
                                  {a}
                                </Badge>
                              ))}
                              {d.status === 'approved' && !alerts.length && (d.online ? <Badge tone="success" icon={HardDrive}>Sağlıklı</Badge> : <span className="text-[12px] text-slate-400">{fmtAgo(d.lastSeen)}</span>)}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {open && <DeviceModal id={open} onClose={() => setOpen(null)} onSaved={reload} />}
      <Modal
        open={!!bulk}
        title={`${sel.size} cihaza etiket ata`}
        description="Boş bıraktığınız alan değişmez."
        onClose={() => setBulk(null)}
        footer={
          <Button variant="primary" loading={busy} onClick={() => bulk && runBulk({ ...(bulk.location && { location: bulk.location }), ...(bulk.department && { department: bulk.department }) })}>
            Uygula
          </Button>
        }
      >
        {bulk && (
          <div className="space-y-5">
            <Field label="Lokasyon">
              <Input icon={MapPin} value={bulk.location} onChange={(e) => setBulk({ ...bulk, location: e.target.value })} placeholder="Örn: Gebze Fabrika" />
            </Field>
            <Field label="Departman">
              <Input icon={Tag} value={bulk.department} onChange={(e) => setBulk({ ...bulk, department: e.target.value })} placeholder="Örn: Üretim" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
