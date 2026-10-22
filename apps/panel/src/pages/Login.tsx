import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Building2, LifeBuoy, ShieldEllipsis, HardHat, KeyRound, Lock, Moon, RadioTower, ShieldCheck, Sun, User as UserIcon, Users } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { Button, Callout, cn, Field, IconButton, Input, useTheme } from '../ui';
import { CodeInput } from '../ui/code-input';

const PILLARS = [
  { icon: Users, label: 'İnsan Kaynakları', text: 'Duyuru, anket, kutlama', grad: 'from-violet-500 to-fuchsia-500' },
  { icon: HardHat, label: 'İş Güvenliği', text: 'Acil durum ve yoklama', grad: 'from-rose-500 to-orange-500' },
  { icon: ShieldCheck, label: 'Bilgi Teknolojileri', text: 'Envanter ve bakım', grad: 'from-sky-500 to-indigo-500' },
];

/** Sağdaki "canlı ekran" süsü: ürünün ne yaptığını ilk bakışta anlatır. */
function HeroScreen() {
  return (
    <div className="relative mx-auto mt-14 aspect-[16/10] w-full max-w-[520px]">
      <div className="absolute inset-0 rounded-[28px] border border-white/15 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur-md" />
      <div className="absolute inset-3 overflow-hidden rounded-[20px] bg-linear-to-br from-slate-800/80 to-slate-900/80">
        <div className="absolute top-[12%] left-[7%] h-[66%] w-[60%] rounded-xl bg-white/[0.07] p-4">
          {[80, 60, 72, 45, 66].map((w, i) => (
            <div key={i} className="mb-2.5 h-2 rounded-full bg-white/10" style={{ width: `${w}%` }} />
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, x: 40, y: 10 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ delay: 0.6, type: 'spring', stiffness: 120, damping: 16 }}
          className="absolute right-[4%] bottom-[8%] w-[46%] rounded-2xl border border-white/20 bg-white/95 p-3.5 shadow-2xl"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-linear-to-br from-rose-500 to-orange-500 text-[11px] text-white">🧯</div>
            <div className="text-[11px] font-semibold text-slate-900">Yangın tatbikatı · 14:00</div>
          </div>
          <div className="mt-1.5 text-[10px] leading-snug text-slate-500">Alarmda en yakın çıkıştan toplanma alanına gidiniz.</div>
          <div className="mt-2.5 flex justify-end">
            <span className="rounded-md bg-linear-to-br from-emerald-500 to-teal-600 px-2 py-1 text-[9px] font-semibold text-white">Okudum, anladım</span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1, type: 'spring', stiffness: 200, damping: 14 }}
          className="absolute top-[6%] right-[5%] flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl"
        >
          🇹🇷
        </motion.div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2 }}
        className="absolute -bottom-6 -left-6 flex items-center gap-3 rounded-2xl border border-white/15 bg-slate-900/70 px-4 py-3 shadow-xl backdrop-blur-xl"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
          <ShieldCheck size={18} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-white">35 / 40 güvende</div>
          <div className="text-[11px] text-slate-400">Canlı yoklama · 0:42</div>
        </div>
      </motion.div>
    </div>
  );
}

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { dark, toggle } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ldap, setLdap] = useState<{ enabled: boolean; domain: string | null; org?: string | null } | null>(null);
  // 2. adım: parola doğru, Authenticator kodu bekleniyor
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    api<{ ldap: boolean; domain: string | null; org: string | null }>('/api/auth/config').then((r) => setLdap({ enabled: r.ldap, domain: r.domain, org: r.org }), () => setLdap(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user?: User; mfa?: 'required'; challenge?: string }>('/api/auth/login', { body: { username, password } });
      if (r.mfa === 'required' && r.challenge) {
        setChallenge(r.challenge);
        setPassword('');
        setCode('');
      } else if (r.user) onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code) => {
    if (!challenge || busy) return;
    if (!recovery && c.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User; recoveryUsed?: boolean; recoveryLeft?: number }>('/api/auth/login/mfa', { body: { challenge, code: c } });
      if (r.recoveryUsed) sessionStorage.setItem('ertepano.recoveryLeft', String(r.recoveryLeft ?? 0));
      onLogin(r.user);
    } catch (err) {
      const e = err as Error & { status?: number };
      setError(e.message);
      setCode('');
      if (/süresi doldu|yeniden giriş/i.test(e.message)) setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setChallenge(null);
    setError(null);
    setCode('');
    setRecovery(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Sol: marka sahnesi */}
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-emerald-500/25 blur-[120px]" />
          <div className="absolute top-1/3 -right-40 h-[480px] w-[480px] rounded-full bg-teal-400/20 blur-[120px]" />
          <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-indigo-500/20 blur-[120px]" />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse at 30% 20%, black 20%, transparent 70%)' }}
          />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
            <RadioTower size={22} />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">ErtePano</span>
        </div>
        <div className="relative mt-auto">
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-lg text-[44px] leading-[1.08] font-bold tracking-tight text-white">
            Şirketin her ekranına,{' '}
            <span className="bg-linear-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent">tek bir yerden</span> ulaşın.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }} className="mt-5 max-w-md text-[16px] leading-relaxed text-slate-400">
            Duyurular, anketler ve acil durum uyarıları saniyeler içinde masaüstlerinde. Tamamı iç ağınızda, veriniz dışarı çıkmaz.
          </motion.p>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4">
            {PILLARS.map((p, i) => (
              <motion.div
                key={p.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.07]"
              >
                <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-lg', p.grad)}>
                  <p.icon size={17} />
                </div>
                <div className="mt-3 text-[13px] font-semibold text-white">{p.label}</div>
                <div className="mt-0.5 text-[12px] text-slate-400">{p.text}</div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="relative mt-auto">
          <HeroScreen />
        </div>
      </div>

      {/* Sağ: giriş */}
      <div className="relative flex items-center justify-center p-6 sm:p-12">
        <div className="app-backdrop" />
        <IconButton icon={dark ? Sun : Moon} label="Tema" onClick={toggle} className="absolute top-6 right-6" />
        <motion.form
          onSubmit={(e) => {
            if (challenge) {
              e.preventDefault();
              verify();
            } else submit(e);
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px] rounded-[28px] border border-slate-200/60 bg-white/70 p-8 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl sm:p-10 dark:border-white/10 dark:bg-slate-900/60"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-400 to-teal-600 text-white">
              <RadioTower size={20} />
            </div>
            <span className="text-lg font-bold tracking-tight">ErtePano</span>
          </div>
          {challenge ? (
            <>
          <button type="button" onClick={back} className="mb-6 flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition hover:text-slate-900 dark:hover:text-white">
            <ArrowLeft size={15} /> Geri
          </button>
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300">
            {recovery ? <LifeBuoy size={22} /> : <ShieldEllipsis size={22} />}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{recovery ? 'Kurtarma kodu' : 'Doğrulama kodu'}</h2>
          <p className="mt-1.5 text-[14px] text-slate-500 dark:text-slate-400">
            {recovery ? 'Kaydettiğiniz kurtarma kodlarından birini girin (ör. ABCD-EFGH). Her kod bir kez kullanılır.' : 'Authenticator uygulamanızdaki 6 haneli kodu girin.'}
          </p>
          <div className="mt-8 space-y-5">
            {recovery ? (
              <Input icon={LifeBuoy} autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" maxLength={12} className="font-mono tracking-widest" autoComplete="off" />
            ) : (
              <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={busy} autoFocus error={!!error} />
            )}
            {error && <Callout tone="danger">{error}</Callout>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={recovery ? code.replace(/[^A-Z0-9]/g, '').length < 8 : code.length !== 6} iconRight={busy ? undefined : ArrowRight}>
              Doğrula
            </Button>
            <button
              type="button"
              onClick={() => {
                setRecovery(!recovery);
                setCode('');
                setError(null);
              }}
              className="w-full text-center text-[13px] font-medium text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              {recovery ? 'Authenticator kodu kullan' : 'Telefonuma erişemiyorum — kurtarma kodu kullan'}
            </button>
          </div>
            </>
          ) : (
            <>
          {ldap?.org && <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">{ldap.org}</div>}
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Tekrar hoş geldiniz</h2>
          <p className="mt-1.5 text-[14px] text-slate-500 dark:text-slate-400">
            {ldap?.enabled ? 'Kurumsal (Windows) hesabınızla giriş yapın.' : 'Panel hesabınızla giriş yapın.'}
          </p>

          {ldap?.enabled && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-200">
              <Building2 size={17} className="shrink-0" />
              <span>
                Active Directory bağlı{ldap.domain ? <> · <b>{ldap.domain}</b></> : null}
              </span>
            </div>
          )}

          <div className="mt-8 space-y-5">
            <Field label="Kullanıcı adı">
              <Input icon={UserIcon} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder={ldap?.enabled ? 'ad.soyad' : 'kullanıcı adı'} />
            </Field>
            <Field label="Parola">
              <Input icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
            </Field>
            {error && <Callout tone="danger">{error}</Callout>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!username || !password} iconRight={busy ? undefined : ArrowRight}>
              {busy ? 'Giriş yapılıyor' : 'Giriş yap'}
            </Button>
          </div>
            </>
          )}
          <div className="mt-8 flex items-center gap-2 border-t border-slate-200/60 pt-6 text-[12px] text-slate-400 dark:border-white/10">
            <KeyRound size={13} /> Oturumlar şifreli çerezle korunur; her işlem denetim kaydına yazılır.
          </div>
        </motion.form>
      </div>
    </div>
  );
}
