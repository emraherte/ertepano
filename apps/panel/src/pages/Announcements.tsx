import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bot, Building2, Megaphone, Plus, Search, Tag, User as UserIcon, Users } from 'lucide-react';
import { CATEGORIES, CATEGORY_LABELS, KIND_LABELS, ROLE_CATEGORIES } from '@ertepano/shared';
import { fmtDateTime, pct, useApi } from '../api';
import type { Announcement } from '../types';
import { useLicense } from '../components/license';
import { Badge, Button, CAT, Card, Cat, Checkbox, cn, EmptyState, Input, listItem, PageHeader, ReadBar, Select, SkeletonCard, StatusBadge, Tabs, td, th, trClick, trCls, useAuth } from '../ui';

const TABS = [
  { value: '', label: 'Tümü' },
  { value: 'active', label: 'Yayında' },
  { value: 'scheduled', label: 'Planlı' },
  { value: 'draft', label: 'Taslak' },
  { value: 'ended', label: 'Biten' },
];

export function targetLabel(targets: string[]) {
  if (targets.includes('all')) return 'Herkes';
  return targets
    .map((t) => {
      const [k, ...rest] = t.split(':');
      const v = rest.join(':');
      return k === 'loc' ? v : k === 'dep' ? v : k === 'user' ? `@${v}` : k === 'dev' ? 'tek cihaz' : t;
    })
    .join(', ');
}

export function TargetIcon({ targets }: { targets: string[] }) {
  const Icon = targets.includes('all') ? Users : targets.some((t) => t.startsWith('loc:')) ? Building2 : targets.some((t) => t.startsWith('user:')) ? UserIcon : Tag;
  return <Icon size={14} className="shrink-0 text-slate-400" />;
}

export function Announcements() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [showAuto, setShowAuto] = useState(false);
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ ...(status && { status }), ...(category && { category }) }).toString();
  const { data } = useApi<{ items: Announcement[] }>(`/api/announcements${qs ? `?${qs}` : ''}`, 15000);
  const needle = q.toLocaleLowerCase('tr');
  const items = (data?.items ?? []).filter((a) => (showAuto || !a.auto) && (!needle || `${a.title} ${a.body}`.toLocaleLowerCase('tr').includes(needle)));
  const { categoriesFor } = useLicense();
  const canCreate = categoriesFor(user.role).length > 0;

  return (
    <>
      <PageHeader
        eyebrow={<><Megaphone size={14} /> Yayınlar</>}
        title="Duyurular"
        description="Kart, şerit, rozet, anket ve geri sayım yayınları. Acil durumlar kendi sayfasında yönetilir."
        actions={canCreate && <Button to="/duyurular/yeni" variant="primary" icon={Plus}>Yeni duyuru</Button>}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} items={TABS} />
        <div className="flex-1" />
        <Input icon={Search} placeholder="Başlıkta ara…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-60" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full sm:w-56">
          <option value="">Tüm kategoriler</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Checkbox checked={showAuto} onChange={setShowAuto} label={<span className="flex items-center gap-1.5"><Bot size={14} /> Otomatikler</span>} />
      </div>

      {!data ? (
        <SkeletonCard rows={6} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Bu filtrede duyuru yok"
              description="Filtreleri değiştirin ya da yeni bir duyuru oluşturun."
              action={canCreate && <Button to="/duyurular/yeni" variant="primary" icon={Plus}>Yeni duyuru</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Duyuru</th>
                    <th className={th}>Hedef</th>
                    <th className={th}>Durum</th>
                    <th className={th}>Zaman</th>
                    <th className={cn(th, 'w-[220px]')}>Erişim</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a, i) => {
                    const s = a.stats!;
                    const base = Math.max(s.sent, s.targets);
                    const done = a.requireAck ? s.acked : a.kind === 'survey' ? s.answered : undefined;
                    return (
                      <motion.tr key={a.id} variants={listItem} initial="hidden" animate="show" custom={i} className={cn(trCls, trClick, 'group')} onClick={() => nav(`/duyurular/${a.id}`)}>
                        <td className={td}>
                          <div className="flex items-center gap-4">
                            <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl transition-transform duration-300 group-hover:scale-105', CAT[a.category].soft)}>{a.emoji ?? '📢'}</div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">{a.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
                                <Cat c={a.category} />
                                <span>·</span>
                                <span>{KIND_LABELS[a.kind]}</span>
                                {a.requireAck && <Badge tone="info">Zorunlu onay</Badge>}
                                {a.auto && <Badge icon={Bot}>Otomatik</Badge>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={cn(td, 'text-[13px] text-slate-600 dark:text-slate-300')}>
                          <span className="flex items-center gap-2"><TargetIcon targets={a.targets} /> {targetLabel(a.targets)}</span>
                        </td>
                        <td className={td}>
                          <StatusBadge s={a.status} />
                        </td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500')}>
                          {fmtDateTime(a.startsAt ?? a.createdAt)}
                          {a.endsAt && <div className="text-[12px] text-slate-400">→ {fmtDateTime(a.endsAt)}</div>}
                        </td>
                        <td className={td}>
                          {a.status === 'draft' ? (
                            <span className="text-[12px] text-slate-400">{s.targets} cihaza gidecek</span>
                          ) : (
                            <>
                              <ReadBar targets={base} seen={s.seen} done={done} />
                              <div className="mt-1.5 flex justify-between text-[12px] text-slate-500 tabular-nums">
                                <span>{s.seen}/{base} gördü</span>
                                {done !== undefined && <span className="font-medium text-emerald-600 dark:text-emerald-400">%{pct(done, Math.max(s.sent, 1))}</span>}
                              </div>
                            </>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
