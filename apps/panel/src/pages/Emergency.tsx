import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import {
  Biohazard,
  CheckCircle2,
  ChevronDown,
  Clock,
  DoorOpen,
  Flame,
  FileText,
  HardHat,
  History,
  Info,
  LifeBuoy,
  type LucideIcon,
  MapPin,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Users,
  Waves,
  Wind,
  WifiOff,
} from 'lucide-react';
import { api, fmtDateTime, pct, useApi } from '../api';
import type { EmergencyDetail, EmergencyTemplate } from '../types';
import { Preview } from '../components/Preview';
import { TargetPicker } from '../components/TargetPicker';
import {
  AnimatedNumber,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  cn,
  EmptyState,
  Field,
  focusRing,
  Input,
  KeyValue,
  listItem,
  Modal,
  PageHeader,
  PageSkeleton,
  Progress,
  SkeletonCard,
  Textarea,
  td,
  th,
  trCls,
  useAuth,
  useToast,
} from '../ui';

const HOLD_MS = 2000;

const TYPE_ICON: Record<string, LucideIcon> = {
  yangin: Flame,
  deprem: Waves,
  tahliye: DoorOpen,
  gaz: Wind,
  kimyasal: Biohazard,
  siber: ShieldAlert,
  diger: Siren,
};

/** Basılı tutarak onay: yanlışlıkla tıklamayı önler, gerçek acil anda yine de 2 saniye sürer. */
function HoldButton({ t, disabled, onFire, index }: { t: EmergencyTemplate; disabled: boolean; onFire: () => void; index: number }) {
  const controls = useAnimationControls();
  const timer = useRef<number>();
  const [holding, setHolding] = useState(false);
  const Icon = TYPE_ICON[t.type] ?? Siren;

  const start = () => {
    if (disabled) return;
    setHolding(true);
    controls.set({ width: '0%' });
    controls.start({ width: '100%', transition: { duration: HOLD_MS / 1000, ease: 'linear' } });
    timer.current = window.setTimeout(() => {
      cancel();
      onFire();
    }, HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
    controls.stop();
    controls.start({ width: '0%', transition: { duration: 0.2 } });
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <motion.button
      type="button"
      variants={listItem}
      initial="hidden"
      animate="show"
      custom={index}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && start()}
      onKeyUp={cancel}
      aria-label={`${t.label}: başlatmak için 2 saniye basılı tutun`}
      style={{
        ['--glow' as string]: `${t.color}66`,
        background: `linear-gradient(135deg, color-mix(in oklab, ${t.color} 82%, white) 0%, ${t.color} 55%, color-mix(in oklab, ${t.color} 72%, black) 100%)`,
      }}
      className={cn(
        'group relative flex min-h-[148px] select-none flex-col items-start justify-between overflow-hidden rounded-3xl p-5 text-left text-white',
        'shadow-[0_10px_28px_-12px_var(--glow)] ring-1 ring-inset ring-white/15 transition-all duration-300',
        'hover:-translate-y-1 hover:shadow-[0_22px_44px_-14px_var(--glow)] active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-40 disabled:saturate-50',
        focusRing,
        holding && 'scale-[0.98]',
      )}
    >
      <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-white/20 blur-2xl transition-opacity duration-300 group-hover:opacity-80" />
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
        <Icon size={24} strokeWidth={2.2} />
      </div>
      <div className="relative">
        <div className="text-[17px] font-bold tracking-tight">{t.label}</div>
        <div className="mt-0.5 text-[12px] font-medium text-white/75">{holding ? 'Bırakmayın…' : '2 sn basılı tutun'}</div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/15">
        <motion.div animate={controls} initial={{ width: '0%' }} className="h-full bg-white/90 shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
      </div>
    </motion.button>
  );
}

function Elapsed({ from }: { from: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 1000));
  return <span className="font-mono tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

function RollStat({ label, value, sub, icon: Icon, tone, delay }: { label: string; value: number; sub?: string; icon: LucideIcon; tone: 'slate' | 'emerald' | 'rose' | 'amber'; delay: number }) {
  const tones = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };
  const bg = {
    slate: '',
    emerald: 'bg-linear-to-br from-emerald-500/[0.10] to-teal-500/[0.04]',
    rose: value ? 'bg-linear-to-br from-rose-500/[0.14] to-red-500/[0.05] ring-1 ring-rose-500/30' : '',
    amber: '',
  };
  return (
    <Card className={cn('p-6', bg[tone])} delay={delay}>
      <div className={cn('flex items-center gap-2 text-[13px] font-medium', tone === 'slate' ? 'text-slate-500 dark:text-slate-400' : tones[tone])}>
        <Icon size={16} /> {label}
      </div>
      <div className={cn('mt-3 text-[52px] leading-none font-bold tracking-tight tabular-nums', tones[tone])}>
        <AnimatedNumber value={value} />
      </div>
      {sub && <div className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </Card>
  );
}

export function Emergency({ canAct, onChange }: { canAct: boolean; onChange: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const active = useApi<{ item: EmergencyDetail | null }>('/api/emergencies/active', 2500);
  const templates = useApi<{ items: EmergencyTemplate[] }>('/api/emergency-templates');
  const history = useApi<{ items: { id: string; type: string; title: string; drill: boolean; startedBy: string; startedAt: string; endedAt: string | null; targetCount: number; safe: number; help: number }[] }>('/api/emergencies', 30000);
  const [drill, setDrill] = useState(false);
  const [targets, setTargets] = useState<string[]>(['all']);
  const [custom, setCustom] = useState({ title: '', body: '' });
  const [showCustom, setShowCustom] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endNote, setEndNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EmergencyDetail | null>(null);

  const e = active.data?.item;
  const allowedType = (type: string) => user.role === 'admin' || user.role === 'isg' || (user.role === 'it' && type === 'siber');

  const start = async (t: EmergencyTemplate) => {
    if (t.type === 'diger' && !custom.title.trim()) {
      setShowCustom(true);
      toast('"Diğer" için önce başlık yazın', true);
      return;
    }
    setBusy(true);
    try {
      await api('/api/emergencies', {
        body: { type: t.type, drill, targets, ...(t.type === 'diger' ? { title: custom.title, body: custom.body } : {}) },
      });
      toast(drill ? 'Tatbikat başlatıldı' : 'ACİL DURUM YAYINLANDI');
      active.reload();
      onChange();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const end = async (mode: 'all_clear' | 'false_alarm' | 'silent') => {
    if (!e) return;
    setBusy(true);
    try {
      await api(`/api/emergencies/${e.id}/end`, { body: { mode, note: endNote || undefined } });
      toast('Acil durum sonlandırıldı');
      setEnding(false);
      setEndNote('');
      active.reload();
      history.reload();
      onChange();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (id: string) => {
    try {
      const r = await api<{ item: EmergencyDetail }>(`/api/emergencies/${id}`);
      setReport(r.item);
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  if (!active.data) return <PageSkeleton />;

  // ---- Devam eden acil durum: canlı yoklama ----
  if (e) {
    const c = e.counts;
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'relative mb-6 overflow-hidden rounded-3xl p-8 text-white shadow-xl',
            e.drill ? 'bg-linear-to-br from-amber-500 to-orange-600 shadow-orange-500/25' : 'animate-siren bg-linear-to-br from-rose-600 to-red-700 shadow-rose-600/30',
          )}
        >
          <div className="pointer-events-none absolute -top-20 -right-10 h-64 w-64 rounded-full bg-white/15 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/25">
              {e.drill ? <HardHat size={28} /> : <Siren size={28} className="animate-pulse" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/80">
                {e.drill ? 'Tatbikat devam ediyor' : 'Acil durum devam ediyor'}
              </div>
              <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">{e.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-white/85">
                <span>Başlatan: {e.startedBy}</span>
                <span>{fmtDateTime(e.startedAt)}</span>
                <span className="flex items-center gap-1.5">
                  <Clock size={14} /> <Elapsed from={e.startedAt} />
                </span>
              </div>
            </div>
            {canAct && (
              <button
                onClick={() => setEnding(true)}
                className={cn(
                  'inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-semibold text-slate-900 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98]',
                  focusRing,
                )}
              >
                <CheckCircle2 size={18} className="text-emerald-600" /> Sonlandır
              </button>
            )}
          </div>
        </motion.div>

        <div className="mb-6 grid grid-cols-2 gap-6 xl:grid-cols-4">
          <RollStat label="Hedef ekran" value={c.targets} icon={Users} tone="slate" delay={0} />
          <RollStat label="Güvende" value={c.safe} sub={`%${pct(c.safe, c.targets)}`} icon={ShieldCheck} tone="emerald" delay={0.05} />
          <RollStat label="Yardım istiyor" value={c.help} icon={LifeBuoy} tone="rose" delay={0.1} />
          <RollStat label="Yanıt yok" value={c.noResponse} sub={`%${pct(c.noResponse, c.targets)}`} icon={Clock} tone="amber" delay={0.15} />
        </div>

        {e.help.length > 0 && (
          <Card className="mb-6 overflow-hidden ring-2 ring-rose-500/40" delay={0.1}>
            <div className="flex items-center gap-3 bg-linear-to-r from-rose-500/15 to-transparent px-6 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/30">
                <LifeBuoy size={18} className="animate-pulse" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-rose-700 dark:text-rose-300">Yardım isteyenler — öncelikli</h2>
                <p className="text-[12px] text-rose-600/80 dark:text-rose-300/70">Ekip yönlendirin; liste canlı güncellenir</p>
              </div>
            </div>
            <div className="divide-y divide-rose-500/10">
              {e.help.map((h, i) => (
                <motion.div key={h.deviceId} variants={listItem} initial="hidden" animate="show" custom={i} className="grid grid-cols-1 gap-2 px-6 py-4 sm:grid-cols-[1.2fr_1fr_2fr_auto] sm:items-center sm:gap-6">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{h.userLogin ?? '—'}</div>
                    <div className="font-mono text-[12px] text-slate-500">{h.hostname}</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-300">
                    <MapPin size={14} className="text-rose-500" /> {h.location ?? 'Lokasyonsuz'}
                  </div>
                  <div className="text-[13px] text-slate-700 dark:text-slate-300">{h.note ?? <span className="text-slate-400">not yok</span>}</div>
                  <div className="text-[12px] text-slate-500 tabular-nums">{fmtDateTime(h.respondedAt)}</div>
                </motion.div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card delay={0.15}>
            <CardHeader icon={MapPin} title="Lokasyonlara göre" description="Güvende · yardım · yanıt yok" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Lokasyon</th>
                    <th className={th}>Güvende</th>
                    <th className={th}>Yardım</th>
                    <th className={th}>Yanıt yok</th>
                    <th className={cn(th, 'w-[160px]')} />
                  </tr>
                </thead>
                <tbody>
                  {e.byLocation.map((l) => (
                    <tr key={l.location} className={trCls}>
                      <td className={cn(td, 'font-semibold text-slate-900 dark:text-white')}>{l.location}</td>
                      <td className={cn(td, 'font-medium text-emerald-600 tabular-nums dark:text-emerald-400')}>{l.safe}</td>
                      <td className={cn(td, 'tabular-nums', l.help ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-slate-500')}>{l.help}</td>
                      <td className={cn(td, 'text-slate-500 tabular-nums')}>{l.noResponse}</td>
                      <td className={td}>
                        <Progress
                          height="h-2"
                          segments={[
                            { value: pct(l.safe, l.total) },
                            { value: pct(l.help, l.total), className: 'bg-linear-to-r from-rose-500 to-red-500' },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card delay={0.2}>
            <CardHeader icon={Clock} title="Yanıt vermeyenler" description="Toplanma alanı sorumlusuna iletin" action={<Badge tone="warning">{e.noResponse.length}</Badge>} />
            {e.noResponse.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Herkes yanıt verdi" description="Hedefteki tüm ekranlardan yanıt alındı." />
            ) : (
              <div className="max-h-[420px] overflow-y-auto px-3 pb-3">
                {e.noResponse.map((n, i) => (
                  <motion.div
                    key={n.deviceId}
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    custom={i}
                    className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{n.userLogin ?? <span className="font-normal text-slate-400">oturum yok</span>}</div>
                      <div className="font-mono text-[12px] text-slate-400">{n.hostname}</div>
                    </div>
                    <div className="hidden text-[12px] text-slate-500 sm:block">{n.location ?? '—'}</div>
                    {n.online ? (
                      <Badge tone="warning" dot>
                        Ekran açık
                      </Badge>
                    ) : (
                      <Badge icon={WifiOff}>Çevrimdışı</Badge>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Modal
          open={ending}
          title="Acil durumu sonlandır"
          description="Tam ekran uyarı tüm ekranlardan kalkar."
          onClose={() => setEnding(false)}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => end('silent')}>
                Sessizce bitir
              </Button>
              <Button disabled={busy} onClick={() => end('false_alarm')}>
                Yanlış alarm duyur
              </Button>
              <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={() => end('all_clear')}>
                {e.drill ? 'Tatbikat bitti' : 'Tehlike geçti'} duyur
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
              Seçiminize göre 30 dakika ekranda kalan bir bilgilendirme kartı gönderilir. "Sessizce bitir" kart göndermez.
            </p>
            <Field label="Bilgilendirme notu" hint="isteğe bağlı">
              <Textarea value={endNote} onChange={(x) => setEndNote(x.target.value)} placeholder="Örn: Çalışma alanlarınıza dönebilirsiniz." />
            </Field>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-emerald-500/10 p-3">
                <div className="text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">{c.safe}</div>
                <div className="text-[12px] text-slate-500">güvende</div>
              </div>
              <div className="rounded-2xl bg-rose-500/10 p-3">
                <div className="text-xl font-bold text-rose-600 tabular-nums dark:text-rose-400">{c.help}</div>
                <div className="text-[12px] text-slate-500">yardım</div>
              </div>
              <div className="rounded-2xl bg-amber-500/10 p-3">
                <div className="text-xl font-bold text-amber-600 tabular-nums dark:text-amber-400">{c.noResponse}</div>
                <div className="text-[12px] text-slate-500">yanıt yok</div>
              </div>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  // ---- Başlatma ekranı ----
  const tpls = templates.data?.items ?? [];
  const sample = tpls.find((t) => t.type === 'yangin');

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Siren size={14} /> İş sağlığı ve güvenliği
          </span>
        }
        title="Acil Durum"
        description="Tüm ekranlara kapatılamayan tam ekran uyarı ve canlı yoklama: Güvendeyim / Yardım lazım."
      />

      {canAct ? (
        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="p-8 xl:col-span-8">
            <div className="flex flex-wrap items-center gap-4">
              <div className="inline-flex rounded-2xl border border-slate-200/60 bg-slate-900/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]">
                {[
                  { v: false, label: 'Gerçek acil durum', icon: Siren },
                  { v: true, label: 'Tatbikat', icon: HardHat },
                ].map((o) => {
                  const on = drill === o.v;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setDrill(o.v)}
                      className={cn('relative flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors duration-300', focusRing, on ? 'text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}
                    >
                      {on && (
                        <motion.span
                          layoutId="em-mode"
                          className={cn('absolute inset-0 rounded-xl shadow-md', o.v ? 'bg-linear-to-br from-amber-500 to-orange-600 shadow-orange-500/30' : 'bg-linear-to-br from-rose-500 to-red-600 shadow-rose-500/30')}
                          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        />
                      )}
                      <o.icon size={15} className="relative" />
                      <span className="relative">{o.label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="text-[13px] text-slate-500 dark:text-slate-400">
                {drill ? 'Ekranlarda büyük "TATBİKAT" etiketi görünür; rapor tatbikat tutanağı olur.' : 'Sesli, kapatılamaz, tüm monitörlerde.'}
              </span>
            </div>

            {templates.data ? (
              <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
                {tpls.map((t, i) => (
                  <HoldButton key={t.type} t={t} index={i} disabled={busy || !allowedType(t.type)} onFire={() => start(t)} />
                ))}
              </div>
            ) : (
              <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="skeleton h-[148px] rounded-3xl" />
                ))}
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-slate-200/60 dark:border-white/10">
              <button
                type="button"
                onClick={() => setShowCustom((v) => !v)}
                className={cn('flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left text-[14px] font-semibold text-slate-800 transition-colors hover:bg-slate-900/[0.02] dark:text-slate-200 dark:hover:bg-white/[0.03]', focusRing)}
              >
                <span className="flex items-center gap-2">
                  <FileText size={16} className="text-slate-400" /> "Diğer" için başlık/metin ve hedef seçimi
                </span>
                <motion.span animate={{ rotate: showCustom ? 180 : 0 }}>
                  <ChevronDown size={18} className="text-slate-400" />
                </motion.span>
              </button>
              <motion.div initial={false} animate={{ height: showCustom ? 'auto' : 0, opacity: showCustom ? 1 : 0 }} className="overflow-hidden">
                <div className="space-y-5 px-5 pt-1 pb-5">
                  <Field label="Başlık" hint="Diğer için zorunlu">
                    <Input value={custom.title} onChange={(x) => setCustom({ ...custom, title: x.target.value })} maxLength={140} placeholder="Örn: SU BASKINI — ZEMİN KATI BOŞALTIN" />
                  </Field>
                  <Field label="Talimat metni">
                    <Textarea value={custom.body} onChange={(x) => setCustom({ ...custom, body: x.target.value })} placeholder="Çalışanlar ne yapmalı?" />
                  </Field>
                  <div>
                    <div className="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">Hedef</div>
                    <TargetPicker value={targets} onChange={setTargets} />
                  </div>
                </div>
              </motion.div>
            </div>

            {user.role === 'it' && (
              <Callout tone="info" className="mt-6">
                IT rolü yalnızca "Siber saldırı" uyarısı başlatabilir. Diğer türler İSG yetkisindedir.
              </Callout>
            )}
          </Card>

          <div className="flex flex-col gap-6 xl:col-span-4">
            <Card className="p-6" delay={0.05}>
              <div className="mb-4 text-[13px] font-medium text-slate-500 dark:text-slate-400">Çalışanın ekranında</div>
              {sample && <Preview d={{ kind: 'fullscreen', category: 'isg', title: sample.title, body: sample.body, emoji: sample.emoji, color: sample.color, drill, emergency: true }} />}
            </Card>
            <Card className="p-6" delay={0.1}>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Info size={17} />
                </div>
                <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Yanıtlar anında lokasyon bazında sayılır. "Yardım lazım" diyenler en üstte kırmızı listelenir. Kiosk/TV ekranları da aynı anda kırmızıya döner.
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Callout tone="info" className="mb-6" title="Görüntüleme modu">
          Acil durum yayını İSG ve IT yetkililerindedir. Devam eden bir olay olduğunda burada canlı yoklamayı izleyebilirsiniz.
        </Callout>
      )}

      {!history.data ? (
        <SkeletonCard rows={3} />
      ) : (
        <Card delay={0.15} className="overflow-hidden">
          <CardHeader icon={History} title="Geçmiş olaylar ve tatbikatlar" description="Tutanaklar 2 yıl saklanır" />
          {!history.data.items.length ? (
            <EmptyState icon={ShieldCheck} title="Kayıt yok" description="Başlatılan acil durum ve tatbikatlar burada listelenir." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Olay</th>
                    <th className={th}>Başlangıç</th>
                    <th className={th}>Süre</th>
                    <th className={th}>Katılım</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((h, i) => {
                    const Icon = TYPE_ICON[h.type] ?? Siren;
                    return (
                      <motion.tr key={h.id} variants={listItem} initial="hidden" animate="show" custom={i} className={trCls}>
                        <td className={td}>
                          <div className="flex items-center gap-3">
                            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', h.drill ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400')}>
                              <Icon size={17} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-white">
                                <span className="truncate">{h.title}</span>
                                {h.drill && <Badge tone="warning">Tatbikat</Badge>}
                              </div>
                              <div className="text-[12px] text-slate-400">{h.startedBy}</div>
                            </div>
                          </div>
                        </td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500')}>{fmtDateTime(h.startedAt)}</td>
                        <td className={cn(td, 'text-[13px] text-slate-500 tabular-nums')}>{h.endedAt ? `${Math.round((Date.parse(h.endedAt) - Date.parse(h.startedAt)) / 60000)} dk` : '—'}</td>
                        <td className={cn(td, 'min-w-[200px]')}>
                          <Progress
                            segments={[
                              { value: pct(h.safe, h.targetCount) },
                              { value: pct(h.help, h.targetCount), className: 'bg-linear-to-r from-rose-500 to-red-500' },
                            ]}
                          />
                          <div className="mt-1.5 text-[12px] text-slate-500 tabular-nums">
                            {h.safe}/{h.targetCount} güvende{h.help ? ` · ${h.help} yardım` : ''} · %{pct(h.safe + h.help, h.targetCount)}
                          </div>
                        </td>
                        <td className={cn(td, 'text-right')}>
                          <Button size="sm" icon={FileText} onClick={() => openReport(h.id)}>
                            Tutanak
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={!!report}
        title={report ? `${report.drill ? 'Tatbikat' : 'Olay'} tutanağı` : ''}
        description={report?.title}
        onClose={() => setReport(null)}
        width={760}
        footer={
          <Button icon={Printer} onClick={() => window.print()}>
            Yazdır
          </Button>
        }
      >
        {report && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Hedef', report.counts.targets, 'text-slate-900 dark:text-white'],
                ['Güvende', report.counts.safe, 'text-emerald-600 dark:text-emerald-400'],
                ['Yardım', report.counts.help, 'text-rose-600 dark:text-rose-400'],
                ['Yanıt yok', report.counts.noResponse, 'text-amber-600 dark:text-amber-400'],
              ].map(([l, v, cls]) => (
                <div key={l as string} className="rounded-2xl border border-slate-200/60 p-4 dark:border-white/10">
                  <div className="text-[12px] text-slate-500">{l}</div>
                  <div className={cn('mt-1 text-2xl font-bold tracking-tight tabular-nums', cls as string)}>{v}</div>
                </div>
              ))}
            </div>
            <KeyValue
              items={[
                ['Olay', report.title],
                ['Başlatan', `${report.startedBy ?? '—'} — ${fmtDateTime(report.startedAt)}`],
                ['Sonlandıran', `${report.endedBy ?? '—'} — ${fmtDateTime(report.endedAt)}`],
                ['Güvende oranı', `%${pct(report.counts.safe, report.counts.targets)}`],
                ['Medyan yanıt süresi', report.safe.length ? `${[...report.safe].sort((a, b) => a.afterSec - b.afterSec)[Math.floor(report.safe.length / 2)].afterSec} sn` : '—'],
                ...(report.endNote ? ([['Not', report.endNote]] as [string, string][]) : []),
              ]}
            />
            <div>
              <h3 className="mb-3 text-[14px] font-semibold tracking-tight text-slate-900 dark:text-white">Lokasyonlar</h3>
              <div className="overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Lokasyon</th>
                      <th className={th}>Hedef</th>
                      <th className={th}>Güvende</th>
                      <th className={th}>Yardım</th>
                      <th className={th}>Yanıt yok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byLocation.map((l) => (
                      <tr key={l.location} className={trCls}>
                        <td className={cn(td, 'font-medium')}>{l.location}</td>
                        <td className={cn(td, 'tabular-nums')}>{l.total}</td>
                        <td className={cn(td, 'text-emerald-600 tabular-nums dark:text-emerald-400')}>{l.safe}</td>
                        <td className={cn(td, 'tabular-nums', l.help && 'font-bold text-rose-600 dark:text-rose-400')}>{l.help}</td>
                        <td className={cn(td, 'tabular-nums')}>{l.noResponse}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
