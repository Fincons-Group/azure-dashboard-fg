import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's %VITE_x% index.html interpolation (used for the CSP connect-src
// entry, see client/index.html) leaves the token as a literal, unreplaced
// string - and warns - when the env var is unset, instead of resolving it
// to an empty string. An explicit default here is what makes the token
// disappear cleanly for same-origin builds that don't set this var.
process.env.VITE_API_BASE_URL ??= ''

// https://vite.dev/config/
export default defineConfig(() => ({
  base: process.env.VITE_PUBLIC_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
}))
