import { useState } from 'react';
import { REPORT_LABELS, type ReportKind } from '@ertepano/shared';
import { api, fmtAgo, fmtDateTime, useApi } from '../api';
import { Empty, Modal, PageHead, StatusBadge, useToast } from '../ui';

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

export function Reports() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { data, reload } = useApi<{ items: Report[] }>(`/api/reports${status ? `?status=${status}` : ''}`, 15000);
  const [open, setOpen] = useState<Report | null>(null);
  const [note, setNote] = useState('');

  const update = async (r: Report, s: Report['status']) => {
    try {
      await api(`/api/reports/${r.id}`, { method: 'PATCH', body: { status: s, handlerNote: note || undefined } });
      toast('Güncellendi');
      setOpen(null);
      setNote('');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const items = data?.items ?? [];
  return (
    <>
      <PageHead title="Çalışan bildirimleri" sub="Çalışanların ekrandaki ErtePano simgesinden gönderdiği IT talepleri ve ramak kala bildirimleri." />
      <div className="tabs">
        {[['', 'Tümü'], ['open', 'Açık'], ['in_progress', 'İşlemde'], ['closed', 'Kapanan']].map(([v, l]) => (
          <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      <div className="card">
        {items.length === 0 ? (
          <Empty icon="📥" title="Bildirim yok">Çalışanlar sağ alttaki simgeden "IT'ye bildir" veya "Ramak kala bildir" seçeneğini kullandığında burada görünür.</Empty>
        ) : (
          <table className="tbl">
            <thead><tr><th>Bildirim</th><th>Kimden</th><th>Lokasyon</th><th>Zaman</th><th>Durum</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="click" onClick={() => { setOpen(r); setNote(r.handlerNote ?? ''); }}>
                  <td style={{ maxWidth: 460 }}>
                    <span className={`badge ${r.kind === 'near_miss' ? 'badge-danger' : 'badge-info'}`}>{r.kind === 'near_miss' ? '⚠️ Ramak kala' : '🛠️ IT'}</span>
                    <div style={{ marginTop: 4 }}>{r.text}</div>
                  </td>
                  <td className="small">{r.anonymous ? <i className="faint">Anonim</i> : <>{r.userLogin ?? '—'}<div className="mono faint">{r.hostname}</div></>}</td>
                  <td className="small">{r.location ?? '—'}</td>
                  <td className="small muted">{fmtAgo(r.createdAt)}</td>
                  <td><StatusBadge s={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal
          title={REPORT_LABELS[open.kind]}
          onClose={() => setOpen(null)}
          footer={
            <>
              {open.status !== 'in_progress' && <button className="btn" onClick={() => update(open, 'in_progress')}>İşleme al</button>}
              {open.status !== 'closed' ? (
                <button className="btn btn-primary" onClick={() => update(open, 'closed')}>✓ Kapat</button>
              ) : (
                <button className="btn" onClick={() => update(open, 'open')}>Yeniden aç</button>
              )}
            </>
          }
        >
          <div className="stack">
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{open.text}</p>
            <dl className="kv small">
              <dt>Gönderen</dt><dd>{open.anonymous ? 'Anonim' : open.userLogin ?? '—'}</dd>
              <dt>Lokasyon</dt><dd>{open.location ?? '—'}</dd>
              <dt>Zaman</dt><dd>{fmtDateTime(open.createdAt)}</dd>
              {open.handledBy && (<><dt>İlgilenen</dt><dd>{open.handledBy}</dd></>)}
            </dl>
            {open.deviceSummary && (
              <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
                <b className="small">Otomatik eklenen cihaz özeti</b>
                <dl className="kv small" style={{ marginTop: 8 }}>
                  <dt>Bilgisayar</dt><dd className="mono">{open.deviceSummary.hostname} · {open.deviceSummary.ip}</dd>
                  <dt>Sistem</dt><dd>{open.deviceSummary.os}</dd>
                  <dt>CPU</dt><dd>{open.deviceSummary.cpuModel} · %{Number(open.deviceSummary.cpuLoad ?? 0).toFixed(0)}</dd>
                  <dt>RAM</dt><dd>{Math.round(Number(open.deviceSummary.ramFreeMb ?? 0) / 1024)} / {Math.round(Number(open.deviceSummary.ramTotalMb ?? 0) / 1024)} GB boş</dd>
                  <dt>Disk</dt><dd>{Number(open.deviceSummary.diskFreeGb ?? 0).toFixed(0)} / {Number(open.deviceSummary.diskTotalGb ?? 0).toFixed(0)} GB boş</dd>
                  <dt>Açık kalma</dt><dd>{(Number(open.deviceSummary.uptimeSec ?? 0) / 86400).toFixed(1)} gün</dd>
                </dl>
              </div>
            )}
            <label className="field">İşlem notu<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yapılan işlem / alınan önlem" /></label>
          </div>
        </Modal>
      )}
    </>
  );
}
