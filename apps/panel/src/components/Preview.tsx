import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CATEGORY_COLORS, type Category, type Kind } from '@ertepano/shared';
import { BadgeArt, centerOf } from './PlacementPicker';

export interface PreviewData {
  kind: Kind;
  category: Category;
  title: string;
  body: string;
  emoji?: string | null;
  imageUrl?: string | null;
  color?: string | null;
  requireAck?: boolean;
  ackLabel?: string | null;
  options?: string[] | null;
  countdownTo?: string | null;
  position?: string | null;
  posX?: number | null;
  posY?: number | null;
  size?: number | null;
  opacity?: number | null;
  drill?: boolean;
  emergency?: boolean;
}

function useCountdown(to?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!to) return '--:--';
  const s = Math.max(0, Math.floor((Date.parse(to) - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const pop = { initial: { opacity: 0, y: 10, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 6 }, transition: { type: 'spring' as const, stiffness: 360, damping: 28 } };

/** Duyurunun çalışan ekranında nasıl görüneceğinin maketi (gerçekçi monitör çerçevesi içinde). */
export function Preview({ d }: { d: PreviewData }) {
  const c = d.color || CATEGORY_COLORS[d.category];
  const cd = useCountdown(d.kind === 'countdown' ? d.countdownTo : null);
  const badgeAt = centerOf({ position: d.position ?? 'top-right', posX: d.posX ?? null, posY: d.posY ?? null, size: null, opacity: null });

  return (
    <div className="w-full">
      {/* Monitör */}
      <div className="rounded-[22px] bg-linear-to-b from-slate-700 to-slate-900 p-[7px] shadow-2xl shadow-slate-900/25 ring-1 ring-slate-900/10 dark:from-slate-700 dark:to-slate-800 dark:shadow-black/50 dark:ring-white/10">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-linear-to-br from-sky-100 via-slate-100 to-indigo-100 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950">
          {/* masaüstü uygulaması */}
          <div className="absolute top-[10%] left-[6%] h-[68%] w-[60%] overflow-hidden rounded-lg bg-white/90 shadow-lg shadow-slate-900/10 dark:bg-slate-700/70">
            <div className="flex h-[9%] min-h-3 items-center gap-1 bg-slate-100 px-2 dark:bg-slate-600/60">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
            <div className="space-y-2 p-3">
              {[90, 70, 80, 50, 75, 60].map((w, i) => (
                <div key={i} className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          {/* görev çubuğu */}
          <div className="absolute inset-x-0 bottom-0 flex h-[7%] items-center justify-center gap-1.5 bg-slate-900/80 backdrop-blur">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-2 w-2 rounded-sm bg-white/30" />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {(d.kind === 'toast' || d.kind === 'survey') && (
              <motion.div key="toast" {...pop} className="absolute right-[2.5%] bottom-[10%] w-[46%] rounded-xl border border-white/60 bg-white/95 p-2.5 text-[10px] leading-snug text-slate-900 shadow-2xl shadow-slate-900/25 backdrop-blur" style={{ borderLeft: `4px solid ${c}` }}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-tight">
                  {d.emoji && <span>{d.emoji}</span>}
                  <span className="truncate">{d.title || 'Başlık'}</span>
                </div>
                {d.imageUrl && <img src={d.imageUrl} alt="" className="my-1.5 max-h-14 max-w-full rounded-md" />}
                {d.body && <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-slate-500">{d.body}</div>}
                {d.kind === 'survey' && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(d.options ?? []).filter(Boolean).map((o, i) => (
                      <span key={i} className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[9px]">{o}</span>
                    ))}
                  </div>
                )}
                {d.kind === 'toast' && (
                  <div className="mt-2 flex justify-end gap-1">
                    {!d.requireAck && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-medium text-slate-600">Kapat</span>}
                    <span className="rounded-md px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: c }}>
                      {d.requireAck ? d.ackLabel || 'Okudum, anladım' : 'Tamam'}
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {(d.kind === 'banner' || d.kind === 'countdown') && (
              <motion.div key="banner" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-lg" style={{ background: c }}>
                {d.emoji && <span>{d.emoji}</span>}
                <span className="shrink-0">{d.title || 'Başlık'}</span>
                {d.body && <span className="truncate font-normal opacity-90">— {d.body}</span>}
                {d.kind === 'countdown' && <span className="ml-auto shrink-0 rounded bg-black/20 px-1.5 py-px font-mono tabular-nums">{cd}</span>}
              </motion.div>
            )}

            {d.kind === 'badge' && (
              <motion.div
                key="badge"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: d.opacity ?? 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 transition-[left,top,width] duration-300 [container-type:inline-size]"
                style={{ left: `${badgeAt[0]}%`, top: `${badgeAt[1]}%`, width: `${Math.max(((d.size ?? 160) / 1920) * 100, 4)}%` }}
              >
                <BadgeArt imageUrl={d.imageUrl} emoji={d.emoji} />
              </motion.div>
            )}

            {d.kind === 'fullscreen' && (
              <motion.div key="full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-[8%] text-center text-white" style={{ background: `radial-gradient(circle at 50% 30%, ${c}, ${c}dd 60%, #0f172a 140%)` }}>
                {d.drill && <div className="absolute top-[7%] rounded-md bg-white px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.2em]" style={{ color: c }}>TATBİKAT</div>}
                <div className="text-[30px] leading-none">{d.emoji}</div>
                <div className="text-[14px] font-extrabold tracking-tight">{d.title}</div>
                <div className="line-clamp-3 text-[10px] opacity-90">{d.body}</div>
                {d.emergency && (
                  <div className="mt-2 flex gap-2">
                    <span className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-bold text-slate-900 shadow">✓ Güvendeyim</span>
                    <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-slate-900 shadow">Yardım lazım</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* ayak */}
      <div className="mx-auto h-5 w-[18%] bg-linear-to-b from-slate-400 to-slate-500 dark:from-slate-700 dark:to-slate-800" style={{ clipPath: 'polygon(12% 0, 88% 0, 100% 100%, 0 100%)' }} />
      <div className="mx-auto h-1.5 w-[34%] rounded-full bg-slate-400/80 shadow-md dark:bg-slate-700" />
    </div>
  );
}
