import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
let onMfaSetupRequired: () => void = () => {};
export const setMfaSetupRequiredHandler = (fn: () => void) => {
  onMfaSetupRequired = fn;
};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized();
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (res.status === 403 && data.code === 'mfa_setup_required') onMfaSetupRequired();
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Hata (${res.status})`);
  return data as T;
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/media', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Yükleme başarısız');
  return data.url as string;
}

/** GET + isteğe bağlı periyodik yenileme. */
export function useApi<T>(path: string | null, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    if (!intervalMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), intervalMs);
    return () => clearInterval(t);
  }, [path, intervalMs, reload]);

  return { data, error, loading, reload, setData };
}

// ---- Biçimlendirme ----
const dtf = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDateTime = (s?: string | null) => (s ? dtf.format(new Date(s)) : '—');
export const fmtDate = (s?: string | null) => (s ? df.format(new Date(s)) : '—');

export function fmtAgo(s?: string | null) {
  if (!s) return '—';
  const sec = Math.round((Date.now() - Date.parse(s)) / 1000);
  if (sec < 60) return 'az önce';
  if (sec < 3600) return `${Math.floor(sec / 60)} dk önce`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} sa önce`;
  return `${Math.floor(sec / 86400)} gün önce`;
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** <input type="datetime-local"> değeri ⇄ ISO */
export const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
