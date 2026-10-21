// 6 haneli doğrulama kodu girişi: kutular arası otomatik geçiş, yapıştırma, SMS/Authenticator otomatik doldurma.
import { useEffect, useRef } from 'react';
import { cn } from './cn';

export function CodeInput({ value, onChange, onComplete, disabled, autoFocus, error }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; autoFocus?: boolean; error?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const set = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
    return clean;
  };

  return (
    <div className="flex justify-between gap-2" onPaste={(e) => {
      const t = e.clipboardData.getData('text');
      if (/\d/.test(t)) {
        e.preventDefault();
        const c = set(t);
        refs.current[Math.min(c.length, 5)]?.focus();
      }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Kod hanesi ${i + 1}`}
          maxLength={i === 0 ? 6 : 1}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) {
              // otomatik doldurma ilk kutuya 6 haneyi birden yazar
              const c = set(v);
              refs.current[Math.min(c.length, 5)]?.focus();
              return;
            }
            const next = (value.slice(0, i) + v + value.slice(i + 1)).slice(0, 6);
            set(next);
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) {
              refs.current[i - 1]?.focus();
              onChange(value.slice(0, i - 1));
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-14 w-full min-w-0 rounded-2xl border bg-white/70 text-center font-mono text-2xl font-semibold text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 outline-none',
            'focus:border-emerald-500/60 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 dark:bg-white/5 dark:text-white dark:focus:bg-white/10',
            error ? 'border-rose-400 dark:border-rose-500/60' : 'border-slate-200/80 dark:border-white/10',
          )}
        />
      ))}
    </div>
  );
}
