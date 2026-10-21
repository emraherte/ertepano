import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.ERTEPANO_API ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
