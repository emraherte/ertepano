import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, FileJson, KeyRound, MapPin, Plus, Puzzle, ShieldCheck, Tag, Tv, XCircle } from 'lucide-react';
import { api, fmtDateTime, useApi } from '../api';
import { Badge, Button, buttonClass, Callout, Card, CardHeader, cn, Copy, EmptyState, Field, Input, listItem, Modal, PageHeader, Skeleton, SkeletonCard, Switch, useConfirm, useToast } from '../ui';

interface EnrollKey {
  id: string;
  key: string;
  label: string;
  autoApprove: number;
  defaultLocation: string | null;
  defaultDepartment: string | null;
  uses: number;
  revoked: number;
  createdBy: string;
  createdAt: string;
}

function UrlRow({ label, url }: { label?: string; url: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/60 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      {label && (
        <span className="flex w-40 shrink-0 items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200">
          <MapPin size={13} className="text-slate-400" /> {label}
        </span>
      )}
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-500 dark:text-slate-400" title={url}>
        {url}
      </code>
      <Copy text={url} />
    </div>
  );
}

export function KioskLinks() {
  const { data } = useApi<{ key: string; locations: string[] }>('/api/settings/kiosk');
  return (
    <Card>
      <CardHeader
        icon={Tv}
        title="Kiosk / TV ekranı"
        description="Fabrika, yemekhane ve giriş TV'lerinde tarayıcıyı tam ekran (F11) açın."
        action={
          data && (
            <a className={buttonClass('secondary', 'sm')} href={`${location.origin}/kiosk?key=${data.key}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Aç
            </a>
          )
        }
      />
      <div className="space-y-3 px-6 pb-6">
        {!data ? (
          <>
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              Duyurular döner; acil durumda ekran kırmızıya döner. Bilgisayarı olmayan çalışanlar da İSG ve İK duyurularını görür.
            </p>
            <UrlRow url={`${location.origin}/kiosk?key=${data.key}`} />
            {data.locations.map((l) => (
              <UrlRow key={l} label={l} url={`${location.origin}/kiosk?key=${data.key}&loc=${encodeURIComponent(l)}`} />
            ))}
            <p className="text-[12px] text-slate-400">Lokasyonlu bağlantı, o lokasyona ve "Herkes"e gönderilenleri gösterir. Kişiye özel kutlamalar ve anketler TV'de gösterilmez.</p>
          </>
        )}
      </div>
    </Card>
  );
}

const STEPS = [
  <>İmzalı <code className="font-mono text-[12.5px]">ErtePano Ajan.msi</code>'yi <b>Computer Configuration → Software Installation</b> ile atayın.</>,
  <>Yandaki <code className="font-mono text-[12.5px]">agent.json</code>'ı <b>GPP → Files</b> ile <code className="font-mono text-[12.5px] break-all">%ProgramData%\ErtePano\agent.json</code> konumuna kopyalayın.</>,
  <><b>GPP → Registry</b>: <code className="font-mono text-[12.5px]">HKLM\…\CurrentVersion\Run</code> altına <code className="font-mono text-[12.5px]">ErtePano</code> = ajan exe yolu.</>,
  <>Bilgisayarlar açıldıkça <b>Cihazlar</b> sayfasında belirir; "Onay bekleyen" sekmesinden toplu onaylayın.</>,
];

export function AgentSetup() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<{ items: EnrollKey[]; publicKey: string }>('/api/enroll-keys');
  const [selected, setSelected] = useState<string | null>(null);
  const [cfg, setCfg] = useState<object | null>(null);
  const [creating, setCreating] = useState<{ label: string; autoApprove: boolean; defaultLocation: string; defaultDepartment: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = (data?.items ?? []).filter((k) => !k.revoked);
  const sel = selected ?? active[0]?.id ?? null;

  useEffect(() => {
    if (!sel) {
      setCfg(null);
      return;
    }
    api<object>(`/api/enroll-keys/${sel}/agent-config`).then(setCfg, () => setCfg(null));
  }, [sel]);

  const create = async () => {
    if (!creating) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/api/enroll-keys', { body: creating });
      toast('Kayıt anahtarı oluşturuldu');
      setCreating(null);
      setSelected(r.id);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: EnrollKey) => {
    if (!(await confirm({ title: 'Kayıt anahtarı iptal edilsin mi?', description: `"${k.label}" ile yeni cihaz kaydı yapılamaz. Daha önce kaydolmuş cihazlar etkilenmez.`, confirmLabel: 'İptal et', tone: 'danger' }))) return;
    try {
      await api(`/api/enroll-keys/${k.id}/revoke`, { method: 'POST' });
      toast('Anahtar iptal edildi');
      if (sel === k.id) setSelected(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const json = cfg ? JSON.stringify(cfg, null, 2) : '';
  return (
    <>
      <PageHeader
        eyebrow={<><Puzzle size={14} /> Dağıtım</>}
        title="Ajan kurulumu"
        description="Kayıt anahtarı → agent.json → GPO ile dağıtım. Ajan imzasız hiçbir duyuruyu göstermez."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating({ label: '', autoApprove: false, defaultLocation: '', defaultDepartment: '' })}>
            Kayıt anahtarı
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-12 [&>*]:min-w-0">
        <div className="xl:col-span-5">
          {!data ? (
            <SkeletonCard rows={4} />
          ) : (
            <Card>
              <CardHeader icon={KeyRound} title="Kayıt anahtarları" description="Seçtiğiniz anahtarın agent.json'ı yanda" />
              {data.items.length === 0 ? (
                <EmptyState icon={KeyRound} title="Anahtar yok" description="Ajanların kaydolabilmesi için bir kayıt anahtarı oluşturun." />
              ) : (
                <div className="space-y-2 px-3 pb-3">
                  {data.items.map((k, i) => {
                    const on = sel === k.id && !k.revoked;
                    return (
                      <motion.div
                        key={k.id}
                        variants={listItem}
                        initial="hidden"
                        animate="show"
                        custom={i}
                        onClick={() => !k.revoked && setSelected(k.id)}
                        className={cn(
                          'group relative rounded-2xl border px-4 py-3.5 transition-all duration-300',
                          k.revoked ? 'border-transparent opacity-50' : 'cursor-pointer hover:-translate-y-0.5',
                          on ? 'border-emerald-500/40 bg-emerald-500/[0.06] shadow-sm shadow-emerald-500/10' : !k.revoked && 'border-transparent hover:border-slate-200/70 hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-white/[0.04]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{k.label}</div>
                            <div className="mt-1 font-mono text-[12.5px] tracking-wide text-slate-500 dark:text-slate-400">{k.key}</div>
                          </div>
                          {k.revoked ? (
                            <Badge tone="neutral">İptal</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={XCircle}
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                revoke(k);
                              }}
                            >
                              İptal et
                            </Button>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <Badge tone={k.autoApprove ? 'success' : 'warning'} icon={ShieldCheck}>
                            {k.autoApprove ? 'Otomatik onay' : 'IT onayı'}
                          </Badge>
                          {k.defaultLocation && <Badge icon={MapPin}>{k.defaultLocation}</Badge>}
                          {k.defaultDepartment && <Badge icon={Tag}>{k.defaultDepartment}</Badge>}
                          <span className="ml-auto text-[12px] text-slate-400 tabular-nums">
                            {k.uses} kayıt · {fmtDateTime(k.createdAt)}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6 xl:col-span-7">
          <Card delay={0.05}>
            <CardHeader icon={FileJson} title="agent.json" description="GPO ile her bilgisayara dağıtılacak yapılandırma" action={json && <Copy text={json} />} />
            <div className="px-6 pb-6">
              <pre className="min-h-[120px] overflow-x-auto rounded-2xl border border-white/5 bg-slate-950 p-5 font-mono text-[12.5px] leading-relaxed text-emerald-200 shadow-inner">
                {json || <span className="text-slate-500">Bir kayıt anahtarı seçin</span>}
              </pre>
              <p className="mt-4 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                <b className="text-slate-700 dark:text-slate-200">serverUrl</b>'yi çalışan bilgisayarların erişebildiği adresle değiştirin (örn. <code className="font-mono text-[12.5px]">https://pano.sirket.local</code>).{' '}
                <b className="text-slate-700 dark:text-slate-200">publicKey</b> sunucunun imza anahtarıdır; ajan yalnızca bu anahtarla imzalanmış duyuruları gösterir.
              </p>
            </div>
          </Card>

          <Card delay={0.1}>
            <CardHeader icon={Puzzle} title="GPO ile dağıtım" description="Dört adımda tüm şirkete" />
            <ol className="space-y-4 px-6 pb-6">
              {STEPS.map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-500 to-teal-600 text-[12px] font-bold text-white shadow-md shadow-emerald-500/25">{i + 1}</span>
                  <span className="pt-0.5 text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">{s}</span>
                </li>
              ))}
            </ol>
            <div className="px-6 pb-6">
              <Callout tone="info">Ajan kurulum paketini AV/EDR beyaz listesine ekleyin. Ajan pencere başlığı, ekran görüntüsü, klavye ve dosya verisi toplamaz.</Callout>
            </div>
          </Card>
        </div>

        <div className="xl:col-span-12">
          <KioskLinks />
        </div>
      </div>

      <Modal
        open={!!creating}
        title="Kayıt anahtarı oluştur"
        description="Ajanlar bu anahtarla sunucuya kaydolur."
        onClose={() => setCreating(null)}
        footer={
          <Button variant="primary" loading={busy} disabled={!creating?.label.trim()} onClick={create}>
            Oluştur
          </Button>
        }
      >
        {creating && (
          <div className="space-y-5">
            <Field label="Ad">
              <Input value={creating.label} onChange={(e) => setCreating({ ...creating, label: e.target.value })} placeholder="Örn: Gebze fabrika GPO" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Varsayılan lokasyon" hint="isteğe bağlı">
                <Input icon={MapPin} value={creating.defaultLocation} onChange={(e) => setCreating({ ...creating, defaultLocation: e.target.value })} />
              </Field>
              <Field label="Varsayılan departman" hint="isteğe bağlı">
                <Input icon={Tag} value={creating.defaultDepartment} onChange={(e) => setCreating({ ...creating, defaultDepartment: e.target.value })} />
              </Field>
            </div>
            <Switch
              checked={creating.autoApprove}
              onChange={(v) => setCreating({ ...creating, autoApprove: v })}
              label="Kaydolan cihazları otomatik onayla"
              description="Yalnızca GPO gibi kontrollü dağıtımda önerilir. Anahtar sızarsa iptal edip yenisini dağıtın."
            />
          </div>
        )}
      </Modal>
    </>
  );
}
