import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATEGORIES, CATEGORY_LABELS, KIND_LABELS, ROLE_CATEGORIES } from '@ertepano/shared';
import { fmtDateTime, pct, useApi } from '../api';
import type { Announcement } from '../types';
import { Cat, Empty, PageHead, ReadBar, StatusBadge, useAuth } from '../ui';

const TABS = [
  ['', 'Tümü'],
  ['active', 'Yayında'],
  ['scheduled', 'Planlı'],
  ['draft', 'Taslak'],
  ['ended', 'Biten'],
] as const;

export function targetLabel(targets: string[]) {
  if (targets.includes('all')) return 'Herkes';
  return targets
    .map((t) => {
      const [k, ...rest] = t.split(':');
      const v = rest.join(':');
      return k === 'loc' ? `📍 ${v}` : k === 'dep' ? `🏷️ ${v}` : k === 'user' ? `👤 ${v}` : k === 'dev' ? '💻 cihaz' : t;
    })
    .join(', ');
}

export function Announcements() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [showAuto, setShowAuto] = useState(false);
  const q = new URLSearchParams({ ...(status && { status }), ...(category && { category }) }).toString();
  const { data } = useApi<{ items: Announcement[] }>(`/api/announcements${q ? `?${q}` : ''}`, 15000);
  const items = (data?.items ?? []).filter((a) => showAuto || !a.auto);
  const canCreate = ROLE_CATEGORIES[user.role].length > 0;

  return (
    <>
      <PageHead title="Duyurular" sub="Kart, şerit, rozet, anket ve geri sayım yayınları. Acil durumlar ayrı sayfada.">
        {canCreate && (
          <Link className="btn btn-primary" to="/duyurular/yeni">
            ＋ Yeni duyuru
          </Link>
        )}
      </PageHead>

      <div className="tabs">
        {TABS.map(([v, l]) => (
          <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
            {l}
          </button>
        ))}
        <div className="spacer" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 220, margin: '4px 0' }}>
          <option value="">Tüm kategoriler</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <label className="check small" style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} /> Otomatikleri göster
        </label>
      </div>

      <div className="card tbl-wrap">
        {items.length === 0 ? (
          <Empty title="Bu filtrede duyuru yok" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Duyuru</th>
                <th>Tür</th>
                <th>Hedef</th>
                <th>Durum</th>
                <th>Zaman</th>
                <th style={{ width: 200 }}>Erişim</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const s = a.stats!;
                const done = a.requireAck ? s.acked : a.kind === 'survey' ? s.answered : undefined;
                return (
                  <tr key={a.id} className="click" onClick={() => nav(`/duyurular/${a.id}`)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {a.emoji} {a.title}
                      </div>
                      <div className="row small" style={{ gap: 8 }}>
                        <Cat c={a.category} />
                        {a.requireAck && <span className="badge badge-info">Zorunlu onay</span>}
                        {a.auto && <span className="badge">Otomatik</span>}
                      </div>
                    </td>
                    <td className="small">{KIND_LABELS[a.kind]}</td>
                    <td className="small">{targetLabel(a.targets)}</td>
                    <td>
                      <StatusBadge s={a.status} />
                    </td>
                    <td className="small muted">
                      {fmtDateTime(a.startsAt ?? a.createdAt)}
                      {a.endsAt && <div>→ {fmtDateTime(a.endsAt)}</div>}
                    </td>
                    <td>
                      {a.status === 'draft' ? (
                        <span className="small faint">{s.targets} cihaza gidecek</span>
                      ) : (
                        <>
                          <ReadBar targets={Math.max(s.sent, s.targets)} seen={s.seen} done={done} />
                          <div className="small muted" style={{ marginTop: 3 }}>
                            {s.seen}/{Math.max(s.sent, s.targets)} gördü
                            {done !== undefined && ` · %${pct(done, Math.max(s.sent, 1))} ${a.kind === 'survey' ? 'oyladı' : 'onayladı'}`}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
