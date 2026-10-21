// Lisans bağlamı + kilitli modül ekranı. Sunucu her zaman asıl kontrolü yapar; panel yalnızca doğru yüzü gösterir.
import { createContext, type ReactNode, useContext } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, HardHat, Lock, type LucideIcon, ShieldCheck, Users } from 'lucide-react';
import { type LicenseInfo, licensedCategories, type Module, MODULE_FEATURES, MODULE_LABELS, ROLE_CATEGORIES, type Role } from '@ertepano/shared';
import { Button, cn } from '../ui';

const LicenseContext = createContext<{ license: LicenseInfo | null; reload: () => void }>({ license: null, reload: () => {} });

export function LicenseProvider({ license, reload, children }: { license: LicenseInfo | null; reload: () => void; children: ReactNode }) {
  return <LicenseContext.Provider value={{ license, reload }}>{children}</LicenseContext.Provider>;
}

export function useLicense() {
  const { license, reload } = useContext(LicenseContext);
  const has = (m: Module) => !!license?.modules.includes(m);
  const any = (ms?: readonly Module[]) => !ms || ms.length === 0 || ms.some(has);
  const categoriesFor = (role: Role) => ROLE_CATEGORIES[role].filter((c) => licensedCategories(license?.modules ?? []).includes(c));
  return { license, reload, has, any, categoriesFor };
}

export const MODULE_ICON: Record<Module, LucideIcon> = { ik: Users, isg: HardHat, it: ShieldCheck };
export const MODULE_GRADIENT: Record<Module, string> = {
  ik: 'from-violet-500 to-fuchsia-500',
  isg: 'from-rose-500 to-orange-500',
  it: 'from-sky-500 to-indigo-500',
};

/** Lisansta olmayan modülün sayfası yerine: ne kazandıracağını anlatan, satış ekibine yönlendiren ekran. */
export function ModuleLocked({ modules, title }: { modules: Module[]; title?: string }) {
  const m = modules[0];
  const Icon = MODULE_ICON[m];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl py-10">
      <div className="relative overflow-hidden rounded-[28px] border border-slate-200/60 bg-white/70 p-10 text-center shadow-[0_30px_80px_-40px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/60">
        <div className={cn('pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-linear-to-br opacity-25 blur-3xl', MODULE_GRADIENT[m])} />
        <div className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center">
          <div className={cn('absolute inset-0 rounded-3xl bg-linear-to-br opacity-90', MODULE_GRADIENT[m])} />
          <Icon size={28} className="relative text-white" />
          <span className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-slate-900 text-white dark:border-slate-900 dark:bg-white dark:text-slate-900">
            <Lock size={13} />
          </span>
        </div>
        <h1 className="relative text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title ?? `${MODULE_LABELS[m]} lisansınızda yok`}</h1>
        <p className="relative mx-auto mt-2 max-w-md text-[15px] text-slate-500 dark:text-slate-400">
          Bu özellik {modules.map((x) => MODULE_LABELS[x]).join(' veya ')} ile gelir. Modülü ekleyince mevcut kurulumunuzda anında açılır; yeniden kurulum gerekmez.
        </p>
        <ul className="relative mx-auto mt-8 grid max-w-md gap-2.5 text-left">
          {MODULE_FEATURES[m].map((f) => (
            <li key={f} className="flex items-center gap-3 text-[14px] text-slate-700 dark:text-slate-300">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check size={12} strokeWidth={3} />
              </span>
              {f}
            </li>
          ))}
        </ul>
        <div className="relative mt-8 flex justify-center">
          <Button to="/lisans" variant="primary" iconRight={ArrowRight}>
            Lisans ve modüller
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
