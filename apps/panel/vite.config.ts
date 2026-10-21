import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ERTEPANO_API ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': api,
      '/media': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
