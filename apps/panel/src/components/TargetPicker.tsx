import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, Globe, Info, Tag, User as UserIcon } from 'lucide-react';
import { api, useApi } from '../api';
import { AnimatedNumber, Badge, Chip, Skeleton } from '../ui';

interface Targets {
  total: number;
  locations: { name: string; count: number }[];
  departments: { name: string; count: number }[];
}

/** "Herkes" ya da lokasyon/departman çipleri; seçim değiştikçe kaç cihaza gideceği yazılır. */
export function TargetPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data } = useApi<Targets>('/api/targets');
  const [count, setCount] = useState<number | null>(null);
  const all = value.includes('all');

  useEffect(() => {
    if (!value.length) {
      setCount(0);
      return;
    }
    let live = true;
    api<{ count: number }>('/api/targets/count', { body: { targets: value } }).then((r) => live && setCount(r.count), () => {});
    return () => {
      live = false;
    };
  }, [value]);

  const toggle = (t: string) => {
    const rest = value.filter((v) => v !== 'all');
    const next = rest.includes(t) ? rest.filter((v) => v !== t) : [...rest, t];
    onChange(next.length ? next : ['all']);
  };

  const custom = value.filter((v) => v.startsWith('user:') || v.startsWith('dev:'));

  if (!data) {
    return (
      <div className="flex flex-wrap gap-2">
        {[90, 120, 110, 100].map((w, i) => (
          <div key={i} style={{ width: w }}>
            <Skeleton className="h-8 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-[12px] font-medium text-slate-400">Lokasyon</div>
        <div className="flex flex-wrap gap-2">
          <Chip on={all} icon={Globe} count={data.total} onClick={() => onChange(['all'])}>
            Herkes
          </Chip>
          {data.locations.map((l) => (
            <Chip key={l.name} on={value.includes(`loc:${l.name}`)} icon={Building2} count={l.count} onClick={() => toggle(`loc:${l.name}`)}>
              {l.name}
            </Chip>
          ))}
        </div>
      </div>
      {!!data.departments.length && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-slate-400">Departman</div>
          <div className="flex flex-wrap gap-2">
            {data.departments.map((d) => (
              <Chip key={d.name} on={value.includes(`dep:${d.name}`)} icon={Tag} count={d.count} onClick={() => toggle(`dep:${d.name}`)}>
                {d.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {custom.map((c) => (
            <Badge key={c} icon={UserIcon}>
              {c}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] px-4 py-3">
        <div className="text-2xl font-bold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-300">
          <AnimatePresence mode="wait">
            <motion.span key={count ?? -1} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              {count === null ? '…' : <AnimatedNumber value={count} />}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="text-[13px] leading-snug text-slate-600 dark:text-slate-300">
          cihaza gönderilecek
          {!all && <div className="text-[12px] text-slate-400">Seçilen lokasyon veya departmandan biri tutan cihazlar</div>}
        </div>
      </div>
      {!data.locations.length && (
        <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
          <Info size={13} /> Lokasyon/departman çipleri için Cihazlar sayfasından etiket atayın.
        </p>
      )}
    </div>
  );
}
