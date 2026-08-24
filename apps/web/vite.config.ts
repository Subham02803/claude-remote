import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 4180);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // All interfaces, so the dev server is reachable from a phone over the
    // tailnet. What limits who can actually connect is the network, not this.
    host: true,
    // Vite rejects requests naming a host it does not recognise, which would
    // otherwise block every tailnet address. `.ts.net` covers MagicDNS names;
    // the plain 100.x addresses are matched by Vite's IP handling.
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
    },
  },
});
