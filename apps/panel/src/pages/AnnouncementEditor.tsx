import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_COLORS, CATEGORY_LABELS, KIND_LABELS, ROLE_CATEGORIES, type Category, type Kind } from '@ertepano/shared';
import { api, fromLocalInput, toLocalInput, uploadImage, useApi } from '../api';
import type { Announcement, Template } from '../types';
import { Preview } from '../components/Preview';
import { TargetPicker } from '../components/TargetPicker';
import { PageHead, useAuth, useToast } from '../ui';

const EDIT_KINDS: { k: Kind; icon: string; hint: string }[] = [
  { k: 'toast', icon: '🗨️', hint: 'Sağ altta kart; okudum butonu' },
  { k: 'banner', icon: '➖', hint: 'Ekranın üstünde ince şerit' },
  { k: 'survey', icon: '📊', hint: 'Tek soru, tek tıkla oy' },
  { k: 'countdown', icon: '⏱️', hint: 'Bakım/etkinlik geri sayımı' },
  { k: 'badge', icon: '🏷️', hint: 'Köşede görsel; tıklamayı engellemez' },
];

const END_PRESETS: [string, number | null][] = [
  ['Süresiz', null],
  ['1 saat', 1],
  ['Gün sonu', -1],
  ['3 gün', 72],
  ['1 hafta', 168],
];

interface Form {
  kind: Kind;
  category: Category;
  title: string;
  body: string;
  emoji: string;
  imageUrl: string | null;
  requireAck: boolean;
  ackLabel: string;
  options: string[];
  countdownTo: string | null;
  position: string;
  sound: boolean;
  targets: string[];
  showOnKiosk: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const blank = (category: Category): Form => ({
  kind: 'toast', category, title: '', body: '', emoji: '📢', imageUrl: null, requireAck: false, ackLabel: '', options: ['', ''],
  countdownTo: null, position: 'top-right', sound: false, targets: ['all'], showOnKiosk: true, startsAt: null, endsAt: null,
});

const endOfDay = () => {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
};

export function AnnouncementEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const allowed = ROLE_CATEGORIES[user.role];
  const templates = useApi<{ items: Template[] }>('/api/templates');
  const existing = useApi<{ item: Announcement }>(id ? `/api/announcements/${id}` : null);
  const [form, setForm] = useState<Form | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = existing.data?.item;
    if (!a) return;
    setForm({
      kind: a.kind, category: a.category, title: a.title, body: a.body, emoji: a.emoji ?? '', imageUrl: a.imageUrl, requireAck: a.requireAck,
      ackLabel: a.ackLabel ?? '', options: a.options ?? ['', ''], countdownTo: a.countdownTo, position: a.position ?? 'top-right', sound: a.sound,
      targets: a.targets, showOnKiosk: a.showOnKiosk, startsAt: a.startsAt, endsAt: a.endsAt,
    });
    setSchedule(!!a.startsAt && a.status !== 'active' && Date.parse(a.startsAt) > Date.now());
  }, [existing.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const applyTemplate = (t: Template) => {
    setForm({
      ...blank(t.category),
      kind: t.kind, title: t.title, body: t.body, emoji: t.emoji, requireAck: !!t.requireAck, ackLabel: t.ackLabel ?? '',
      options: t.options ?? ['', ''],
      countdownTo: t.countdownMinutes ? new Date(Date.now() + t.countdownMinutes * 60000).toISOString() : null,
      endsAt: t.countdownMinutes ? new Date(Date.now() + t.countdownMinutes * 60000).toISOString() : null,
    });
  };

  const grouped = useMemo(() => {
    const m = new Map<Category, Template[]>();
    (templates.data?.items ?? []).forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]));
    return [...m.entries()];
  }, [templates.data]);

  // ---- 1. adım: şablon seçimi ----
  if (!id && !form) {
    return (
      <>
        <PageHead title="Yeni duyuru" sub="Bir şablonla başlayın; köşeli parantezli [alanları] doldurmanız yeterli.">
          <button className="btn" onClick={() => setForm(blank(allowed[0] ?? 'genel'))}>
            Boş başla
          </button>
        </PageHead>
        <div className="stack" style={{ gap: 22 }}>
          {grouped.map(([cat, ts]) => (
            <div key={cat}>
              <h3 style={{ marginBottom: 10 }}>{CATEGORY_LABELS[cat]}</h3>
              <div className="tpl-grid">
                {ts.map((t) => (
                  <button key={t.id} className="tpl" style={{ ['--c' as string]: CATEGORY_COLORS[t.category] }} onClick={() => applyTemplate(t)}>
                    <span className="e">{t.emoji}</span>
                    <span className="n">{t.name}</span>
                    <span className="small muted">{KIND_LABELS[t.kind]}{t.requireAck ? ' · zorunlu onay' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }
  if (!form) return null;

  const placeholders = /\[[^\]]+\]/.test(form.title + form.body + form.options.join(''));

  const save = async (publish: boolean) => {
    setBusy(true);
    setError(null);
    const body = {
      kind: form.kind, category: form.category, title: form.title, body: form.body, emoji: form.emoji || null, imageUrl: form.imageUrl,
      requireAck: form.kind === 'toast' && form.requireAck, ackLabel: form.ackLabel || null,
      options: form.kind === 'survey' ? form.options.map((o) => o.trim()).filter(Boolean) : null,
      countdownTo: form.kind === 'countdown' ? form.countdownTo : null, position: form.kind === 'badge' ? form.position : null,
      sound: form.sound, targets: form.targets, showOnKiosk: form.showOnKiosk,
      startsAt: schedule ? form.startsAt : null, endsAt: form.endsAt, publish,
    };
    try {
      const r = id
        ? await api<{ item: Announcement }>(`/api/announcements/${id}`, { method: 'PATCH', body })
        : await api<{ item: Announcement }>('/api/announcements', { body });
      toast(publish ? (r.item.status === 'scheduled' ? 'Duyuru planlandı' : 'Duyuru yayınlandı — ekranlara gidiyor') : 'Kaydedildi');
      nav(`/duyurular/${r.item.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onImage = async (f?: File) => {
    if (!f) return;
    try {
      set('imageUrl', await uploadImage(f));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const isActive = existing.data?.item.status === 'active';

  return (
    <>
      <PageHead title={id ? 'Duyuruyu düzenle' : 'Yeni duyuru'} sub={isActive ? 'Bu duyuru yayında; kaydettiğinizde ekranlardaki kopya güncellenir.' : undefined}>
        {!id && (
          <button className="btn btn-ghost" onClick={() => setForm(null)}>
            ← Şablonlar
          </button>
        )}
        <Link className="btn btn-ghost" to={id ? `/duyurular/${id}` : '/duyurular'}>
          Vazgeç
        </Link>
      </PageHead>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="card card-pad stack" style={{ gap: 18 }}>
          <div className="stack" style={{ gap: 8 }}>
            <b>Kategori</b>
            <div className="row">
              {allowed.map((c) => (
                <button key={c} type="button" className={`chip ${form.category === c ? 'on' : ''}`} onClick={() => set('category', c)}>
                  <span className="cat" style={{ ['--c' as string]: CATEGORY_COLORS[c] }}>{CATEGORY_LABELS[c]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <b>Ekranda nasıl görünsün?</b>
            <div className="row">
              {EDIT_KINDS.map(({ k, icon, hint }) => (
                <button key={k} type="button" title={hint} className={`chip ${form.kind === k ? 'on' : ''}`} onClick={() => set('kind', k)}>
                  {icon} {KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <span className="small faint">{EDIT_KINDS.find((x) => x.k === form.kind)?.hint}</span>
          </div>

          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
            <label className="field" style={{ width: 80 }}>
              Simge
              <input value={form.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={8} style={{ textAlign: 'center', fontSize: 18 }} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Başlık
              <input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={140} placeholder="Kısa ve net bir başlık" />
            </label>
          </div>

          {form.kind !== 'badge' && (
            <label className="field">
              {form.kind === 'survey' ? 'Açıklama (isteğe bağlı)' : 'Metin'}
              <textarea value={form.body} onChange={(e) => set('body', e.target.value)} maxLength={2000} rows={form.kind === 'banner' ? 2 : 4} />
              <span className="hint">{form.body.length}/2000</span>
            </label>
          )}

          {form.kind === 'survey' && (
            <div className="stack" style={{ gap: 6 }}>
              <b>Seçenekler</b>
              {form.options.map((o, i) => (
                <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                  <input value={o} onChange={(e) => set('options', form.options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Seçenek ${i + 1}`} />
                  {form.options.length > 2 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('options', form.options.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {form.options.length < 6 && (
                <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('options', [...form.options, ''])}>
                  ＋ Seçenek
                </button>
              )}
              <span className="small faint">Yanıtlar panelde kişi adı olmadan, toplu sayı olarak gösterilir.</span>
            </div>
          )}

          {form.kind === 'countdown' && (
            <label className="field">
              Geri sayım hedefi
              <input type="datetime-local" value={toLocalInput(form.countdownTo)} onChange={(e) => set('countdownTo', fromLocalInput(e.target.value))} />
            </label>
          )}

          {form.kind === 'badge' && (
            <label className="field">
              Rozet konumu
              <select value={form.position} onChange={(e) => set('position', e.target.value)}>
                <option value="top-right">Sağ üst</option>
                <option value="top-left">Sol üst</option>
                <option value="bottom-right">Sağ alt</option>
                <option value="bottom-left">Sol alt</option>
              </select>
            </label>
          )}

          {form.kind !== 'banner' && form.kind !== 'countdown' && (
            <div className="row">
              <label className="btn btn-sm">
                🖼️ {form.imageUrl ? 'Görseli değiştir' : 'Görsel ekle'}
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => onImage(e.target.files?.[0])} />
              </label>
              {form.imageUrl && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('imageUrl', null)}>
                  Görseli kaldır
                </button>
              )}
              <span className="small faint">PNG/JPG/GIF/WEBP, en fazla 5 MB</span>
            </div>
          )}

          {form.kind === 'toast' && (
            <div className="stack" style={{ gap: 8 }}>
              <label className="check">
                <input type="checkbox" checked={form.requireAck} onChange={(e) => set('requireAck', e.target.checked)} />
                Zorunlu okuma onayı iste <span className="faint small">(kim, ne zaman onayladı kaydedilir — denetim kanıtı)</span>
              </label>
              {form.requireAck && (
                <input value={form.ackLabel} onChange={(e) => set('ackLabel', e.target.value)} placeholder="Buton metni: Okudum, anladım" maxLength={40} />
              )}
            </div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <b>Kime?</b>
            <TargetPicker value={form.targets} onChange={(v) => set('targets', v)} />
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <b>Ne zaman?</b>
            <div className="row">
              <button type="button" className={`chip ${!schedule ? 'on' : ''}`} onClick={() => setSchedule(false)}>
                ⚡ Hemen
              </button>
              <button type="button" className={`chip ${schedule ? 'on' : ''}`} onClick={() => setSchedule(true)}>
                🗓️ İleri tarihte
              </button>
              {schedule && (
                <input type="datetime-local" style={{ width: 220 }} value={toLocalInput(form.startsAt)} onChange={(e) => set('startsAt', fromLocalInput(e.target.value))} />
              )}
            </div>
            <div className="row small">
              <span className="muted">Ekranda kalma süresi:</span>
              {END_PRESETS.map(([label, h]) => (
                <button
                  key={label}
                  type="button"
                  className={`chip ${(h === null && !form.endsAt) ? 'on' : ''}`}
                  style={{ padding: '3px 10px' }}
                  onClick={() => {
                    const base = schedule && form.startsAt ? Date.parse(form.startsAt) : Date.now();
                    set('endsAt', h === null ? null : h === -1 ? endOfDay() : new Date(base + h * 3600_000).toISOString());
                  }}
                >
                  {label}
                </button>
              ))}
              <input type="datetime-local" style={{ width: 200 }} value={toLocalInput(form.endsAt)} onChange={(e) => set('endsAt', fromLocalInput(e.target.value))} />
            </div>
          </div>

          <div className="row">
            <label className="check">
              <input type="checkbox" checked={form.showOnKiosk} onChange={(e) => set('showOnKiosk', e.target.checked)} /> Kiosk/TV ekranlarında da göster
            </label>
            <label className="check">
              <input type="checkbox" checked={form.sound} onChange={(e) => set('sound', e.target.checked)} /> Sesli uyarı
            </label>
          </div>

          {placeholders && <div className="alert alert-warn">Metinde doldurulmamış [köşeli parantez] alanları var.</div>}
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {(!id || existing.data?.item.status === 'draft') && (
              <button className="btn" disabled={busy || !form.title.trim()} onClick={() => save(false)}>
                Taslak kaydet
              </button>
            )}
            <button className="btn btn-primary btn-lg" disabled={busy || !form.title.trim()} onClick={() => save(true)}>
              {isActive ? 'Kaydet ve güncelle' : schedule ? '🗓️ Planla' : '🚀 Yayınla'}
            </button>
          </div>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 20 }}>
          <b>Önizleme</b>
          <Preview d={{ ...form, emoji: form.emoji }} />
          <p className="small faint">
            Kart ve anketler tam ekran sunum/oyun sırasında beklemeye alınır, sunum bitince gösterilir. Rozet tıklamaları engellemez.
          </p>
        </div>
      </div>
    </>
  );
}
