import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Award, Cake, CheckCheck, Inbox, Megaphone, MonitorCheck, Plus, Siren, Sparkles, Wrench, GitPullRequestArrow } from 'lucide-react';
import type { Category } from '@ertepano/shared';
import { fmtAgo, pct, useApi } from '../api';
import type { Announcement } from '../types';
import { AnimatedNumber, Avatar, Badge, Button, CAT, Card, CardHeader, Cat, cn, EmptyState, listItem, PageSkeleton, Progress, ReadBar, StatCard, useAuth } from '../ui';

interface Dash {
  devices: { total: number; online: number; pending: number; alerts: number | null };
  activeCount: number;
  active: Announcement[];
  recent: (Announcement & { stats: { sent: number; seen: number; acked: number; answered: number } })[];
  openReports: Record<string, number>;
  emergency: { id: string; title: string; drill: boolean; startedAt: string } | null;
  celebrations: { fullName: string; department: string | null; type: 'birthday' | 'anniversary' }[];
  pendingAcks: { id: string; title: string; category: Category; sent: number; acked: number }[];
  approvalsWaiting?: number;
  canPublish: Category[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

/** Çevrimiçi oranı halkası */
function Ring({ value, total }: { value: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = total ? value / total : 0;
  return (
    <div className="relative h-36 w-36">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" className="stroke-slate-900/[0.06] dark:stroke-white/[0.08]" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          stroke="url(#ring-g)"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">%{Math.round(p * 100)}</span>
        <span className="text-[11px] font-medium text-slate-400">çevrimiçi</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { data } = useApi<Dash>('/api/dashboard', 10000);
  if (!data) return <PageSkeleton />;
  const d = data.devices;
  const reports = data.openReports.it_help ?? 0;
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 [&>*]:min-w-0">
      {data.emergency && (
        <Link to="/acil" className="xl:col-span-12">
          <Card className={cn('flex items-center gap-4 border-0 p-6 text-white', data.emergency.drill ? 'bg-linear-to-r from-amber-500 to-orange-600' : 'animate-siren bg-linear-to-r from-rose-600 to-red-600')} interactive>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              <Siren size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-white/80">{data.emergency.drill ? 'Tatbikat' : 'Acil durum'} · {fmtAgo(data.emergency.startedAt)} başladı</div>
              <div className="truncate text-lg font-bold tracking-tight">{data.emergency.title}</div>
            </div>
            <span className="flex items-center gap-1.5 font-semibold">Canlı yoklama <ArrowRight size={18} /></span>
          </Card>
        </Link>
      )}

      {!!data.approvalsWaiting && (
        <Link to="/onaylar" className="xl:col-span-12">
          <Card className="flex items-center gap-4 border-0 bg-linear-to-r from-amber-500/15 to-transparent p-5 ring-1 ring-amber-500/30" interactive>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/30">
              <GitPullRequestArrow size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-white">Onayınızı bekleyen {data.approvalsWaiting} duyuru var</div>
              <div className="text-[13px] text-slate-500 dark:text-slate-400">Onaylanana kadar çalışanların ekranına gitmez.</div>
            </div>
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-amber-700 dark:text-amber-300">İncele <ArrowRight size={16} /></span>
          </Card>
        </Link>
      )}

      {/* Karşılama — geniş bento */}
      <Card className="relative overflow-hidden p-8 xl:col-span-8">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-linear-to-br from-emerald-400/30 to-teal-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-40 h-56 w-56 rounded-full bg-indigo-400/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
            <Sparkles size={14} /> {today}
          </div>
          <h1 className="mt-3 text-[32px] leading-tight font-bold tracking-tight text-slate-900 dark:text-white">
            {greeting()}, {user.fullName.split(' ')[0]}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
            Şu an <b className="text-slate-800 dark:text-slate-200">{data.activeCount} duyuru</b> yayında ve <b className="text-slate-800 dark:text-slate-200">{d.online} ekran</b> bağlı.
            {reports > 0 && <> Sizi bekleyen <b className="text-slate-800 dark:text-slate-200">{reports} çalışan bildirimi</b> var.</>}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {data.canPublish.length > 0 && (
              <Button to="/duyurular/yeni" variant="primary" size="lg" icon={Plus}>
                Yeni duyuru
              </Button>
            )}
            <Button to="/acil" size="lg" icon={Siren} className="text-rose-600 dark:text-rose-400">
              Acil durum
            </Button>
            <Button to="/duyurular" variant="ghost" size="lg" iconRight={ArrowRight}>
              Tüm duyurular
            </Button>
          </div>
        </div>
      </Card>

      {/* Canlı ekranlar */}
      <Card className="flex items-center gap-6 p-8 xl:col-span-4" delay={0.05}>
        <Ring value={d.online} total={d.total} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Bağlı ekran</div>
          <div className="mt-1 text-[40px] leading-none font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">
            <AnimatedNumber value={d.online} />
          </div>
          <div className="mt-2 text-[13px] text-slate-500">{d.total} kayıtlı cihazdan</div>
          {d.pending > 0 && (
            <Badge tone="warning" dot className="mt-3">
              {d.pending} cihaz onay bekliyor
            </Badge>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 xl:col-span-12">
        <StatCard icon={Megaphone} tone="emerald" label="Yayındaki duyuru" value={data.activeCount} sub="özel gün ve kutlamalar dahil" delay={0.1} />
        <StatCard
          icon={Inbox}
          tone="violet"
          label="Açık çalışan bildirimi"
          value={Object.keys(data.openReports).length ? reports : null}
          delay={0.15}
          sub={
            Object.keys(data.openReports).length ? (
              <span className="flex gap-3">
                {data.openReports.it_help !== undefined && <span>{data.openReports.it_help} IT</span>}
              </span>
            ) : (
              'yetki alanınızda değil'
            )
          }
        />
        <StatCard icon={Wrench} tone="amber" label="Cihaz uyarısı" value={d.alerts} sub="disk, yeniden başlatma, erişim" delay={0.2} />
      </div>

      {/* Son duyurular */}
      <Card className="xl:col-span-8" delay={0.2}>
        <CardHeader
          icon={Megaphone}
          title="Son duyurular"
          description="Kaç kişi gördü, kaç kişi onayladı — anlık"
          action={
            <Button to="/duyurular" size="sm" variant="ghost" iconRight={ArrowUpRight}>
              Tümü
            </Button>
          }
        />
        {data.recent.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Henüz duyuru yok"
            description="Şablonlardan biriyle 30 saniyede ilk duyurunuzu yayınlayın."
            action={data.canPublish.length > 0 && <Button to="/duyurular/yeni" variant="primary" icon={Plus}>İlk duyuruyu oluştur</Button>}
          />
        ) : (
          <div className="px-3 pb-3">
            {data.recent.map((a, i) => {
              const done = a.requireAck ? a.stats.acked : a.kind === 'survey' ? a.stats.answered : undefined;
              return (
                <motion.div key={a.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                  <Link to={`/duyurular/${a.id}`} className="group grid grid-cols-[auto_1fr_200px] items-center gap-4 rounded-2xl px-3 py-3.5 transition-all duration-300 hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.04]">
                    <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl text-xl', CAT[a.category].soft)}>{a.emoji ?? '📢'}</div>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">{a.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-400">
                        <Cat c={a.category} /> <span>·</span> {fmtAgo(a.startsAt)}
                      </div>
                    </div>
                    <div>
                      <ReadBar targets={a.stats.sent} seen={a.stats.seen} done={done} />
                      <div className="mt-1.5 flex justify-between text-[12px] text-slate-500">
                        <span>%{pct(a.stats.seen, a.stats.sent)} gördü</span>
                        {done !== undefined && <span className="font-medium text-emerald-600 dark:text-emerald-400">%{pct(done, a.stats.sent)} {a.kind === 'survey' ? 'oyladı' : 'onay'}</span>}
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-6 xl:col-span-4">
        <Card delay={0.25}>
          <CardHeader icon={CheckCheck} title="Onay bekleyenler" description="Zorunlu okumalı aktif duyurular" />
          {data.pendingAcks.length === 0 ? (
            <div className="px-6 pb-6 text-[13px] text-slate-500">Şu an onay bekleyen zorunlu duyuru yok.</div>
          ) : (
            <div className="space-y-5 px-6 pb-6">
              {data.pendingAcks.map((p) => (
                <Link key={p.id} to={`/duyurular/${p.id}`} className="group block">
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate font-medium text-slate-800 group-hover:text-emerald-700 dark:text-slate-200 dark:group-hover:text-emerald-300">{p.title}</span>
                    <span className="shrink-0 text-slate-500 tabular-nums">
                      {p.acked}/{p.sent}
                    </span>
                  </div>
                  <Progress className="mt-2" segments={[{ value: pct(p.acked, p.sent) }]} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card delay={0.3} className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-violet-400/15 blur-3xl" />
          <CardHeader icon={Cake} title="Bugün kutluyoruz" description="Kart, kişinin ekranında sabah gösterilir" />
          {data.celebrations.length === 0 ? (
            <div className="px-6 pb-6 text-[13px] text-slate-500">Bugün doğum günü veya iş yıl dönümü yok.</div>
          ) : (
            <div className="space-y-1 px-3 pb-4">
              {data.celebrations.map((c, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.04]">
                  <Avatar name={c.fullName} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{c.fullName}</div>
                    <div className="text-[12px] text-slate-500">{c.department}</div>
                  </div>
                  <Badge tone={c.type === 'birthday' ? 'violet' : 'warning'} icon={c.type === 'birthday' ? Cake : Award}>
                    {c.type === 'birthday' ? 'Doğum günü' : 'Yıl dönümü'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {(user.role === 'admin' || user.role === 'it') && (
          <Card delay={0.35} className="p-6" interactive>
            <Link to="/cihazlar" className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/25">
                <MonitorCheck size={20} />
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-slate-900 dark:text-white">Ekranlar sağlıklı mı?</div>
                <div className="text-[12px] text-slate-500">{d.alerts ? `${d.alerts} cihazda uyarı var` : 'Envanteri görüntüle'}</div>
              </div>
              <ArrowRight size={18} className="text-slate-400" />
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
