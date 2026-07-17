import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: {
    // true = listen on all interfaces (0.0.0.0), not just loopback — needed
    // so apps/mobile's Apple Music WebView (a separate device/emulator, not
    // this same machine) can reach the dev server via the host's LAN IP.
    // Doesn't affect Spotify's web OAuth redirect, which is keyed to the
    // registered http://127.0.0.1:8888/callback regardless of which
    // interface the server accepts connections on.
    host: true,
    port: 8888,
    strictPort: true,
  },
})
