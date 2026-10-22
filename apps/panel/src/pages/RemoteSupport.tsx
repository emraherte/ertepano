import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, CircleOff, Clock, Eye, Hand, Loader2, Maximize, MousePointerClick, PhoneOff, ScreenShare, ShieldCheck, User as UserIcon } from 'lucide-react';
import { api, fmtDateTime, useApi } from '../api';
import { Badge, type BadgeTone, Button, Callout, Card, cn, EmptyState, listItem, PageHeader, SkeletonCard, td, th, trCls } from '../ui';

interface Session {
  id: string;
  deviceId: string;
  technician: string;
  reason: string;
  mode: 'view' | 'control';
  allowControl: boolean;
  status: 'requested' | 'accepted' | 'active' | 'denied' | 'expired' | 'ended' | 'failed';
  userLogin: string | null;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  endReason: string | null;
  durationSec: number | null;
  hostname?: string | null;
}

const STATUS: Record<Session['status'], [string, BadgeTone]> = {
  requested: ['Onay bekleniyor', 'info'],
  accepted: ['Bağlanıyor', 'info'],
  active: ['Bağlı', 'success'],
  denied: ['Çalışan reddetti', 'warning'],
  expired: ['Yanıt yok', 'neutral'],
  ended: ['Bitti', 'neutral'],
  failed: ['Bağlanamadı', 'danger'],
};

const dur = (s: number | null) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

// ---------------------------------------------------------------------------------------------
// Geçmiş
// ---------------------------------------------------------------------------------------------
export function SupportHistory() {
  const { data } = useApi<{ items: Session[] }>('/api/support/sessions', 15000);
  const nav = useNavigate();
  const items = data?.items ?? [];
  return (
    <>
      <PageHeader
        eyebrow={<><ScreenShare size={14} /> IT</>}
        title="Uzaktan destek"
        description="Çalışanın onayıyla bağlanılan oturumlar. Görüntü kaydedilmez; kim, ne zaman, neden ve ne kadar süre bağlandığı burada ve denetim kaydında tutulur."
        actions={<Button to="/cihazlar" icon={ScreenShare} variant="primary">Cihaz seçip bağlan</Button>}
      />
      {!data ? (
        <SkeletonCard rows={6} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState icon={ScreenShare} title="Henüz destek oturumu yok" description="Cihazlar sayfasında bir bilgisayarı açıp &quot;Uzaktan destek&quot;e tıklayın." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Bilgisayar</th>
                    <th className={th}>Neden</th>
                    <th className={th}>Teknisyen</th>
                    <th className={th}>Çalışan</th>
                    <th className={th}>Durum</th>
                    <th className={th}>Süre</th>
                    <th className={th}>Zaman</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s, i) => {
                    const [label, tone] = STATUS[s.status];
                    const open = ['requested', 'accepted', 'active'].includes(s.status);
                    return (
                      <motion.tr
                        key={s.id}
                        variants={listItem}
                        initial="hidden"
                        animate="show"
                        custom={i}
                        className={cn(trCls, open && 'cursor-pointer hover:bg-slate-900/[0.025] dark:hover:bg-white/[0.03]')}
                        onClick={() => open && nav(`/destek/${s.id}`)}
                      >
                        <td className={cn(td, 'font-mono text-[13px] font-semibold text-slate-900 dark:text-white')}>{s.hostname ?? '—'}</td>
                        <td className={cn(td, 'max-w-[320px] truncate text-[13px] text-slate-600 dark:text-slate-300')} title={s.reason}>{s.reason}</td>
                        <td className={cn(td, 'text-[13px]')}>{s.technician}</td>
                        <td className={cn(td, 'text-[13px] text-slate-500')}>{s.userLogin ?? '—'}</td>
                        <td className={td}>
                          <Badge tone={tone} dot>{label}</Badge>
                          {s.endReason && <div className="mt-1 text-[12px] text-slate-400">{s.endReason}</div>}
                        </td>
                        <td className={cn(td, 'font-mono text-[13px] tabular-nums')}>{dur(s.durationSec)}</td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500')}>{fmtDateTime(s.requestedAt)}</td>
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

// ---------------------------------------------------------------------------------------------
// Canlı oturum
// ---------------------------------------------------------------------------------------------
export function SupportSession() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const info = useApi<{ session: Session; device: { hostname: string; lastUser: string | null; location: string | null } }>(`/api/support/sessions/${id}`);
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<{ w: number; h: number } | null>(null);
  const [frames, setFrames] = useState(0);
  const [now, setNow] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const lastMove = useRef(0);

  useEffect(() => {
    if (info.data && !session) setSession(info.data.session);
  }, [info.data, session]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws/support/viewer?sid=${encodeURIComponent(id)}`);
    sock.binaryType = 'blob';
    ws.current = sock;
    sock.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        if (m.t === 'status') setSession(m.session);
        if (m.t === 'screen') setScreen({ w: m.w, h: m.h });
        return;
      }
      // kare: yalnızca bellekte çizilir, hiçbir yere kaydedilmez
      try {
        const bmp = await createImageBitmap(ev.data as Blob);
        const c = canvas.current;
        if (!c) return;
        if (c.width !== bmp.width || c.height !== bmp.height) {
          c.width = bmp.width;
          c.height = bmp.height;
        }
        c.getContext('2d')?.drawImage(bmp, 0, 0);
        bmp.close();
        setFrames((f) => f + 1);
      } catch {
        /* bozuk kare */
      }
    };
    sock.onclose = () => info.reload();
    return () => sock.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const send = useCallback((m: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  const control = !!session && session.status === 'active' && session.allowControl;
  const pos = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const end = async () => {
    send({ t: 'end' });
    try {
      await api(`/api/support/sessions/${id}/end`, { method: 'POST' });
    } catch {
      /* zaten bitmiş olabilir */
    }
    info.reload();
  };

  if (!session) return <SkeletonCard rows={4} />;
  const d = info.data?.device;
  const [label, tone] = STATUS[session.status];
  const open = ['requested', 'accepted', 'active'].includes(session.status);
  const waitLeft = Math.max(0, Math.round((Date.parse(session.requestedAt) + 90_000 - now) / 1000));
  const elapsed = session.startedAt ? Math.floor(((session.endedAt ? Date.parse(session.endedAt) : now) - Date.parse(session.startedAt)) / 1000) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" icon={ArrowLeft} to="/destek">
          Geçmiş
        </Button>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-sky-500 to-indigo-500 text-white">
            <ScreenShare size={18} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-mono text-[15px] font-semibold text-slate-900 dark:text-white">{d?.hostname ?? '…'}</div>
            <div className="flex items-center gap-2 text-[12px] text-slate-500">
              <UserIcon size={12} /> {session.userLogin ?? d?.lastUser ?? '—'}
              {d?.location && <> · {d.location}</>}
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <Badge tone={tone} dot>{label}</Badge>
        {session.status === 'active' && (
          <>
            <Badge icon={Clock}>{dur(elapsed)}</Badge>
            {control ? <Badge tone="success" icon={MousePointerClick}>Kontrol sizde</Badge> : <Badge tone="warning" icon={Eye}>Yalnızca görüntüleme</Badge>}
            <Button size="sm" icon={Maximize} onClick={() => box.current?.requestFullscreen?.()}>
              Tam ekran
            </Button>
          </>
        )}
        {open && (
          <Button size="sm" variant="danger" icon={PhoneOff} onClick={end}>
            Bitir
          </Button>
        )}
      </div>

      <Card className="p-4 text-[13px] text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-200">Neden:</span> {session.reason}
      </Card>

      {session.status === 'requested' && (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-500/20" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/30">
              <Hand size={26} />
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Çalışanın onayı bekleniyor</h2>
          <p className="mt-2 max-w-md text-[14px] text-slate-500 dark:text-slate-400">
            {d?.lastUser ?? 'Çalışan'} ekranındaki pencereden izin verince görüntü burada açılır. Kalan süre: <b className="tabular-nums">{waitLeft} sn</b>
          </p>
        </Card>
      )}

      {session.status === 'accepted' && (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <Loader2 size={32} className="mb-4 animate-spin text-emerald-500" />
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Çalışan onayladı — bağlanılıyor</h2>
        </Card>
      )}

      {session.status === 'active' && (
        <div ref={box} className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-slate-950 shadow-2xl dark:border-white/10">
          {frames === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-slate-400">
              <Loader2 size={18} className="mr-2 animate-spin" /> Görüntü bekleniyor…
            </div>
          )}
          <canvas
            ref={canvas}
            tabIndex={0}
            className={cn('mx-auto block h-auto max-h-[calc(100vh-220px)] w-full object-contain outline-none', control ? 'cursor-none' : 'cursor-default')}
            style={{ aspectRatio: screen ? `${screen.w} / ${screen.h}` : '16 / 9' }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerMove={(e) => {
              if (!control) return;
              const t = performance.now();
              if (t - lastMove.current < 33) return; // ~30/sn
              lastMove.current = t;
              send({ t: 'input', kind: 'move', ...pos(e) });
            }}
            onPointerDown={(e) => {
              (e.target as HTMLCanvasElement).focus();
              if (control) send({ t: 'input', kind: 'down', button: e.button, ...pos(e) });
            }}
            onPointerUp={(e) => control && send({ t: 'input', kind: 'up', button: e.button, ...pos(e) })}
            onWheel={(e) => control && send({ t: 'input', kind: 'wheel', dy: Math.round(-e.deltaY), ...pos(e) })}
            onKeyDown={(e) => {
              if (!control) return;
              e.preventDefault();
              send({ t: 'input', kind: 'keydown', code: e.code, key: e.key });
            }}
            onKeyUp={(e) => {
              if (!control) return;
              e.preventDefault();
              send({ t: 'input', kind: 'keyup', code: e.code, key: e.key });
            }}
          />
        </div>
      )}

      {session.status === 'active' && (
        <p className="flex items-center gap-2 text-[12px] text-slate-400">
          <ShieldCheck size={13} /> Çalışan ekranında kırmızı çerçeve ve "Bitir" düğmesini görüyor; kontrolü istediği an geri alabilir. Klavye için görüntüye tıklayın. Ctrl+Alt+Del ve yönetici onay ekranları
          güvenlik nedeniyle iletilmez.
        </p>
      )}

      {!open && (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900/5 text-slate-500 dark:bg-white/10">
            <CircleOff size={24} />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{label}</h2>
          {session.endReason && <p className="mt-1 text-[14px] text-slate-500">{session.endReason}</p>}
          {session.durationSec != null && <p className="mt-1 text-[13px] text-slate-400">Süre: {dur(session.durationSec)}</p>}
          <div className="mt-6 flex gap-3">
            <Button to="/destek">Geçmiş</Button>
            <Button variant="primary" onClick={() => nav('/cihazlar')}>
              Cihazlar
            </Button>
          </div>
        </Card>
      )}
      {session.status === 'denied' && <Callout tone="info">Çalışan bağlantıyı reddetti. Telefonla ya da talep üzerinden iletişime geçebilirsiniz.</Callout>}
    </div>
  );
}
