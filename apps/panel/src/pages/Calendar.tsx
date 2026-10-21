import { useState } from 'react';
import { motion } from 'framer-motion';
import { Cake, CalendarDays, CalendarHeart, Eye, EyeOff, FileUp, Flag, Plus, Repeat, Trash2, Upload } from 'lucide-react';
import { api, fmtDate, useApi } from '../api';
import { Badge, Button, Callout, Card, Checkbox, cn, EmptyState, Field, IconButton, Input, listItem, Modal, PageHeader, Select, SkeletonCard, Switch, Tabs, td, Textarea, th, trCls, useToast } from '../ui';

interface SpecialDay {
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

interface Employee {
  username: string;
  fullName: string;
  birthMd: string | null;
  startDate: string | null;
  department: string | null;
  location: string | null;
  celebrate: boolean;
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const mdLabel = (md: string | null) => (md ? `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}` : '—');
const KIND = { badge: 'Köşe rozeti', toast: 'Kart', banner: 'Üst şerit' };

function DateTile({ md, date, today }: { md: string | null; date: string | null; today: boolean }) {
  const m = date ? date.slice(5) : md;
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border text-center leading-none',
        today ? 'border-emerald-500/40 bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25' : 'border-slate-200/70 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200',
      )}
    >
      <span className="text-[16px] font-bold tabular-nums">{m ? Number(m.slice(3)) : '—'}</span>
      <span className={cn('mt-0.5 text-[10px] font-semibold uppercase', today ? 'text-white/80' : 'text-slate-400')}>{m ? MONTHS[Number(m.slice(0, 2)) - 1] : ''}</span>
    </div>
  );
}

function DaysTab() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: SpecialDay[]; today: string }>('/api/special-days');
  const [form, setForm] = useState<{ name: string; when: string; recurring: boolean; emoji: string; message: string; kind: SpecialDay['kind'] } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!form) return;
    const [y, m, d] = form.when.split('-');
    setBusy(true);
    try {
      await api('/api/special-days', {
        body: {
          name: form.name,
          emoji: form.emoji || null,
          message: form.message || null,
          kind: form.kind,
          ...(form.recurring ? { monthDay: `${m}-${d}` } : { date: `${y}-${m}-${d}` }),
        },
      });
      toast('Özel gün eklendi');
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
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
    if (!confirm(`"${d.name}" silinsin mi?`)) return;
    try {
      await api(`/api/special-days/${d.id}`, { method: 'DELETE' });
      toast('Silindi');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const today = data?.today ?? '';
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <p className="max-w-2xl text-[14px] text-slate-500 dark:text-slate-400">
          O gün sabah tüm ekranlarda otomatik gösterilir, gün sonunda kalkar. Dinî bayramlar her yıl değiştiği için "tek seferlik" ekleyin.
        </p>
        <div className="flex-1" />
        <Button variant="primary" icon={Plus} onClick={() => setForm({ name: '', when: today, recurring: true, emoji: '🎉', message: '', kind: 'badge' })}>
          Özel gün
        </Button>
      </div>
      {!data ? (
        <SkeletonCard rows={6} />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title="Takvim boş" description="Resmî günleri ve şirketinize özel günleri ekleyin." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((d, i) => {
            const isToday = d.monthDay === today.slice(5) || d.date === today;
            return (
              <motion.div key={d.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                <Card className={cn('group h-full p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl', !d.enabled && 'opacity-55', isToday && 'ring-2 ring-emerald-500/40')}>
                  <div className="flex items-start gap-4">
                    <DateTile md={d.monthDay} date={d.date} today={isToday} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 text-[14px] font-semibold tracking-tight text-slate-900 dark:text-white">
                          {d.emoji} {d.name}
                        </div>
                        <div className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
                          <IconButton icon={d.enabled ? EyeOff : Eye} label={d.enabled ? 'Kapat' : 'Aç'} onClick={() => toggle(d)} className="h-8 w-8" />
                          <IconButton icon={Trash2} label="Sil" onClick={() => remove(d)} className="h-8 w-8 hover:text-rose-600" />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {isToday && <Badge tone="success" dot>Bugün</Badge>}
                        <Badge icon={d.date ? CalendarDays : Repeat}>{d.date ? fmtDate(d.date) : `Her yıl ${mdLabel(d.monthDay)}`}</Badge>
                        <Badge tone="info">{KIND[d.kind]}</Badge>
                      </div>
                      {d.message && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{d.message}</p>}
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
        title="Özel gün ekle"
        description="Seçilen gün tüm ekranlarda otomatik gösterilir."
        onClose={() => setForm(null)}
        footer={
          <Button variant="primary" loading={busy} disabled={!form?.name || !form?.when} onClick={add}>
            Ekle
          </Button>
        }
      >
        {form && (
          <div className="space-y-5">
            <div className="grid grid-cols-[80px_1fr] gap-4">
              <Field label="Simge">
                <Input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className="text-center text-lg" />
              </Field>
              <Field label="Ad">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn: Ramazan Bayramı, kuruluş yıl dönümü" />
              </Field>
            </div>
            <Field label="Tarih">
              <Input type="date" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
            </Field>
            <Switch checked={form.recurring} onChange={(v) => setForm({ ...form, recurring: v })} label="Her yıl tekrarla" description="Kapalıysa yalnızca seçilen yılda gösterilir." />
            <Field label="Gösterim">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SpecialDay['kind'] })}>
                <option value="badge">Köşe rozeti (çalışmayı bölmez)</option>
                <option value="banner">Üst şerit</option>
                <option value="toast">Kart</option>
              </Select>
            </Field>
            <Field label="Mesaj">
              <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

function PeopleTab() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Employee[] }>('/api/employees');
  const [csv, setCsv] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  const importCsv = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: number; errors: string[] }>('/api/employees/import', { body: { csv, replace } });
      toast(`${r.imported} çalışan yüklendi${r.errors.length ? `, ${r.errors.length} satır atlandı` : ''}`);
      if (r.errors.length) toast(r.errors.slice(0, 3).join(' · '), true);
      setCsv(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (f?: File) => f && f.text().then(setCsv);
  const toggle = async (e: Employee) => {
    try {
      await api(`/api/employees/${encodeURIComponent(e.username)}`, { method: 'PATCH', body: { celebrate: !e.celebrate } });
      reload();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const items = data?.items ?? [];
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <p className="max-w-2xl text-[14px] text-slate-500 dark:text-slate-400">
          Doğum günü (sadece gün/ay), iş yıl dönümü ve ilk iş günü için kişiye özel kart, <b className="text-slate-700 dark:text-slate-200">kişinin kendi ekranında</b> sabah gösterilir.
        </p>
        <div className="flex-1" />
        <Button variant="primary" icon={Upload} onClick={() => setCsv('')}>
          CSV yükle
        </Button>
      </div>
      <Callout tone="info" className="mb-6">
        KVKK: Doğum yılı saklanmaz. Kutlama istemeyen çalışan için satırdaki anahtarı kapatın. Eşleştirme, bilgisayarda oturum açan Windows kullanıcı adıyla yapılır.
      </Callout>
      {!data ? (
        <SkeletonCard rows={6} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              icon={Cake}
              title="Çalışan listesi boş"
              description="İK sisteminizden dışa aktardığınız listeyi CSV olarak yükleyin."
              action={<Button variant="primary" icon={Upload} onClick={() => setCsv('')}>CSV yükle</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Ad soyad</th>
                    <th className={th}>Kullanıcı adı</th>
                    <th className={th}>Doğum günü</th>
                    <th className={th}>İşe giriş</th>
                    <th className={th}>Departman</th>
                    <th className={th}>Kutlama</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => (
                    <motion.tr key={e.username} variants={listItem} initial="hidden" animate="show" custom={i} className={trCls}>
                      <td className={cn(td, 'font-semibold text-slate-900 dark:text-white')}>{e.fullName}</td>
                      <td className={cn(td, 'font-mono text-[12.5px] text-slate-500')}>{e.username}</td>
                      <td className={cn(td, 'text-[13px]')}>{e.birthMd ? <Badge tone="violet" icon={Cake}>{mdLabel(e.birthMd)}</Badge> : <span className="text-slate-400">—</span>}</td>
                      <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>{e.startDate ? fmtDate(e.startDate) : '—'}</td>
                      <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>
                        {e.department ?? '—'}
                        {e.location && <div className="text-[12px] text-slate-400">{e.location}</div>}
                      </td>
                      <td className={td}>
                        <Switch checked={e.celebrate} onChange={() => toggle(e)} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <Modal
        open={csv !== null}
        title="Çalışan listesi yükle"
        description="Noktalı virgül, virgül veya sekme ile ayrılmış; ilk satır başlık olabilir."
        width={680}
        onClose={() => setCsv(null)}
        footer={
          <Button variant="primary" icon={FileUp} loading={busy} disabled={!csv?.trim()} onClick={importCsv}>
            Yükle
          </Button>
        }
      >
        {csv !== null && (
          <div className="space-y-5">
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 font-mono text-[12.5px] leading-relaxed text-emerald-200">
              kullanici_adi;ad_soyad;dogum_gunu;ise_giris;departman;lokasyon{'\n'}ayse.demir;Ayşe Demir;15.07;01.09.2019;İK;İstanbul Merkez
            </pre>
            <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300/80 px-6 py-6 text-[13px] font-medium text-slate-500 transition-all duration-300 hover:border-emerald-500/60 hover:bg-emerald-500/[0.04] hover:text-emerald-700 dark:border-white/15 dark:hover:text-emerald-300">
              <Upload size={18} /> Dosya seçin (.csv, .txt)
              <input type="file" accept=".csv,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="…veya Excel'den kopyalayıp buraya yapıştırın" className="font-mono text-[12.5px]" />
            <Checkbox checked={replace} onChange={setReplace} label="Mevcut listeyi tamamen değiştir" />
          </div>
        )}
      </Modal>
    </>
  );
}

export function CalendarPage() {
  const [tab, setTab] = useState<'days' | 'people'>('days');
  return (
    <>
      <PageHeader eyebrow={<><CalendarHeart size={14} /> İK otomasyonu</>} title="Takvim & kutlamalar" description="Bir kez kurun, her yıl kendiliğinden çalışsın." />
      <Tabs
        className="mb-8"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'days', label: 'Özel günler', icon: Flag },
          { value: 'people', label: 'Doğum günü & kıdem', icon: Cake },
        ]}
      />
      {tab === 'days' ? <DaysTab /> : <PeopleTab />}
    </>
  );
}
