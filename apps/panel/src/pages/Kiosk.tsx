import { useEffect, useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS, type Category } from '@ertepano/shared';

interface KioskData {
  serverTime: string;
  emergency: { title: string; body: string; emoji: string | null; color: string | null; drill: boolean } | null;
  items: { id: string; kind: string; category: Category; title: string; body: string; emoji: string | null; imageUrl: string | null; color: string | null; countdownTo: string | null }[];
}

const ROTATE_MS = 12000;

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
    const t = setInterval(() => {
      setNow(new Date());
    }, 1000);
    const r = setInterval(() => setI((x) => x + 1), ROTATE_MS);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  if (error && !data) return <div className="kiosk" style={{ alignItems: 'center', justifyContent: 'center' }}>⚠️ {error}</div>;
  if (!data) return <div className="kiosk" />;

  if (data.emergency) {
    const e = data.emergency;
    return (
      <div className="kiosk-em" style={{ ['--c' as string]: e.color ?? '#d92d20', color: '#fff' }}>
        {e.drill && <div className="d">TATBİKAT</div>}
        <div style={{ fontSize: '9vw' }}>{e.emoji}</div>
        <div className="t">{e.title}</div>
        <div className="b">{e.body}</div>
      </div>
    );
  }

  const items = data.items;
  const cur = items.length ? items[i % items.length] : null;
  const c = cur ? cur.color ?? CATEGORY_COLORS[cur.category] : '#0f766e';
  const cd = cur?.countdownTo ? Math.max(0, Math.floor((Date.parse(cur.countdownTo) - now.getTime()) / 1000)) : null;

  return (
    <div className="kiosk">
      <div className="kiosk-top">
        <span>📌 ErtePano{loc ? ` · ${loc}` : ''}</span>
        <span>{now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="clock">{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {cur ? (
        <div className="kiosk-card" style={{ ['--c' as string]: c }} key={cur.id}>
          <div className="small" style={{ color: c, fontWeight: 700, fontSize: '1.4vw' }}>{CATEGORY_LABELS[cur.category]}</div>
          <div className="e">{cur.emoji}</div>
          <div className="t">{cur.title}</div>
          {cur.body && <div className="b">{cur.body}</div>}
          {cd !== null && (
            <div style={{ fontSize: '6vw', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: c, marginTop: '1vw' }}>
              {Math.floor(cd / 3600) ? `${Math.floor(cd / 3600)}:` : ''}{String(Math.floor((cd % 3600) / 60)).padStart(2, '0')}:{String(cd % 60).padStart(2, '0')}
            </div>
          )}
          {cur.imageUrl && <img src={cur.imageUrl} alt="" />}
        </div>
      ) : (
        <div className="kiosk-card" style={{ ['--c' as string]: '#0f766e', alignItems: 'center', textAlign: 'center' }}>
          <div className="e">☀️</div>
          <div className="t">İyi çalışmalar!</div>
          <div className="b">Şu an yayında duyuru yok.</div>
        </div>
      )}
      <div className="kiosk-dots">
        {items.map((x, j) => <i key={x.id} className={j === i % items.length ? 'on' : ''} />)}
      </div>
    </div>
  );
}
