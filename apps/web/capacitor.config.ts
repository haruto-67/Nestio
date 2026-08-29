import type { CapacitorConfig } from '@capacitor/cli';

// CAP_SERVER_URL を指定した場合、ビルド済み dist ではなく指定 URL を直接 WebView にロードする。
// 開発時は Vite dev server (http://localhost:5173) を指すと HMR と /api プロキシがそのまま使え、
// 認証 Cookie も WebView と同一オリジンになるため SameSite=Strict のまま動作する。
const devServerUrl = process.env.CAP_SERVER_URL;

// Google OAuth ログインは accounts.google.com へ 302 リダイレクトする。
// Capacitor は既定で server.url 以外のホストへのナビゲーションをブロックするため明示的に許可する。
const allowNavigation = ['accounts.google.com', '*.google.com'];

const config: CapacitorConfig = {
  appId: 'com.niwatorimc.nestio',
  appName: 'Nestio',
  webDir: 'dist',
  server: {
    allowNavigation,
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  // 'automatic'(既定)だとネイティブ側のスクロールインセットとCSSのenv(safe-area-inset-*)が
  // 競合し、どちらも中途半端にしか効かなくなる。'never'にしてCSS側のみで対応する（改修20回目）
  ios: {
    contentInset: 'never',
  },
};

export default config;
