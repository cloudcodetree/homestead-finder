/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set base to repo name for GitHub Pages deployment
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/homestead-finder/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    // Frozen at build time; exposed as a global constant the footer can
    // render. ISO format — the footer formats it for display.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Default `node` env was fine for the pure-utility tests; component
    // tests need DOM globals (document, window, getComputedStyle).
  },
})
