// Active Directory bağlantı formu: kaydetmeden önce dene, sonra kaydet. Servis parolası sunucuda şifreli saklanır.
import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Lock, PlugZap, Save, ShieldAlert, XCircle } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@ertepano/shared';
import { api, useApi } from '../api';
import { Badge, Button, Callout, cn, Field, Input, Select, Switch, Textarea, useToast } from '../ui';

interface LdapSettings {
  enabled: boolean;
  source: 'panel' | 'env' | 'none';
  url: string | null;
  baseDn: string | null;
  bindDn: string | null;
  bindPasswordSet: boolean;
  userFilter: string;
  domain: string | null;
  startTls: boolean;
  caPemSet: boolean;
  rejectUnauthorized: boolean;
  groups: Partial<Record<Role, string>>;
  defaultRole: Role | null;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  groups: { role: Role; group: string; found: boolean }[];
}

const ROLE_ORDER: Role[] = ['admin', 'isg', 'it', 'ik', 'viewer'];
const GROUP_DEFAULTS: Record<Role, string> = { admin: 'ErtePano-Yonetici', it: 'ErtePano-IT', isg: 'ErtePano-ISG', ik: 'ErtePano-IK', viewer: 'ErtePano-Izleyici' };

export function LdapForm({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<LdapSettings>('/api/settings/ldap');
  const [f, setF] = useState({
    enabled: true,
    url: '',
    baseDn: '',
    bindDn: '',
    bindPassword: '',
    domain: '',
    startTls: false,
    rejectUnauthorized: true,
    caPem: '',
    userFilter: '',
    groups: { ...GROUP_DEFAULTS } as Record<Role, string>,
    defaultRole: '' as Role | '',
  });
  const [advanced, setAdvanced] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setF((x) => ({
      ...x,
      enabled: data.source === 'none' ? true : data.enabled,
      url: data.url ?? '',
      baseDn: data.baseDn ?? '',
      bindDn: data.bindDn ?? '',
      domain: data.domain ?? '',
      startTls: data.startTls,
      rejectUnauthorized: data.rejectUnauthorized,
      userFilter: data.userFilter,
      groups: data.source === 'none' ? { ...GROUP_DEFAULTS } : (Object.fromEntries(ROLE_ORDER.map((r) => [r, data.groups[r] ?? ''])) as Record<Role, string>),
      defaultRole: data.defaultRole ?? '',
    }));
  }, [data]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => ({
    enabled: f.enabled,
    url: f.url.trim(),
    baseDn: f.baseDn.trim(),
    bindDn: f.bindDn.trim(),
    bindPassword: f.bindPassword || undefined,
    domain: f.domain.trim() || null,
    startTls: f.startTls,
    rejectUnauthorized: f.rejectUnauthorized,
    caPem: f.caPem.trim() || undefined,
    userFilter: f.userFilter.trim() || undefined,
    groups: f.groups,
    defaultRole: f.defaultRole || null,
  });

  const runTest = async () => {
    setBusy('test');
    setError(null);
    try {
      setTest(await api<TestResult>('/api/settings/ldap/test', { body: { config: body() } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api('/api/settings/ldap', { method: 'PUT', body: body() });
      toast(f.enabled ? 'Active Directory bağlandı' : 'Active Directory ayarları kaydedildi (kapalı)');
      setF((x) => ({ ...x, bindPassword: '' }));
      reload();
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;
  const plain = f.url.startsWith('ldap://') && !f.startTls;

  return (
    <div className="space-y-5">
      {data.source === 'env' && <Callout tone="info">Şu an ayarlar sunucunun .env dosyasından geliyor. Burada kaydederseniz panel ayarları geçerli olur.</Callout>}
      <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} label="Active Directory ile giriş" description="Çalışanlar Windows kullanıcı adı ve parolasıyla girer; rol AD grubundan gelir" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Etki alanı denetleyicisi" hint="LDAPS önerilir">
          <Input value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="ldaps://dc01.sirket.local:636" className="font-mono" />
        </Field>
        <Field label="Temel DN">
          <Input value={f.baseDn} onChange={(e) => set('baseDn', e.target.value)} placeholder="DC=sirket,DC=local" className="font-mono" />
        </Field>
        <Field label="Servis hesabı (salt okur)" hint="DN ya da kullanici@sirket.local">
          <Input value={f.bindDn} onChange={(e) => set('bindDn', e.target.value)} placeholder="CN=svc-ertepano,OU=Servis,DC=sirket,DC=local" className="font-mono" />
        </Field>
        <Field label="Servis hesabı parolası" hint={data.bindPasswordSet ? 'kayıtlı — değiştirmek için yazın' : undefined}>
          <Input type="password" icon={Lock} value={f.bindPassword} onChange={(e) => set('bindPassword', e.target.value)} placeholder={data.bindPasswordSet ? '••••••••' : ''} autoComplete="new-password" />
        </Field>
        <Field label="Alan adı (giriş ekranında ipucu)">
          <Input value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder="SIRKET" />
        </Field>
        <Field label="Gruba üye olmayanlar">
          <Select value={f.defaultRole} onChange={(e) => set('defaultRole', e.target.value as Role | '')}>
            <option value="">Giremez (önerilen)</option>
            <option value="viewer">İzleyici olarak girer</option>
          </Select>
        </Field>
      </div>

      {plain && (
        <Callout tone="warning" icon={ShieldAlert} title="Şifresiz bağlantı">
          ldap:// üzerinde parolalar ağda açık gider. ldaps://…:636 kullanın ya da StartTLS'i açın.
        </Callout>
      )}

      <div>
        <div className="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">Rol grupları</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLE_ORDER.map((r) => {
            const t = test?.groups.find((g) => g.role === r);
            return (
              <div key={r} className="flex items-center gap-3 rounded-2xl border border-slate-200/60 bg-white/50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
                <span className="w-24 shrink-0 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{ROLE_LABELS[r]}</span>
                <input
                  value={f.groups[r]}
                  onChange={(e) => set('groups', { ...f.groups, [r]: e.target.value })}
                  placeholder="grup adı ya da DN"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                />
                {t && (t.found ? <CheckCircle2 size={16} className="shrink-0 text-emerald-500" /> : <XCircle size={16} className="shrink-0 text-rose-500" />)}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-slate-400">Birden fazla gruba üye kullanıcı en yetkili rolü alır (Yönetici › İSG › IT › İK › İzleyici). DN yazılırsa iç içe gruplar da çözülür.</p>
      </div>

      <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ChevronDown size={15} className={cn('transition-transform', advanced && 'rotate-180')} /> Gelişmiş (sertifika, StartTLS, filtre)
      </button>
      {advanced && (
        <div className="space-y-4 rounded-2xl border border-slate-200/60 p-4 dark:border-white/10">
          <Switch checked={f.startTls} onChange={(v) => set('startTls', v)} label="StartTLS (ldap://…:389 üzerinde şifreleme)" />
          <Switch checked={f.rejectUnauthorized} onChange={(v) => set('rejectUnauthorized', v)} label="Sunucu sertifikasını doğrula" description="Kapatmayın; iç CA kullanıyorsanız kök sertifikayı aşağıya yapıştırın" />
          <Field label="Kurumsal kök sertifika (PEM)" hint={data.caPemSet ? 'kayıtlı' : 'isteğe bağlı'}>
            <Textarea rows={3} value={f.caPem} onChange={(e) => set('caPem', e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-[12px]" />
          </Field>
          <Field label="Kullanıcı filtresi">
            <Input value={f.userFilter} onChange={(e) => set('userFilter', e.target.value)} className="font-mono text-[12px]" />
          </Field>
        </div>
      )}

      {test && (
        <Callout tone={test.ok ? 'success' : 'danger'} title={test.message}>
          {test.ok && (
            <span className="text-[12px]">
              {test.latencyMs} ms · {test.groups.filter((g) => g.found).length}/{test.groups.length} grup bulundu
              {test.groups.some((g) => !g.found) && ' — bulunamayan grupları AD\'de oluşturun ya da adını düzeltin'}
            </span>
          )}
        </Callout>
      )}
      {error && <Callout tone="danger">{error}</Callout>}

      <div className="flex flex-wrap justify-end gap-3">
        <Button icon={PlugZap} loading={busy === 'test'} disabled={!f.url || !f.baseDn} onClick={runTest}>
          Bağlantıyı dene
        </Button>
        <Button variant="primary" icon={Save} loading={busy === 'save'} disabled={f.enabled && (!f.url || !f.baseDn)} onClick={save}>
          Kaydet
        </Button>
      </div>
      {data.source === 'panel' && <Badge tone="success">Panelden yapılandırıldı · parola şifreli saklanıyor</Badge>}
    </div>
  );
}
