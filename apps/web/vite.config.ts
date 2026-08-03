import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Nestio',
        short_name: 'Nestio',
        description: '巣に、今日やることを集めるタスク管理PWA',
        theme_color: '#2A9D8F',
        background_color: '#F5E6C8',
        display: 'standalone',
        start_url: '/',
        // 本番用PNGはPhase 6でCanvaから書き出して差し替える（docs/open-questions.md 6章）
        icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // SSEストリームはキャッシュ対象から除外する
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.includes('/sync/stream'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
