import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BACKEND = process.env.ROUNDTABLE_BACKEND ?? 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Browser talks only to the Vite origin; Vite forwards to the Node backend.
    proxy: {
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
})
