import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarHeart,
  Inbox,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Megaphone,
  Menu,
  Monitor,
  Moon,
  Plus,
  Puzzle,
  RadioTower,
  ScrollText,
  Search,
  Settings2,
  Siren,
  Sun,
  UserCog,
  BadgeCheck,
  Lock,
  Sparkles,
  ScreenShare,
  Rocket,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { EMERGENCY_ROLES, type LicenseInfo, type Module, ROLE_LABELS, type Role } from '@ertepano/shared';
import { api, setMfaSetupRequiredHandler, setUnauthorizedHandler, useApi } from './api';
import { MfaRequiredScreen } from './pages/MfaRequired';
import type { User } from './types';
import { AuthContext, Avatar, cn, IconButton, Kbd, LiveDot, useTheme } from './ui';
import { type Command, CommandPalette, useCommandHotkey } from './components/CommandPalette';
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
import { SystemSettings } from './pages/SystemSettings';
import { Kiosk } from './pages/Kiosk';
import { LicensePage } from './pages/License';
import { SupportHistory, SupportSession } from './pages/RemoteSupport';
import { SetupWizard } from './pages/SetupWizard';
import { LicenseProvider, ModuleLocked, useLicense } from './components/license';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  danger?: boolean;
  count?: number;
  /** Bu modüllerden biri lisanslıysa açık; değilse kilitli gösterilir */
  modules?: Module[];
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
    const loadMe = () => api<{ user: User }>('/api/auth/me').then((r) => setUser(r.user), () => setUser(null));
    setMfaSetupRequiredHandler(loadMe);
    loadMe();
  }, []);

  if (user === undefined) return <div className="app-backdrop" />;
  if (!user) return <Login onLogin={setUser} />;

  const logout = () => api('/api/auth/logout', { method: 'POST' }).finally(() => setUser(null));
  if (user.mfaSetupRequired) return <MfaRequiredScreen user={user} onDone={setUser} onLogout={logout} />;
  return (
    <AuthContext.Provider value={{ user, logout }}>
      <Shell user={user} logout={logout} />
    </AuthContext.Provider>
  );
}

function Shell(props: { user: User; logout: () => void }) {
  const lic = useApi<LicenseInfo>('/api/license', 5 * 60_000);
  return (
    <LicenseProvider license={lic.data} reload={lic.reload}>
      <ShellInner {...props} />
    </LicenseProvider>
  );
}

function ShellInner({ user, logout }: { user: User; logout: () => void }) {
  const { license, any, categoriesFor } = useLicense();
  const setup = useApi<{ completed: boolean }>(user.role === 'admin' ? '/api/setup' : null);
  const authCfg = useApi<{ org: string | null }>('/api/auth/config');
  const location = useLocation();
  const nav = useNavigate();
  const { dark, toggle } = useTheme();
  const em = useApi<{ item: { id: string; title: string; drill: boolean } | null }>('/api/emergencies/active', 5000);
  const dash = useApi<{ devices: { pending: number; online: number; total: number }; openReports: Record<string, number> }>('/api/dashboard', 20000);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  useCommandHotkey(setPaletteOpen);
  useEffect(() => setMobileNav(false), [location.pathname]);

  const active = em.data?.item;
  const openReports = Object.values(dash.data?.openReports ?? {}).reduce((a, b) => a + b, 0);
  const can = (roles?: Role[]) => !roles || user.role === 'admin' || roles.includes(user.role);
  const canPublish = categoriesFor(user.role).length > 0;

  const sections: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { to: '/', label: 'Pano', icon: LayoutDashboard },
        { to: '/duyurular', label: 'Duyurular', icon: Megaphone },
        { to: '/acil', label: 'Acil Durum', icon: Siren, danger: true, modules: ['isg', 'it'] },
      ],
    },
    {
      title: 'Takip',
      items: [
        { to: '/bildirimler', label: 'Çalışan bildirimleri', icon: Inbox, roles: ['it', 'isg'], count: openReports, modules: ['it', 'isg'] },
        { to: '/cihazlar', label: 'Cihazlar', icon: Monitor, roles: ['it'], count: dash.data?.devices.pending },
        { to: '/destek', label: 'Uzaktan destek', icon: ScreenShare, roles: ['it'], modules: ['it'] },
        { to: '/takvim', label: 'Takvim & kutlamalar', icon: CalendarHeart, roles: ['ik'] },
      ],
    },
    {
      title: 'Yönetim',
      items: [
        { to: '/ajan-kurulumu', label: 'Ajan kurulumu', icon: Puzzle, roles: ['it'] },
        { to: '/kullanicilar', label: 'Kullanıcılar', icon: UsersIcon, roles: ['admin'] },
        { to: '/denetim', label: 'Denetim kaydı', icon: ScrollText, roles: ['admin'] },
        { to: '/sistem', label: 'Sistem & güvenlik', icon: Settings2, roles: ['admin'] },
        { to: '/lisans', label: 'Lisans ve modüller', icon: BadgeCheck, roles: ['admin'] },
        { to: '/kurulum', label: 'Kurulum & kontrol', icon: Rocket, roles: ['admin'] },
        { to: '/hesabim', label: 'Hesabım', icon: UserCog },
      ],
    },
  ];

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => nav(to);
    const list: Command[] = sections.flatMap((s) =>
      s.items.filter((n) => can(n.roles)).map((n) => ({ id: n.to, label: n.label, icon: n.icon, group: 'Sayfalar', run: go(n.to) })),
    );
    if (canPublish) list.unshift({ id: 'new', label: 'Yeni duyuru oluştur', icon: Plus, group: 'İşlemler', hint: 'şablonla', run: go('/duyurular/yeni'), keywords: 'duyuru anket şablon' });
    if (EMERGENCY_ROLES.includes(user.role)) list.unshift({ id: 'em', label: 'Acil durum / tatbikat başlat', icon: Siren, group: 'İşlemler', run: go('/acil'), keywords: 'yangın deprem tahliye' });
    list.push({ id: 'theme', label: dark ? 'Açık temaya geç' : 'Koyu temaya geç', icon: dark ? Sun : Moon, group: 'Tercihler', run: toggle, keywords: 'tema karanlık' });
    list.push({ id: 'logout', label: 'Çıkış yap', icon: LogOut, group: 'Tercihler', run: logout });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, dark, openReports, dash.data?.devices.pending]);

  const sidebar = (
    <aside className="flex h-full flex-col gap-1 p-4">
      <Link to="/" className="mb-6 flex items-center gap-3 px-2 pt-1">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
          <RadioTower size={20} strokeWidth={2.2} />
          <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/30" />
        </div>
        <div>
          <div className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">ErtePano</div>
          <div className="max-w-[170px] truncate text-[11px] font-medium text-slate-400">{authCfg.data?.org ?? 'İK · İSG · IT'}</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto">
        {sections.map((s, i) => {
          const items = s.items.filter((n) => can(n.roles));
          if (!items.length) return null;
          return (
            <div key={i}>
              {s.title && <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{s.title}</div>}
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} className="group relative block rounded-xl outline-none">
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="nav-active"
                            className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/10 dark:ring-white/10"
                            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                          />
                        )}
                        <span
                          className={cn(
                            'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-300',
                            isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 group-hover:translate-x-0.5 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white',
                            n.danger && !isActive && 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          <n.icon size={18} strokeWidth={isActive ? 2.3 : 2} className={cn(isActive && (n.danger ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'))} />
                          {n.label}
                          {!any(n.modules) && <Lock size={13} className="ml-auto text-slate-400" />}
                          {!!n.count && any(n.modules) && (
                            <span className="ml-auto rounded-full bg-linear-to-br from-rose-500 to-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm shadow-rose-500/30 tabular-nums">{n.count}</span>
                          )}
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {dash.data && (
        <div className="mb-3 rounded-2xl border border-emerald-500/15 bg-linear-to-br from-emerald-500/[0.08] to-teal-500/[0.04] p-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
            <LiveDot /> Canlı
          </div>
          <div className="mt-1.5 text-[13px] text-slate-600 dark:text-slate-300">
            <span className="text-lg font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">{dash.data.devices.online}</span> / {dash.data.devices.total} ekran çevrimiçi
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.04]">
        <Avatar name={user.fullName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{user.fullName}</div>
          <div className="text-[12px] text-slate-500">{ROLE_LABELS[user.role]}</div>
        </div>
        <IconButton icon={LogOut} label="Çıkış yap" onClick={logout} />
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" />

      {/* Masaüstü: yüzen cam kenar çubuğu */}
      <div className="fixed inset-y-3 left-3 z-30 hidden w-[264px] lg:block">
        <div className="h-full rounded-3xl border border-slate-200/60 bg-white/60 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.25)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/50">{sidebar}</div>
      </div>

      {/* Mobil çekmece */}
      <AnimatePresence>
        {mobileNav && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setMobileNav(false)} />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              className="absolute inset-y-3 left-3 w-[280px] rounded-3xl border border-white/10 bg-white/95 shadow-2xl backdrop-blur-2xl dark:bg-slate-900/95"
            >
              <IconButton icon={X} label="Menüyü kapat" className="absolute top-5 right-4" onClick={() => setMobileNav(false)} />
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="lg:pl-[280px]">
        {/* Üst çubuk */}
        <header className="no-print sticky top-0 z-20 px-4 pt-3 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center gap-3 rounded-2xl border border-slate-200/50 bg-white/50 px-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40">
            <IconButton icon={Menu} label="Menü" className="lg:hidden" onClick={() => setMobileNav(true)} />
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex h-9 w-full max-w-md items-center gap-3 rounded-xl border border-slate-200/70 bg-white/60 px-3 text-[13px] text-slate-400 transition-all duration-300 hover:border-slate-300 hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <Search size={15} />
              <span className="flex-1 text-left">Ara veya komut çalıştır…</span>
              <span className="hidden items-center gap-1 sm:flex">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="flex-1" />
            {dash.data && (
              <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-1.5 text-[12px] font-medium text-emerald-700 md:flex dark:text-emerald-300">
                <LiveDot /> {dash.data.devices.online} ekran bağlı
              </div>
            )}
            <IconButton icon={dark ? Sun : Moon} label={dark ? 'Açık tema' : 'Koyu tema'} onClick={toggle} />
          </div>
        </header>

        {license && (license.mode === 'trial' || license.mode === 'grace' || license.mode === 'expired') && (
          <div className="no-print px-4 pt-3 sm:px-6 lg:px-8">
            <Link
              to={user.role === 'admin' ? '/lisans' : '/'}
              className={cn(
                'flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-[13px] font-medium transition-all duration-300 hover:-translate-y-0.5',
                license.mode === 'trial'
                  ? 'border-sky-500/20 bg-sky-500/[0.07] text-sky-800 dark:text-sky-200'
                  : 'border-amber-500/30 bg-amber-500/[0.08] text-amber-900 dark:text-amber-200',
              )}
            >
              {license.mode === 'trial' ? <Sparkles size={16} /> : <BadgeCheck size={16} />}
              {license.mode === 'trial'
                ? `Deneme sürümü: tüm modüller ${license.daysLeft} gün daha açık`
                : license.mode === 'grace'
                  ? `Lisans süresi doldu — ${license.daysLeft} gün içinde yenilenmezse modüller kapanır`
                  : 'Lisans geçersiz ya da süresi doldu — yalnızca temel paket çalışıyor'}
              {user.role === 'admin' && <span className="ml-auto opacity-70">Lisansı yönet →</span>}
            </Link>
          </div>
        )}

        <AnimatePresence>
          {active && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="no-print px-4 pt-3 sm:px-6 lg:px-8">
              <Link
                to="/acil"
                className={cn(
                  'group flex items-center gap-3 rounded-2xl px-5 py-3.5 text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:-translate-y-0.5',
                  active.drill ? 'bg-linear-to-r from-amber-500 to-orange-600 shadow-orange-500/25' : 'animate-siren bg-linear-to-r from-rose-600 to-red-600 shadow-rose-600/30',
                )}
              >
                <Siren size={18} className="animate-pulse" />
                <span className="truncate">
                  {active.drill ? 'TATBİKAT DEVAM EDİYOR' : 'ACİL DURUM DEVAM EDİYOR'} · {active.title}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-white/90">
                  Yoklamayı izle <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="mx-auto w-full max-w-[1400px] px-4 pt-8 pb-16 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <Routes location={location}>
                <Route path="/" element={setup.data && !setup.data.completed ? <Navigate to="/kurulum" replace /> : <Dashboard />} />
                {can(['admin']) && <Route path="/kurulum" element={<SetupWizard />} />}
                <Route path="/duyurular" element={<Announcements />} />
                <Route path="/duyurular/yeni" element={<AnnouncementEditor />} />
                <Route path="/duyurular/:id" element={<AnnouncementDetail />} />
                <Route path="/duyurular/:id/duzenle" element={<AnnouncementEditor />} />
                <Route path="/acil" element={any(['isg', 'it']) ? <Emergency canAct={EMERGENCY_ROLES.includes(user.role)} onChange={em.reload} /> : <ModuleLocked modules={['isg']} />} />
                {can(['it', 'isg']) && <Route path="/bildirimler" element={any(['it', 'isg']) ? <Reports /> : <ModuleLocked modules={user.role === 'isg' ? ['isg'] : ['it']} />} />}
                {can(['it']) && <Route path="/cihazlar" element={<Devices />} />}
                {can(['it']) && <Route path="/destek" element={any(['it']) ? <SupportHistory /> : <ModuleLocked modules={['it']} />} />}
                {can(['it']) && <Route path="/destek/:id" element={any(['it']) ? <SupportSession /> : <ModuleLocked modules={['it']} />} />}
                {can(['ik']) && <Route path="/takvim" element={<CalendarPage />} />}
                {can(['it']) && <Route path="/ajan-kurulumu" element={<AgentSetup />} />}
                {can(['admin']) && <Route path="/kullanicilar" element={<Users />} />}
                {can(['admin']) && <Route path="/denetim" element={<Audit />} />}
                {can(['admin']) && <Route path="/sistem" element={<SystemSettings />} />}
                <Route path="/hesabim" element={<Account />} />
                {can(['admin']) && <Route path="/lisans" element={<LicensePage />} />}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

