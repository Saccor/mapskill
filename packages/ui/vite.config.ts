import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// During development, `MAPSKILL_DAEMON=http://127.0.0.1:<port> pnpm --filter @mapskill/ui dev` proxies the API to a running daemon.
const daemon = process.env.MAPSKILL_DAEMON;

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: daemon
    ? { proxy: { '/api': daemon, '/ws': { target: daemon.replace(/^http/, 'ws'), ws: true } } }
    : undefined,
});
