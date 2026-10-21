import { useState } from 'react';
import { api, fmtDate, useApi } from '../api';
import { Empty, Modal, PageHead, useToast } from '../ui';

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

function DaysTab() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: SpecialDay[]; today: string }>('/api/special-days');
  const [form, setForm] = useState<{ name: string; when: string; recurring: boolean; emoji: string; message: string; kind: SpecialDay['kind'] } | null>(null);

  const add = async () => {
    if (!form) return;
    const [y, m, d] = form.when.split('-');
    try {
      await api('/api/special-days', {
        body: {
          name: form.name, emoji: form.emoji || null, message: form.message || null, kind: form.kind,
          ...(form.recurring ? { monthDay: `${m}-${d}` } : { date: `${y}-${m}-${d}` }),
        },
      });
      toast('Özel gün eklendi');
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const toggle = async (d: SpecialDay) => {
    await api(`/api/special-days/${d.id}`, { method: 'PATCH', body: { enabled: !d.enabled } });
    reload();
  };
  const remove = async (d: SpecialDay) => {
    if (!confirm(`"${d.name}" silinsin mi?`)) return;
    await api(`/api/special-days/${d.id}`, { method: 'DELETE' });
    reload();
  };

  const today = data?.today ?? '';
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted">O gün sabah tüm ekranlarda otomatik gösterilir, gün sonunda kalkar. Dinî bayramlar her yıl değiştiği için "tek seferlik" ekleyin.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setForm({ name: '', when: today, recurring: true, emoji: '🎉', message: '', kind: 'badge' })}>＋ Özel gün</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Gün</th><th>Tarih</th><th>Gösterim</th><th>Mesaj</th><th /></tr></thead>
          <tbody>
            {(data?.items ?? []).map((d) => {
              const isToday = d.monthDay === today.slice(5) || d.date === today;
              return (
                <tr key={d.id} style={{ opacity: d.enabled ? 1 : 0.5 }}>
                  <td><b>{d.emoji} {d.name}</b> {isToday && <span className="badge badge-ok">Bugün</span>}</td>
                  <td className="small">{d.date ? fmtDate(d.date) : `Her yıl ${mdLabel(d.monthDay)}`}</td>
                  <td className="small">{KIND[d.kind]}</td>
                  <td className="small muted" style={{ maxWidth: 380 }}>{d.message}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggle(d)}>{d.enabled ? 'Kapat' : 'Aç'}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(d)}>Sil</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title="Özel gün ekle" onClose={() => setForm(null)} footer={<button className="btn btn-primary" disabled={!form.name || !form.when} onClick={add}>Ekle</button>}>
          <div className="stack">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="field" style={{ width: 80 }}>Simge<input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} style={{ textAlign: 'center' }} /></label>
              <label className="field" style={{ flex: 1 }}>Ad<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn: Ramazan Bayramı, Şirket kuruluş yıl dönümü" /></label>
            </div>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>Tarih<input type="date" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
              <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} /> Her yıl tekrarla</label>
            </div>
            <label className="field">Gösterim
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SpecialDay['kind'] })}>
                <option value="badge">Köşe rozeti (çalışmayı bölmez)</option>
                <option value="banner">Üst şerit</option>
                <option value="toast">Kart</option>
              </select>
            </label>
            <label className="field">Mesaj<textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </>
  );
}

function PeopleTab() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Employee[] }>('/api/employees');
  const [csv, setCsv] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);

  const importCsv = async () => {
    try {
      const r = await api<{ imported: number; errors: string[] }>('/api/employees/import', { body: { csv, replace } });
      toast(`${r.imported} çalışan yüklendi${r.errors.length ? `, ${r.errors.length} satır atlandı` : ''}`);
      if (r.errors.length) toast(r.errors.slice(0, 3).join(' · '), true);
      setCsv(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const onFile = (f?: File) => f && f.text().then(setCsv);
  const toggle = async (e: Employee) => {
    await api(`/api/employees/${encodeURIComponent(e.username)}`, { method: 'PATCH', body: { celebrate: !e.celebrate } });
    reload();
  };

  const items = data?.items ?? [];
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted">Doğum günü (sadece gün/ay), iş yıl dönümü ve ilk iş günü için kişiye özel kart, <b>kişinin kendi ekranında</b> sabah gösterilir.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCsv('')}>⬆ CSV yükle</button>
      </div>
      <div className="alert alert-info small" style={{ marginBottom: 12 }}>
        KVKK: Doğum yılı saklanmaz. Kutlama istemeyen çalışan için satırdaki anahtarı kapatın. Eşleştirme, bilgisayarda oturum açan Windows kullanıcı adıyla yapılır.
      </div>
      <div className="card tbl-wrap">
        {items.length === 0 ? (
          <Empty icon="🎂" title="Çalışan listesi boş">İK sisteminizden dışa aktardığınız listeyi CSV olarak yükleyin.</Empty>
        ) : (
          <table className="tbl">
            <thead><tr><th>Ad soyad</th><th>Kullanıcı adı</th><th>Doğum günü</th><th>İşe giriş</th><th>Departman</th><th>Kutlama</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.username}>
                  <td><b>{e.fullName}</b></td>
                  <td className="mono small">{e.username}</td>
                  <td className="small">{mdLabel(e.birthMd)}</td>
                  <td className="small">{e.startDate ? fmtDate(e.startDate) : '—'}</td>
                  <td className="small">{e.department ?? '—'}{e.location && <div className="faint">{e.location}</div>}</td>
                  <td><label className="check"><input type="checkbox" checked={e.celebrate} onChange={() => toggle(e)} /> {e.celebrate ? 'Açık' : 'Kapalı'}</label></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {csv !== null && (
        <Modal title="Çalışan listesi yükle" width={680} onClose={() => setCsv(null)} footer={<button className="btn btn-primary" disabled={!csv.trim()} onClick={importCsv}>Yükle</button>}>
          <div className="stack">
            <p className="small muted">Sütun sırası (noktalı virgül, virgül veya sekme ile ayrılmış; ilk satır başlık olabilir):</p>
            <pre className="code">kullanici_adi;ad_soyad;dogum_gunu;ise_giris;departman;lokasyon{'\n'}ayse.demir;Ayşe Demir;15.07;01.09.2019;İK;İstanbul Merkez</pre>
            <input type="file" accept=".csv,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
            <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="…veya Excel'den kopyalayıp buraya yapıştırın" className="mono" />
            <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Mevcut listeyi tamamen değiştir</label>
          </div>
        </Modal>
      )}
    </>
  );
}

export function CalendarPage() {
  const [tab, setTab] = useState<'days' | 'people'>('days');
  return (
    <>
      <PageHead title="Takvim & kutlamalar" sub="Bir kez kurun, her yıl kendiliğinden çalışsın." />
      <div className="tabs">
        <button className={tab === 'days' ? 'on' : ''} onClick={() => setTab('days')}>🇹🇷 Özel günler</button>
        <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>🎂 Doğum günü & kıdem</button>
      </div>
      {tab === 'days' ? <DaysTab /> : <PeopleTab />}
    </>
  );
}
