'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppData } from '@/lib/domain';

export async function api<T = unknown>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    cache: 'no-store',
    headers: {
      'X-FirstPoint': '1',
      ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || '请求未完成，请稍后重试。');
  return json;
}
type ContextValue = {
  data: AppData | null;
  error: string;
  refresh: () => Promise<void>;
  toast: (text: string) => void;
  settings: boolean;
  setSettings: (open: boolean) => void;
  recording: boolean;
  setRecording: (active: boolean) => void;
};
const AppContext = createContext<ContextValue | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [recording, setRecording] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const next = await api<AppData>('state');
      setData(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(''), 4500);
    return () => clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return (
    <AppContext.Provider
      value={{
        data,
        error,
        refresh,
        toast: setMessage,
        settings,
        setSettings,
        recording,
        setRecording,
      }}
    >
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </AppContext.Provider>
  );
}
export function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error('AppProvider required');
  return app;
}
