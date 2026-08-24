import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 4180);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Loopback only. The tunnel points at the API server, not at Vite.
    host: '127.0.0.1',
    proxy: {
      '/api': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
      '/auth': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
    },
  },
});
