// Tarayıcının confirm() penceresi yerine temaya uyan onay penceresi:  if (!(await confirm({ … }))) return;
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button, Modal } from './index';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setOpts(null);
  };

  const danger = opts?.tone === 'danger';
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        width={440}
        title={
          <span className="flex items-center gap-3">
            <span className={danger ? 'flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}>
              {danger ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
            </span>
            {opts?.title}
          </span>
        }
        onClose={() => close(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {opts?.cancelLabel ?? 'Vazgeç'}
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {opts?.confirmLabel ?? 'Onayla'}
            </Button>
          </>
        }
      >
        <div className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">{opts?.description}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
