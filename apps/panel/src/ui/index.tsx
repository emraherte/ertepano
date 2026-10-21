// ErtePano tasarım sistemi: cam (glass) yüzeyler, zümrüt vurgu, yumuşak mikro etkileşimler.
// Sayfalar yalnızca buradaki parçaları kullanır; yeni bir desen gerekiyorsa önce buraya eklenir.
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy as CopyIcon, Info, Loader2, type LucideIcon, X, XCircle } from 'lucide-react';
import { CATEGORY_LABELS, type Category } from '@ertepano/shared';
import type { User } from '../types';
import { cn } from './cn';

export { cn } from './cn';
export { ThemeProvider, useTheme } from './theme';
export { Select, type SelectProps } from './select';
export { ConfirmProvider, useConfirm, type ConfirmOptions } from './confirm';

// ---------------------------------------------------------------------------------------------
// Oturum
// ---------------------------------------------------------------------------------------------
export const AuthContext = createContext<{ user: User; logout: () => void } | null>(null);
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthContext yok');
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Ortak sınıflar
// ---------------------------------------------------------------------------------------------
export const glass =
  'rounded-3xl border border-slate-200/60 bg-white/70 shadow-[0_1px_0_0_rgba(255,255,255,0.7)_inset,0_10px_30px_-18px_rgba(15,23,42,0.25)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_10px_30px_-18px_rgba(0,0,0,0.6)]';

export const focusRing =
  'outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/60';

export const accentGradient = 'bg-linear-to-br from-emerald-500 to-teal-500';

/** Kategori → Tailwind sınıfları */
export const CAT: Record<Category, { dot: string; text: string; soft: string; ring: string; hex: string; grad: string }> = {
  ik: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-300', soft: 'bg-violet-500/10', ring: 'ring-violet-500/30', hex: '#7c3aed', grad: 'from-violet-500 to-fuchsia-500' },
  isg: { dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-300', soft: 'bg-rose-500/10', ring: 'ring-rose-500/30', hex: '#e11d48', grad: 'from-rose-500 to-orange-500' },
  it: { dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-300', soft: 'bg-sky-500/10', ring: 'ring-sky-500/30', hex: '#2563eb', grad: 'from-sky-500 to-indigo-500' },
  genel: { dot: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-300', soft: 'bg-teal-500/10', ring: 'ring-teal-500/30', hex: '#0d9488', grad: 'from-emerald-500 to-teal-500' },
};

// ---------------------------------------------------------------------------------------------
// Düğmeler
// ---------------------------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white bg-linear-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30 hover:brightness-[1.06] border border-emerald-400/30',
  secondary:
    'text-slate-700 bg-white/80 border border-slate-200/80 shadow-sm hover:bg-white hover:shadow-md hover:border-slate-300/80 dark:text-slate-200 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10',
  ghost: 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
  danger:
    'text-white bg-linear-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-600/25 hover:shadow-xl hover:shadow-rose-600/30 hover:brightness-105 border border-rose-400/30',
  subtle: 'text-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/15 dark:text-emerald-300',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-2xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  to?: string;
  href?: string;
}

export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md', extra?: string) =>
  cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-300 ease-out',
    'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    focusRing,
    VARIANTS[variant],
    SIZES[size],
    extra,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, to, href, className, children, ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  const inner = (
    <>
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon && <Icon size={iconSize} strokeWidth={2.2} />}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={2.2} />}
    </>
  );
  const cls = buttonClass(variant, size, className);
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} className={cls}>{inner}</a>;
  return (
    <button ref={ref} className={cls} disabled={rest.disabled || loading} {...rest}>
      {inner}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-900/5 hover:text-slate-900 active:scale-95 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white',
        focusRing,
        className,
      )}
      {...rest}
    >
      <Icon size={17} />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Kartlar ve yerleşim
// ---------------------------------------------------------------------------------------------
export function Card({ className, children, interactive, delay = 0, onClick }: { className?: string; children: ReactNode; interactive?: boolean; delay?: number; onClick?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={cn(glass, interactive && 'cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-900/10 dark:hover:shadow-black/40', className)}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ title, description, icon: Icon, action, className }: { title: ReactNode; description?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-6 pt-6 pb-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900/5 text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <Icon size={17} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8 flex flex-wrap items-end justify-between gap-6"
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">{eyebrow}</div>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </motion.div>
  );
}

/** Sayısal değeri yumuşakça sayarak gösterir. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString('tr-TR'));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={className}>{rounded}</motion.span>;
}

const TONES = {
  emerald: 'from-emerald-500/15 to-teal-500/10 text-emerald-600 dark:text-emerald-300',
  sky: 'from-sky-500/15 to-indigo-500/10 text-sky-600 dark:text-sky-300',
  violet: 'from-violet-500/15 to-fuchsia-500/10 text-violet-600 dark:text-violet-300',
  amber: 'from-amber-500/20 to-orange-500/10 text-amber-600 dark:text-amber-300',
  rose: 'from-rose-500/15 to-red-500/10 text-rose-600 dark:text-rose-300',
  slate: 'from-slate-500/15 to-slate-500/5 text-slate-600 dark:text-slate-300',
};
export type Tone = keyof typeof TONES;

export function IconTile({ icon: Icon, tone = 'emerald', size = 'md' }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl';
  return (
    <div className={cn('flex shrink-0 items-center justify-center bg-linear-to-br ring-1 ring-inset ring-current/10', s, TONES[tone])}>
      <Icon size={size === 'lg' ? 22 : size === 'sm' ? 15 : 18} strokeWidth={2} />
    </div>
  );
}

export function StatCard({ icon, tone, label, value, sub, delay, footer, onClick }: { icon: LucideIcon; tone?: Tone; label: string; value: number | null; sub?: ReactNode; delay?: number; footer?: ReactNode; onClick?: () => void }) {
  return (
    <Card className="p-6" delay={delay} interactive={!!onClick} onClick={onClick}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <IconTile icon={icon} tone={tone} />
      </div>
      <div className="mt-4 text-[34px] font-bold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">
        {value === null ? '—' : <AnimatedNumber value={value} />}
      </div>
      {sub && <div className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">{sub}</div>}
      {footer && <div className="mt-4">{footer}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Rozetler, çipler, kategori
// ---------------------------------------------------------------------------------------------
const BADGE: Record<string, string> = {
  neutral: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300',
  success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
  info: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300',
  violet: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300',
};
export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = 'neutral', dot, icon: Icon, children, className }: { tone?: BadgeTone; dot?: boolean; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset', BADGE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {Icon && <Icon size={12} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

export function Cat({ c, className }: { c: Category; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', CAT[c].text, className)}>
      <span className={cn('h-2 w-2 rounded-[3px]', CAT[c].dot)} />
      {CATEGORY_LABELS[c]}
    </span>
  );
}

const STATUS: Record<string, [string, BadgeTone]> = {
  active: ['Yayında', 'success'],
  scheduled: ['Planlandı', 'info'],
  draft: ['Taslak', 'neutral'],
  ended: ['Bitti', 'neutral'],
  pending: ['Onay bekliyor', 'warning'],
  approved: ['Onaylı', 'success'],
  blocked: ['Engelli', 'danger'],
  open: ['Açık', 'danger'],
  in_progress: ['İşlemde', 'warning'],
  closed: ['Kapandı', 'success'],
};
export function StatusBadge({ s }: { s: string }) {
  const [label, tone] = STATUS[s] ?? [s, 'neutral'];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export function Chip({ on, onClick, children, icon: Icon, count, className, title }: { on?: boolean; onClick?: () => void; children: ReactNode; icon?: LucideIcon; count?: number; className?: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97]',
        focusRing,
        on
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 shadow-sm shadow-emerald-500/10 dark:text-emerald-300'
          : 'border-slate-200/80 bg-white/60 text-slate-600 hover:border-slate-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10',
        className,
      )}
    >
      {Icon && <Icon size={14} />}
      {children}
      {count !== undefined && <span className={cn('tabular-nums', on ? 'text-emerald-600/70 dark:text-emerald-300/70' : 'text-slate-400')}>{count}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Sekmeler (kayan hap)
// ---------------------------------------------------------------------------------------------
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number; icon?: LucideIcon }[]; className?: string }) {
  const id = useId();
  return (
    <div className={cn('inline-flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200/60 bg-slate-900/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]', className)}>
      {items.map((it) => {
        const on = it.value === value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            className={cn('relative rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-300', focusRing, on ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}
          >
            {on && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/10 dark:ring-white/10"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {Icon && <Icon size={14} />}
              {it.label}
              {it.count !== undefined && <span className="tabular-nums text-slate-400">{it.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Form alanları
// ---------------------------------------------------------------------------------------------
const fieldBase =
  'w-full rounded-xl border border-slate-200/80 bg-white/70 px-3.5 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-300 placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500/60 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 outline-none disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-slate-500 dark:hover:border-white/20 dark:focus:bg-white/10';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon }>(function Input({ className, icon: Icon, ...rest }, ref) {
  if (!Icon) return <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...rest} />;
  return (
    <div className={cn('relative', className)}>
      <Icon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
      <input ref={ref} className={cn(fieldBase, 'h-10 pl-10')} {...rest} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-[96px] resize-y py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-2', className)}>
      <span className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
        {label}
        {hint && <span className="text-[12px] font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode }) {
  return (
    <label className="group flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-300', focusRing, checked ? 'bg-linear-to-r from-emerald-500 to-teal-500' : 'bg-slate-300/80 dark:bg-white/15')}
      >
        <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className={cn('h-5 w-5 rounded-full bg-white shadow-md', checked ? 'ml-auto' : '')} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>}
          {description && <span className="block text-[13px] text-slate-500 dark:text-slate-400">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300', className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-all duration-200',
          focusRing,
          checked ? 'border-emerald-500 bg-linear-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-500/30' : 'border-slate-300 bg-white/80 hover:border-slate-400 dark:border-white/20 dark:bg-white/5',
        )}
      >
        <AnimatePresence>{checked && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={12} strokeWidth={3.5} /></motion.span>}</AnimatePresence>
      </button>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// İlerleme
// ---------------------------------------------------------------------------------------------
/** Çok parçalı ilerleme çubuğu (ör. onayladı + yalnız gördü). Değerler 0–100. */
export function Progress({ segments, className, height = 'h-1.5' }: { segments: { value: number; className?: string }[]; className?: string; height?: string }) {
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-slate-900/[0.06] dark:bg-white/[0.08]', height, className)}>
      {segments.map((s, i) => (
        <motion.div
          key={i}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, s.value))}%` }}
          transition={{ duration: 0.8, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
          className={cn('h-full', s.className ?? 'bg-linear-to-r from-emerald-500 to-teal-500')}
        />
      ))}
    </div>
  );
}

/** Okunma: onay/yanıt (koyu) + yalnız gördü (açık). */
export function ReadBar({ targets, seen, done }: { targets: number; seen: number; done?: number }) {
  const t = Math.max(targets, 1);
  const d = done ?? 0;
  return (
    <Progress
      segments={[
        ...(done !== undefined ? [{ value: (Math.min(d, t) / t) * 100 }] : []),
        { value: (Math.max(0, Math.min(seen, t) - d) / t) * 100, className: done !== undefined ? 'bg-emerald-500/35' : undefined },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Tablo
// ---------------------------------------------------------------------------------------------
export const th = 'px-6 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-slate-400 whitespace-nowrap';
export const td = 'px-6 py-4 align-middle';
export const trCls = 'border-t border-slate-200/60 transition-colors duration-200 dark:border-white/5';
export const trClick = 'cursor-pointer hover:bg-slate-900/[0.025] dark:hover:bg-white/[0.03]';

// ---------------------------------------------------------------------------------------------
// İskelet ve boş durum
// ---------------------------------------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function SkeletonCard({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(glass, 'p-6', className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(glass, 'p-6')}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-5 h-8 w-16" />
          </div>
        ))}
      </div>
      <SkeletonCard className="mt-6" rows={5} />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-3xl bg-linear-to-br from-emerald-400/30 to-teal-400/20 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl border border-white/60 bg-linear-to-br from-white to-slate-50 text-emerald-600 shadow-lg shadow-slate-900/5 dark:border-white/10 dark:from-slate-800 dark:to-slate-900 dark:text-emerald-400">
          <Icon size={26} strokeWidth={1.8} />
        </div>
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------------------------
// Uyarı kutusu
// ---------------------------------------------------------------------------------------------
const CALLOUT = {
  info: ['border-sky-500/20 bg-sky-500/[0.07] text-sky-900 dark:text-sky-200', Info],
  success: ['border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-900 dark:text-emerald-200', CheckCircle2],
  warning: ['border-amber-500/25 bg-amber-500/[0.08] text-amber-900 dark:text-amber-200', AlertTriangle],
  danger: ['border-rose-500/25 bg-rose-500/[0.07] text-rose-900 dark:text-rose-200', XCircle],
} as const;
export function Callout({ tone = 'info', title, children, className, icon }: { tone?: keyof typeof CALLOUT; title?: ReactNode; children?: ReactNode; className?: string; icon?: LucideIcon }) {
  const [cls, DefIcon] = CALLOUT[tone];
  const Icon = icon ?? DefIcon;
  return (
    <div className={cn('flex gap-3 rounded-2xl border px-4 py-3.5 text-[13px] leading-relaxed backdrop-blur-sm', cls, className)}>
      <Icon size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------------------------
export function Modal({ open = true, title, description, onClose, children, footer, width = 560 }: { open?: boolean; title: ReactNode; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="pointer-events-none absolute inset-0 bg-slate-950/40 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            style={{ width: `min(${width}px, 100%)` }}
            className="relative flex max-h-[88vh] flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white/90 shadow-2xl shadow-slate-900/20 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/90"
          >
            <div className="flex items-start justify-between gap-4 px-7 pt-7">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
                {description && <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
              </div>
              <IconButton icon={X} label="Kapat" onClick={onClose} className="-mt-1 -mr-2" />
            </div>
            <div className="overflow-y-auto px-7 py-6">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200/60 bg-slate-50/60 px-7 py-4 dark:border-white/10 dark:bg-white/[0.02]">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------------------------
// Bildirim (toast)
// ---------------------------------------------------------------------------------------------
type ToastItem = { id: number; text: string; err?: boolean };
const ToastContext = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, text, err }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), err ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-[min(380px,calc(100vw-48px))] flex-col gap-3" role="status">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-3.5 text-sm font-medium text-slate-800 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-100"
            >
              {t.err ? <XCircle size={18} className="mt-px shrink-0 text-rose-500" /> : <CheckCircle2 size={18} className="mt-px shrink-0 text-emerald-500" />}
              <span className="min-w-0 flex-1">{t.text}</span>
              <button className="text-slate-400 transition hover:text-slate-700 dark:hover:text-white" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Kapat">
                <X size={15} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------------------------
export function Copy({ text, label = 'Kopyala' }: { text: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? Check : CopyIcon}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            toast('Panoya kopyalandı');
            setTimeout(() => setDone(false), 1500);
          },
          () => toast('Kopyalanamadı', true),
        )
      }
    >
      {label}
    </Button>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase('tr'))
    .join('');
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-teal-600 font-semibold text-white shadow-inner ring-2 ring-white/60 dark:ring-white/10', className)}
    >
      {initials || '?'}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-slate-200 bg-white/80 px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/5 dark:text-slate-400">{children}</kbd>;
}

export function LiveDot({ on = true, className }: { on?: boolean; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', on ? 'animate-pulse-ring bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600', className)} />;
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-3 text-[13px]', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="min-w-0 font-medium text-slate-800 dark:text-slate-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Animasyonlu listeler için ortak varyantlar */
export const listItem = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.035, duration: 0.35, ease: [0.22, 1, 0.36, 1] } }),
};

