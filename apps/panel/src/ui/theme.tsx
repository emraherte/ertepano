import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'ertepano.theme';
const read = (): ThemeMode => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

const ThemeContext = createContext<{ mode: ThemeMode; dark: boolean; setMode: (m: ThemeMode) => void; toggle: () => void }>({
  mode: 'system',
  dark: false,
  setMode: () => {},
  toggle: () => {},
});
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(read);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* gizli pencere vb. — tercih sadece bu oturumda geçerli */
    }
  }, []);
  const toggle = useCallback(() => setMode(dark ? 'light' : 'dark'), [dark, setMode]);

  return <ThemeContext.Provider value={{ mode, dark, setMode, toggle }}>{children}</ThemeContext.Provider>;
}
