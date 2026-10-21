import { useState } from 'react';
import { ROLE_LABELS, ROLES, type Role } from '@ertepano/shared';
import { api, fmtAgo, useApi } from '../api';
import { Copy, Modal, PageHead, useAuth, useToast } from '../ui';

interface PanelUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Her şey',
  it: 'Cihazlar, ajan kurulumu, IT duyuruları, siber olay uyarısı, IT talepleri',
  isg: 'İSG duyuruları, acil durum ve tatbikat, ramak kala bildirimleri',
  ik: 'İK duyuruları, anketler, özel günler, kutlamalar',
  viewer: 'Sadece görüntüleme',
};

export function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi<{ items: PanelUser[] }>('/api/users');
  const [form, setForm] = useState<{ username: string; fullName: string; role: Role } | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);

  const create = async () => {
    if (!form) return;
    try {
      const r = await api<{ password: string }>('/api/users', { body: form });
      setSecret({ username: form.username, password: r.password });
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const patch = async (u: PanelUser, body: object) => {
    try {
      const r = await api<{ password?: string }>(`/api/users/${u.id}`, { method: 'PATCH', body });
      if (r.password) setSecret({ username: u.username, password: r.password });
      else toast('Güncellendi');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <PageHead title="Kullanıcılar" sub="Panel kullanıcıları ve rolleri. (AD/LDAP girişi Faz 1'de.)">
        <button className="btn btn-primary" onClick={() => setForm({ username: '', fullName: '', role: 'ik' })}>＋ Kullanıcı</button>
      </PageHead>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Son giriş</th><th /></tr></thead>
          <tbody>
            {(data?.items ?? []).map((u) => (
              <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                <td><b>{u.fullName}</b><div className="mono small faint">{u.username}</div></td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value })} style={{ width: 150 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <div className="small faint" style={{ marginTop: 2 }}>{ROLE_HELP[u.role]}</div>
                </td>
                <td className="small muted">{fmtAgo(u.lastLoginAt)}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => confirm('Yeni parola üretilsin mi?') && patch(u, { resetPassword: true })}>Parola sıfırla</button>
                  {u.id !== me.id && <button className="btn btn-sm btn-ghost" onClick={() => patch(u, { isActive: !u.isActive })}>{u.isActive ? 'Devre dışı' : 'Etkinleştir'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title="Kullanıcı ekle" onClose={() => setForm(null)} footer={<button className="btn btn-primary" disabled={!form.username || !form.fullName} onClick={create}>Ekle</button>}>
          <div className="stack">
            <label className="field">Ad soyad<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
            <label className="field">Kullanıcı adı<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} placeholder="ayse.demir" /></label>
            <label className="field">Rol
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} — {ROLE_HELP[r]}</option>)}
              </select>
            </label>
          </div>
        </Modal>
      )}
      {secret && (
        <Modal title="Geçici parola" onClose={() => setSecret(null)} footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>Tamam</button>}>
          <div className="stack">
            <p><b>{secret.username}</b> için parola (yalnızca şimdi gösterilir):</p>
            <div className="row"><code style={{ fontSize: 18 }}>{secret.password}</code><Copy text={secret.password} /></div>
            <p className="small muted">Kullanıcıdan ilk girişte Hesabım sayfasından parolasını değiştirmesini isteyin.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
