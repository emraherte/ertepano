import { useState } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, CalendarClock, Check, Fingerprint, KeyRound, Lock, Monitor, Package, Upload } from 'lucide-react';
import { type LicenseMode, MODULE_FEATURES, MODULE_LABELS, MODULES } from '@ertepano/shared';
import { api, fmtDate } from '../api';
import { Badge, Button, Callout, Card, CardHeader, cn, Copy, PageHeader, PageSkeleton, Progress, Textarea, useAuth, useToast } from '../ui';
import { MODULE_GRADIENT, MODULE_ICON, useLicense } from '../components/license';

const MODE: Record<LicenseMode, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' }> = {
  licensed: { label: 'Lisanslı', tone: 'success' },
  trial: { label: 'Deneme sürümü', tone: 'info' },
  grace: { label: 'Süresi doldu — ek süre', tone: 'warning' },
  expired: { label: 'Lisans geçersiz / süresi doldu', tone: 'danger' },
};

export function LicensePage() {
  const { user } = useAuth();
  const toast = useToast();
  const { license, reload } = useLicense();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!license) return <PageSkeleton />;
  const m = MODE[license.mode];
  const usage = license.maxDevices ? Math.round((license.deviceCount / license.maxDevices) * 100) : 0;
  const isAdmin = user.role === 'admin';

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/license', { body: { license: text } });
      toast('Lisans yüklendi — modüller güncellendi');
      setText('');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow={<><BadgeCheck size={14} /> Yönetim</>} title="Lisans ve modüller" description="İK, İSG ve IT modülleri ayrı lisanslanır. Temel paket (genel duyurular, özel gün rozetleri, kiosk/TV, cihaz kaydı) her lisansta vardır." />

      <div className="grid gap-6 xl:grid-cols-12 [&>*]:min-w-0">
        <Card className="relative overflow-hidden p-8 xl:col-span-8">
          <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-linear-to-br from-emerald-400/25 to-teal-300/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
              <Package size={26} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{license.customer ?? 'ErtePano'}</h2>
                <Badge tone={m.tone} dot>
                  {m.label}
                </Badge>
              </div>
              <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
                {license.mode === 'trial'
                  ? `Tüm modüller ${license.daysLeft} gün daha açık. Satın aldığınız lisansı aşağıdan yükleyin.`
                  : license.mode === 'grace'
                    ? `Lisans süresi doldu; ${license.daysLeft} gün içinde yenilenmezse modüller kapanır.`
                    : license.mode === 'expired'
                      ? 'Modüller kapalı; yalnızca temel paket çalışıyor. Geçerli bir lisans yükleyin.'
                      : `Geçerlilik: ${fmtDate(license.validUntil)} (${license.daysLeft} gün)`}
              </p>
            </div>
          </div>
          <div className="relative mt-8 grid gap-6 sm:grid-cols-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] text-slate-500"><Monitor size={14} /> Cihaz kullanımı</div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">
                {license.deviceCount}
                <span className="text-base font-medium text-slate-400"> / {license.maxDevices}</span>
              </div>
              <Progress className="mt-2" segments={[{ value: usage, className: usage >= 95 ? 'bg-rose-500' : usage >= 80 ? 'bg-amber-500' : undefined }]} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-[13px] text-slate-500"><CalendarClock size={14} /> Bitiş</div>
              <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{license.validUntil ? fmtDate(license.validUntil) : '—'}</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[13px] text-slate-500"><KeyRound size={14} /> Lisans no</div>
              <div className="mt-2 truncate font-mono text-[13px] text-slate-700 dark:text-slate-300">{license.licenseId ?? (license.mode === 'trial' ? 'deneme' : '—')}</div>
            </div>
          </div>
        </Card>

        <Card className="p-6 xl:col-span-4" delay={0.05}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500"><Fingerprint size={15} /> Sunucu kimliği</div>
          <p className="mt-1 text-[13px] text-slate-400">Lisansı bu sunucuya bağlatmak için satıcınıza iletin.</p>
          {license.serverId ? (
            <div className="mt-4 flex items-center gap-3">
              <code className="flex-1 rounded-xl bg-slate-900/5 px-3 py-2 font-mono text-[15px] tracking-wider text-slate-800 dark:bg-white/10 dark:text-slate-100">{license.serverId}</code>
              <Copy text={license.serverId} label="" />
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-slate-400">Yalnızca yönetici görebilir.</p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-3 xl:col-span-12">
          {MODULES.map((mod, i) => {
            const on = license.modules.includes(mod);
            const Icon = MODULE_ICON[mod];
            return (
              <motion.div key={mod} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06 }}>
                <Card className={cn('relative h-full overflow-hidden p-6', !on && 'opacity-80')}>
                  <div className={cn('pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-linear-to-br opacity-20 blur-3xl', MODULE_GRADIENT[mod])} />
                  <div className="relative flex items-center justify-between">
                    <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br text-white shadow-lg', MODULE_GRADIENT[mod], !on && 'grayscale')}>
                      <Icon size={20} />
                    </div>
                    {on ? (
                      <Badge tone="success" icon={Check}>Lisanslı</Badge>
                    ) : (
                      <Badge icon={Lock}>Kapalı</Badge>
                    )}
                  </div>
                  <h3 className="relative mt-4 text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{MODULE_LABELS[mod]}</h3>
                  <ul className="relative mt-3 space-y-2">
                    {MODULE_FEATURES[mod].map((f) => (
                      <li key={f} className="flex gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                        <Check size={14} className={cn('mt-0.5 shrink-0', on ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600')} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {isAdmin && (
          <Card className="xl:col-span-12" delay={0.2}>
            <CardHeader icon={Upload} title="Lisans yükle" description="Satıcınızdan aldığınız .lic dosyasını seçin ya da içeriğini yapıştırın. Yeni lisans eskisinin yerine geçer." />
            <div className="space-y-4 px-6 pb-6">
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300/80 px-6 py-5 text-[13px] font-medium text-slate-500 transition-all duration-300 hover:border-emerald-500/60 hover:bg-emerald-500/[0.04] hover:text-emerald-700 dark:border-white/15 dark:hover:text-emerald-300">
                <Upload size={18} /> Lisans dosyası seçin (.lic)
                <input type="file" accept=".lic,.txt" hidden onChange={(e) => e.target.files?.[0]?.text().then(setText)} />
              </label>
              <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ERTEPANO-LICENSE-1\n…'} className="font-mono text-[12px]" />
              {error && <Callout tone="danger">{error}</Callout>}
              <div className="flex justify-end">
                <Button variant="primary" icon={BadgeCheck} loading={busy} disabled={!text.trim()} onClick={install}>
                  Lisansı doğrula ve yükle
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
