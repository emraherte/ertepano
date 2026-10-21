import { useState } from 'react';
import { Building2, KeyRound, Lock, UserCog } from 'lucide-react';
import { ROLE_LABELS } from '@ertepano/shared';
import { api } from '../api';
import { Avatar, Badge, Button, Callout, Card, CardHeader, Field, Input, KeyValue, PageHeader, useAuth, useToast } from '../ui';
import { KioskLinks } from './AgentSetup';
import { MfaCard } from '../components/MfaCard';

export function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const ldap = user.authSource === 'ldap';
  const mismatch = p.again.length > 0 && p.next !== p.again;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p.next !== p.again) return toast('Yeni parolalar eşleşmiyor', true);
    setBusy(true);
    try {
      await api('/api/auth/password', { body: { current: p.current, next: p.next } });
      toast('Parola değiştirildi');
      setP({ current: '', next: '', again: '' });
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow={<><UserCog size={14} /> Profil</>} title="Hesabım" description="Kimlik bilgileriniz ve oturum güvenliği." />
      <div className="grid gap-6 xl:grid-cols-12 [&>*]:min-w-0">
        <Card className="relative overflow-hidden p-8 xl:col-span-5">
          <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-linear-to-br from-emerald-400/25 to-teal-300/10 blur-3xl" />
          <div className="relative flex items-center gap-5">
            <Avatar name={user.fullName} size={64} />
            <div className="min-w-0">
              <div className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white">{user.fullName}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="success" dot>
                  {ROLE_LABELS[user.role]}
                </Badge>
                {ldap ? <Badge tone="info" icon={Building2}>Active Directory</Badge> : <Badge icon={KeyRound}>Yerel hesap</Badge>}
              </div>
            </div>
          </div>
          <KeyValue className="relative mt-8" items={[['Kullanıcı adı', <span className="font-mono">{user.username}</span>], ['Rol', ROLE_LABELS[user.role]], ['Kimlik kaynağı', ldap ? 'Active Directory (LDAP)' : 'ErtePano yerel']]} />
        </Card>

        <Card className="xl:col-span-7" delay={0.05}>
          <CardHeader icon={Lock} title="Parola" description={ldap ? 'Kurumsal hesabınızla yönetilir' : 'En az 10 karakter; tahmin edilmesi zor bir ifade seçin'} />
          <div className="px-6 pb-6">
            {ldap ? (
              <Callout tone="info" icon={Building2}>
                Parolanız Active Directory'de yönetilir. Değiştirmek için Ctrl+Alt+Del → Parola değiştir.
              </Callout>
            ) : (
              <form onSubmit={save} className="space-y-5">
                <Field label="Mevcut parola">
                  <Input type="password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} autoComplete="current-password" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Yeni parola" hint={`${p.next.length}/10+`}>
                    <Input type="password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} autoComplete="new-password" />
                  </Field>
                  <Field label="Yeni parola (tekrar)" hint={mismatch ? <span className="text-rose-500">eşleşmiyor</span> : undefined}>
                    <Input type="password" value={p.again} onChange={(e) => setP({ ...p, again: e.target.value })} autoComplete="new-password" />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" loading={busy} disabled={!p.current || p.next.length < 10 || mismatch}>
                    Parolayı güncelle
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>

        <div className="xl:col-span-12">
          <MfaCard />
        </div>

        {user.role !== 'viewer' && (
          <div className="xl:col-span-12">
            <KioskLinks />
          </div>
        )}
      </div>
    </>
  );
}
