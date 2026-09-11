import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's %VITE_x% index.html interpolation (used for the CSP connect-src
// entry, see client/index.html) leaves the token as a literal, unreplaced
// string - and warns - when the env var is unset, instead of resolving it
// to an empty string. An explicit default here is what makes the token
// disappear cleanly for same-origin builds that don't set this var.
process.env.VITE_API_BASE_URL ??= ''

// Univer (embedded spreadsheet on the Excel Export page) is a plugin-mode
// setup: the app imports ~17 @univerjs/* packages plus their `/facade` and
// `/locale/en-US` sub-entries. Listing every entry point here forces Vite's
// dev dep-optimizer to pre-bundle them together in one pass - otherwise it
// discovers the facade side-effect imports late and produces a second
// optimize chunk, which re-evaluates @univerjs/engine-render and logs
// "Identifier ... already exists" warnings.
const UNIVER_PACKAGES = [
  'core',
  'design',
  'themes',
  'engine-render',
  'engine-formula',
  'ui',
  'docs',
  'docs-ui',
  'sheets',
  'sheets-ui',
  'sheets-formula',
  'sheets-formula-ui',
  'sheets-numfmt',
  'sheets-numfmt-ui',
  'sheets-filter',
  'sheets-filter-ui',
  'sheets-sort',
  'sheets-sort-ui',
]

const UNIVER_FACADE = [
  'core',
  'engine-formula',
  'ui',
  'docs-ui',
  'sheets',
  'sheets-ui',
  'sheets-formula',
  'sheets-numfmt',
  'sheets-filter',
  'sheets-sort',
]

const UNIVER_LOCALES = [
  'design',
  'ui',
  'docs-ui',
  'sheets',
  'sheets-ui',
  'sheets-formula-ui',
  'sheets-numfmt-ui',
  'sheets-filter-ui',
  'sheets-sort-ui',
]

// https://vite.dev/config/
export default defineConfig(() => ({
  base: process.env.VITE_PUBLIC_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      // Dev-only static report mounts (see E2E_REPORTS_DIR /
      // TEST_SUITES_REPORTS_DIR in src/server.ts) - without this, a plain
      // <a href="/test-suites-reports/..."> resolves against the client's
      // own origin (:3000) instead of the server that serves it (:3001),
      // and Vite's SPA fallback swallows the 404 into whatever the app's
      // default route is instead of opening the report.
      '/test-suites-reports': 'http://localhost:3001',
      '/e2e-reports': 'http://localhost:3001',
    },
  },
  optimizeDeps: {
    include: [
      ...UNIVER_PACKAGES.map((p) => `@univerjs/${p}`),
      ...UNIVER_FACADE.map((p) => `@univerjs/${p}/facade`),
      ...UNIVER_LOCALES.map((p) => `@univerjs/${p}/locale/en-US`),
    ],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
}))
