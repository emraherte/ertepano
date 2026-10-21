// Sistem → Güvenlik: iki faktörlü doğrulamanın hangi rollerde zorunlu olduğu.
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ROLE_LABELS, ROLES, type Role } from '@ertepano/shared';
import { api, useApi } from '../api';
import { Badge, Button, Callout, Card, CardHeader, Switch, useToast } from '../ui';

interface Security {
  mfaRequiredRoles: Role[];
  counts: { role: Role; total: number; mfa: number | null }[];
}

export function SecurityPolicyCard() {
  const toast = useToast();
  const { data, reload } = useApi<Security>('/api/settings/security');
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setRoles(data.mfaRequiredRoles);
  }, [data]);

  if (!data) return null;
  const dirty = [...roles].sort().join() !== [...data.mfaRequiredRoles].sort().join();

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/settings/security', { method: 'PUT', body: { mfaRequiredRoles: roles } });
      toast('Güvenlik politikası kaydedildi');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="İki faktörlü doğrulama politikası"
        description="Zorunlu rollerdeki kullanıcılar bir sonraki girişte 2FA kurmadan panele giremez"
        action={
          dirty && (
            <Button size="sm" variant="primary" loading={busy} onClick={save}>
              Kaydet
            </Button>
          )
        }
      />
      <div className="space-y-2 px-6 pb-6">
        {ROLES.map((r) => {
          const c = data.counts.find((x) => x.role === r);
          const on = roles.includes(r);
          return (
            <div key={r} className="flex items-center gap-4 rounded-2xl border border-slate-200/60 bg-white/50 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
              <Switch checked={on} onChange={(v) => setRoles(v ? [...roles, r] : roles.filter((x) => x !== r))} label={ROLE_LABELS[r]} />
              <div className="flex-1" />
              {c ? (
                <Badge tone={c.mfa === c.total ? 'success' : on ? 'warning' : 'neutral'}>
                  {c.mfa ?? 0}/{c.total} kullanıcıda açık
                </Badge>
              ) : (
                <span className="text-[12px] text-slate-400">kullanıcı yok</span>
              )}
            </div>
          );
        })}
        <Callout tone="info" className="mt-3">
          Acil durum yayını yapabilen roller (Yönetici, İSG, IT) için zorunlu tutmanız önerilir. Telefonunu kaybeden kullanıcı için Kullanıcılar sayfasından "2FA sıfırla".
        </Callout>
      </div>
    </Card>
  );
}
