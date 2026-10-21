import { motion } from 'framer-motion';
import { LogOut, RadioTower, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS } from '@ertepano/shared';
import type { User } from '../types';
import { Button } from '../ui';
import { MfaSetup } from '../components/MfaSetup';

/** Rolü 2FA gerektiren kullanıcı, kurulumu bitirene kadar panele giremez. */
export function MfaRequiredScreen({ user, onDone, onLogout }: { user: User; onDone: (u: User) => void; onLogout: () => void }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="app-backdrop" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[760px] rounded-[28px] border border-slate-200/60 bg-white/75 p-7 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl sm:p-10 dark:border-white/10 dark:bg-slate-900/65"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Hesabınızı koruyun</h1>
              <p className="mt-1 text-[14px] text-slate-500 dark:text-slate-400">
                <b className="text-slate-700 dark:text-slate-200">{ROLE_LABELS[user.role]}</b> rolü için iki faktörlü doğrulama zorunlu. Bir kez kurun, sonraki girişlerde telefonunuzdaki kodu girin.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[13px] font-semibold text-slate-400 sm:flex">
            <RadioTower size={16} /> ErtePano
          </div>
        </div>
        <MfaSetup user={user} onDone={onDone} />
        <div className="mt-8 flex items-center justify-between border-t border-slate-200/60 pt-5 text-[13px] text-slate-500 dark:border-white/10">
          <span>
            {user.fullName} · <span className="font-mono">{user.username}</span>
          </span>
          <Button size="sm" variant="ghost" icon={LogOut} onClick={onLogout}>
            Çıkış
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
