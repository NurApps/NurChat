import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
    plugins: () => [],
  },
  build: {
    target: 'esnext',
  },
  server: {
    // Tauri дожидается фронтенда на 127.0.0.1 (см. devUrl в tauri.conf.json);
    // без явного host Vite на некоторых машинах слушает только [::1] (IPv6),
    // и Tauri вечно висит на "Waiting for your frontend dev server...".
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Туннели для `run.bat tunnel` (Cloudflare): без этого Vite 403-ит
    // запросы с tunnel-хоста проверкой Host. Только dev-сервер.
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.trycloudflare.com',
    ],
  },
})
