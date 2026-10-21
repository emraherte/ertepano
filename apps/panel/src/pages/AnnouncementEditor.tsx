import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCheck,
  Clock,
  FilePlus2,
  HardHat,
  ImagePlus,
  LayoutTemplate,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  MonitorSmartphone,
  PanelTop,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Sticker,
  Timer,
  Trash2,
  Tv,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';
import { CATEGORY_LABELS, KIND_LABELS, ROLE_CATEGORIES, type Category, type Kind } from '@ertepano/shared';
import { api, fromLocalInput, toLocalInput, uploadImage, useApi } from '../api';
import type { Announcement, Template } from '../types';
import { Preview } from '../components/Preview';
import { PlacementPicker } from '../components/PlacementPicker';
import { TargetPicker } from '../components/TargetPicker';
import {
  Badge,
  Button,
  buttonClass,
  CAT,
  Callout,
  Card,
  Chip,
  cn,
  Field,
  IconButton,
  Input,
  listItem,
  PageHeader,
  PageSkeleton,
  Skeleton,
  Switch,
  Textarea,
  useAuth,
  useToast,
} from '../ui';

const EDIT_KINDS: { k: Kind; icon: LucideIcon; hint: string }[] = [
  { k: 'toast', icon: MessageSquare, hint: 'Sağ altta kart; okudum butonu' },
  { k: 'banner', icon: PanelTop, hint: 'Ekranın üstünde ince şerit' },
  { k: 'survey', icon: BarChart3, hint: 'Tek soru, tek tıkla oy' },
  { k: 'countdown', icon: Timer, hint: 'Bakım/etkinlik geri sayımı' },
  { k: 'badge', icon: Sticker, hint: 'Köşede görsel; tıklamayı engellemez' },
];
const KIND_ICON = Object.fromEntries(EDIT_KINDS.map((x) => [x.k, x.icon])) as Record<Kind, LucideIcon>;

const CAT_ICON: Record<Category, LucideIcon> = { ik: Users, isg: HardHat, it: ShieldCheck, genel: Megaphone };

const END_PRESETS: [string, number | null][] = [
  ['Süresiz', null],
  ['1 saat', 1],
  ['Gün sonu', -1],
  ['3 gün', 72],
  ['1 hafta', 168],
];


interface Form {
  kind: Kind;
  category: Category;
  title: string;
  body: string;
  emoji: string;
  imageUrl: string | null;
  requireAck: boolean;
  ackLabel: string;
  options: string[];
  countdownTo: string | null;
  position: string;
  posX: number | null;
  posY: number | null;
  size: number | null;
  opacity: number | null;
  sound: boolean;
  targets: string[];
  showOnKiosk: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const blank = (category: Category): Form => ({
  kind: 'toast', category, title: '', body: '', emoji: '📢', imageUrl: null, requireAck: false, ackLabel: '', options: ['', ''],
  countdownTo: null, position: 'top-right', posX: null, posY: null, size: null, opacity: null, sound: false, targets: ['all'], showOnKiosk: true, startsAt: null, endsAt: null,
});

const endOfDay = () => {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
};

/** Numaralı form bölümü */
function Section({ n, icon: Icon, title, description, children, delay }: { n: number; icon: LucideIcon; title: string; description?: string; children: ReactNode; delay?: number }) {
  return (
    <Card className="p-6 sm:p-8" delay={delay}>
      <div className="mb-6 flex items-start gap-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15 dark:text-emerald-300">
          <Icon size={18} />
          <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-500 shadow ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/10">{n}</span>
        </div>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

export function AnnouncementEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const allowed = ROLE_CATEGORIES[user.role];
  const templates = useApi<{ items: Template[] }>('/api/templates');
  const existing = useApi<{ item: Announcement }>(id ? `/api/announcements/${id}` : null);
  const [form, setForm] = useState<Form | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = existing.data?.item;
    if (!a) return;
    setForm({
      kind: a.kind, category: a.category, title: a.title, body: a.body, emoji: a.emoji ?? '', imageUrl: a.imageUrl, requireAck: a.requireAck,
      ackLabel: a.ackLabel ?? '', options: a.options ?? ['', ''], countdownTo: a.countdownTo, position: a.position ?? 'top-right', posX: a.posX, posY: a.posY, size: a.size, opacity: a.opacity, sound: a.sound,
      targets: a.targets, showOnKiosk: a.showOnKiosk, startsAt: a.startsAt, endsAt: a.endsAt,
    });
    setSchedule(!!a.startsAt && a.status !== 'active' && Date.parse(a.startsAt) > Date.now());
  }, [existing.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const applyTemplate = (t: Template) => {
    setForm({
      ...blank(t.category),
      kind: t.kind, title: t.title, body: t.body, emoji: t.emoji, requireAck: !!t.requireAck, ackLabel: t.ackLabel ?? '',
      options: t.options ?? ['', ''],
      countdownTo: t.countdownMinutes ? new Date(Date.now() + t.countdownMinutes * 60000).toISOString() : null,
      endsAt: t.countdownMinutes ? new Date(Date.now() + t.countdownMinutes * 60000).toISOString() : null,
    });
  };

  const grouped = useMemo(() => {
    const m = new Map<Category, Template[]>();
    (templates.data?.items ?? []).forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m.entries()];
  }, [templates.data]);

  // ---- 1. adım: şablon galerisi ----
  if (!id && !form) {
    return (
      <>
        <PageHeader
          eyebrow={<><LayoutTemplate size={14} /> Adım 1 / 2</>}
          title="Bir şablonla başlayın"
          description="Hazır metni seçin; köşeli parantezli [alanları] doldurmanız yeterli. 30 saniyede ekranlarda."
          actions={
            <>
              <Button variant="ghost" icon={ArrowLeft} to="/duyurular">Vazgeç</Button>
              <Button icon={FilePlus2} onClick={() => setForm(blank(allowed[0] ?? 'genel'))}>Boş başla</Button>
            </>
          }
        />
        {!templates.data ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-5 w-48" />
                <div className="mt-6 grid grid-cols-2 gap-4">
                  {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-24 rounded-2xl" />)}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
            {grouped.map(([cat, ts], gi) => {
              const CI = CAT_ICON[cat];
              return (
                <Card key={cat} className={cn('relative overflow-hidden p-6 sm:p-8', grouped.length % 2 === 1 && gi === 0 && '2xl:col-span-2')} delay={gi * 0.06}>
                  <div className={cn('pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-linear-to-br opacity-15 blur-3xl', CAT[cat].grad)} />
                  <div className="relative mb-6 flex items-center gap-3">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-lg', CAT[cat].grad)}>
                      <CI size={18} />
                    </div>
                    <div>
                      <h2 className="text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{CATEGORY_LABELS[cat]}</h2>
                      <p className="text-[12px] text-slate-400">{ts.length} şablon</p>
                    </div>
                  </div>
                  <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {ts.map((t, i) => {
                      const KI = KIND_ICON[t.kind] ?? MessageSquare;
                      return (
                        <motion.button
                          key={t.id}
                          type="button"
                          variants={listItem}
                          initial="hidden"
                          animate="show"
                          custom={i}
                          onClick={() => applyTemplate(t)}
                          className="group flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:bg-white hover:shadow-xl hover:shadow-slate-900/10 active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] dark:hover:shadow-black/40"
                        >
                          <div className="flex items-center justify-between">
                            <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl text-lg', CAT[cat].soft)}>{t.emoji}</div>
                            <KI size={15} className="text-slate-300 transition-colors group-hover:text-emerald-500 dark:text-slate-600" />
                          </div>
                          <div>
                            <div className="text-[13.5px] font-semibold tracking-tight text-slate-900 dark:text-white">{t.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-400">
                              {KIND_LABELS[t.kind]}
                              {t.requireAck && <Badge tone="info">onaylı</Badge>}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </>
    );
  }
  if (!form) return <PageSkeleton />;

  const placeholders = /\[[^\]]+\]/.test(form.title + form.body + form.options.join(''));
  const isActive = existing.data?.item.status === 'active';

  const save = async (publish: boolean) => {
    setBusy(publish ? 'publish' : 'draft');
    setError(null);
    const body = {
      kind: form.kind, category: form.category, title: form.title, body: form.body, emoji: form.emoji || null, imageUrl: form.imageUrl,
      requireAck: form.kind === 'toast' && form.requireAck, ackLabel: form.ackLabel || null,
      options: form.kind === 'survey' ? form.options.map((o) => o.trim()).filter(Boolean) : null,
      countdownTo: form.kind === 'countdown' ? form.countdownTo : null, position: form.kind === 'badge' ? form.position : null,
      ...(form.kind === 'badge' ? { posX: form.position === 'custom' ? form.posX : null, posY: form.position === 'custom' ? form.posY : null, size: form.size, opacity: form.opacity } : {}),
      sound: form.sound, targets: form.targets, showOnKiosk: form.showOnKiosk,
      startsAt: schedule ? form.startsAt : null, endsAt: form.endsAt, publish,
    };
    try {
      const r = id
        ? await api<{ item: Announcement }>(`/api/announcements/${id}`, { method: 'PATCH', body })
        : await api<{ item: Announcement }>('/api/announcements', { body });
      toast(publish ? (r.item.status === 'scheduled' ? 'Duyuru planlandı' : 'Duyuru yayınlandı — ekranlara gidiyor') : 'Kaydedildi');
      nav(`/duyurular/${r.item.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onImage = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try {
      set('imageUrl', await uploadImage(f));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUploading(false);
    }
  };

  const endPresetOn = (h: number | null) => h === null && !form.endsAt;

  return (
    <>
      <PageHeader
        eyebrow={<><Megaphone size={14} /> {id ? 'Düzenleme' : 'Adım 2 / 2'}</>}
        title={id ? 'Duyuruyu düzenle' : 'Yeni duyuru'}
        description={isActive ? 'Bu duyuru yayında; kaydettiğinizde ekranlardaki kopya anında güncellenir.' : 'Sağdaki önizleme, çalışanın ekranında göreceği hâlidir.'}
        actions={
          <>
            {!id && <Button variant="ghost" icon={LayoutTemplate} onClick={() => setForm(null)}>Şablonlar</Button>}
            <Button variant="ghost" icon={ArrowLeft} to={id ? `/duyurular/${id}` : '/duyurular'}>Vazgeç</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-6">
          <Section n={1} icon={MonitorSmartphone} title="Kategori ve görünüm" description="Kimin adına ve ekranda nasıl çıkacak?">
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {allowed.map((c) => {
                  const CI = CAT_ICON[c];
                  return (
                    <Chip key={c} on={form.category === c} onClick={() => set('category', c)}>
                      <CI size={14} className={CAT[c].text} />
                      {CATEGORY_LABELS[c]}
                    </Chip>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {EDIT_KINDS.map(({ k, icon: Icon, hint }) => {
                  const on = form.kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      title={hint}
                      onClick={() => set('kind', k)}
                      className={cn(
                        'relative flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]',
                        on
                          ? 'border-emerald-500/50 bg-emerald-500/[0.07] shadow-lg shadow-emerald-500/10'
                          : 'border-slate-200/70 bg-white/50 hover:border-slate-300 hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]',
                      )}
                    >
                      <Icon size={18} className={on ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
                      <span className={cn('text-[13px] font-semibold tracking-tight', on ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-300')}>{KIND_LABELS[k]}</span>
                      {on && <motion.span layoutId="kind-dot" className="absolute top-3 right-3 h-2 w-2 rounded-full bg-emerald-500" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">{EDIT_KINDS.find((x) => x.k === form.kind)?.hint}</p>
            </div>
          </Section>

          <Section n={2} icon={MessageSquare} title="İçerik" description="Kısa başlık, net mesaj." delay={0.05}>
            <div className="space-y-5">
              <div className="grid grid-cols-[84px_1fr] gap-4">
                <Field label="Simge">
                  <Input value={form.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={8} className="text-center text-xl" />
                </Field>
                <Field label="Başlık" hint={`${form.title.length}/140`}>
                  <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={140} placeholder="Kısa ve net bir başlık" />
                </Field>
              </div>

              {form.kind !== 'badge' && (
                <Field label={form.kind === 'survey' ? 'Açıklama (isteğe bağlı)' : 'Metin'} hint={`${form.body.length}/2000`}>
                  <Textarea value={form.body} onChange={(e) => set('body', e.target.value)} maxLength={2000} rows={form.kind === 'banner' ? 2 : 4} />
                </Field>
              )}

              {form.kind === 'survey' && (
                <div className="space-y-3">
                  <div className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Seçenekler</div>
                  {form.options.map((o, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900/[0.04] text-[13px] font-semibold text-slate-400 dark:bg-white/5">{i + 1}</span>
                      <Input value={o} onChange={(e) => set('options', form.options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Seçenek ${i + 1}`} className="flex-1" />
                      {form.options.length > 2 && <IconButton icon={Trash2} label="Seçeneği sil" onClick={() => set('options', form.options.filter((_, j) => j !== i))} />}
                    </motion.div>
                  ))}
                  {form.options.length < 6 && (
                    <Button size="sm" variant="subtle" icon={Plus} onClick={() => set('options', [...form.options, ''])}>
                      Seçenek ekle
                    </Button>
                  )}
                  <p className="text-[12px] text-slate-400">Yanıtlar panelde kişi adı olmadan, toplu sayı olarak gösterilir.</p>
                </div>
              )}

              {form.kind === 'countdown' && (
                <Field label="Geri sayım hedefi">
                  <Input type="datetime-local" value={toLocalInput(form.countdownTo)} onChange={(e) => set('countdownTo', fromLocalInput(e.target.value))} />
                </Field>
              )}

              {form.kind === 'badge' && (
                <div>
                  <div className="mb-3 text-[13px] font-medium text-slate-700 dark:text-slate-300">Ekrandaki yeri</div>
                  <PlacementPicker
                    value={form}
                    imageUrl={form.imageUrl}
                    emoji={form.emoji}
                    onChange={(p) => setForm((f) => (f ? { ...f, ...p, position: p.position ?? 'top-right' } : f))}
                  />
                </div>
              )}

              {form.kind !== 'banner' && form.kind !== 'countdown' && (
                <div className="flex flex-wrap items-center gap-3">
                  {form.imageUrl && (
                    <div className="relative">
                      <img src={form.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-white/10" />
                    </div>
                  )}
                  <label className={buttonClass('secondary', 'sm', 'cursor-pointer')}>
                    <ImagePlus size={14} />
                    {uploading ? 'Yükleniyor…' : form.imageUrl ? 'Görseli değiştir' : 'Görsel ekle'}
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => onImage(e.target.files?.[0])} />
                  </label>
                  {form.imageUrl && (
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set('imageUrl', null)}>
                      Kaldır
                    </Button>
                  )}
                  <span className="text-[12px] text-slate-400">PNG/JPG/GIF/WEBP, en fazla 5 MB</span>
                </div>
              )}

              {form.kind === 'toast' && (
                <div className="space-y-3 rounded-2xl border border-slate-200/60 bg-slate-900/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
                  <Switch
                    checked={form.requireAck}
                    onChange={(v) => set('requireAck', v)}
                    label={<span className="flex items-center gap-2"><CheckCheck size={15} className="text-emerald-500" /> Zorunlu okuma onayı</span>}
                    description="Kim, ne zaman onayladı kaydedilir — denetim kanıtı."
                  />
                  {form.requireAck && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <Input value={form.ackLabel} onChange={(e) => set('ackLabel', e.target.value)} placeholder="Buton metni: Okudum, anladım" maxLength={40} />
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section n={3} icon={Users} title="Hedef" description="Kimin ekranına gidecek?" delay={0.1}>
            <TargetPicker value={form.targets} onChange={(v) => set('targets', v)} />
          </Section>

          <Section n={4} icon={CalendarClock} title="Zamanlama" description="Ne zaman başlasın, ne kadar kalsın?" delay={0.15}>
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Chip on={!schedule} icon={Zap} onClick={() => setSchedule(false)}>Hemen</Chip>
                <Chip on={schedule} icon={CalendarClock} onClick={() => setSchedule(true)}>İleri tarihte</Chip>
                {schedule && (
                  <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                    <Input type="datetime-local" className="w-56" value={toLocalInput(form.startsAt)} onChange={(e) => set('startsAt', fromLocalInput(e.target.value))} />
                  </motion.div>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  <Clock size={14} className="text-slate-400" /> Ekranda kalma süresi
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {END_PRESETS.map(([label, h]) => (
                    <Chip
                      key={label}
                      on={endPresetOn(h)}
                      onClick={() => {
                        const base = schedule && form.startsAt ? Date.parse(form.startsAt) : Date.now();
                        set('endsAt', h === null ? null : h === -1 ? endOfDay() : new Date(base + h * 3600_000).toISOString());
                      }}
                    >
                      {label}
                    </Chip>
                  ))}
                  <Input type="datetime-local" className="w-56" value={toLocalInput(form.endsAt)} onChange={(e) => set('endsAt', fromLocalInput(e.target.value))} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Switch checked={form.showOnKiosk} onChange={(v) => set('showOnKiosk', v)} label={<span className="flex items-center gap-2"><Tv size={15} className="text-slate-400" /> Kiosk/TV ekranlarında</span>} description="Fabrika ve yemekhane ekranlarında da dönsün" />
                <Switch checked={form.sound} onChange={(v) => set('sound', v)} label={<span className="flex items-center gap-2"><Volume2 size={15} className="text-slate-400" /> Sesli uyarı</span>} description="Gösterilirken kısa bir ses çalar" />
              </div>
            </div>
          </Section>

          {(placeholders || error) && (
            <div className="space-y-3">
              {placeholders && <Callout tone="warning" title="Doldurulmamış alan var">Metinde [köşeli parantez] içinde kalan yerler var.</Callout>}
              {error && <Callout tone="danger">{error}</Callout>}
            </div>
          )}

          <Card className="flex flex-wrap items-center justify-end gap-3 p-4 sm:p-5" delay={0.2}>
            <span className="mr-auto pl-2 text-[13px] text-slate-500 dark:text-slate-400">
              {schedule && form.startsAt ? 'Seçilen zamanda otomatik yayınlanır.' : 'Yayınla dediğinizde saniyeler içinde ekranlarda.'}
            </span>
            {(!id || existing.data?.item.status === 'draft') && (
              <Button icon={Save} loading={busy === 'draft'} disabled={!!busy || !form.title.trim()} onClick={() => save(false)}>
                Taslak kaydet
              </Button>
            )}
            <Button variant="primary" size="lg" icon={schedule ? CalendarClock : Rocket} loading={busy === 'publish'} disabled={!!busy || !form.title.trim()} onClick={() => save(true)}>
              {isActive ? 'Kaydet ve güncelle' : schedule ? 'Planla' : 'Yayınla'}
            </Button>
          </Card>
        </div>

        <div className="xl:sticky xl:top-24">
          <Card className="p-6" delay={0.1}>
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-slate-900 dark:text-white">
                <MonitorSmartphone size={16} className="text-emerald-500" /> Canlı önizleme
              </div>
              <Badge tone="success" dot>{KIND_LABELS[form.kind]}</Badge>
            </div>
            <Preview d={{ ...form, emoji: form.emoji }} />
            <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
              Kart ve anketler tam ekran sunum/oyun sırasında beklemeye alınır, sunum bitince gösterilir. Rozet tıklamaları engellemez.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
