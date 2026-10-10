import { defineConfig } from 'vite';
import { env } from 'node:process';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: env.MUSICFS_DEV_SERVER ?? 'http://127.0.0.1:8080', changeOrigin: false } } },
  build: { target: 'es2022' },
});
