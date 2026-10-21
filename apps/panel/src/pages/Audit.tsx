import { useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, Search } from 'lucide-react';
import { fmtDateTime, useApi } from '../api';
import { Avatar, Card, cn, EmptyState, Input, listItem, PageHeader, SkeletonCard, td, th, trCls } from '../ui';

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
  ldap_login: 'AD ile giriş yaptı',
  ldap_login_failed: 'AD girişi başarısız',
  ldap_tested: 'LDAP bağlantısını test etti',
  ldap_user_provisioned: 'AD kullanıcısı oluşturuldu',
  announcement_created: 'Duyuru oluşturdu',
  announcement_published: 'Duyuru yayınladı',
  announcement_updated: 'Duyuru güncelledi',
  announcement_ended: 'Duyuru bitirdi',
  announcement_deleted: 'Duyuru sildi',
  emergency_started: 'ACİL DURUM BAŞLATTI',
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

const tone = (a: string) =>
  a.startsWith('emergency') || a.endsWith('_failed') || a === 'enroll_rejected'
    ? 'text-rose-600 dark:text-rose-400'
    : a.startsWith('drill')
      ? 'text-amber-600 dark:text-amber-400'
      : a.includes('deleted') || a.includes('revoked')
        ? 'text-slate-900 dark:text-white'
        : 'text-slate-700 dark:text-slate-200';

export function Audit() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data } = useApi<{ items: Row[] }>(`/api/audit${applied ? `?q=${encodeURIComponent(applied)}` : ''}`);
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow={<><ScrollText size={14} /> Uyum</>}
        title="Denetim kaydı"
        description="Panelde yapılan her işlem silinemez şekilde kaydedilir (saklama: 2 yıl)."
        actions={
          <Input
            icon={Search}
            placeholder="Kişi veya işlem ara… (Enter)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setApplied(q)}
            onBlur={() => setApplied(q)}
            className="w-full sm:w-80"
          />
        }
      />
      {!data ? (
        <SkeletonCard rows={8} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState icon={ScrollText} title="Kayıt bulunamadı" description={applied ? `"${applied}" için eşleşen işlem yok.` : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Zaman</th>
                    <th className={th}>Kim</th>
                    <th className={th}>İşlem</th>
                    <th className={th}>Ayrıntı</th>
                    <th className={th}>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <motion.tr key={r.id} variants={listItem} initial="hidden" animate="show" custom={i} className={trCls}>
                      <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500 tabular-nums')}>{fmtDateTime(r.createdAt)}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.actor ?? 'Sistem'} size={28} />
                          <span className="text-[13px] font-semibold text-slate-900 dark:text-white">{r.actor ?? 'sistem'}</span>
                        </div>
                      </td>
                      <td className={cn(td, 'text-[13px] font-medium', tone(r.action))}>{ACTIONS[r.action] ?? r.action}</td>
                      <td className={cn(td, 'max-w-[420px]')}>
                        <div className="truncate font-mono text-[12px] text-slate-400" title={r.details ?? ''}>
                          {r.details}
                        </div>
                      </td>
                      <td className={cn(td, 'font-mono text-[12px] text-slate-400')}>{r.ip}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
