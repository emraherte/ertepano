import { useEffect, useRef, useState } from 'react';
import { api, fmtDateTime, pct, useApi } from '../api';
import type { EmergencyDetail, EmergencyTemplate } from '../types';
import { Preview } from '../components/Preview';
import { TargetPicker } from '../components/TargetPicker';
import { Empty, Modal, PageHead, useAuth, useToast } from '../ui';

const HOLD_MS = 2000;

/** Basılı tutarak onay: yanlışlıkla tıklamayı önler, gerçek acil anda yine de 2 saniye sürer. */
function HoldButton({ t, disabled, onFire }: { t: EmergencyTemplate; disabled: boolean; onFire: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const start = () => {
    if (disabled) return;
    if (bar.current) {
      bar.current.style.transition = `width ${HOLD_MS}ms linear`;
      bar.current.style.width = '100%';
    }
    timer.current = window.setTimeout(() => {
      cancel();
      onFire();
    }, HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    if (bar.current) {
      bar.current.style.transition = 'none';
      bar.current.style.width = '0';
    }
  };
  return (
    <button
      className="em-btn"
      style={{ ['--c' as string]: t.color }}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && start()}
      onKeyUp={cancel}
      aria-label={`${t.label}: başlatmak için 2 saniye basılı tutun`}
    >
      <span className="e">{t.emoji}</span>
      {t.label}
      <span className="hint">2 sn basılı tut</span>
      <div className="hold" ref={bar} />
    </button>
  );
}

function Elapsed({ from }: { from: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - Date.parse(from)) / 1000);
  return <span className="mono">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

export function Emergency({ canAct, onChange }: { canAct: boolean; onChange: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const active = useApi<{ item: EmergencyDetail | null }>('/api/emergencies/active', 2500);
  const templates = useApi<{ items: EmergencyTemplate[] }>('/api/emergency-templates');
  const history = useApi<{ items: { id: string; type: string; title: string; drill: boolean; startedBy: string; startedAt: string; endedAt: string | null; targetCount: number; safe: number; help: number }[] }>('/api/emergencies', 30000);
  const [drill, setDrill] = useState(false);
  const [targets, setTargets] = useState<string[]>(['all']);
  const [custom, setCustom] = useState({ title: '', body: '' });
  const [ending, setEnding] = useState(false);
  const [endNote, setEndNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EmergencyDetail | null>(null);

  const e = active.data?.item;
  const allowedType = (type: string) => user.role === 'admin' || user.role === 'isg' || (user.role === 'it' && type === 'siber');

  const start = async (t: EmergencyTemplate) => {
    if (t.type === 'diger' && !custom.title.trim()) {
      toast('"Diğer" için önce başlık yazın', true);
      return;
    }
    setBusy(true);
    try {
      await api('/api/emergencies', {
        body: { type: t.type, drill, targets, ...(t.type === 'diger' ? { title: custom.title, body: custom.body } : {}) },
      });
      toast(drill ? 'Tatbikat başlatıldı' : 'ACİL DURUM YAYINLANDI');
      active.reload();
      onChange();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const end = async (mode: 'all_clear' | 'false_alarm' | 'silent') => {
    if (!e) return;
    setBusy(true);
    try {
      await api(`/api/emergencies/${e.id}/end`, { body: { mode, note: endNote || undefined } });
      toast('Acil durum sonlandırıldı');
      setEnding(false);
      setEndNote('');
      active.reload();
      history.reload();
      onChange();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (id: string) => {
    const r = await api<{ item: EmergencyDetail }>(`/api/emergencies/${id}`);
    setReport(r.item);
  };

  // ---- Devam eden acil durum: canlı yoklama ----
  if (e) {
    const c = e.counts;
    return (
      <>
        <PageHead
          title={`${e.drill ? '🧯 Tatbikat' : '🚨 Acil durum'}: ${e.title}`}
          sub={<>Başlatan: {e.startedBy} · {fmtDateTime(e.startedAt)} · Geçen süre: <Elapsed from={e.startedAt} /></>}
        >
          {canAct && (
            <button className="btn btn-primary btn-lg" onClick={() => setEnding(true)}>
              ✅ Sonlandır
            </button>
          )}
        </PageHead>

        <div className="roll" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="muted">Hedef ekran</div>
            <div className="big-num">{c.targets}</div>
          </div>
          <div className="card" style={{ background: 'var(--ok-soft)' }}>
            <div style={{ color: 'var(--ok)', fontWeight: 600 }}>✅ Güvende</div>
            <div className="big-num" style={{ color: 'var(--ok)' }}>{c.safe}</div>
            <div className="small muted">%{pct(c.safe, c.targets)}</div>
          </div>
          <div className="card" style={{ background: c.help ? 'var(--danger-soft)' : undefined }}>
            <div style={{ color: 'var(--danger)', fontWeight: 600 }}>🆘 Yardım istiyor</div>
            <div className="big-num" style={{ color: 'var(--danger)' }}>{c.help}</div>
          </div>
          <div className="card">
            <div className="muted">⏳ Yanıt yok</div>
            <div className="big-num">{c.noResponse}</div>
            <div className="small muted">%{pct(c.noResponse, c.targets)}</div>
          </div>
        </div>

        {e.help.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
            <div className="card-head" style={{ background: 'var(--danger-soft)' }}>
              <h2 style={{ color: 'var(--danger)' }}>🆘 Yardım isteyenler — öncelikli</h2>
            </div>
            <table className="tbl">
              <tbody>
                {e.help.map((h) => (
                  <tr key={h.deviceId}>
                    <td><b>{h.userLogin ?? '—'}</b><div className="mono small">{h.hostname}</div></td>
                    <td>📍 {h.location ?? 'Lokasyonsuz'}</td>
                    <td>{h.note ?? <span className="faint">not yok</span>}</td>
                    <td className="small muted">{fmtDateTime(h.respondedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Lokasyonlara göre</h2></div>
            <table className="tbl">
              <thead>
                <tr><th>Lokasyon</th><th>Güvende</th><th>Yardım</th><th>Yanıt yok</th><th style={{ width: 140 }} /></tr>
              </thead>
              <tbody>
                {e.byLocation.map((l) => (
                  <tr key={l.location}>
                    <td><b>{l.location}</b></td>
                    <td style={{ color: 'var(--ok)' }}>{l.safe}</td>
                    <td style={{ color: l.help ? 'var(--danger)' : undefined, fontWeight: l.help ? 700 : 400 }}>{l.help}</td>
                    <td>{l.noResponse}</td>
                    <td>
                      <div className="progress">
                        <div className="ack" style={{ width: `${pct(l.safe, l.total)}%` }} />
                        <div style={{ width: `${pct(l.help, l.total)}%`, background: 'var(--danger)' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Yanıt vermeyenler</h2>
              <span className="small muted">Toplanma alanı sorumlusuna iletin</span>
            </div>
            {e.noResponse.length === 0 ? (
              <Empty icon="🎉" title="Herkes yanıt verdi" />
            ) : (
              <div className="tbl-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="tbl">
                  <tbody>
                    {e.noResponse.map((n) => (
                      <tr key={n.deviceId}>
                        <td>{n.userLogin ?? <span className="faint">oturum yok</span>}<div className="mono small faint">{n.hostname}</div></td>
                        <td className="small">{n.location ?? '—'}</td>
                        <td className="small">{n.online ? <span className="badge badge-warn">Ekran açık</span> : <span className="badge">Çevrimdışı</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {ending && (
          <Modal
            title="Acil durumu sonlandır"
            onClose={() => setEnding(false)}
            footer={
              <>
                <button className="btn" disabled={busy} onClick={() => end('silent')}>Sessizce bitir</button>
                <button className="btn" disabled={busy} onClick={() => end('false_alarm')}>Yanlış alarm duyur</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => end('all_clear')}>✅ {e.drill ? 'Tatbikat bitti' : 'Tehlike geçti'} duyur</button>
              </>
            }
          >
            <div className="stack">
              <p className="muted">Tam ekran uyarı tüm ekranlardan kalkar. Seçiminize göre 30 dakika ekranda kalan bir bilgilendirme kartı gönderilir.</p>
              <label className="field">
                Bilgilendirme notu (isteğe bağlı)
                <textarea value={endNote} onChange={(x) => setEndNote(x.target.value)} placeholder="Örn: Çalışma alanlarınıza dönebilirsiniz." />
              </label>
              <p className="small faint">
                Son durum: {c.safe} güvende, {c.help} yardım, {c.noResponse} yanıt yok. Rapor geçmişte saklanır.
              </p>
            </div>
          </Modal>
        )}
      </>
    );
  }

  // ---- Başlatma ekranı ----
  const tpls = templates.data?.items ?? [];
  const sample = tpls.find((t) => t.type === 'yangin');

  return (
    <>
      <PageHead title="Acil Durum" sub="Tüm ekranlara kapatılamayan tam ekran uyarı + canlı yoklama (Güvendeyim / Yardım lazım)." />

      {canAct ? (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', alignItems: 'start', marginBottom: 24 }}>
          <div className="card card-pad stack" style={{ gap: 18 }}>
            <div className="row">
              <button className={`chip ${!drill ? 'on' : ''}`} onClick={() => setDrill(false)} style={!drill ? { background: 'var(--danger-soft)', borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}>
                🚨 Gerçek acil durum
              </button>
              <button className={`chip ${drill ? 'on' : ''}`} onClick={() => setDrill(true)}>
                🧯 Tatbikat
              </button>
              <span className="small muted">{drill ? 'Ekranlarda büyük "TATBİKAT" etiketi görünür; rapor tatbikat tutanağı olur.' : 'Sesli, kapatılamaz, tüm monitörlerde.'}</span>
            </div>

            <div className="em-grid">
              {tpls.map((t) => (
                <HoldButton key={t.type} t={t} disabled={busy || !allowedType(t.type)} onFire={() => start(t)} />
              ))}
            </div>

            <details>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>"Diğer" için başlık/metin ve hedef seçimi</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <input placeholder="Başlık (Diğer için zorunlu)" value={custom.title} onChange={(x) => setCustom({ ...custom, title: x.target.value })} maxLength={140} />
                <textarea placeholder="Talimat metni" value={custom.body} onChange={(x) => setCustom({ ...custom, body: x.target.value })} />
                <b>Hedef</b>
                <TargetPicker value={targets} onChange={setTargets} />
              </div>
            </details>
            {user.role === 'it' && <div className="alert alert-info small">IT rolü yalnızca "Siber saldırı" uyarısı başlatabilir. Diğerleri İSG'dedir.</div>}
          </div>
          <div className="stack">
            <b>Çalışanın ekranında</b>
            {sample && <Preview d={{ kind: 'fullscreen', category: 'isg', title: sample.title, body: sample.body, emoji: sample.emoji, color: sample.color, drill, emergency: true }} />}
            <p className="small faint">
              Yanıtlar anında aşağıda lokasyon bazında sayılır. "Yardım lazım" diyenler en üstte kırmızı listelenir. Kiosk/TV ekranları da aynı anda kırmızıya döner.
            </p>
          </div>
        </div>
      ) : (
        <div className="alert alert-info" style={{ marginBottom: 24 }}>
          Acil durum yayını İSG ve IT yetkililerindedir. Devam eden bir olay olduğunda burada canlı yoklamayı izleyebilirsiniz.
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Geçmiş olaylar ve tatbikatlar</h2></div>
        {!history.data?.items.length ? (
          <Empty icon="🕊️" title="Kayıt yok" />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Olay</th><th>Başlangıç</th><th>Süre</th><th>Katılım</th><th /></tr>
            </thead>
            <tbody>
              {history.data.items.map((h) => (
                <tr key={h.id}>
                  <td>
                    <b>{h.title}</b> {h.drill && <span className="badge badge-warn">Tatbikat</span>}
                    <div className="small faint">{h.startedBy}</div>
                  </td>
                  <td className="small">{fmtDateTime(h.startedAt)}</td>
                  <td className="small">{h.endedAt ? `${Math.round((Date.parse(h.endedAt) - Date.parse(h.startedAt)) / 60000)} dk` : '—'}</td>
                  <td className="small">
                    {h.safe}/{h.targetCount} güvende{h.help ? ` · ${h.help} yardım` : ''} (%{pct(h.safe + h.help, h.targetCount)})
                  </td>
                  <td className="right"><button className="btn btn-sm" onClick={() => openReport(h.id)}>Tutanak</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {report && (
        <Modal title={`${report.drill ? 'Tatbikat' : 'Olay'} tutanağı`} onClose={() => setReport(null)} width={720} footer={<button className="btn" onClick={() => window.print()}>🖨 Yazdır</button>}>
          <dl className="kv">
            <dt>Olay</dt><dd>{report.title}</dd>
            <dt>Başlatan</dt><dd>{report.startedBy} — {fmtDateTime(report.startedAt)}</dd>
            <dt>Sonlandıran</dt><dd>{report.endedBy ?? '—'} — {fmtDateTime(report.endedAt)}</dd>
            <dt>Hedef ekran</dt><dd>{report.counts.targets}</dd>
            <dt>Güvende</dt><dd>{report.counts.safe} (%{pct(report.counts.safe, report.counts.targets)})</dd>
            <dt>Yardım isteyen</dt><dd>{report.counts.help}</dd>
            <dt>Yanıt vermeyen</dt><dd>{report.counts.noResponse}</dd>
            <dt>Medyan yanıt süresi</dt>
            <dd>{report.safe.length ? `${[...report.safe].sort((a, b) => a.afterSec - b.afterSec)[Math.floor(report.safe.length / 2)].afterSec} sn` : '—'}</dd>
            {report.endNote && (<><dt>Not</dt><dd>{report.endNote}</dd></>)}
          </dl>
          <h3 style={{ margin: '16px 0 8px' }}>Lokasyonlar</h3>
          <table className="tbl">
            <thead><tr><th>Lokasyon</th><th>Hedef</th><th>Güvende</th><th>Yardım</th><th>Yanıt yok</th></tr></thead>
            <tbody>
              {report.byLocation.map((l) => (
                <tr key={l.location}><td>{l.location}</td><td>{l.total}</td><td>{l.safe}</td><td>{l.help}</td><td>{l.noResponse}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
