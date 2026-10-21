import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, MapPin, RadioTower, Sun, Timer, WifiOff } from 'lucide-react';
import { CATEGORY_LABELS, type Category } from '@ertepano/shared';
import { CAT, cn } from '../ui';

interface KioskData {
  serverTime: string;
  emergency: { title: string; body: string; emoji: string | null; color: string | null; drill: boolean } | null;
  items: { id: string; kind: string; category: Category; title: string; body: string; emoji: string | null; imageUrl: string | null; color: string | null; countdownTo: string | null }[];
}

const ROTATE_MS = 12000;

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-[20vh] -left-[10vw] h-[60vh] w-[50vw] rounded-full bg-emerald-500/20 blur-[120px]" />
      <div className="absolute top-[30vh] -right-[15vw] h-[60vh] w-[50vw] rounded-full bg-teal-400/15 blur-[120px]" />
      <div className="absolute -bottom-[25vh] left-[25vw] h-[55vh] w-[45vw] rounded-full bg-indigo-500/15 blur-[120px]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '5vw 5vw',
          maskImage: 'radial-gradient(ellipse at 50% 0%, black 25%, transparent 75%)',
        }}
      />
    </div>
  );
}

/** Fabrika/yemekhane TV'si: oturumsuz, anahtarla; duyurular döner, acil durumda tüm ekran kırmızı. */
export function Kiosk() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key') ?? '';
  const loc = params.get('loc');
  const [data, setData] = useState<KioskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    document.documentElement.classList.add('dark');
    const load = () =>
      fetch(`/api/kiosk?key=${encodeURIComponent(key)}${loc ? `&loc=${encodeURIComponent(loc)}` : ''}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          setData(j);
          setError(null);
        })
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [key, loc]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const r = setInterval(() => setI((x) => x + 1), ROTATE_MS);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  const shell = 'fixed inset-0 overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 font-sans text-white';

  if (error && !data) {
    return (
      <div className={cn(shell, 'flex flex-col items-center justify-center gap-[2vw]')}>
        <Backdrop />
        <div className="relative flex h-[8vw] w-[8vw] items-center justify-center rounded-[2vw] bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
          <AlertTriangle className="h-[4vw] w-[4vw]" />
        </div>
        <div className="relative text-[2.4vw] font-semibold tracking-tight">{error}</div>
        <div className="relative text-[1.3vw] text-slate-400">Kiosk bağlantısını panelden yeniden kopyalayın.</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={cn(shell, 'flex items-center justify-center')}>
        <Backdrop />
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }} className="relative flex items-center gap-[1vw] text-[1.6vw] text-slate-400">
          <RadioTower className="h-[2vw] w-[2vw]" /> Bağlanıyor…
        </motion.div>
      </div>
    );
  }

  // ---- Acil durum: tüm ekran ----
  if (data.emergency) {
    const e = data.emergency;
    const color = e.color ?? (e.drill ? '#ea580c' : '#dc2626');
    return (
      <motion.div
        className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden p-[5vw] text-center text-white"
        style={{ background: `radial-gradient(circle at 50% 35%, color-mix(in oklab, ${color} 85%, white), ${color} 45%, color-mix(in oklab, ${color} 55%, black) 100%)` }}
        animate={{ filter: ['brightness(1)', 'brightness(0.8)', 'brightness(1)'] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,0,0,0.35),transparent_60%)]" />
        {e.drill && (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative mb-[2.5vw] rounded-[1vw] bg-white px-[2.5vw] py-[0.6vw] text-[2.6vw] font-black tracking-[0.25em]" style={{ color }}>
            TATBİKAT
          </motion.div>
        )}
        <motion.div initial={{ scale: 0.6 }} animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.3, repeat: Infinity }} className="relative text-[10vw] leading-none drop-shadow-2xl">
          {e.emoji ?? '🚨'}
        </motion.div>
        <h1 className="relative mt-[2vw] max-w-[90vw] text-[5.6vw] leading-[1.05] font-black tracking-tight drop-shadow-lg">{e.title}</h1>
        {e.body && <p className="relative mt-[2vw] max-w-[78vw] text-[2.5vw] leading-snug font-medium text-white/95">{e.body}</p>}
        <div className="absolute bottom-[3vw] flex items-center gap-[1vw] text-[1.4vw] font-semibold text-white/80">
          <span className="tabular-nums">{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          {loc && (
            <>
              <span>·</span>
              <MapPin className="h-[1.4vw] w-[1.4vw]" /> {loc}
            </>
          )}
        </div>
      </motion.div>
    );
  }

  const items = data.items;
  const cur = items.length ? items[i % items.length] : null;
  const cat = cur ? CAT[cur.category] : CAT.genel;
  const accent = cur?.color ?? cat.hex;
  const cd = cur?.countdownTo ? Math.max(0, Math.floor((Date.parse(cur.countdownTo) - now.getTime()) / 1000)) : null;

  return (
    <div className={cn(shell, 'flex flex-col')}>
      <Backdrop />

      {/* Üst bant */}
      <header className="relative flex items-center justify-between px-[3vw] pt-[2.2vw] pb-[1.6vw]">
        <div className="flex items-center gap-[1vw]">
          <div className="flex h-[3.4vw] w-[3.4vw] items-center justify-center rounded-[1vw] bg-linear-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/30">
            <RadioTower className="h-[1.8vw] w-[1.8vw]" />
          </div>
          <div>
            <div className="text-[1.6vw] font-bold tracking-tight">ErtePano</div>
            {loc && (
              <div className="flex items-center gap-[0.4vw] text-[1vw] text-slate-400">
                <MapPin className="h-[1vw] w-[1vw]" /> {loc}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[2.5vw]">
          {error && (
            <div className="flex items-center gap-[0.5vw] rounded-full bg-amber-500/15 px-[1vw] py-[0.4vw] text-[1vw] text-amber-300 ring-1 ring-amber-400/30">
              <WifiOff className="h-[1vw] w-[1vw]" /> Bağlantı yok
            </div>
          )}
          <div className="text-right">
            <div className="text-[3.4vw] leading-none font-bold tracking-tight tabular-nums">{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="mt-[0.4vw] text-[1.1vw] font-medium text-slate-400 capitalize">{now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          </div>
        </div>
      </header>

      {/* Duyuru kartı */}
      <main className="relative flex flex-1 px-[3vw] pb-[1.5vw]">
        <AnimatePresence mode="wait">
          {cur ? (
            <motion.article
              key={cur.id}
              initial={{ opacity: 0, y: 30, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.99 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex flex-1 overflow-hidden rounded-[2.2vw] border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur-2xl"
            >
              <div className={cn('w-[0.9vw] shrink-0 bg-linear-to-b', cat.grad)} style={cur.color ? { background: accent } : undefined} />
              <div className="pointer-events-none absolute -top-[10vw] -right-[6vw] h-[30vw] w-[30vw] rounded-full opacity-30 blur-[90px]" style={{ background: accent }} />
              <div className={cn('relative flex flex-1 gap-[3vw] p-[4vw]', cur.imageUrl ? 'items-center' : 'flex-col justify-center')}>
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-[0.6vw] rounded-full bg-white/10 px-[1.1vw] py-[0.45vw] text-[1.15vw] font-semibold ring-1 ring-white/15">
                    <span className="h-[0.7vw] w-[0.7vw] rounded-full" style={{ background: accent }} />
                    {CATEGORY_LABELS[cur.category]}
                  </div>
                  {cur.emoji && <div className="mt-[2vw] text-[5.5vw] leading-none">{cur.emoji}</div>}
                  <h1 className="mt-[1.5vw] text-[4.4vw] leading-[1.08] font-bold tracking-tight">{cur.title}</h1>
                  {cur.body && <p className="mt-[1.5vw] max-w-[70vw] text-[2.1vw] leading-relaxed whitespace-pre-wrap text-slate-300">{cur.body}</p>}
                  {cd !== null && (
                    <div className="mt-[2.5vw] inline-flex items-center gap-[1.2vw] rounded-[1.4vw] border border-white/10 bg-black/25 px-[2vw] py-[1vw]">
                      <Timer className="h-[3vw] w-[3vw]" style={{ color: accent }} />
                      <span className="text-[6vw] leading-none font-bold tracking-tight tabular-nums">
                        {Math.floor(cd / 3600) ? `${Math.floor(cd / 3600)}:` : ''}
                        {String(Math.floor((cd % 3600) / 60)).padStart(2, '0')}:{String(cd % 60).padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>
                {cur.imageUrl && <img src={cur.imageUrl} alt="" className="max-h-[52vh] max-w-[34vw] rounded-[1.6vw] object-contain shadow-2xl ring-1 ring-white/10" />}
              </div>
              {items.length > 1 && (
                <motion.div key={`bar-${i}`} className="absolute bottom-0 left-0 h-[0.35vw] bg-white/40" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: ROTATE_MS / 1000, ease: 'linear' }} />
              )}
            </motion.article>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative flex flex-1 flex-col items-center justify-center rounded-[2.2vw] border border-white/10 bg-white/[0.04] text-center backdrop-blur-2xl"
            >
              <div className="flex h-[8vw] w-[8vw] items-center justify-center rounded-[2.2vw] bg-linear-to-br from-amber-300 to-orange-500 shadow-2xl shadow-orange-500/30">
                <Sun className="h-[4.4vw] w-[4.4vw]" />
              </div>
              <h1 className="mt-[2.5vw] text-[4vw] font-bold tracking-tight">İyi çalışmalar!</h1>
              <p className="mt-[0.8vw] text-[1.8vw] text-slate-400">Şu an yayında duyuru yok.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* İlerleme noktaları */}
      <footer className="relative flex h-[3vw] items-center justify-center gap-[0.7vw]">
        {items.map((x, j) => {
          const on = j === i % items.length;
          return <motion.span key={x.id} animate={{ width: on ? '2.6vw' : '0.8vw', opacity: on ? 1 : 0.35 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="h-[0.8vw] rounded-full bg-white" />;
        })}
      </footer>
    </div>
  );
}
