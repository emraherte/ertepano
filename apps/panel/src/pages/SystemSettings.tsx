import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, CheckCircle2, CircleSlash, KeyRound, Network, PlugZap, Search, Settings2, ShieldCheck, Users, XCircle } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@ertepano/shared';
import { api, useApi } from '../api';
import { SecurityPolicyCard } from '../components/SecurityPolicyCard';
import { LdapForm } from '../components/LdapForm';
import { SecurityChecklist } from '../components/SecurityChecklist';
import { Badge, Button, Callout, Card, CardHeader, cn, Field, IconTile, Input, KeyValue, PageHeader, PageSkeleton, StatCard, useToast } from '../ui';

interface LdapSettings {
  enabled: boolean;
  url: string | null;
  baseDn: string | null;
  bindDn: string | null;
  bindPasswordSet: boolean;
  userFilter: string;
  domain: string | null;
  startTls: boolean;
  caFile: string | null;
  rejectUnauthorized: boolean;
  groups: Partial<Record<Role, string>>;
  defaultRole: Role | null;
  users: Record<string, number>;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  groups: { role: Role; group: string; found: boolean }[];
  user?: { found: boolean; dn?: string; fullName?: string; role?: Role | null; disabled?: boolean };
}


const ROLE_ORDER: Role[] = ['admin', 'isg', 'it', 'ik', 'viewer'];

export function SystemSettings() {
  const toast = useToast();
  const { data, reload } = useApi<LdapSettings>('/api/settings/ldap');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  if (!data) return <PageSkeleton />;

  const test = async () => {
    setBusy(true);
    try {
      setResult(await api<TestResult>('/api/settings/ldap/test', { body: { username: username || undefined } }));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<><Settings2 size={14} /> Yönetim</>}
        title="Sistem & güvenlik"
        description="Active Directory ile tek oturum: çalışanlar Windows hesaplarıyla girer, rolleri AD gruplarından gelir."
      />

      <div className="mb-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <SecurityChecklist compact />
        <SecurityPolicyCard />
      </div>

      <div className="grid gap-6 xl:grid-cols-12 [&>*]:min-w-0">
        <Card className="relative overflow-hidden p-8 xl:col-span-8">
          <div className={cn('pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full blur-3xl', data.enabled ? 'bg-emerald-400/25' : 'bg-slate-400/15')} />
          <div className="relative flex flex-wrap items-center gap-5">
            <IconTile icon={Building2} tone={data.enabled ? 'emerald' : 'slate'} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Active Directory</h2>
                {data.enabled ? <Badge tone="success" dot>Etkin</Badge> : <Badge dot>Kapalı</Badge>}
              </div>
              <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
                {data.enabled ? <>Bağlantı: <span className="font-mono text-slate-700 dark:text-slate-300">{data.url}</span></> : 'Yalnızca yerel panel hesapları kullanılıyor.'}
              </p>
            </div>
            {data.enabled && (
              <Button variant="primary" icon={PlugZap} loading={busy} onClick={test}>
                Bağlantıyı test et
              </Button>
            )}
          </div>

          <div className="relative mt-8">
            <LdapForm onSaved={reload} />
          </div>
        </Card>

        <div className="grid gap-6 xl:col-span-4">
          <StatCard icon={Building2} tone="sky" label="AD kullanıcısı" value={data.users.ldap ?? 0} sub="ilk girişte otomatik oluşur" delay={0.05} />
          <StatCard icon={KeyRound} tone="violet" label="Yerel hesap" value={data.users.local ?? 0} sub="AD çökerse yedek giriş" delay={0.1} />
        </div>

        <Card className="xl:col-span-7" delay={0.1}>
          <CardHeader icon={Users} title="Rol eşlemesi" description="Birden fazla gruba üye kullanıcı en yetkili rolü alır (yukarıdan aşağıya)" />
          <div className="space-y-2 px-6 pb-6">
            {ROLE_ORDER.map((r) => {
              const g = data.groups[r];
              const tested = result?.groups.find((x) => x.role === r);
              return (
                <div key={r} className="flex items-center gap-4 rounded-2xl border border-slate-200/60 bg-white/50 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
                  <div className="w-28 shrink-0 text-[13px] font-semibold text-slate-900 dark:text-white">{ROLE_LABELS[r]}</div>
                  <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-500">{g ?? <span className="font-sans text-slate-400">eşlenmemiş</span>}</div>
                  {tested && (tested.found ? <Badge tone="success" icon={CheckCircle2}>Bulundu</Badge> : <Badge tone="danger" icon={XCircle}>Bulunamadı</Badge>)}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="xl:col-span-5" delay={0.15}>
          <CardHeader icon={Search} title="Kullanıcı sorgula" description="Parola sormadan bir AD hesabının hangi rolle gireceğini görün" />
          <div className="space-y-4 px-6 pb-6">
            <div className="flex gap-3">
              <Field label="" className="flex-1">
                <Input icon={Network} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ad.soyad veya SIRKET\ad.soyad" disabled={!data.enabled} onKeyDown={(e) => e.key === 'Enter' && test()} />
              </Field>
              <Button onClick={test} loading={busy} disabled={!data.enabled} className="self-end">
                Sorgula
              </Button>
            </div>

            {result && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <Callout tone={result.ok ? 'success' : 'danger'} title={result.message}>
                  {result.ok && <span className="text-[12px] opacity-80">{result.latencyMs} ms</span>}
                </Callout>
                {result.user && (
                  <div className="rounded-2xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.03]">
                    {!result.user.found ? (
                      <div className="flex items-center gap-2 text-[13px] text-slate-500"><CircleSlash size={15} /> Kullanıcı bulunamadı</div>
                    ) : (
                      <KeyValue
                        items={[
                          ['Ad', result.user.fullName ?? '—'],
                          ['DN', <span className="font-mono text-[11px] break-all">{result.user.dn}</span>],
                          ['Rol', result.user.role ? <Badge tone="success" icon={ShieldCheck}>{ROLE_LABELS[result.user.role]}</Badge> : <Badge tone="danger">Giriş reddedilir (grup yok)</Badge>],
                          ['Hesap', result.user.disabled ? <Badge tone="danger">Devre dışı</Badge> : <Badge tone="success">Etkin</Badge>],
                        ]}
                      />
                    )}
                  </div>
                )}
              </motion.div>
            )}
            {!data.enabled && <p className="text-[13px] text-slate-400">LDAP yapılandırıldığında kullanılabilir.</p>}
          </div>
        </Card>
      </div>
    </>
  );
}
