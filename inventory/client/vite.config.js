import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // בפיתוח הלקוח רץ בנפרד; בפרודקשן Express מגיש את dist ואין proxy
    proxy: { '/api': 'http://localhost:4010' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
