import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS, type Category } from '@ertepano/shared';
import type { User } from './types';

// ---- Oturum ----
export const AuthContext = createContext<{ user: User; logout: () => void } | null>(null);
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthContext yok');
  return ctx;
}

// ---- Bildirim (toast) ----
type ToastItem = { id: number; text: string; err?: boolean };
const ToastContext = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, err }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), err ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-host" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Küçük bileşenler ----
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Cat({ c }: { c: Category }) {
  return (
    <span className="cat" style={{ ['--c' as string]: CATEGORY_COLORS[c] }}>
      {CATEGORY_LABELS[c]}
    </span>
  );
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted" style={{ marginTop: 6 }}>{children}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Okunma çubuğu: görüldü (açık) + onaylandı/yanıtlandı (koyu) */
export function ReadBar({ targets, seen, done }: { targets: number; seen: number; done?: number }) {
  const t = Math.max(targets, 1);
  return (
    <div className="progress" title={`${seen}/${targets} gördü${done !== undefined ? ` · ${done} onayladı` : ''}`}>
      {done !== undefined && <div className="ack" style={{ width: `${(Math.min(done, t) / t) * 100}%` }} />}
      <div style={{ width: `${(Math.max(0, Math.min(seen, t) - (done ?? 0)) / t) * 100}%`, opacity: 0.55 }} />
    </div>
  );
}

export function StatusBadge({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    active: ['Yayında', 'badge-ok'],
    scheduled: ['Planlandı', 'badge-info'],
    draft: ['Taslak', ''],
    ended: ['Bitti', ''],
    pending: ['Onay bekliyor', 'badge-warn'],
    approved: ['Onaylı', 'badge-ok'],
    blocked: ['Engelli', 'badge-danger'],
    open: ['Açık', 'badge-danger'],
    in_progress: ['İşlemde', 'badge-warn'],
    closed: ['Kapandı', 'badge-ok'],
  };
  const [label, cls] = map[s] ?? [s, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Copy({ text, label = 'Kopyala' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      className="btn btn-sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast('Panoya kopyalandı'), () => toast('Kopyalanamadı', true))}
    >
      📋 {label}
    </button>
  );
}
