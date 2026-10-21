import { useState } from 'react';
import { ROLE_LABELS } from '@ertepano/shared';
import { api } from '../api';
import { PageHead, useAuth, useToast } from '../ui';
import { KioskLinks } from './AgentSetup';

export function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [p, setP] = useState({ current: '', next: '', again: '' });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p.next !== p.again) return toast('Yeni parolalar eşleşmiyor', true);
    try {
      await api('/api/auth/password', { body: { current: p.current, next: p.next } });
      toast('Parola değiştirildi');
      setP({ current: '', next: '', again: '' });
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  return (
    <>
      <PageHead title="Hesabım" sub={`${user.fullName} · ${ROLE_LABELS[user.role]}`} />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form className="card card-pad stack" onSubmit={save}>
          <h2>Parola değiştir</h2>
          <label className="field">Mevcut parola<input type="password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} autoComplete="current-password" /></label>
          <label className="field">Yeni parola <span className="hint">en az 10 karakter</span><input type="password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} autoComplete="new-password" /></label>
          <label className="field">Yeni parola (tekrar)<input type="password" value={p.again} onChange={(e) => setP({ ...p, again: e.target.value })} autoComplete="new-password" /></label>
          <button className="btn btn-primary" disabled={!p.current || p.next.length < 10}>Kaydet</button>
        </form>
        {user.role !== 'viewer' && <KioskLinks />}
      </div>
    </>
  );
}
