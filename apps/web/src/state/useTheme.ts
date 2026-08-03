import { useEffect } from 'react';
import { useApp } from './AppProvider.js';
import { upsertUserSettingsOp } from './actions.js';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'nestio_theme';

/** user_settings.theme を正として使う。未ログイン/未同期時は localStorage → OS設定へフォールバック */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const { data, me, submitOps } = useApp();

  const theme: Theme =
    data.userSettings?.theme ??
    (localStorage.getItem(STORAGE_KEY) as Theme | null) ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    if (me) {
      submitOps([upsertUserSettingsOp(me.id, { theme: next })]).catch((err) => console.error(err));
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  };

  return { theme, toggleTheme };
}
