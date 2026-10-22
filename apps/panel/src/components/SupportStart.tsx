// Uzaktan destek başlatma: neden + mod. Çalışanın ekranında onay penceresi açılır; o onaylamadan hiçbir şey görülmez.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, MousePointerClick, ScreenShare, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { Button, Callout, cn, Field, Modal, Textarea } from '../ui';

export function SupportStartModal({ deviceId, hostname, user, onClose }: { deviceId: string; hostname: string; user: string | null; onClose: () => void }) {
  const nav = useNavigate();
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'view' | 'control'>('control');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ session: { id: string } }>('/api/support/sessions', { body: { deviceId, reason, mode } });
      nav(`/destek/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const MODES = [
    { v: 'control' as const, icon: MousePointerClick, label: 'Görüntüle ve kontrol et', hint: 'Fare ve klavye (çalışan ayrıca izin verir)' },
    { v: 'view' as const, icon: Eye, label: 'Yalnızca görüntüle', hint: 'Çalışan ekranı gösterir, siz yönlendirirsiniz' },
  ];

  return (
    <Modal
      open
      width={560}
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-sky-500 to-indigo-500 text-white">
            <ScreenShare size={18} />
          </span>
          Uzaktan destek
        </span>
      }
      description={<>
        <span className="font-mono">{hostname}</span>
        {user && <> · {user}</>}
      </>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" icon={ScreenShare} loading={busy} disabled={reason.trim().length < 5} onClick={start}>
            Bağlantı iste
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Neden bağlanıyorsunuz?" hint="çalışanın ekranında gösterilir ve kayda geçer">
          <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Örn: Yazıcı sürücüsü sorunu — talep #123" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setMode(m.v)}
              className={cn(
                'flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5',
                mode === m.v ? 'border-emerald-500/50 bg-emerald-500/[0.07]' : 'border-slate-200/70 bg-white/50 dark:border-white/10 dark:bg-white/[0.03]',
              )}
            >
              <m.icon size={18} className={cn('mt-0.5 shrink-0', mode === m.v ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
              <span>
                <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-200">{m.label}</span>
                <span className="block text-[12px] text-slate-500">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <Callout tone="info" icon={ShieldCheck} title="KVKK uyumlu bağlantı">
          Çalışan ekranında onay vermeden hiçbir şey görülmez; bağlantı boyunca ekranında kırmızı çerçeve ve "Bitir" düğmesi bulunur.
          Görüntü kaydedilmez; kim, ne zaman, neden ve ne kadar süre bağlandığı denetim kaydına yazılır.
        </Callout>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}
