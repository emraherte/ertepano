import { useMemo, useState } from 'react';
import { api, fmtAgo, fmtDateTime, useApi } from '../api';
import type { Device } from '../types';
import { Empty, Modal, PageHead, StatusBadge, useToast } from '../ui';

const FILTERS = [
  ['all', 'Tümü'],
  ['pending', 'Onay bekleyen'],
  ['alerts', 'Uyarılı'],
  ['offline', 'Çevrimdışı'],
] as const;

const gb = (mb?: number | null) => (mb ? `${(mb / 1024).toFixed(0)} GB` : '—');
const diskPct = (d: Device) => (d.diskTotalGb && d.diskFreeGb != null ? Math.round((1 - d.diskFreeGb / d.diskTotalGb) * 100) : null);
const days = (s?: number | null) => (s ? `${(s / 86400).toFixed(s < 86400 ? 1 : 0)} gün` : '—');

function Spark({ values, max, color = 'var(--brand)' }: { values: number[]; max: number; color?: string }) {
  if (values.length < 2) return <span className="faint small">Yeterli veri yok</span>;
  const w = 260;
  const h = 44;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function DeviceModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data } = useApi<{ item: Device; telemetry: { cpuLoad: number; ramFreeMb: number; diskFreeGb: number; at: string }[]; reports: { id: string; kind: string; text: string; status: string; createdAt: string }[] }>(`/api/devices/${id}`);
  const [edit, setEdit] = useState<{ location: string; department: string; note: string } | null>(null);
  if (!data) return null;
  const d = data.item;
  const e = edit ?? { location: d.location ?? '', department: d.department ?? '', note: d.note ?? '' };

  const save = async (extra: Record<string, unknown> = {}) => {
    try {
      await api(`/api/devices/${d.id}`, { method: 'PATCH', body: { ...e, ...extra } });
      toast('Cihaz güncellendi');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  return (
    <Modal
      title={d.hostname}
      onClose={onClose}
      width={720}
      footer={
        <>
          {d.status !== 'blocked' ? (
            <button className="btn btn-ghost" onClick={() => confirm('Cihaz engellensin mi? Bağlantısı kesilir, duyuru alamaz.') && save({ status: 'blocked' })}>Engelle</button>
          ) : (
            <button className="btn" onClick={() => save({ status: 'approved' })}>Engeli kaldır</button>
          )}
          <div className="spacer" />
          {d.status === 'pending' && <button className="btn" onClick={() => save({ status: 'approved' })}>✓ Onayla ve kaydet</button>}
          <button className="btn btn-primary" onClick={() => save()}>Kaydet</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="row">
          <StatusBadge s={d.status} />
          <span className="row small"><span className={`dot ${d.online ? 'on' : ''}`} /> {d.online ? 'Çevrimiçi' : `Son görülme ${fmtAgo(d.lastSeen)}`}</span>
          {d.alerts.filter((a) => a !== 'Onay bekliyor').map((a) => <span key={a} className="badge badge-warn">{a}</span>)}
        </div>
        <div className="grid grid-3">
          <label className="field">Lokasyon<input value={e.location} onChange={(x) => setEdit({ ...e, location: x.target.value })} placeholder="Örn: Gebze Fabrika" /></label>
          <label className="field">Departman<input value={e.department} onChange={(x) => setEdit({ ...e, department: x.target.value })} placeholder="Örn: Üretim" /></label>
          <label className="field">Not<input value={e.note} onChange={(x) => setEdit({ ...e, note: x.target.value })} placeholder="Örn: Vardiya amiri PC" /></label>
        </div>
        <dl className="kv small">
          <dt>Kullanıcı</dt><dd>{d.lastUser ?? '—'}</dd>
          <dt>IP / MAC</dt><dd className="mono">{d.ip ?? '—'} · {d.mac ?? '—'}</dd>
          <dt>İşletim sistemi</dt><dd>{d.os ?? '—'}</dd>
          <dt>İşlemci</dt><dd>{d.cpuModel ?? '—'} · anlık %{d.cpuLoad?.toFixed(0) ?? '—'}</dd>
          <dt>Bellek</dt><dd>{gb(d.ramTotalMb)} (boş {gb(d.ramFreeMb)})</dd>
          <dt>Disk (C:)</dt><dd>{d.diskTotalGb?.toFixed(0) ?? '—'} GB · %{diskPct(d) ?? '—'} dolu</dd>
          <dt>Açık kalma</dt><dd>{days(d.uptimeSec)}</dd>
          <dt>Ajan</dt><dd>{d.agentVersion ?? '—'} · ilk kayıt {fmtDateTime(d.firstSeen)}</dd>
        </dl>
        <div className="grid grid-2">
          <div>
            <div className="small muted">İşlemci yükü (7 gün)</div>
            <Spark values={data.telemetry.map((t) => t.cpuLoad)} max={100} />
          </div>
          <div>
            <div className="small muted">Boş disk (GB, 7 gün)</div>
            <Spark values={data.telemetry.map((t) => t.diskFreeGb)} max={Math.max(...data.telemetry.map((t) => t.diskFreeGb), 1)} color="var(--info)" />
          </div>
        </div>
        {data.reports.length > 0 && (
          <div>
            <b>Bu cihazdan gelen bildirimler</b>
            {data.reports.map((r) => (
              <div key={r.id} className="small" style={{ marginTop: 6 }}>
                <StatusBadge s={r.status} /> {r.text} <span className="faint">· {fmtAgo(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Devices() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Device[] }>('/api/devices', 15000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ location: string; department: string } | null>(null);

  const all = data?.items ?? [];
  const items = useMemo(() => {
    const s = q.toLocaleLowerCase('tr');
    return all.filter((d) => {
      if (filter === 'pending' && d.status !== 'pending') return false;
      if (filter === 'alerts' && !d.alerts.some((a) => a !== 'Onay bekliyor')) return false;
      if (filter === 'offline' && d.online) return false;
      if (!s) return true;
      return [d.hostname, d.lastUser, d.ip, d.location, d.department, d.os].some((v) => v?.toLocaleLowerCase('tr').includes(s));
    });
  }, [all, filter, q]);

  const counts = {
    all: all.length,
    pending: all.filter((d) => d.status === 'pending').length,
    alerts: all.filter((d) => d.alerts.some((a) => a !== 'Onay bekliyor')).length,
    offline: all.filter((d) => !d.online).length,
  };

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const runBulk = async (body: Record<string, unknown>) => {
    try {
      await api('/api/devices/bulk', { body: { ids: [...sel], ...body } });
      toast(`${sel.size} cihaz güncellendi`);
      setSel(new Set());
      setBulk(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <PageHead title="Cihazlar" sub={`${all.filter((d) => d.online).length} çevrimiçi · ${all.length} kayıtlı`}>
        <a className="btn" href="/api/devices.csv">⬇ Excel/CSV</a>
      </PageHead>

      <div className="tabs">
        {FILTERS.map(([v, l]) => (
          <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>
            {l} <span className="faint">({counts[v]})</span>
          </button>
        ))}
        <div className="spacer" />
        <input placeholder="Ara: bilgisayar, kullanıcı, IP…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260, margin: '4px 0' }} />
      </div>

      {sel.size > 0 && (
        <div className="alert alert-info row" style={{ marginBottom: 12 }}>
          <b>{sel.size} cihaz seçili</b>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => runBulk({ approve: true })}>✓ Onayla</button>
          <button className="btn btn-sm" onClick={() => setBulk({ location: '', department: '' })}>📍 Lokasyon/departman ata</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Seçimi kaldır</button>
        </div>
      )}

      <div className="card tbl-wrap">
        {items.length === 0 ? (
          <Empty icon="💻" title="Cihaz yok">Ajan kurulumu sayfasından kayıt anahtarı oluşturup ajanı dağıtın.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={items.length > 0 && items.every((d) => sel.has(d.id))} onChange={(e) => setSel(e.target.checked ? new Set(items.map((d) => d.id)) : new Set())} />
                </th>
                <th>Bilgisayar</th>
                <th>Kullanıcı</th>
                <th>Lokasyon / Departman</th>
                <th>Sistem</th>
                <th>Disk</th>
                <th>Açık kalma</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const dp = diskPct(d);
                return (
                  <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} /></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}><span className={`dot ${d.online ? 'on' : ''}`} /><b className="mono">{d.hostname}</b></div>
                      <div className="small faint mono">{d.ip}</div>
                    </td>
                    <td className="small">{d.lastUser ?? '—'}</td>
                    <td className="small">{d.location ?? <span className="faint">—</span>}<div className="faint">{d.department}</div></td>
                    <td className="small">{d.os?.replace('Windows', 'Win') ?? '—'}<div className="faint">{gb(d.ramTotalMb)} RAM</div></td>
                    <td className="small" style={{ minWidth: 90 }}>
                      {dp != null ? (
                        <>
                          %{dp}
                          <div className="progress" style={{ marginTop: 3 }}><div style={{ width: `${dp}%`, background: dp >= 90 ? 'var(--danger)' : dp >= 75 ? 'var(--warn)' : undefined }} /></div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="small">{days(d.uptimeSec)}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {d.status !== 'approved' && <StatusBadge s={d.status} />}
                        {d.alerts.filter((a) => a !== 'Onay bekliyor').map((a) => <span key={a} className="badge badge-warn">{a}</span>)}
                        {!d.online && d.status === 'approved' && !d.alerts.length && <span className="small faint">{fmtAgo(d.lastSeen)}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && <DeviceModal id={open} onClose={() => setOpen(null)} onSaved={reload} />}
      {bulk && (
        <Modal
          title={`${sel.size} cihaza etiket ata`}
          onClose={() => setBulk(null)}
          footer={<button className="btn btn-primary" onClick={() => runBulk({ ...(bulk.location && { location: bulk.location }), ...(bulk.department && { department: bulk.department }) })}>Uygula</button>}
        >
          <div className="stack">
            <label className="field">Lokasyon<input value={bulk.location} onChange={(e) => setBulk({ ...bulk, location: e.target.value })} placeholder="Boş bırakılırsa değişmez" /></label>
            <label className="field">Departman<input value={bulk.department} onChange={(e) => setBulk({ ...bulk, department: e.target.value })} placeholder="Boş bırakılırsa değişmez" /></label>
          </div>
        </Modal>
      )}
    </>
  );
}
