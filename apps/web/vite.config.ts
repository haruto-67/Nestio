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
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Nestio',
        short_name: 'Nestio',
        description: '巣に、今日やることを集めるタスク管理PWA',
        theme_color: '#2A9D8F',
        background_color: '#FEF2DC',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
        navigateFallbackDenylist: [/^\/api\//],
        // 期限リマインダー・ポモドーロ終了のpush/notificationclickハンドラを追加する
        importScripts: ['push-sw.js'],
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
