import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 4180);

// Set by the server when it runs Vite in-process, which is what `pnpm dev`
// does: there is no second port to listen on, and nothing to proxy to, because
// the API is already this origin. Standalone `pnpm dev:web` keeps both.
const embedded = process.env.CLAUDE_REMOTE_EMBEDDED === '1';

export default defineConfig({
  plugins: [react()],
  server: {
    // All interfaces, so the dev server is reachable from a phone over the
    // tailnet. What limits who can actually connect is the network, not this.
    host: true,
    // Vite rejects requests naming a host it does not recognise, which would
    // otherwise block every tailnet address. `.ts.net` covers MagicDNS names;
    // the plain 100.x addresses are matched by Vite's IP handling.
    allowedHosts: ['.ts.net'],
    ...(embedded
      ? {}
      : {
          port: 5173,
          proxy: {
            // ws:true matters — the terminal is a WebSocket, and without it Vite
            // proxies the HTTP request and drops the upgrade.
            '/api': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true, ws: true },
          },
        }),
  },
});
