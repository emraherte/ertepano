// Rozetin çalışanın ekranındaki yeri: 9 hazır nokta ya da sürükleyerek serbest konum; boyut ve saydamlık.
// Değerler ajana olduğu gibi gider (posX/posY = rozet merkezinin ekran yüzdesi).
import { useRef, useState } from 'react';
import { Maximize2, Move, RotateCcw, SunDim } from 'lucide-react';
import { BADGE_POSITION_LABELS, BADGE_POSITIONS, BADGE_SIZE, type BadgePosition } from '@ertepano/shared';
import { Button, cn } from '../ui';

export interface Placement {
  position: string | null;
  posX: number | null;
  posY: number | null;
  size: number | null;
  opacity: number | null;
}

export const defaultPlacement = (position: BadgePosition = 'top-right'): Placement => ({ position, posX: null, posY: null, size: null, opacity: null });

/** Ekran genişliği (mantıksal px) — önizlemede boyutu orantılamak için */
const SCREEN_W = 1920;
const SNAP = 4;

export function centerOf(p: Placement): [number, number] {
  if (p.position === 'custom' && p.posX != null && p.posY != null) return [p.posX, p.posY];
  const preset = BADGE_POSITIONS[(p.position ?? 'top-right') as keyof typeof BADGE_POSITIONS] ?? BADGE_POSITIONS['top-right'];
  return [preset[0], preset[1]];
}

export function placementLabel(p: Placement) {
  const pos = (p.position ?? 'top-right') as BadgePosition;
  if (pos === 'custom') {
    const [x, y] = centerOf(p);
    return `Serbest (%${Math.round(x)}, %${Math.round(y)})`;
  }
  return BADGE_POSITION_LABELS[pos] ?? pos;
}

/** Yalnızca rozetin kendisi (önizlemelerde ortak) */
export function BadgeArt({ imageUrl, emoji, className }: { imageUrl?: string | null; emoji?: string | null; className?: string }) {
  return imageUrl ? (
    <img src={imageUrl} alt="" draggable={false} className={cn('h-full w-full object-contain drop-shadow-xl', className)} />
  ) : (
    <span className={cn('flex h-full w-full items-center justify-center leading-none drop-shadow-lg', className)} style={{ fontSize: '70cqw' }}>
      {emoji || '🏢'}
    </span>
  );
}

function Slider({ icon: Icon, label, value, min, max, step = 1, format, onChange }: { icon: typeof Move; label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between text-[13px] font-medium text-slate-700 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <Icon size={14} className="text-slate-400" /> {label}
        </span>
        <span className="rounded-md bg-slate-900/5 px-1.5 py-0.5 font-mono text-[12px] text-slate-600 tabular-nums dark:bg-white/10 dark:text-slate-300">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ep-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none"
        style={{ background: `linear-gradient(to right, rgb(16 185 129) ${pct}%, rgb(148 163 184 / 0.3) ${pct}%)` }}
      />
    </label>
  );
}

export function PlacementPicker({ value, onChange, imageUrl, emoji }: { value: Placement; onChange: (p: Placement) => void; imageUrl?: string | null; emoji?: string | null }) {
  const screen = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [x, y] = centerOf(value);
  const size = value.size ?? BADGE_SIZE.default;
  const opacity = value.opacity ?? 1;
  const widthPct = (size / SCREEN_W) * 100;

  const setXY = (clientX: number, clientY: number, snap: boolean) => {
    const r = screen.current?.getBoundingClientRect();
    if (!r) return;
    let nx = Math.min(98, Math.max(2, ((clientX - r.left) / r.width) * 100));
    let ny = Math.min(96, Math.max(3, ((clientY - r.top) / r.height) * 100));
    if (snap) {
      for (const [key, [px, py]] of Object.entries(BADGE_POSITIONS)) {
        if (Math.abs(px - nx) < SNAP && Math.abs(py - ny) < SNAP * 1.4) {
          onChange({ ...value, position: key, posX: null, posY: null });
          return;
        }
      }
    }
    nx = Math.round(nx * 10) / 10;
    ny = Math.round(ny * 10) / 10;
    onChange({ ...value, position: 'custom', posX: nx, posY: ny });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] bg-linear-to-b from-slate-700 to-slate-900 p-[6px] shadow-xl shadow-slate-900/20 ring-1 ring-slate-900/10 dark:ring-white/10">
        <div
          ref={screen}
          className={cn('relative aspect-[16/10] touch-none overflow-hidden rounded-[15px] bg-linear-to-br from-sky-100 via-slate-100 to-indigo-100 select-none dark:from-slate-800 dark:via-slate-800 dark:to-slate-900', drag ? 'cursor-grabbing' : 'cursor-crosshair')}
          onPointerDown={(e) => {
            if (e.target === screen.current) setXY(e.clientX, e.clientY, true);
          }}
        >
          {/* sahte masaüstü */}
          <div className="pointer-events-none absolute top-[12%] left-[16%] h-[62%] w-[56%] rounded-lg bg-white/80 shadow-lg dark:bg-slate-700/60">
            <div className="h-[9%] rounded-t-lg bg-slate-200/80 dark:bg-slate-600/60" />
            <div className="space-y-2 p-3">
              {[85, 60, 75, 45].map((w, i) => (
                <div key={i} className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[7%] bg-slate-900/80" />

          {/* hazır noktalar */}
          {Object.entries(BADGE_POSITIONS).map(([key, [px, py]]) => {
            const on = value.position === key;
            return (
              <button
                key={key}
                type="button"
                title={BADGE_POSITION_LABELS[key as BadgePosition]}
                onClick={() => onChange({ ...value, position: key, posX: null, posY: null })}
                className={cn(
                  'absolute z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all duration-200 hover:scale-150',
                  on ? 'border-emerald-500 bg-emerald-500/30' : 'border-white/90 bg-slate-900/20 shadow dark:border-white/60',
                  drag && 'scale-125',
                )}
                style={{ left: `${px}%`, top: `${py}%` }}
              />
            );
          })}

          {/* rozet */}
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDrag(true);
            }}
            onPointerMove={(e) => drag && setXY(e.clientX, e.clientY, false)}
            onPointerUp={(e) => {
              setDrag(false);
              setXY(e.clientX, e.clientY, true);
            }}
            className={cn('absolute z-20 aspect-square -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-lg [container-type:inline-size]', drag ? 'ring-2 ring-emerald-500' : 'transition-[left,top,width,opacity] duration-300 ease-out hover:ring-2 hover:ring-emerald-500/60')}
            style={{ left: `${x}%`, top: `${y}%`, width: `${Math.max(widthPct, 4)}%`, opacity }}
          >
            <BadgeArt imageUrl={imageUrl} emoji={emoji} />
          </div>

          {drag && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-emerald-500/50" style={{ left: `${x}%` }} />
              <div className="pointer-events-none absolute inset-x-0 h-px bg-emerald-500/50" style={{ top: `${y}%` }} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
          <Move size={14} /> <b className="font-medium text-slate-800 dark:text-slate-200">{placementLabel(value)}</b>
          <span className="hidden sm:inline">· rozeti sürükleyin ya da bir noktaya tıklayın</span>
        </div>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onChange(defaultPlacement())}>
          Sıfırla
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Slider icon={Maximize2} label="Boyut" value={size} min={BADGE_SIZE.min} max={BADGE_SIZE.max} step={8} format={(v) => `${v} px`} onChange={(v) => onChange({ ...value, size: v })} />
        <Slider icon={SunDim} label="Saydamlık" value={Math.round(opacity * 100)} min={20} max={100} step={5} format={(v) => `%${v}`} onChange={(v) => onChange({ ...value, opacity: v / 100 })} />
      </div>
    </div>
  );
}
