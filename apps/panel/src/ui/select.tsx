// Temaya uyan açılır liste. Yerel <select> açılır penceresi koyu temada beyaz zemin + beyaz yazı çizdiği için
// kendi listemizi çiziyoruz. Kullanımı yerel select ile aynıdır: <Select value onChange><option value>…</option></Select>
import { Children, isValidElement, type ReactElement, type ReactNode, type SelectHTMLAttributes, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

interface Opt {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value?: string | number | null;
  onChange?: (e: { target: { value: string } }) => void;
  placeholder?: string;
};

const textOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : isValidElement(n) ? textOf((n.props as { children?: ReactNode }).children) : '';

function readOptions(children: ReactNode): Opt[] {
  return Children.toArray(children)
    .filter((c): c is ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }> => isValidElement(c) && c.type === 'option')
    .map((c) => ({
      value: String(c.props.value ?? textOf(c.props.children)),
      label: c.props.children,
      text: textOf(c.props.children),
      disabled: c.props.disabled,
    }));
}

export function Select({ value, onChange, children, className, disabled, placeholder, id, ...rest }: SelectProps) {
  const options = readOptions(children);
  const current = options.find((o) => o.value === String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const typed = useRef({ s: '', t: 0 });

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(300, options.length * 40 + 12);
    const up = below < want && above > below;
    setRect({ left: r.left, width: r.width, top: up ? r.top - 6 : r.bottom + 6, up, maxH: Math.max(120, Math.min(300, up ? above : below)) });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const i = options.findIndex((o) => o.value === current?.value);
    setActive(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o?: Opt) => {
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value } });
  };

  const move = (d: number) => {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + d + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Home') (e.preventDefault(), setActive(0));
    else if (e.key === 'End') (e.preventDefault(), setActive(options.length - 1));
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), choose(options[active]));
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setOpen(false));
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      // harfle atla ("İs" yazınca İstanbul'a gider)
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLocaleLowerCase('tr'), t: now };
      const i = options.findIndex((o) => o.text.toLocaleLowerCase('tr').startsWith(typed.current.s));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={rest['aria-label']}
        title={rest.title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3.5 pr-9 text-left text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-300 outline-none',
          'hover:border-slate-300 focus-visible:border-emerald-500/60 focus-visible:ring-4 focus-visible:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60',
          'dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20',
          open && 'border-emerald-500/60 ring-4 ring-emerald-500/15',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-slate-400')}>{current ? current.label : placeholder ?? 'Seçin'}</span>
      </button>
      <ChevronDown size={16} className={cn('pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 transition-transform duration-300', open && 'rotate-180')} />

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={list}
              id={listId}
              role="listbox"
              initial={{ opacity: 0, y: rect.up ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: rect.up ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: 'fixed',
                left: rect.left,
                width: Math.max(rect.width, 180),
                maxHeight: rect.maxH,
                ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
                transformOrigin: rect.up ? 'bottom' : 'top',
              }}
              className="z-[90] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-1.5 shadow-2xl shadow-slate-900/15 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-black/50"
              onKeyDown={onKey}
            >
              {options.map((o, i) => {
                const sel = o.value === current?.value;
                return (
                  <div
                    key={o.value + i}
                    data-i={i}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                      i === active ? 'bg-slate-900/[0.05] text-slate-900 dark:bg-white/[0.08] dark:text-white' : 'text-slate-700 dark:text-slate-300',
                      sel && 'font-medium text-emerald-700 dark:text-emerald-300',
                      o.disabled && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {sel && <Check size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
