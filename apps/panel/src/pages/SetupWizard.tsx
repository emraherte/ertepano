// İlk kurulum sihirbazı: bir kuruma gidildiğinde 10 dakikada güvenli kurulum.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, Check, KeyRound, Network, Puzzle, Rocket, ShieldCheck } from 'lucide-react';
import { api, useApi } from '../api';
import { Button, Callout, Card, cn, Copy, Field, Input, PageHeader, Textarea, useToast } from '../ui';
import { LdapForm } from '../components/LdapForm';
import { SecurityPolicyCard } from '../components/SecurityPolicyCard';
import { SecurityChecklist, useSetup } from '../components/SecurityChecklist';
import { useLicense } from '../components/license';

const STEPS = [
  { title: 'Kurum', icon: Building2 },
  { title: 'Güvenlik', icon: ShieldCheck },
  { title: 'Active Directory', icon: Network },
  { title: 'Lisans', icon: BadgeCheck },
  { title: 'Ajanlar', icon: Puzzle },
  { title: 'Kontrol', icon: Rocket },
];

function OrgStep() {
  const toast = useToast();
  const setup = useSetup();
  const [name, setName] = useState('');
  useEffect(() => {
    if (setup.data?.orgName) setName(setup.data.orgName);
  }, [setup.data]);
  const save = async () => {
    try {
      await api('/api/setup/org', { body: { name } });
      toast('Kurum adı kaydedildi');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="space-y-5">
      <Field label="Kurum adı" hint="giriş ekranında ve panelde görünür">
        <div className="flex gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Kastaş A.Ş." className="flex-1" />
          <Button onClick={save} disabled={name.trim().length < 2}>
            Kaydet
          </Button>
        </div>
      </Field>
      <Callout tone="info" title="Panel adresi">
        {setup.data?.publicUrl ? (
          <>Çalışanlar ve ajanlar sunucuya <b className="font-mono">{setup.data.publicUrl}</b> adresinden ulaşıyor.</>
        ) : (
          <>Henüz bir kurumsal adres tanımlı değil. İç DNS'te <b className="font-mono">pano.sirket.local</b> gibi bir ad açıp iç CA sertifikasıyla HTTPS yayınlayın;
            ardından sunucuda <span className="font-mono">PUBLIC_URL</span> ve <span className="font-mono">SECURE_COOKIES=true</span> ayarlayın (kurulum betiği bunu sorar).</>
        )}
      </Callout>
    </div>
  );
}

function SecurityStep() {
  const setup = useSetup();
  const initial = setup.data?.checks.find((c) => c.id === 'initial_password');
  return (
    <div className="space-y-5">
      {initial?.status === 'fail' ? (
        <Callout tone="danger" icon={KeyRound} title="Önce ilk yönetici parolasını değiştirin">
          Kurulumda üretilen parola diskteki bir dosyada duruyor. <Button size="sm" variant="ghost" to="/hesabim">Hesabım → Parola</Button> Değiştirince dosya otomatik silinir.
        </Callout>
      ) : (
        <Callout tone="success">İlk yönetici parolası değiştirildi.</Callout>
      )}
      <SecurityPolicyCard />
    </div>
  );
}

function LicenseStep() {
  const toast = useToast();
  const { license, reload } = useLicense();
  const [text, setText] = useState('');
  const install = async () => {
    try {
      await api('/api/license', { body: { license: text } });
      toast('Lisans yüklendi');
      setText('');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="space-y-5">
      {license && (
        <Callout tone={license.mode === 'licensed' ? 'success' : 'info'}>
          {license.mode === 'licensed'
            ? `${license.customer} · ${license.modules.map((m) => m.toUpperCase()).join(', ')} · ${license.maxDevices} cihaz`
            : `Deneme sürümü: tüm modüller ${license.daysLeft} gün açık. Lisansı şimdi ya da daha sonra Lisans sayfasından yükleyebilirsiniz.`}
        </Callout>
      )}
      <Field label="Lisans dosyası (.lic)">
        <input type="file" accept=".lic,.txt" onChange={(e) => e.target.files?.[0]?.text().then(setText)} className="text-[13px]" />
      </Field>
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ERTEPANO-LICENSE-1\n…'} className="font-mono text-[12px]" />
      <div className="flex justify-end">
        <Button variant="primary" disabled={!text.trim()} onClick={install}>
          Lisansı yükle
        </Button>
      </div>
    </div>
  );
}

function AgentStep() {
  const toast = useToast();
  const keys = useApi<{ items: { id: string; key: string; label: string; revoked: number; autoApprove: number }[] }>('/api/enroll-keys');
  const [cfg, setCfg] = useState<string | null>(null);
  const active = (keys.data?.items ?? []).filter((k) => !k.revoked && k.key !== 'EK-DEMO-DEMO-DEMO');

  useEffect(() => {
    const k = active[0];
    if (k) api<object>(`/api/enroll-keys/${k.id}/agent-config`).then((c) => setCfg(JSON.stringify(c, null, 2)), () => setCfg(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.data]);

  const create = async () => {
    try {
      await api('/api/enroll-keys', { body: { label: 'GPO dağıtımı', autoApprove: false } });
      toast('Kayıt anahtarı oluşturuldu');
      keys.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="space-y-5">
      <ol className="space-y-3 text-[14px] text-slate-600 dark:text-slate-300">
        {[
          <>İmzalı <b>ErtePano-Ajan.msi</b>'yi (satıcıdan) bir paylaşıma koyun; Domain Computers okuyabilsin.</>,
          <>GPO → <b>Software Installation (Assigned)</b> ile MSI'ı atayın.</>,
          <>GPO → <b>Administrative Templates → ErtePano</b> (ErtePano.admx) ile aşağıdaki sunucu adresi, kayıt anahtarı ve imza anahtarını girin. OU başına lokasyon da verebilirsiniz.</>,
          <>Bilgisayarlar yeniden başladıkça <b>Cihazlar</b>'da "Onay bekleyen" olarak görünür; toplu onaylayın.</>,
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      {cfg ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[13px] font-medium text-slate-700 dark:text-slate-300">
            GPO / agent.json değerleri <Copy text={cfg} />
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 font-mono text-[12px] text-emerald-200">{cfg}</pre>
        </div>
      ) : (
        <Button variant="primary" icon={KeyRound} onClick={create}>
          Kayıt anahtarı oluştur
        </Button>
      )}
      <Button variant="ghost" iconRight={ArrowRight} to="/ajan-kurulumu">
        Ajan kurulumu sayfası
      </Button>
    </div>
  );
}

export function SetupWizard() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const finish = async () => {
    try {
      await api('/api/setup/complete', { method: 'POST' });
      toast('Kurulum tamamlandı');
      nav('/');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const bodies = [<OrgStep key={0} />, <SecurityStep key={1} />, <LdapForm key={2} />, <LicenseStep key={3} />, <AgentStep key={4} />, <SecurityChecklist key={5} />];

  return (
    <>
      <PageHeader eyebrow={<><Rocket size={14} /> İlk kurulum</>} title="ErtePano'yu kurumunuza hazırlayın" description="Altı adımda güvenli kurulum. Her adımı daha sonra da değiştirebilirsiniz." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr] [&>*]:min-w-0">
        <Card className="h-fit p-3">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setStep(i)}
              className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors', i === step ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'text-slate-600 hover:bg-slate-900/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.04]')}
            >
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-xl', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-linear-to-br from-emerald-500 to-teal-600 text-white' : 'bg-slate-900/5 text-slate-500 dark:bg-white/10')}>
                {i < step ? <Check size={14} strokeWidth={3} /> : <s.icon size={14} />}
              </span>
              {s.title}
            </button>
          ))}
        </Card>
        <div>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
              {step === 5 || step === 1 ? bodies[step] : <Card className="p-6 sm:p-8">{bodies[step]}</Card>}
            </motion.div>
          </AnimatePresence>
          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" icon={ArrowLeft} disabled={step === 0} onClick={() => setStep(step - 1)}>
              Geri
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" iconRight={ArrowRight} onClick={() => setStep(step + 1)}>
                {step === 2 ? 'Devam (AD isteğe bağlı)' : 'Devam'}
              </Button>
            ) : (
              <Button variant="primary" icon={Rocket} onClick={finish}>
                Kurulumu tamamla
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
