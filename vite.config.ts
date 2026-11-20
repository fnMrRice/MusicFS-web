import { defineConfig } from 'vite';
import { env } from 'node:process';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import manifest from './public/version.json' with { type: 'json' };

if (manifest.webVersion !== pkg.version) {
  throw new Error('The web version in public/version.json must match package.json.');
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: env.MUSICFS_DEV_SERVER ?? 'http://127.0.0.1:8080', changeOrigin: false, ws: true } } },
  build: { target: 'es2022' },
});
