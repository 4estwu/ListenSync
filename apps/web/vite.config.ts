import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: {
    host: '127.0.0.1',
    port: 8888,
    strictPort: true,
  },
})
