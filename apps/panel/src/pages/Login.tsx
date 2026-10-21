import { useState } from 'react';
import { api } from '../api';
import type { User } from '../types';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>('/api/auth/login', { body: { username, password } });
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 20 }}>📌</div>
          <div>
            <h1>ErtePano</h1>
            <p className="muted small">Kurumsal ekran iletişimi</p>
          </div>
        </div>
        <div className="login-pillars">
          <span style={{ background: '#f4ebff', color: '#7c3aed' }}>İK</span>
          <span style={{ background: '#fef3f2', color: '#d92d20' }}>İSG</span>
          <span style={{ background: '#eff4ff', color: '#2563eb' }}>IT</span>
        </div>
        <div className="stack">
          <label className="field">
            Kullanıcı adı
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            Parola
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy || !username || !password}>
            {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </button>
        </div>
      </form>
    </div>
  );
}
