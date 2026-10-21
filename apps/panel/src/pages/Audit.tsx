import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link2, ScrollText, Search } from 'lucide-react';
import { api, fmtDateTime, useApi } from '../api';
import { Avatar, Button, Card, cn, useToast, EmptyState, Input, listItem, PageHeader, SkeletonCard, td, th, trCls } from '../ui';

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
  mfa_enabled: '2FA açtı',
  mfa_disabled: '2FA kapattı',
  mfa_failed: 'Hatalı 2FA kodu',
  mfa_reset: '2FA sıfırladı',
  mfa_recovery_regenerated: 'Kurtarma kodlarını yeniledi',
  security_settings_updated: 'Güvenlik politikasını değiştirdi',
  device_reenrolled_pending: 'Cihaz kimliği kanıtlanamadı — onaya düştü',
  audit_verified: 'Denetim kaydını doğruladı',
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
  const toast = useToast();
  const [verifying, setVerifying] = useState(false);
  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api<{ ok: boolean; checked: number; brokenAt: number | null }>('/api/audit/verify');
      if (r.ok) toast(`Zincir sağlam — ${r.checked} kayıt doğrulandı`);
      else toast(`UYARI: kayıt #${r.brokenAt} değiştirilmiş ya da silinmiş`, true);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<><ScrollText size={14} /> Uyum</>}
        title="Denetim kaydı"
        description="Panelde yapılan her işlem silinemez şekilde kaydedilir; her kayıt bir öncekinin özetini taşır (saklama: 2 yıl)."
        actions={
          <>
          <Button icon={Link2} loading={verifying} onClick={verify}>Bütünlüğü doğrula</Button>
          <Input
            icon={Search}
            placeholder="Kişi veya işlem ara… (Enter)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setApplied(q)}
            onBlur={() => setApplied(q)}
            className="w-full sm:w-80"
          />
          </>
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
