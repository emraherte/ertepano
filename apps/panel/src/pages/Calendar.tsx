import { useState } from 'react';
import { motion } from 'framer-motion';
import { Cake, CalendarHeart, FileUp, Flag, Upload } from 'lucide-react';
import { api, fmtDate, useApi } from '../api';
import { Badge, Button, Callout, Card, Checkbox, cn, EmptyState, listItem, Modal, PageHeader, SkeletonCard, Switch, Tabs, td, Textarea, th, trCls, useToast } from '../ui';
import { DaysTab, mdLabel } from './SpecialDays';

interface Employee {
  username: string;
  fullName: string;
  birthMd: string | null;
  startDate: string | null;
  department: string | null;
  location: string | null;
  celebrate: boolean;
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
