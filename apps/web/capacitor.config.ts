import type { CapacitorConfig } from '@capacitor/cli';

// CAP_SERVER_URL を指定した場合、ビルド済み dist ではなく指定 URL を直接 WebView にロードする。
// 開発時は Vite dev server (http://localhost:5173) を指すと HMR と /api プロキシがそのまま使え、
// 認証 Cookie も WebView と同一オリジンになるため SameSite=Strict のまま動作する。
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.niwatorimc.nestio',
  appName: 'Nestio',
  webDir: 'dist',
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: true } } : {}),
};

export default config;
