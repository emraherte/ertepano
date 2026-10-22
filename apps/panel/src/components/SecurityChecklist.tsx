// Güvenlik kontrol listesi: kurulumun "güvenli mi?" sorusuna tek bakışta cevap.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CheckCircle2, DatabaseBackup, Info, RefreshCw, XCircle } from 'lucide-react';
import { api, useApi } from '../api';
import { Button, Card, CardHeader, cn, listItem, useToast } from '../ui';
import { ShieldCheck } from 'lucide-react';

export interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  action?: string;
}

const ICON = {
  ok: [CheckCircle2, 'text-emerald-500'],
  warn: [AlertTriangle, 'text-amber-500'],
  fail: [XCircle, 'text-rose-500'],
  info: [Info, 'text-sky-500'],
} as const;

export function useSetup() {
  return useApi<{ completed: boolean; orgName: string | null; publicUrl: string | null; checks: Check[] }>('/api/setup');
}

export function SecurityChecklist({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const { data, reload } = useSetup();
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const fails = data.checks.filter((c) => c.status === 'fail').length;
  const warns = data.checks.filter((c) => c.status === 'warn').length;
  const score = Math.round((data.checks.filter((c) => c.status === 'ok' || c.status === 'info').length / data.checks.length) * 100);

  const backup = async () => {
    setBusy(true);
    try {
      await api('/api/setup/backup', { method: 'POST' });
      toast('Yedek alındı');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Güvenlik kontrol listesi"
        description={fails ? `${fails} kritik, ${warns} uyarı — kurumun gönlü rahat olsun diye kapatın` : warns ? `${warns} uyarı` : 'Her şey yolunda'}
        action={
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums', fails ? 'bg-rose-500/10 text-rose-600' : warns ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600')}>
              %{score}
            </span>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => reload()}>
              Yenile
            </Button>
          </div>
        }
      />
      <div className={cn('space-y-1.5 px-4 pb-4', compact && 'max-h-[420px] overflow-y-auto')}>
        {data.checks.map((c, i) => {
          const [Icon, color] = ICON[c.status];
          return (
            <motion.div key={c.id} variants={listItem} initial="hidden" animate="show" custom={i} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.04]">
              <Icon size={18} className={cn('mt-0.5 shrink-0', color)} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-slate-900 dark:text-white">{c.label}</div>
                <div className="text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">{c.detail}</div>
              </div>
              {c.id === 'backup' && c.status !== 'ok' ? (
                <Button size="sm" icon={DatabaseBackup} loading={busy} onClick={backup}>
                  Şimdi yedekle
                </Button>
              ) : (
                c.action && c.status !== 'ok' && (
                  <Button size="sm" variant="ghost" iconRight={ArrowRight} to={c.action}>
                    Düzelt
                  </Button>
                )
              )}
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
