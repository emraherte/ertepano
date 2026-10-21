import { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, CalendarHeart, Eye, EyeOff, ImagePlus, LayoutTemplate, MapPin, Pencil, Plus, Repeat, Sticker, Trash2, X } from 'lucide-react';
import { api, fmtDate, uploadImage, useApi } from '../api';
import { Badge, Button, Card, cn, EmptyState, Field, IconButton, Input, listItem, Modal, SkeletonCard, Switch, Textarea, useConfirm, useToast } from '../ui';
import { BadgeArt, centerOf, defaultPlacement, type Placement, PlacementPicker, placementLabel } from '../components/PlacementPicker';
import { Preview } from '../components/Preview';

interface SpecialDay extends Placement {
  id: string;
  name: string;
  monthDay: string | null;
  date: string | null;
  emoji: string | null;
  imageUrl: string | null;
  message: string | null;
  kind: 'badge' | 'toast' | 'banner';
  enabled: boolean;
}

interface DayForm extends Placement {
  id?: string;
  name: string;
  when: string;
  recurring: boolean;
  emoji: string;
  imageUrl: string | null;
  message: string;
  kind: SpecialDay['kind'];
}

export const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const mdLabel = (md: string | null) => (md ? `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}` : '—');

const KINDS: { value: SpecialDay['kind']; label: string; hint: string; icon: typeof Sticker }[] = [
  { value: 'badge', label: 'Ekranda rozet', hint: 'Görsel istediğiniz yerde durur, tıklamayı engellemez', icon: Sticker },
  { value: 'banner', label: 'Üst şerit', hint: 'Ekranın üstünde ince bant', icon: LayoutTemplate },
  { value: 'toast', label: 'Kart', hint: 'Sağ altta kapatılabilir kart', icon: CalendarHeart },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<SpecialDay['kind'], string>;
const IMAGE_TYPES = 'image/png,image/webp,image/gif,image/jpeg';

function DateTile({ md, date, today }: { md: string | null; date: string | null; today: boolean }) {
  const m = date ? date.slice(5) : md;
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border text-center leading-none',
        today
          ? 'border-emerald-500/40 bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
          : 'border-slate-200/70 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
      )}
    >
      <span className="text-[16px] font-bold tabular-nums">{m ? Number(m.slice(3)) : '—'}</span>
      <span className={cn('mt-0.5 text-[10px] font-semibold uppercase', today ? 'text-white/80' : 'text-slate-400')}>{m ? MONTHS[Number(m.slice(0, 2)) - 1] : ''}</span>
    </div>
  );
}

/** Kartta küçük ekran: rozetin nerede duracağı bir bakışta */
function MiniScreen({ d }: { d: SpecialDay }) {
  const [x, y] = centerOf(d);
  return (
    <div className="relative aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200/70 bg-linear-to-br from-sky-100 to-indigo-100 dark:border-white/10 dark:from-slate-800 dark:to-slate-900">
      <div className="absolute inset-x-0 bottom-0 h-[8%] bg-slate-900/70" />
      {d.kind === 'badge' ? (
        <div
          className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 [container-type:inline-size]"
          style={{ left: `${x}%`, top: `${y}%`, width: `${Math.max(((d.size ?? 160) / 1920) * 160, 12)}%`, opacity: d.opacity ?? 1 }}
        >
          <BadgeArt imageUrl={d.imageUrl} emoji={d.emoji} />
        </div>
      ) : d.kind === 'banner' ? (
        <div className="absolute inset-x-0 top-0 h-[16%] bg-teal-600" />
      ) : (
        <div className="absolute right-[4%] bottom-[14%] h-[30%] w-[44%] rounded-sm border-l-2 border-teal-600 bg-white shadow" />
      )}
    </div>
  );
}

function ImageField({ value, uploading, onFile, onClear }: { value: string | null; uploading: boolean; onFile: (f?: File) => void; onClear: () => void }) {
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        {/* dama deseni: şeffaf PNG'nin kenarları görünsün */}
        <img src={value} alt="" className="h-14 w-14 rounded-xl bg-[conic-gradient(#e2e8f0_25%,#fff_0_50%,#e2e8f0_0_75%,#fff_0)] bg-[length:12px_12px] object-contain p-1" />
        <div className="min-w-0 flex-1 text-[13px] text-slate-600 dark:text-slate-300">Görsel yüklendi</div>
        <label className="cursor-pointer rounded-xl px-3 py-1.5 text-[13px] font-medium text-emerald-700 transition hover:bg-emerald-500/10 dark:text-emerald-300">
          Değiştir
          <input type="file" accept={IMAGE_TYPES} hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <IconButton icon={X} label="Görseli kaldır" onClick={onClear} />
      </div>
    );
  }
  return (
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300/80 px-4 py-6 text-center transition-all duration-300 hover:border-emerald-500/60 hover:bg-emerald-500/[0.04] dark:border-white/15">
      <ImagePlus size={22} className="text-emerald-600 dark:text-emerald-400" />
      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{uploading ? 'Yükleniyor…' : 'Görsel yükle'}</span>
      <span className="text-[12px] text-slate-400">Şeffaf arka planlı PNG önerilir (bayrak, portre, logo) · en fazla 5 MB</span>
      <input type="file" accept={IMAGE_TYPES} hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </label>
  );
}

export function DaysTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<{ items: SpecialDay[]; today: string }>('/api/special-days');
  const [form, setForm] = useState<DayForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const today = data?.today ?? '';
  const patch = (p: Partial<DayForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  const openNew = () =>
    setForm({ name: '', when: today, recurring: true, emoji: '🎉', imageUrl: null, message: '', kind: 'badge', ...defaultPlacement('top-right') });
  const openEdit = (d: SpecialDay) =>
    setForm({
      id: d.id,
      name: d.name,
      when: d.date ?? `${today.slice(0, 4)}-${d.monthDay}`,
      recurring: !d.date,
      emoji: d.emoji ?? '',
      imageUrl: d.imageUrl,
      message: d.message ?? '',
      kind: d.kind,
      position: d.position ?? 'top-right',
      posX: d.posX,
      posY: d.posY,
      size: d.size,
      opacity: d.opacity,
    });

  const save = async () => {
    if (!form) return;
    const [y, m, d] = form.when.split('-');
    setBusy(true);
    try {
      const body = {
        name: form.name,
        emoji: form.emoji || null,
        imageUrl: form.imageUrl,
        message: form.message || null,
        kind: form.kind,
        monthDay: form.recurring ? `${m}-${d}` : null,
        date: form.recurring ? null : `${y}-${m}-${d}`,
        position: form.position,
        posX: form.position === 'custom' ? form.posX : null,
        posY: form.position === 'custom' ? form.posY : null,
        size: form.size,
        opacity: form.opacity,
      };
      if (form.id) await api(`/api/special-days/${form.id}`, { method: 'PATCH', body });
      else await api('/api/special-days', { body });
      const isToday = form.recurring ? `${m}-${d}` === today.slice(5) : form.when === today;
      toast(isToday ? 'Kaydedildi — bugünkü ekranlar güncellendi' : form.id ? 'Kaydedildi' : 'Özel gün eklendi');
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const onImage = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try {
      patch({ imageUrl: await uploadImage(f) });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUploading(false);
    }
  };

  const toggle = async (d: SpecialDay) => {
    try {
      await api(`/api/special-days/${d.id}`, { method: 'PATCH', body: { enabled: !d.enabled } });
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const remove = async (d: SpecialDay) => {
    const ok = await confirm({
      title: 'Özel gün silinsin mi?',
      description: `"${d.name}" takvimden kaldırılır; bugün ekrandaysa hemen kalkar.`,
      confirmLabel: 'Sil',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/api/special-days/${d.id}`, { method: 'DELETE' });
      toast('Silindi');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <p className="max-w-2xl text-[14px] text-slate-500 dark:text-slate-400">
          O gün sabah tüm ekranlarda otomatik gösterilir, gün sonunda kalkar. Görsel ekleyip ekranda istediğiniz yere yerleştirebilirsiniz. Dinî bayramlar her yıl
          değiştiği için "tek seferlik" ekleyin.
        </p>
        <div className="flex-1" />
        <Button variant="primary" icon={Plus} onClick={openNew}>
          Özel gün
        </Button>
      </div>

      {!data ? (
        <SkeletonCard rows={6} />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Takvim boş"
            description="Resmî günleri ve şirketinize özel günleri ekleyin."
            action={<Button variant="primary" icon={Plus} onClick={openNew}>Özel gün ekle</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((d, i) => {
            const isToday = d.monthDay === today.slice(5) || d.date === today;
            return (
              <motion.div key={d.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                <Card
                  onClick={() => openEdit(d)}
                  className={cn('group h-full cursor-pointer p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl', !d.enabled && 'opacity-55', isToday && 'ring-2 ring-emerald-500/40')}
                >
                  <div className="flex items-start gap-4">
                    <DateTile md={d.monthDay} date={d.date} today={isToday} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 text-[14px] font-semibold tracking-tight text-slate-900 dark:text-white">
                          {d.emoji} {d.name}
                        </div>
                        <div className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                          <IconButton icon={Pencil} label="Düzenle" onClick={() => openEdit(d)} className="h-8 w-8" />
                          <IconButton icon={d.enabled ? EyeOff : Eye} label={d.enabled ? 'Kapat' : 'Aç'} onClick={() => toggle(d)} className="h-8 w-8" />
                          <IconButton icon={Trash2} label="Sil" onClick={() => remove(d)} className="h-8 w-8 hover:text-rose-600" />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {isToday && <Badge tone="success" dot>Bugün</Badge>}
                        <Badge icon={d.date ? CalendarDays : Repeat}>{d.date ? fmtDate(d.date) : `Her yıl ${mdLabel(d.monthDay)}`}</Badge>
                        <Badge tone="info">{KIND_LABEL[d.kind]}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <MiniScreen d={d} />
                    <div className="min-w-0 space-y-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {d.kind === 'badge' && (
                        <div className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                          <MapPin size={12} /> {placementLabel(d)}
                        </div>
                      )}
                      {d.imageUrl && (
                        <div className="flex items-center gap-1">
                          <ImagePlus size={12} /> Görsel eklendi
                        </div>
                      )}
                      {d.message && <p className="line-clamp-2">{d.message}</p>}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!form}
        width={1000}
        title={form?.id ? 'Özel günü düzenle' : 'Özel gün ekle'}
        description="Seçilen gün tüm ekranlarda otomatik gösterilir; gün bugünse kaydettiğiniz anda ekranlar güncellenir."
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Vazgeç
            </Button>
            <Button variant="primary" loading={busy} disabled={!form?.name.trim() || !form?.when || uploading} onClick={save}>
              {form?.id ? 'Kaydet' : 'Ekle'}
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-5">
              <div className="grid grid-cols-[80px_1fr] gap-4">
                <Field label="Simge">
                  <Input value={form.emoji} onChange={(e) => patch({ emoji: e.target.value })} className="text-center text-lg" maxLength={8} />
                </Field>
                <Field label="Ad">
                  <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Örn: 29 Ekim Cumhuriyet Bayramı" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tarih">
                  <Input type="date" value={form.when} onChange={(e) => patch({ when: e.target.value })} />
                </Field>
                <div className="flex items-end pb-1.5">
                  <Switch checked={form.recurring} onChange={(v) => patch({ recurring: v })} label="Her yıl tekrarla" />
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Gösterim</span>
                <div className="grid gap-2">
                  {KINDS.map((k) => {
                    const on = form.kind === k.value;
                    return (
                      <button
                        key={k.value}
                        type="button"
                        onClick={() => patch({ kind: k.value })}
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5',
                          on
                            ? 'border-emerald-500/50 bg-emerald-500/[0.07] shadow-sm'
                            : 'border-slate-200/70 bg-white/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20',
                        )}
                      >
                        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', on ? 'bg-linear-to-br from-emerald-500 to-teal-600 text-white' : 'bg-slate-900/5 text-slate-500 dark:bg-white/10 dark:text-slate-300')}>
                          <k.icon size={17} />
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block text-[13px] font-semibold', on ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-800 dark:text-slate-200')}>{k.label}</span>
                          <span className="block text-[12px] text-slate-500 dark:text-slate-400">{k.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Görsel</span>
                <ImageField value={form.imageUrl} uploading={uploading} onFile={onImage} onClear={() => patch({ imageUrl: null })} />
              </div>

              <Field label="Mesaj" hint={form.kind === 'badge' ? 'kiosk/TV ekranında görünür' : undefined}>
                <Textarea value={form.message} onChange={(e) => patch({ message: e.target.value })} maxLength={500} />
              </Field>
            </div>

            <div className="space-y-3">
              <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{form.kind === 'badge' ? 'Ekrandaki yeri' : 'Önizleme'}</span>
              {form.kind === 'badge' ? (
                <PlacementPicker value={form} imageUrl={form.imageUrl} emoji={form.emoji} onChange={(p) => patch(p)} />
              ) : (
                <Preview d={{ kind: form.kind, category: 'genel', title: form.name || 'Özel gün', body: form.message, emoji: form.emoji, imageUrl: form.imageUrl }} />
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
