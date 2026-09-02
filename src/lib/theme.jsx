import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext(undefined);

const API_URL = import.meta.env.VITE_API_URL || "";

function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme) {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'dark';
    }
    return 'dark';
  });

  const applyTheme = useCallback((value) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolveTheme(value));
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('theme', theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, applyTheme]);

  useEffect(() => {
    async function syncTheme() {
      const token = localStorage.getItem('nineteen_token');
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.theme && data.theme !== theme) {
            setTheme(data.theme);
          }
        }
      } catch { /* ignore */ }
    }
    syncTheme();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
