import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.ERTEPANO_API ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // changeOrigin: false → Host başlığı tarayıcının gördüğü köken (localhost:5180) kalır; sunucunun
    // CSRF köken denetimi Origin ile Host'u karşılaştırdığı için gerekli.
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/media': { target: api, changeOrigin: false },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
