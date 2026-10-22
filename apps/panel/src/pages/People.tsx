// İK → Personel & kutlamalar: yaklaşan doğum günleri listesi, kişi ekleme (bilgisayarı olmayanlar dahil),
// İK sisteminden toplu liste (önizlemeli), Active Directory eşitlemesi ve kutlamaların nerede gösterileceği.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Cake, CalendarDays, Eye, FileUp, Gift, Laptop, MonitorOff, Pencil, Plus, RefreshCw, Search, Settings2, Trash2, Upload, Users } from 'lucide-react';
import { api, fmtDate, fmtDateTime, useApi } from '../api';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  cn,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyValue,
  listItem,
  Modal,
  SkeletonCard,
  Switch,
  td,
  Textarea,
  th,
  trCls,
  useConfirm,
  useToast,
} from '../ui';
import { mdLabel } from './SpecialDays';

interface Employee {
  id: string;
  username: string | null;
  employeeNo: string | null;
  fullName: string;
  birthMd: string | null;
  startDate: string | null;
  department: string | null;
  location: string | null;
  celebrate: boolean;
  source: 'csv' | 'ldap' | 'manual';
  hasPc: boolean;
}

interface Upcoming {
  date: string;
  inDays: number;
  type: 'birthday' | 'anniversary';
  years?: number;
  employee: Employee;
}

interface ImportResult {
  dryRun: boolean;
  mapping: Record<string, string> | null;
  total: number;
  withBirthday: number;
  withoutPc: number;
  yearsDropped: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: string[];
  errorCount: number;
  sample: { username: string | null; employeeNo: string | null; fullName: string; birthMd: string | null; startDate: string | null; department: string | null; location: string | null }[];
}

interface SyncSettings {
  enabled: boolean;
  birthdayAttr: string;
  hireDateAttr: string;
  employeeNoAttr: string;
  departmentAttr: string;
  locationAttr: string;
  filter: string;
  removeMissing: boolean;
  lastRunAt: string | null;
  lastResult: { created: number; updated: number; unchanged: number; removed: number; total: number; error?: string } | null;
  ldapReady: boolean;
}

interface Celebrations {
  personal: boolean;
  team: boolean;
  kiosk: boolean;
  anniversaries: boolean;
}

const SOURCE: Record<Employee['source'], [string, 'neutral' | 'info' | 'violet']> = {
  csv: ['Liste', 'neutral'],
  ldap: ['AD', 'info'],
  manual: ['Elle', 'violet'],
};

const FIELD_LABELS: Record<string, string> = {
  username: 'Kullanıcı adı',
  email: 'E-posta',
  employeeNo: 'Sicil',
  fullName: 'Ad soyad',
  firstName: 'Ad',
  lastName: 'Soyad',
  birth: 'Doğum günü',
  start: 'İşe giriş',
  department: 'Departman',
  location: 'Lokasyon',
};

const ddmm = (md: string | null) => (md ? `${md.slice(3)}.${md.slice(0, 2)}` : '');
const dmy = (d: string | null) => (d ? `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

type Form = { id?: string; fullName: string; username: string; employeeNo: string; birthMd: string; startDate: string; department: string; location: string; celebrate: boolean };
const emptyForm: Form = { fullName: '', username: '', employeeNo: '', birthMd: '', startDate: '', department: '', location: '', celebrate: true };

// ---- yaklaşanlar -------------------------------------------------------------------------------

function UpcomingCard() {
  const { data } = useApi<{ items: Upcoming[] }>('/api/employees/upcoming?days=30');
  const items = data?.items ?? [];
  return (
    <Card className="h-full">
      <CardHeader icon={CalendarDays} title="Önümüzdeki 30 gün" description="Doğum günleri ve iş yıl dönümleri" />
      <div className="px-3 pb-4">
        {!data ? (
          <div className="px-3"><SkeletonCard rows={4} /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={Gift} title="Yaklaşan kutlama yok" description="Listeye doğum günü eklendikçe burada görünür." />
        ) : (
          <ul className="max-h-[440px] space-y-1 overflow-y-auto pr-1">
            {items.map((u, i) => (
              <motion.li
                key={`${u.employee.id}-${u.type}`}
                variants={listItem}
                initial="hidden"
                animate="show"
                custom={i}
                className={cn('flex items-center gap-3 rounded-2xl px-3 py-2.5', u.inDays === 0 && 'bg-amber-500/10 ring-1 ring-amber-500/30')}
              >
                <span className="text-xl">{u.type === 'birthday' ? '🎂' : '🏅'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{u.employee.fullName}</div>
                  <div className="truncate text-[12px] text-slate-500 dark:text-slate-400">
                    {u.type === 'anniversary' ? `${u.years}. yıl` : 'Doğum günü'}
                    {u.employee.department ? ` · ${u.employee.department}` : ''}
                    {!u.employee.hasPc ? ' · bilgisayarsız' : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold text-slate-700 tabular-nums dark:text-slate-200">{fmtDate(u.date)}</div>
                  <div className="text-[11.5px] text-slate-400">{u.inDays === 0 ? 'bugün' : u.inDays === 1 ? 'yarın' : `${u.inDays} gün sonra`}</div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---- kutlama ayarları --------------------------------------------------------------------------

function CelebrationSettingsCard() {
  const toast = useToast();
  const { data, reload } = useApi<Celebrations>('/api/celebrations/settings');
  const set = async (patch: Partial<Celebrations>) => {
    if (!data) return;
    try {
      await api('/api/celebrations/settings', { method: 'PUT', body: { ...data, ...patch } });
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Card className="h-full">
      <CardHeader icon={Settings2} title="Kutlamalar nerede görünsün?" description="Sabah 08:30'da, gün boyu" />
      {!data ? (
        <div className="px-6 pb-6"><SkeletonCard rows={3} /></div>
      ) : (
        <div className="space-y-4 px-6 pb-6">
          <Switch checked={data.personal} onChange={(v) => set({ personal: v })} label="Kişinin kendi ekranında" description="Bilgisayarı olan ve kullanıcı adı bilinen kişiye kart" />
          <Switch checked={data.kiosk} onChange={(v) => set({ kiosk: v })} label="Kiosk / TV ekranlarında" description="Lokasyon başına “Bugün kutladıklarımız” — bilgisayarı olmayanlar için" />
          <Switch checked={data.team} onChange={(v) => set({ team: v })} label="Ekip arkadaşlarına duyur" description="Aynı departmandaki bilgisayarlara kısa kart" />
          <Switch checked={data.anniversaries} onChange={(v) => set({ anniversaries: v })} label="Kıdem yıl dönümü ve hoş geldin" />
          {data.team && (
            <Callout tone="warning">
              Doğum gününü ekibe duyurmak kişisel verinin paylaşılmasıdır: aydınlatma metninde belirtin ve istemeyen kişinin “Kutlama” anahtarını kapatın.
            </Callout>
          )}
        </div>
      )}
    </Card>
  );
}

// ---- içe aktarma -------------------------------------------------------------------------------

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<ImportResult>('/api/employees/import', { body: { text, replace, dryRun } });
      if (dryRun) setPreview(r);
      else {
        toast(`${r.created} eklendi, ${r.updated} güncellendi${r.removed ? `, ${r.removed} çıkarıldı` : ''}`);
        onDone();
        onClose();
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (f?: File) => f && f.text().then((t) => (setText(t), setPreview(null)));

  return (
    <Modal
      open
      title="İK sisteminden liste yükle"
      description="Logo, Netsis, Mikro, SAP ya da Excel'den dışa aktarılan liste. Sütunlar başlıklarından tanınır; önce önizleme gösterilir."
      width={760}
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>Geri</Button>
            <Button variant="primary" icon={FileUp} loading={busy} disabled={!preview.total} onClick={() => run(false)}>
              {preview.created + preview.updated} kaydı uygula
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={Eye} loading={busy} disabled={!text.trim()} onClick={() => run(true)}>
            Önizle
          </Button>
        )
      }
    >
      {!preview ? (
        <div className="space-y-5">
          <Callout tone="info" title="Tanınan başlıklar (Türkçe / İngilizce)">
            Sicil No · Adı Soyadı (ya da Ad + Soyad) · Doğum Tarihi · İşe Giriş Tarihi · Bölüm / Departman · Şube / Lokasyon · Kullanıcı Adı ya da E-posta.
            Kullanıcı adı boş olan kişi “bilgisayarsız” sayılır ve kiosk ekranlarında kutlanır. Doğum yılı <b>saklanmaz</b>.
          </Callout>
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300/80 px-6 py-6 text-[13px] font-medium text-slate-500 transition-all duration-300 hover:border-emerald-500/60 hover:bg-emerald-500/[0.04] hover:text-emerald-700 dark:border-white/15 dark:hover:text-emerald-300">
            <Upload size={18} /> Dosya seçin (.csv, .txt — Excel: “Farklı kaydet → CSV UTF-8”)
            <input type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <Textarea rows={8} value={text} onChange={(e) => (setText(e.target.value), setPreview(null))} placeholder="…veya Excel'de sütunları seçip kopyalayın ve buraya yapıştırın" className="font-mono text-[12.5px]" />
          <Checkbox checked={replace} onChange={setReplace} label="Listede olmayanları çıkar (yalnızca daha önce listeyle yüklenenler; elle girilenler ve AD kayıtları korunur)" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Yeni', preview.created, 'text-emerald-600'],
              ['Güncellenecek', preview.updated, 'text-sky-600'],
              ['Değişmeyen', preview.unchanged, 'text-slate-500'],
              ['Çıkarılacak', preview.removed, 'text-rose-600'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="rounded-2xl border border-slate-200/60 p-4 dark:border-white/10">
                <div className={cn('text-2xl font-bold tabular-nums', c as string)}>{v as number}</div>
                <div className="text-[12px] text-slate-500">{l}</div>
              </div>
            ))}
          </div>
          <KeyValue
            items={[
              ['Tanınan sütunlar', preview.mapping ? Object.entries(preview.mapping).map(([k, v]) => `${FIELD_LABELS[k] ?? k} ← “${v}”`).join(' · ') : 'Başlık yok — sıra: kullanıcı adı; ad soyad; doğum günü; işe giriş; departman; lokasyon'],
              ['Satır', `${preview.total} kişi · ${preview.withBirthday} doğum günü · ${preview.withoutPc} bilgisayarsız`],
              ['KVKK', preview.yearsDropped ? `${preview.yearsDropped} satırda doğum yılı atıldı (yalnızca gün/ay saklanır)` : 'Doğum yılı yok'],
            ]}
          />
          {preview.errorCount > 0 && (
            <Callout tone="warning" title={`${preview.errorCount} satırda sorun (bu satırlar atlanır ya da tarih boş bırakılır)`}>
              <ul className="list-disc pl-5">{preview.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
            </Callout>
          )}
          <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/10">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <th className={th}>Ad soyad</th>
                  <th className={th}>Kullanıcı</th>
                  <th className={th}>Sicil</th>
                  <th className={th}>Doğum günü</th>
                  <th className={th}>İşe giriş</th>
                  <th className={th}>Departman</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i} className={trCls}>
                    <td className="px-6 py-2 font-medium">{r.fullName}</td>
                    <td className="px-6 py-2 font-mono text-slate-500">{r.username ?? <span className="text-amber-600">bilgisayarsız</span>}</td>
                    <td className="px-6 py-2">{r.employeeNo ?? '—'}</td>
                    <td className="px-6 py-2">{r.birthMd ? mdLabel(r.birthMd) : '—'}</td>
                    <td className="px-6 py-2">{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                    <td className="px-6 py-2">{r.department ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- Active Directory eşitleme -----------------------------------------------------------------

function SyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<SyncSettings>('/api/employees/sync-settings');
  const [form, setForm] = useState<SyncSettings | null>(null);
  const [preview, setPreview] = useState<{ total: number; withBirthday: number; created: number; updated: number; unchanged: number; removed: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const f = form ?? data;

  const save = async () => {
    if (!f) return;
    setBusy('save');
    try {
      const { enabled, birthdayAttr, hireDateAttr, employeeNoAttr, departmentAttr, locationAttr, filter, removeMissing } = f;
      await api('/api/employees/sync-settings', { method: 'PUT', body: { enabled, birthdayAttr, hireDateAttr, employeeNoAttr, departmentAttr, locationAttr, filter, removeMissing } });
      toast('Eşitleme ayarları kaydedildi');
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const sync = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'sync');
    try {
      if (form) await save();
      const r = await api<NonNullable<typeof preview>>('/api/employees/sync', { body: { dryRun } });
      if (dryRun) setPreview(r);
      else {
        toast(`AD eşitlendi: ${r.created} yeni, ${r.updated} güncellendi, ${r.removed} çıkarıldı`);
        onDone();
        reload();
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const set = (patch: Partial<SyncSettings>) => f && (setForm({ ...f, ...patch }), setPreview(null));

  return (
    <Modal
      open
      title="Active Directory'den eşitle"
      description="Doğum günü, işe giriş, departman ve lokasyon AD'de tutuluyorsa ayrı liste gerekmez. Günde bir kez kendiliğinden eşitlenir."
      width={680}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" loading={busy === 'save'} disabled={!form} onClick={save}>Kaydet</Button>
          <Button icon={Eye} loading={busy === 'preview'} disabled={!f?.ldapReady} onClick={() => sync(true)}>Önizle</Button>
          <Button variant="primary" icon={RefreshCw} loading={busy === 'sync'} disabled={!f?.ldapReady || !preview} onClick={() => sync(false)}>Şimdi eşitle</Button>
        </>
      }
    >
      {!f ? (
        <SkeletonCard rows={4} />
      ) : (
        <div className="space-y-5">
          {!f.ldapReady && <Callout tone="warning">Önce Sistem & güvenlik → Active Directory bağlantısını kurun.</Callout>}
          <Switch checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Günlük otomatik eşitleme" description="Yeni işe girenler eklenir, ayrılanlar (devre dışı hesaplar) listeden çıkar" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Doğum günü özniteliği" hint="ör. extensionAttribute1 — boşsa alınmaz">
              <Input value={f.birthdayAttr} onChange={(e) => set({ birthdayAttr: e.target.value })} placeholder="extensionAttribute1" />
            </Field>
            <Field label="İşe giriş özniteliği" hint="isteğe bağlı">
              <Input value={f.hireDateAttr} onChange={(e) => set({ hireDateAttr: e.target.value })} placeholder="extensionAttribute2" />
            </Field>
            <Field label="Sicil"><Input value={f.employeeNoAttr} onChange={(e) => set({ employeeNoAttr: e.target.value })} /></Field>
            <Field label="Departman"><Input value={f.departmentAttr} onChange={(e) => set({ departmentAttr: e.target.value })} /></Field>
            <Field label="Lokasyon"><Input value={f.locationAttr} onChange={(e) => set({ locationAttr: e.target.value })} /></Field>
          </div>
          <Field label="Kullanıcı filtresi" hint="varsayılan: etkin kişi hesapları">
            <Input value={f.filter} onChange={(e) => set({ filter: e.target.value })} className="font-mono text-[12px]" />
          </Field>
          <Checkbox checked={f.removeMissing} onChange={(v) => set({ removeMissing: v })} label="AD'de bulunmayanları listeden çıkar (elle girilenler korunur)" />
          {preview && (
            <Callout tone="success" title="Önizleme">
              AD'de {preview.total} kişi ({preview.withBirthday} doğum günü) · {preview.created} yeni · {preview.updated} güncellenecek · {preview.unchanged} aynı · {preview.removed} çıkarılacak
            </Callout>
          )}
          {f.lastRunAt && (
            <div className="text-[12.5px] text-slate-500">
              Son eşitleme: {fmtDateTime(f.lastRunAt)}
              {f.lastResult?.error ? <span className="text-rose-600"> — hata: {f.lastResult.error}</span> : f.lastResult ? ` — ${f.lastResult.total} kişi, ${f.lastResult.created} yeni, ${f.lastResult.updated} güncel` : ''}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---- sayfa -------------------------------------------------------------------------------------

export function PeopleTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<{ items: Employee[] }>('/api/employees');
  const [q, setQ] = useState('');
  const [onlyNoPc, setOnlyNoPc] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [modal, setModal] = useState<'import' | 'sync' | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const done = () => (reload(), setRefresh((n) => n + 1));

  const items = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr');
    return (data?.items ?? []).filter(
      (e) => (!onlyNoPc || !e.hasPc) && (!s || [e.fullName, e.username, e.employeeNo, e.department, e.location].some((v) => v?.toLocaleLowerCase('tr').includes(s))),
    );
  }, [data, q, onlyNoPc]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = { ...form, username: form.username || null, employeeNo: form.employeeNo || null, birthMd: form.birthMd || null, startDate: form.startDate || null, department: form.department || null, location: form.location || null };
      if (form.id) await api(`/api/employees/${form.id}`, { method: 'PUT', body });
      else await api('/api/employees', { body });
      toast(form.id ? 'Güncellendi' : 'Kişi eklendi');
      setForm(null);
      done();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (e: Employee) => {
    try {
      await api(`/api/employees/${e.id}`, { method: 'PATCH', body: { celebrate: !e.celebrate } });
      done();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };
  const remove = async (e: Employee) => {
    if (!(await confirm({ title: `${e.fullName} silinsin mi?`, description: e.source === 'ldap' ? 'AD eşitlemesi açıksa bir sonraki eşitlemede yeniden eklenir; kutlanmasını istemiyorsanız “Kutlama”yı kapatın.' : 'Kişi listeden çıkar.', confirmLabel: 'Sil', tone: 'danger' }))) return;
    try {
      await api(`/api/employees/${e.id}`, { method: 'DELETE' });
      toast('Silindi');
      done();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };
  const edit = (e: Employee) =>
    setForm({ id: e.id, fullName: e.fullName, username: e.username ?? '', employeeNo: e.employeeNo ?? '', birthMd: ddmm(e.birthMd), startDate: dmy(e.startDate), department: e.department ?? '', location: e.location ?? '', celebrate: e.celebrate });

  const all = data?.items ?? [];
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-[14px] text-slate-500 dark:text-slate-400">
          Doğum günü (yalnızca gün/ay), iş yıl dönümü ve ilk iş günü. Bilgisayarı olan kişiye kendi ekranında, olmayana kiosk ekranında kutlama.
        </p>
        <div className="flex-1" />
        <Button icon={RefreshCw} onClick={() => setModal('sync')}>AD'den eşitle</Button>
        <Button icon={Upload} onClick={() => setModal('import')}>Liste yükle</Button>
        <Button variant="primary" icon={Plus} onClick={() => setForm({ ...emptyForm })}>Kişi ekle</Button>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-12 [&>*]:min-w-0" key={refresh}>
        <div className="xl:col-span-7"><UpcomingCard /></div>
        <div className="xl:col-span-5"><CelebrationSettingsCard /></div>
      </div>

      {!data ? (
        <SkeletonCard rows={6} />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/60 px-6 py-4 dark:border-white/5">
            <div className="w-72"><Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, kullanıcı, sicil, departman…" /></div>
            <Checkbox checked={onlyNoPc} onChange={setOnlyNoPc} label="Yalnızca bilgisayarı olmayanlar" />
            <div className="flex-1" />
            <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500"><Users size={14} /> {all.length} kişi · {all.filter((e) => !e.hasPc).length} bilgisayarsız</span>
          </div>
          {all.length === 0 ? (
            <EmptyState
              icon={Cake}
              title="Personel listesi boş"
              description="İK sisteminizden listeyi yükleyin, Active Directory'den eşitleyin ya da kişileri tek tek ekleyin."
              action={<Button variant="primary" icon={Upload} onClick={() => setModal('import')}>Liste yükle</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Ad soyad</th>
                    <th className={th}>Bilgisayar</th>
                    <th className={th}>Doğum günü</th>
                    <th className={th}>İşe giriş</th>
                    <th className={th}>Departman</th>
                    <th className={th}>Kaynak</th>
                    <th className={th}>Kutlama</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => (
                    <motion.tr key={e.id} variants={listItem} initial="hidden" animate="show" custom={Math.min(i, 20)} className={trCls}>
                      <td className={cn(td, 'font-semibold text-slate-900 dark:text-white')}>
                        {e.fullName}
                        {e.employeeNo && <div className="text-[12px] font-normal text-slate-400">Sicil {e.employeeNo}</div>}
                      </td>
                      <td className={cn(td, 'text-[12.5px]')}>
                        {e.hasPc ? (
                          <span className="flex items-center gap-1.5 font-mono text-slate-500"><Laptop size={13} /> {e.username}</span>
                        ) : (
                          <Badge tone="warning" icon={MonitorOff}>Yok — kiosk</Badge>
                        )}
                      </td>
                      <td className={cn(td, 'text-[13px]')}>{e.birthMd ? <Badge tone="violet" icon={Cake}>{mdLabel(e.birthMd)}</Badge> : <span className="text-slate-400">—</span>}</td>
                      <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>{e.startDate ? fmtDate(e.startDate) : '—'}</td>
                      <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>
                        {e.department ?? '—'}
                        {e.location && <div className="flex items-center gap-1 text-[12px] text-slate-400"><Building2 size={11} /> {e.location}</div>}
                      </td>
                      <td className={td}><Badge tone={SOURCE[e.source][1]}>{SOURCE[e.source][0]}</Badge></td>
                      <td className={td}><Switch checked={e.celebrate} onChange={() => toggle(e)} /></td>
                      <td className={cn(td, 'whitespace-nowrap text-right')}>
                        <IconButton icon={Pencil} label="Düzenle" onClick={() => edit(e)} />
                        <IconButton icon={Trash2} label="Sil" onClick={() => remove(e)} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Callout tone="info" className="mt-6">
        KVKK: Doğum yılı saklanmaz. Kutlama istemeyen çalışan için “Kutlama” anahtarını kapatın — liste yeniden yüklense ya da AD eşitlense de bu tercih korunur.
        Elle eklenen ya da düzenlenen kişiler toplu yüklemede silinmez.
      </Callout>

      <Modal
        open={!!form}
        title={form?.id ? 'Kişiyi düzenle' : 'Kişi ekle'}
        description="Bilgisayarı olmayan çalışanlar için kullanıcı adını boş bırakın; kutlaması kiosk ekranında görünür."
        onClose={() => setForm(null)}
        footer={<Button variant="primary" loading={busy} disabled={!form?.fullName.trim()} onClick={save}>{form?.id ? 'Kaydet' : 'Ekle'}</Button>}
      >
        {form && (
          <div className="space-y-5">
            <Field label="Ad soyad"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Windows kullanıcı adı" hint="bilgisayarı yoksa boş"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ayse.demir" /></Field>
              <Field label="Sicil no" hint="isteğe bağlı"><Input value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} /></Field>
              <Field label="Doğum günü" hint="GG.AA — yıl yok"><Input value={form.birthMd} onChange={(e) => setForm({ ...form, birthMd: e.target.value })} placeholder="15.07" /></Field>
              <Field label="İşe giriş" hint="GG.AA.YYYY"><Input value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} placeholder="01.09.2019" /></Field>
              <Field label="Departman"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
              <Field label="Lokasyon" hint="kiosk eşleşmesi için"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            </div>
            <Switch checked={form.celebrate} onChange={(v) => setForm({ ...form, celebrate: v })} label="Kutlansın" description="Kişi istemiyorsa kapatın" />
          </div>
        )}
      </Modal>
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={done} />}
      {modal === 'sync' && <SyncModal onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
