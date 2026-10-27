import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app from /Guildspace/; local dev stays at /.
  base: process.env.VITE_BASE || '/',
})
