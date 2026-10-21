import { useEffect, useState } from 'react';
import { api, useApi } from '../api';

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

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="button" className={`chip ${all ? 'on' : ''}`} onClick={() => onChange(['all'])}>
          🌐 Herkes <span className="n">{data?.total ?? ''}</span>
        </button>
        {data?.locations.map((l) => (
          <button type="button" key={l.name} className={`chip ${value.includes(`loc:${l.name}`) ? 'on' : ''}`} onClick={() => toggle(`loc:${l.name}`)}>
            📍 {l.name} <span className="n">{l.count}</span>
          </button>
        ))}
      </div>
      {!!data?.departments.length && (
        <div className="row">
          {data.departments.map((d) => (
            <button type="button" key={d.name} className={`chip ${value.includes(`dep:${d.name}`) ? 'on' : ''}`} onClick={() => toggle(`dep:${d.name}`)}>
              🏷️ {d.name} <span className="n">{d.count}</span>
            </button>
          ))}
        </div>
      )}
      {custom.map((c) => (
        <span key={c} className="badge">
          {c}
        </span>
      ))}
      <div className="small muted">
        {count === null ? '…' : <b>{count} cihaza</b>} gönderilecek
        {!all && ' (seçilen lokasyon veya departmandan biri tutan cihazlar)'}
        {data && !data.locations.length && ' · Lokasyon/departman çipleri için Cihazlar sayfasından etiket atayın.'}
      </div>
    </div>
  );
}
