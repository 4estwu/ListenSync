import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const certPath = path.resolve(dirname, '.certs/dev-cert.pem')
const keyPath = path.resolve(dirname, '.certs/dev-key.pem')
// Generated with mkcert: run `mkcert -install` once, then from this
// directory `mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem
// 192.168.1.167 localhost 127.0.0.1 ::1` (swap in your own LAN IP).
// 127.0.0.1/localhost are already "potentially trustworthy" secure contexts
// even over plain HTTP
// (a standing browser exception for loopback), so this was never needed for
// the desktop dev flow. It's needed for the mobile app's Apple Music Custom
// Tab, which reaches this server via the LAN IP (127.0.0.1 on the *emulator*
// is its own loopback, not this machine's) — a non-loopback origin only
// counts as secure over real HTTPS. MusicKit JS silently falls back to a
// 30-second preview clip without a secure context, because full-length
// playback is DRM-protected and needs Encrypted Media Extensions, which (like
// crypto.randomUUID) browsers restrict to secure contexts — confirmed live by
// comparing navigator.requestMediaKeySystemAccess across an HTTPS
// music.apple.com tab (present) and this server's plain-HTTP LAN-IP origin
// (absent) in the same browser. Falls back to plain HTTP when the cert
// doesn't exist (e.g. a fresh clone before running mkcert) rather than
// failing to start.
const devTls = existsSync(certPath) && existsSync(keyPath) ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: {
    // true = listen on all interfaces (0.0.0.0), not just loopback — needed
    // so apps/mobile's Apple Music WebView (a separate device/emulator, not
    // this same machine) can reach the dev server via the host's LAN IP.
    host: true,
    port: 8888,
    strictPort: true,
    https: devTls,
  },
})
