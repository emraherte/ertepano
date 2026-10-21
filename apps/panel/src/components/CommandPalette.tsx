import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, type LucideIcon, Search } from 'lucide-react';
import { cn, Kbd } from '../ui';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
  keywords?: string;
}

const norm = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Linear tarzı ⌘K / Ctrl+K: sayfalara git, sık işlemleri başlat. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const n = norm(q.trim());
    return n ? commands.filter((c) => norm(`${c.label} ${c.keywords ?? ''} ${c.group}`).includes(n)) : commands;
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const groups = [...new Set(results.map((r) => r.group))];
  let idx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <div className="pointer-events-none absolute inset-0 bg-slate-950/30 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 480, damping: 36 }}
            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200/70 bg-white/90 shadow-2xl shadow-slate-900/25 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/90"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === 'Enter') run(results[active]);
            }}
          >
            <div className="flex items-center gap-3 border-b border-slate-200/60 px-5 dark:border-white/10">
              <Search size={18} className="text-slate-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Sayfa veya işlem ara…"
                className="h-14 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-500">"{q}" için sonuç yok</div>}
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</div>
                  {results
                    .filter((r) => r.group === g)
                    .map((c) => {
                      idx++;
                      const i = idx;
                      const on = i === active;
                      return (
                        <button
                          key={c.id}
                          onMouseMove={() => setActive(i)}
                          onClick={() => run(c)}
                          className={cn('relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors', on ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300')}
                        >
                          {on && <motion.span layoutId="cmd-active" className="absolute inset-0 rounded-xl bg-slate-900/[0.05] dark:bg-white/[0.07]" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
                          <c.icon size={17} className={cn('relative', on ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
                          <span className="relative flex-1 font-medium">{c.label}</span>
                          {c.hint && <span className="relative text-[12px] text-slate-400">{c.hint}</span>}
                          {on && <CornerDownLeft size={14} className="relative text-slate-400" />}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useCommandHotkey(setOpen: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setOpen]);
}

export function useGoTo() {
  const nav = useNavigate();
  return (to: string) => () => nav(to);
}
