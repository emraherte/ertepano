import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KIND_LABELS, ROLE_CATEGORIES } from '@ertepano/shared';
import { api, fmtDateTime, pct, useApi } from '../api';
import type { Announcement, Stats } from '../types';
import { Preview } from '../components/Preview';
import { Cat, Empty, PageHead, StatusBadge, useAuth, useToast } from '../ui';
import { targetLabel } from './Announcements';

interface DeliveryRow {
  deviceId: string;
  hostname: string;
  userLogin: string | null;
  location: string | null;
  department: string | null;
  sentAt: string | null;
  seenAt: string | null;
  readAt: string | null;
  ackedAt: string | null;
  dismissedAt: string | null;
  answeredAt: string | null;
}

export function AnnouncementDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, reload } = useApi<{ item: Announcement; stats: Stats; answers: Record<string, number>; deliveries: DeliveryRow[] }>(
    `/api/announcements/${id}`,
    10000,
  );
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

  const byLocation = useMemo(() => {
    const m = new Map<string, { sent: number; seen: number; acked: number }>();
    (data?.deliveries ?? []).forEach((d) => {
      const k = d.location ?? 'Lokasyonsuz';
      const e = m.get(k) ?? { sent: 0, seen: 0, acked: 0 };
      e.sent++;
      if (d.seenAt) e.seen++;
      if (d.ackedAt) e.acked++;
      m.set(k, e);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [data]);

  if (!data) return null;
  const a = data.item;
  const s = data.stats;
  const canEdit = ROLE_CATEGORIES[user.role].includes(a.category) && a.kind !== 'fullscreen';
  const base = Math.max(s.sent, 1);

  const act = async (path: string, msg: string) => {
    try {
      await api(`/api/announcements/${a.id}${path}`, { method: 'POST' });
      toast(msg);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    if (!confirm('Bu duyuru silinsin mi?')) return;
    try {
      await api(`/api/announcements/${a.id}`, { method: 'DELETE' });
      toast('Silindi');
      nav('/duyurular');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const doneKey: keyof DeliveryRow = a.requireAck ? 'ackedAt' : a.kind === 'survey' ? 'answeredAt' : 'seenAt';
  const rows = data.deliveries.filter((d) => (filter === 'all' ? true : filter === 'done' ? !!d[doneKey] : !d[doneKey]));

  const exportCsv = () => {
    const head = ['Bilgisayar', 'Kullanıcı', 'Lokasyon', 'Departman', 'Gönderildi', 'Görüldü', 'Onaylandı', 'Kapatıldı'];
    const lines = data.deliveries.map((d) =>
      [d.hostname, d.userLogin, d.location, d.department, d.sentAt, d.seenAt, d.ackedAt, d.dismissedAt].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'),
    );
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `onay-raporu-${a.title.slice(0, 30)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHead
        title={`${a.emoji ?? ''} ${a.title}`}
        sub={
          <span className="row" style={{ gap: 8 }}>
            <StatusBadge s={a.status} /> <Cat c={a.category} /> · {KIND_LABELS[a.kind]} · {targetLabel(a.targets)} · {a.createdBy}
          </span>
        }
      >
        <Link className="btn btn-ghost" to="/duyurular">← Duyurular</Link>
        {canEdit && a.status !== 'ended' && <Link className="btn" to={`/duyurular/${a.id}/duzenle`}>Düzenle</Link>}
        {canEdit && a.status === 'draft' && <button className="btn btn-primary" onClick={() => act('/publish', 'Yayınlandı')}>🚀 Yayınla</button>}
        {canEdit && (a.status === 'active' || a.status === 'scheduled') && (
          <button className="btn btn-danger" onClick={() => confirm('Yayın şimdi bitirilsin ve ekranlardan kaldırılsın mı?') && act('/end', 'Yayın bitirildi')}>
            ⏹ Yayını bitir
          </button>
        )}
        {canEdit && a.status !== 'active' && <button className="btn btn-ghost" onClick={remove}>Sil</button>}
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <div className="grid grid-3">
            <div className="card stat">
              <div className="label">Gönderildi</div>
              <div className="value">{s.sent}</div>
              <div className="sub">hedefte {s.targets} cihaz</div>
            </div>
            <div className="card stat">
              <div className="label">Gördü</div>
              <div className="value">%{pct(s.seen, base)}</div>
              <div className="sub">{s.seen} kişi</div>
            </div>
            <div className="card stat">
              <div className="label">{a.requireAck ? 'Onayladı' : a.kind === 'survey' ? 'Oy verdi' : 'Okudu/kapattı'}</div>
              <div className="value">%{pct(a.requireAck ? s.acked : a.kind === 'survey' ? s.answered : s.seen, base)}</div>
              <div className="sub">{a.requireAck ? s.acked : a.kind === 'survey' ? s.answered : s.seen} kişi</div>
            </div>
          </div>

          {a.kind === 'survey' && (
            <div className="card card-pad stack">
              <h2>Anket sonuçları</h2>
              {(a.options ?? []).map((o) => {
                const n = data.answers[o] ?? 0;
                const total = Object.values(data.answers).reduce((x, y) => x + y, 0);
                return (
                  <div key={o}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{o}</span>
                      <b>{n} · %{pct(n, total)}</b>
                    </div>
                    <div className="progress" style={{ height: 10, marginTop: 4 }}>
                      <div style={{ width: `${pct(n, total)}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="small faint">Anket yanıtları kişi bazında gösterilmez.</p>
            </div>
          )}

          {byLocation.length > 1 && (
            <div className="card card-pad stack">
              <h2>Lokasyona göre</h2>
              {byLocation.map(([loc, v]) => (
                <div key={loc}>
                  <div className="row small" style={{ justifyContent: 'space-between' }}>
                    <b>{loc}</b>
                    <span className="muted">{v.seen}/{v.sent} gördü{a.requireAck && ` · ${v.acked} onay`}</span>
                  </div>
                  <div className="progress" style={{ marginTop: 4 }}>
                    {a.requireAck && <div className="ack" style={{ width: `${pct(v.acked, v.sent)}%` }} />}
                    <div style={{ width: `${pct(v.seen - (a.requireAck ? v.acked : 0), v.sent)}%`, opacity: 0.55 }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>{a.requireAck ? 'Onay listesi' : 'Teslim listesi'}</h2>
              <div className="row">
                <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 170 }}>
                  <option value="all">Tümü ({data.deliveries.length})</option>
                  <option value="pending">{a.requireAck ? 'Onaylamayanlar' : 'Görmeyenler'}</option>
                  <option value="done">{a.requireAck ? 'Onaylayanlar' : 'Görenler'}</option>
                </select>
                {a.kind !== 'survey' && <button className="btn btn-sm" onClick={exportCsv}>⬇ CSV</button>}
              </div>
            </div>
            {rows.length === 0 ? (
              <Empty title="Kayıt yok" icon="🕊️">Duyuru hedefteki cihazlara ulaştıkça burada listelenir.</Empty>
            ) : (
              <div className="tbl-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Bilgisayar</th>
                      <th>Kullanıcı</th>
                      <th>Lokasyon</th>
                      <th>Gördü</th>
                      <th>{a.requireAck ? 'Onayladı' : a.kind === 'survey' ? 'Oy' : 'Kapattı'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.deviceId}>
                        <td className="mono">{d.hostname}</td>
                        <td>{d.userLogin ?? <span className="faint">—</span>}</td>
                        <td className="small">{d.location ?? '—'}</td>
                        <td className="small">{d.seenAt ? fmtDateTime(d.seenAt) : <span className="faint">—</span>}</td>
                        <td className="small">
                          {a.requireAck
                            ? d.ackedAt ? <span className="badge badge-ok">✓ {fmtDateTime(d.ackedAt)}</span> : <span className="badge badge-warn">Bekliyor</span>
                            : a.kind === 'survey'
                              ? d.answeredAt ? '✓' : '—'
                              : d.dismissedAt ? fmtDateTime(d.dismissedAt) : d.readAt ? 'okudu' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 20 }}>
          <Preview d={{ ...a, emergency: !!a.emergencyId }} />
          <div className="card card-pad">
            <dl className="kv small">
              <dt>Başlangıç</dt>
              <dd>{fmtDateTime(a.startsAt)}</dd>
              <dt>Bitiş</dt>
              <dd>{a.endsAt ? fmtDateTime(a.endsAt) : 'Süresiz (elle bitirilir)'}</dd>
              <dt>Kiosk/TV</dt>
              <dd>{a.showOnKiosk ? 'Gösteriliyor' : 'Hayır'}</dd>
              <dt>Oluşturan</dt>
              <dd>{a.createdBy}</dd>
            </dl>
            {a.body && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{a.body}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
