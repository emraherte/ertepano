import { Link } from 'react-router-dom';
import type { Category } from '@ertepano/shared';
import { fmtAgo, pct, useApi } from '../api';
import type { Announcement } from '../types';
import { Cat, Empty, PageHead, ReadBar, useAuth } from '../ui';

interface Dash {
  devices: { total: number; online: number; pending: number; alerts: number | null };
  activeCount: number;
  active: Announcement[];
  recent: (Announcement & { stats: { sent: number; seen: number; acked: number; answered: number } })[];
  openReports: Record<string, number>;
  emergency: { id: string; title: string; drill: boolean; startedAt: string } | null;
  celebrations: { fullName: string; department: string | null; type: 'birthday' | 'anniversary' }[];
  pendingAcks: { id: string; title: string; category: Category; sent: number; acked: number }[];
  canPublish: Category[];
}

const hour = new Date().getHours();
const greeting = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';

export function Dashboard() {
  const { user } = useAuth();
  const { data } = useApi<Dash>('/api/dashboard', 10000);
  if (!data) return null;
  const d = data.devices;

  return (
    <>
      <PageHead title={`${greeting}, ${user.fullName.split(' ')[0]}`} sub="Bugün ekranlarda neler oluyor, bir bakışta.">
        {data.canPublish.length > 0 && (
          <Link className="btn btn-primary" to="/duyurular/yeni">
            ＋ Yeni duyuru
          </Link>
        )}
        <Link className="btn btn-danger" to="/acil">
          🚨 Acil durum
        </Link>
      </PageHead>

      {data.emergency && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          🚨 {data.emergency.drill ? 'Tatbikat' : 'Acil durum'} devam ediyor: <b>{data.emergency.title}</b> ({fmtAgo(data.emergency.startedAt)}).{' '}
          <Link to="/acil">Yoklamayı izle →</Link>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label"><span className="dot on" /> Çevrimiçi ekran</div>
          <div className="value">{d.online}</div>
          <div className="sub">{d.total} kayıtlı cihazdan · %{pct(d.online, d.total)}</div>
        </div>
        <div className="card stat">
          <div className="label">📢 Yayındaki duyuru</div>
          <div className="value">{data.activeCount}</div>
          <div className="sub">özel gün ve kutlamalar dahil</div>
        </div>
        <div className="card stat">
          <div className="label">📥 Açık çalışan bildirimi</div>
          <div className="value">{(data.openReports.it_help ?? 0) + (data.openReports.near_miss ?? 0)}</div>
          <div className="sub">
            {data.openReports.it_help !== undefined && `${data.openReports.it_help} IT · `}
            {data.openReports.near_miss !== undefined && `${data.openReports.near_miss} ramak kala`}
            {!Object.keys(data.openReports).length && 'yetkiniz dahilinde yok'}
          </div>
        </div>
        <div className="card stat">
          <div className="label">🛠️ Cihaz uyarısı</div>
          <div className="value">{d.alerts ?? '—'}</div>
          <div className="sub">{d.pending ? `${d.pending} cihaz onay bekliyor` : 'disk, yeniden başlatma, erişim'}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Son duyurular</h2>
            <Link to="/duyurular" className="small">Tümü →</Link>
          </div>
          {data.recent.length === 0 ? (
            <Empty title="Henüz duyuru yok">Şablonlardan biriyle 30 saniyede ilk duyurunuzu yayınlayın.</Empty>
          ) : (
            <table className="tbl">
              <tbody>
                {data.recent.map((a) => (
                  <tr key={a.id}>
                    <td style={{ width: '58%' }}>
                      <Link to={`/duyurular/${a.id}`} style={{ color: 'inherit', fontWeight: 600 }}>
                        {a.emoji} {a.title}
                      </Link>
                      <div className="row small faint" style={{ gap: 8 }}>
                        <Cat c={a.category} /> · {fmtAgo(a.startsAt)}
                      </div>
                    </td>
                    <td>
                      <ReadBar targets={a.stats.sent} seen={a.stats.seen} done={a.requireAck ? a.stats.acked : a.kind === 'survey' ? a.stats.answered : undefined} />
                      <div className="small muted" style={{ marginTop: 4 }}>
                        %{pct(a.stats.seen, a.stats.sent)} gördü
                        {a.requireAck && ` · %${pct(a.stats.acked, a.stats.sent)} onayladı`}
                        {a.kind === 'survey' && ` · ${a.stats.answered} oy`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Onay bekleyen zorunlu duyurular</h2>
            </div>
            {data.pendingAcks.length === 0 ? (
              <div className="card-pad muted">Şu an zorunlu onaylı aktif duyuru yok.</div>
            ) : (
              <div className="card-pad stack">
                {data.pendingAcks.map((p) => (
                  <Link key={p.id} to={`/duyurular/${p.id}`} style={{ color: 'inherit' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b>{p.title}</b>
                      <span className="small muted">{p.acked}/{p.sent} onay</span>
                    </div>
                    <div className="progress" style={{ marginTop: 6 }}>
                      <div className="ack" style={{ width: `${pct(p.acked, p.sent)}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Bugün kutluyoruz 🎉</h2>
            </div>
            {data.celebrations.length === 0 ? (
              <div className="card-pad muted">Bugün doğum günü veya iş yıl dönümü yok.</div>
            ) : (
              <div className="card-pad stack">
                {data.celebrations.map((c, i) => (
                  <div key={i} className="row">
                    <span style={{ fontSize: 20 }}>{c.type === 'birthday' ? '🎂' : '🏅'}</span>
                    <div>
                      <b>{c.fullName}</b>
                      <div className="small muted">{c.type === 'birthday' ? 'Doğum günü' : 'İş yıl dönümü'}{c.department && ` · ${c.department}`}</div>
                    </div>
                  </div>
                ))}
                <p className="small faint">Kişiye özel kart, kendi ekranında sabah 08:30'da otomatik gösterilir.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
