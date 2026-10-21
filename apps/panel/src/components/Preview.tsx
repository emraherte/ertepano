import { useEffect, useState } from 'react';
import { CATEGORY_COLORS, type Category, type Kind } from '@ertepano/shared';

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

/** Duyurunun çalışan ekranında nasıl görüneceğinin maketi. */
export function Preview({ d }: { d: PreviewData }) {
  const c = d.color || CATEGORY_COLORS[d.category];
  const cd = useCountdown(d.kind === 'countdown' ? d.countdownTo : null);
  const pos = d.position ?? 'top-right';
  const badgePos: React.CSSProperties = {
    top: pos.startsWith('top') ? '4%' : undefined,
    bottom: pos.startsWith('bottom') ? '11%' : undefined,
    right: pos.endsWith('right') ? '2%' : undefined,
    left: pos.endsWith('left') ? '2%' : undefined,
  };

  return (
    <div className="screen" style={{ ['--c' as string]: c }}>
      <div className="win">
        <div className="lines">
          {[90, 70, 80, 50, 75, 60].map((w, i) => (
            <i key={i} style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="taskbar" />

      {(d.kind === 'toast' || d.kind === 'survey') && (
        <div className="pv-toast">
          <div className="t">
            {d.emoji} {d.title || 'Başlık'}
          </div>
          {d.imageUrl && <img src={d.imageUrl} alt="" />}
          {d.body && <div className="b">{d.body}</div>}
          {d.kind === 'survey' && (
            <div className="opts">
              {(d.options ?? []).filter(Boolean).map((o, i) => (
                <span key={i}>{o}</span>
              ))}
            </div>
          )}
          {d.kind === 'toast' && (
            <div className="acts">
              {!d.requireAck && <span className="g">Kapat</span>}
              <span>{d.requireAck ? d.ackLabel || 'Okudum, anladım' : 'Tamam'}</span>
            </div>
          )}
        </div>
      )}

      {(d.kind === 'banner' || d.kind === 'countdown') && (
        <div className="pv-banner">
          <span>{d.emoji}</span>
          <span>{d.title || 'Başlık'}</span>
          {d.body && <span className="b">— {d.body}</span>}
          {d.kind === 'countdown' && <span className="cd">{cd}</span>}
        </div>
      )}

      {d.kind === 'badge' && (
        <div className="pv-badge" style={badgePos}>
          {d.imageUrl ? <img src={d.imageUrl} alt="" /> : <span>{d.emoji || '🏢'}</span>}
        </div>
      )}

      {d.kind === 'fullscreen' && (
        <div className="pv-full">
          {d.drill && <div className="drill">TATBİKAT</div>}
          <div style={{ fontSize: 30 }}>{d.emoji}</div>
          <div className="t">{d.title}</div>
          <div className="b">{d.body}</div>
          {d.emergency && (
            <div className="acts">
              <span>✅ Güvendeyim</span>
              <span className="h">🆘 Yardım lazım</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
