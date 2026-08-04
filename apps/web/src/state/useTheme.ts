import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'nestio_theme';

function loadInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * テーマはデバイスごとの見た目設定であり、複数デバイスで揃える必要が無い
 * （改修3回目：ユーザーの要望でuser_settings経由の同期をやめ、localStorage専用にした）
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(loadInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  };

  return { theme, toggleTheme };
}
