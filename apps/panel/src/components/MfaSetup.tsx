// 2FA kurulum sihirbazı: QR tara → kodu doğrula → kurtarma kodlarını sakla.
// Hem zorunlu kurulum ekranında hem Hesabım sayfasında kullanılır.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { Button, Callout, Checkbox, cn, Copy, Skeleton } from '../ui';
import { CodeInput } from '../ui/code-input';

interface SetupData {
  secret: string;
  otpauth: string;
  qrSvg: string;
}

export function RecoveryCodes({ codes, username }: { codes: string[]; username: string }) {
  const text = `ErtePano kurtarma kodları — ${username}\nHer kod yalnızca bir kez kullanılabilir.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ertepano-kurtarma-kodlari-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/70 bg-slate-950 p-4 font-mono text-[15px] tracking-wider text-emerald-200 dark:border-white/10">
        {codes.map((c) => (
          <div key={c} className="rounded-lg px-2 py-1 text-center">
            {c}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Copy text={codes.join('\n')} label="Kopyala" />
        <Button size="sm" icon={Download} onClick={download}>
          İndir (.txt)
        </Button>
      </div>
    </div>
  );
}

export function MfaSetup({ user, onDone, onCancel }: { user: User; onDone: (u: User) => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ codes: string[]; user: User } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<SetupData>('/api/auth/mfa/setup', { method: 'POST' }).then(setSetup, (e) => setError((e as Error).message));
  }, []);

  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[]; user: User }>('/api/auth/mfa/enable', { body: { code: c } });
      setResult({ codes: r.recoveryCodes, user: r.user });
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const step = result ? 3 : 2;
  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-3 text-[12px] font-medium">
        {['Tara', 'Doğrula', 'Kodları sakla'].map((s, i) => {
          const n = i + 1;
          const done = n < step || (n === 1 && !!setup);
          const on = n === step || (n === 1 && !setup);
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  done ? 'bg-emerald-500 text-white' : on ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/40 dark:text-emerald-300' : 'bg-slate-900/5 text-slate-400 dark:bg-white/10',
                )}
              >
                {done ? <Check size={13} strokeWidth={3} /> : n}
              </span>
              <span className={on || done ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>{s}</span>
              {n < 3 && <span className="h-px w-6 bg-slate-200 dark:bg-white/10" />}
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="scan" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="grid gap-6 sm:grid-cols-[220px_1fr]">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-2xl bg-white p-3 shadow-lg shadow-slate-900/10 ring-1 ring-slate-200">
                {setup ? (
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="2FA QR kodu" className="h-[196px] w-[196px]" />
                ) : (
                  <Skeleton className="h-[196px] w-[196px]" />
                )}
              </div>
              {setup && (
                <div className="w-full text-center">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Elle giriş anahtarı</div>
                  <div className="mt-1 font-mono text-[13px] break-all text-slate-700 select-all dark:text-slate-200">{setup.secret}</div>
                </div>
              )}
            </div>
            <div className="space-y-5">
              <div className="space-y-3 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="flex gap-3">
                  <Smartphone size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    Telefonunuzda <b>Microsoft Authenticator</b> veya <b>Google Authenticator</b> uygulamasını açın, <b>+</b> ile yeni hesap ekleyip QR kodu tarayın.
                  </span>
                </p>
                <p className="flex gap-3">
                  <KeyRound size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>Uygulamada görünen 6 haneli kodu aşağıya yazın. Kod 30 saniyede bir yenilenir.</span>
                </p>
              </div>
              <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={!setup || busy} autoFocus error={!!error} />
              {error && <Callout tone="danger">{error}</Callout>}
              <div className="flex flex-wrap justify-end gap-3">
                {onCancel && (
                  <Button variant="ghost" onClick={onCancel}>
                    Vazgeç
                  </Button>
                )}
                <Button variant="primary" icon={ShieldCheck} loading={busy} disabled={code.length !== 6 || !setup} onClick={() => verify()}>
                  Doğrula ve aç
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="codes" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <Callout tone="success" title="İki faktörlü doğrulama açıldı">
              Telefonunuza erişemezseniz bu kodlardan biriyle giriş yapabilirsiniz. Her kod <b>yalnızca bir kez</b> kullanılır ve bir daha gösterilmez.
            </Callout>
            <RecoveryCodes codes={result.codes} username={user.username} />
            <Checkbox checked={saved} onChange={setSaved} label="Kodları güvenli bir yere kaydettim" />
            <div className="flex justify-end">
              <Button variant="primary" disabled={!saved} onClick={() => onDone(result.user)}>
                Tamamla
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
