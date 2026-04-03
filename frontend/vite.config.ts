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
})
