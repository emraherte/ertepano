import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { EMERGENCY_ROLES, ROLE_LABELS, type Role } from '@ertepano/shared';
import { api, setUnauthorizedHandler, useApi } from './api';
import type { User } from './types';
import { AuthContext } from './ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Announcements } from './pages/Announcements';
import { AnnouncementEditor } from './pages/AnnouncementEditor';
import { AnnouncementDetail } from './pages/AnnouncementDetail';
import { Emergency } from './pages/Emergency';
import { Reports } from './pages/Reports';
import { Devices } from './pages/Devices';
import { CalendarPage } from './pages/Calendar';
import { AgentSetup } from './pages/AgentSetup';
import { Users } from './pages/Users';
import { Audit } from './pages/Audit';
import { Account } from './pages/Account';
import { Kiosk } from './pages/Kiosk';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Role[];
  cls?: string;
  count?: number;
}

export function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/kiosk')) return <Kiosk />;
  return <Authed />;
}

function Authed() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<{ user: User }>('/api/auth/me').then((r) => setUser(r.user), () => setUser(null));
  }, []);

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  const logout = () => api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null));
  return (
    <AuthContext.Provider value={{ user, logout }}>
      <Shell user={user} logout={logout} />
    </AuthContext.Provider>
  );
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const em = useApi<{ item: { id: string; title: string; drill: boolean } | null }>('/api/emergencies/active', 5000);
  const dash = useApi<{ devices: { pending: number }; openReports: Record<string, number> }>('/api/dashboard', 20000);
  const active = em.data?.item;
  const openReports = Object.values(dash.data?.openReports ?? {}).reduce((a, b) => a + b, 0);

  const sections: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { to: '/', label: 'Pano', icon: '🏠' },
        { to: '/duyurular', label: 'Duyurular', icon: '📢' },
        { to: '/acil', label: 'Acil Durum', icon: '🚨', cls: 'nav-emergency' },
      ],
    },
    {
      title: 'Takip',
      items: [
        { to: '/bildirimler', label: 'Çalışan bildirimleri', icon: '📥', roles: ['it', 'isg'], count: openReports },
        { to: '/cihazlar', label: 'Cihazlar', icon: '💻', roles: ['it'], count: dash.data?.devices.pending },
        { to: '/takvim', label: 'Takvim & kutlamalar', icon: '🎉', roles: ['ik'] },
      ],
    },
    {
      title: 'Yönetim',
      items: [
        { to: '/ajan-kurulumu', label: 'Ajan kurulumu', icon: '🧩', roles: ['it'] },
        { to: '/kullanicilar', label: 'Kullanıcılar', icon: '👥', roles: ['admin'] },
        { to: '/denetim', label: 'Denetim kaydı', icon: '🧾', roles: ['admin'] },
        { to: '/hesabim', label: 'Hesabım', icon: '⚙️' },
      ],
    },
  ];
  const can = (roles?: Role[]) => !roles || user.role === 'admin' || roles.includes(user.role);

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">📌</div>
          ErtePano
        </div>
        <nav className="nav">
          {sections.map((s, i) => {
            const items = s.items.filter((n) => can(n.roles));
            if (!items.length) return null;
            return (
              <div key={i}>
                {s.title && <div className="nav-section">{s.title}</div>}
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className={n.cls}>
                    <span className="ico">{n.icon}</span>
                    {n.label}
                    {!!n.count && <span className="count">{n.count}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="who">{user.fullName}</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{ROLE_LABELS[user.role]}</span>
            <button onClick={logout}>Çıkış ↩</button>
          </div>
        </div>
      </aside>
      <div>
        {active && (
          <div className={`emergency-strip ${active.drill ? 'drill' : ''}`}>
            🚨 {active.drill ? 'TATBİKAT DEVAM EDİYOR' : 'ACİL DURUM DEVAM EDİYOR'}: {active.title}
            <Link to="/acil">Yoklamayı izle →</Link>
          </div>
        )}
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/duyurular" element={<Announcements />} />
            <Route path="/duyurular/yeni" element={<AnnouncementEditor />} />
            <Route path="/duyurular/:id" element={<AnnouncementDetail />} />
            <Route path="/duyurular/:id/duzenle" element={<AnnouncementEditor />} />
            <Route path="/acil" element={<Emergency canAct={EMERGENCY_ROLES.includes(user.role)} onChange={em.reload} />} />
            {can(['it', 'isg']) && <Route path="/bildirimler" element={<Reports />} />}
            {can(['it']) && <Route path="/cihazlar" element={<Devices />} />}
            {can(['ik']) && <Route path="/takvim" element={<CalendarPage />} />}
            {can(['it']) && <Route path="/ajan-kurulumu" element={<AgentSetup />} />}
            {can(['admin']) && <Route path="/kullanicilar" element={<Users />} />}
            {can(['admin']) && <Route path="/denetim" element={<Audit />} />}
            <Route path="/hesabim" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
