import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ספירת מלאי',
        short_name: 'מלאי',
        description: 'ספירת מלאי למסעדה',
        lang: 'he',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1f6feb',
        background_color: '#f4f5f7',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // המעטפת של האפליקציה נשמרת כדי שהיא תיפתח גם בלי רשת.
        // ה-API לעולם לא נשמר - נתוני מלאי ישנים גרועים מאין נתונים.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4010' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
