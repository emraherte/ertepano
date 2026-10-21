import { useState } from 'react';
import { fmtDateTime, useApi } from '../api';
import { PageHead } from '../ui';

interface Row {
  id: number;
  actor: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

const ACTIONS: Record<string, string> = {
  login: 'Giriş yaptı',
  login_failed: 'Hatalı giriş denemesi',
  announcement_created: 'Duyuru oluşturdu',
  announcement_published: 'Duyuru yayınladı',
  announcement_updated: 'Duyuru güncelledi',
  announcement_ended: 'Duyuru bitirdi',
  announcement_deleted: 'Duyuru sildi',
  emergency_started: '🚨 ACİL DURUM BAŞLATTI',
  emergency_ended: 'Acil durumu bitirdi',
  drill_started: 'Tatbikat başlattı',
  drill_ended: 'Tatbikatı bitirdi',
  device_enrolled: 'Cihaz kaydoldu',
  enroll_rejected: 'Kayıt reddedildi',
  device_updated: 'Cihaz güncelledi',
  devices_bulk_updated: 'Toplu cihaz güncelledi',
  device_deleted: 'Cihaz sildi',
  devices_exported: 'Cihaz listesini dışa aktardı',
  enroll_key_created: 'Kayıt anahtarı oluşturdu',
  enroll_key_revoked: 'Kayıt anahtarı iptal etti',
  report_updated: 'Bildirim güncelledi',
  user_created: 'Kullanıcı ekledi',
  user_updated: 'Kullanıcı güncelledi',
  password_changed: 'Parolasını değiştirdi',
  employees_imported: 'Çalışan listesi yükledi',
  special_day_created: 'Özel gün ekledi',
  media_uploaded: 'Görsel yükledi',
  kiosk_key_rotated: 'Kiosk anahtarını yeniledi',
};

export function Audit() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data } = useApi<{ items: Row[] }>(`/api/audit${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);
  return (
    <>
      <PageHead title="Denetim kaydı" sub="Panelde yapılan her işlem silinemez şekilde kaydedilir (saklama: 2 yıl).">
        <input
          placeholder="Kişi veya işlem ara…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setDebounced(q)}
          onBlur={() => setDebounced(q)}
          style={{ width: 260 }}
        />
      </PageHead>
      <div className="card tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Zaman</th><th>Kim</th><th>İşlem</th><th>Ayrıntı</th><th>IP</th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAt)}</td>
                <td className="small"><b>{r.actor ?? 'sistem'}</b></td>
                <td className="small" style={{ color: r.action.startsWith('emergency') ? 'var(--danger)' : undefined }}>{ACTIONS[r.action] ?? r.action}</td>
                <td className="small mono faint" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details ?? ''}>{r.details}</td>
                <td className="small mono faint">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
