import { useEffect, useState } from 'react';
import { api, fmtDateTime, useApi } from '../api';
import { Copy, Modal, PageHead, useToast } from '../ui';

interface EnrollKey {
  id: string;
  key: string;
  label: string;
  autoApprove: number;
  defaultLocation: string | null;
  defaultDepartment: string | null;
  uses: number;
  revoked: number;
  createdBy: string;
  createdAt: string;
}

export function KioskLinks() {
  const { data } = useApi<{ key: string; locations: string[] }>('/api/settings/kiosk');
  if (!data) return null;
  const base = `${location.origin}/kiosk?key=${data.key}`;
  return (
    <div className="card card-pad stack">
      <h2>📺 Kiosk / TV ekranı</h2>
      <p className="muted">
        Fabrika, yemekhane ve giriş ekranlarındaki TV'de tarayıcıyı tam ekran (F11) açın. Duyurular döner; acil durumda ekran kırmızıya döner.
        Bilgisayarı olmayan çalışanlar da İSG ve İK duyurularını görür.
      </p>
      <div className="row"><code style={{ flex: 1, wordBreak: 'break-all' }}>{base}</code><Copy text={base} /><a className="btn btn-sm" href={base} target="_blank" rel="noreferrer">Aç ↗</a></div>
      {data.locations.map((l) => {
        const u = `${base}&loc=${encodeURIComponent(l)}`;
        return (
          <div key={l} className="row small">
            <span style={{ width: 160 }}>📍 {l}</span>
            <code style={{ flex: 1, wordBreak: 'break-all' }}>{u}</code>
            <Copy text={u} />
          </div>
        );
      })}
      <p className="small faint">Lokasyonlu bağlantı, o lokasyona ve "Herkes"e gönderilenleri gösterir. Kişiye özel kutlamalar ve anketler TV'de gösterilmez.</p>
    </div>
  );
}

export function AgentSetup() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: EnrollKey[]; publicKey: string }>('/api/enroll-keys');
  const [selected, setSelected] = useState<string | null>(null);
  const [cfg, setCfg] = useState<object | null>(null);
  const [creating, setCreating] = useState<{ label: string; autoApprove: boolean; defaultLocation: string; defaultDepartment: string } | null>(null);

  const active = (data?.items ?? []).filter((k) => !k.revoked);
  const sel = selected ?? active[0]?.id ?? null;

  useEffect(() => {
    if (!sel) return;
    api<object>(`/api/enroll-keys/${sel}/agent-config`).then(setCfg, () => setCfg(null));
  }, [sel]);

  const create = async () => {
    if (!creating) return;
    try {
      const r = await api<{ id: string }>('/api/enroll-keys', { body: creating });
      toast('Kayıt anahtarı oluşturuldu');
      setCreating(null);
      setSelected(r.id);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const revoke = async (k: EnrollKey) => {
    if (!confirm(`"${k.label}" anahtarı iptal edilsin mi? Kayıtlı cihazlar etkilenmez, yeni kayıt yapılamaz.`)) return;
    await api(`/api/enroll-keys/${k.id}/revoke`, { method: 'POST' });
    if (sel === k.id) setSelected(null);
    reload();
  };

  const json = cfg ? JSON.stringify(cfg, null, 2) : '';
  return (
    <>
      <PageHead title="Ajan kurulumu" sub="Kayıt anahtarı → agent.json → GPO ile dağıtım. Ajan imzasız hiçbir duyuruyu göstermez.">
        <button className="btn btn-primary" onClick={() => setCreating({ label: '', autoApprove: false, defaultLocation: '', defaultDepartment: '' })}>＋ Kayıt anahtarı</button>
      </PageHead>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Kayıt anahtarları</h2></div>
          <table className="tbl">
            <tbody>
              {(data?.items ?? []).map((k) => (
                <tr key={k.id} className={k.revoked ? '' : 'click'} style={{ opacity: k.revoked ? 0.5 : 1, background: sel === k.id ? 'var(--brand-soft)' : undefined }} onClick={() => !k.revoked && setSelected(k.id)}>
                  <td>
                    <b>{k.label}</b>
                    <div className="mono small">{k.key}</div>
                    <div className="small faint">
                      {k.autoApprove ? 'Otomatik onay' : 'IT onayı gerekir'}
                      {k.defaultLocation && ` · 📍 ${k.defaultLocation}`}
                      {k.defaultDepartment && ` · 🏷️ ${k.defaultDepartment}`}
                    </div>
                  </td>
                  <td className="small muted">{k.uses} kayıt<div className="faint">{fmtDateTime(k.createdAt)}</div></td>
                  <td className="right">
                    {k.revoked ? <span className="badge">İptal</span> : <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); revoke(k); }}>İptal et</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stack">
          <div className="card card-pad stack">
            <div className="row"><h2>agent.json</h2><div className="spacer" />{json && <Copy text={json} />}</div>
            <pre className="code">{json || 'Bir kayıt anahtarı seçin'}</pre>
            <p className="small muted">
              <b>serverUrl</b>'yi çalışan bilgisayarların erişebildiği adresle değiştirin (örn. <code>https://pano.sirket.local</code>). <b>publicKey</b> sunucunun imza anahtarıdır; ajan yalnızca bu anahtarla imzalanmış duyuruları gösterir.
            </p>
          </div>
          <div className="card card-pad stack">
            <h2>GPO ile dağıtım — 4 adım</h2>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              <li>İmzalı <code>ErtePano Ajan.msi</code>'yi <b>Computer Configuration → Software Installation</b> ile atayın.</li>
              <li>Yukarıdaki <code>agent.json</code>'ı <b>GPP → Files</b> ile <code>%ProgramData%\ErtePano\agent.json</code> konumuna kopyalayın.</li>
              <li><b>GPP → Registry</b>: <code>HKLM\…\CurrentVersion\Run</code> altına <code>ErtePano</code> = ajan exe yolu.</li>
              <li>Bilgisayarlar açıldıkça <b>Cihazlar</b> sayfasında belirir; "Onay bekleyen" sekmesinden toplu onaylayın.</li>
            </ol>
            <p className="small faint">Ajan, kurulum paketini AV/EDR beyaz listesine ekleyin. Ajan pencere başlığı, ekran görüntüsü, klavye ve dosya verisi toplamaz.</p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <KioskLinks />
      </div>

      {creating && (
        <Modal title="Kayıt anahtarı oluştur" onClose={() => setCreating(null)} footer={<button className="btn btn-primary" disabled={!creating.label.trim()} onClick={create}>Oluştur</button>}>
          <div className="stack">
            <label className="field">Ad<input value={creating.label} onChange={(e) => setCreating({ ...creating, label: e.target.value })} placeholder="Örn: Gebze fabrika GPO" /></label>
            <div className="grid grid-2">
              <label className="field">Varsayılan lokasyon<input value={creating.defaultLocation} onChange={(e) => setCreating({ ...creating, defaultLocation: e.target.value })} placeholder="isteğe bağlı" /></label>
              <label className="field">Varsayılan departman<input value={creating.defaultDepartment} onChange={(e) => setCreating({ ...creating, defaultDepartment: e.target.value })} placeholder="isteğe bağlı" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={creating.autoApprove} onChange={(e) => setCreating({ ...creating, autoApprove: e.target.checked })} /> Bu anahtarla kaydolan cihazları otomatik onayla</label>
            <p className="small faint">Otomatik onay yalnızca GPO gibi kontrollü dağıtımda önerilir. Anahtar sızarsa iptal edip yenisini dağıtın.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
