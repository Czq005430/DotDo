import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base must be './' for Electron to load assets from the file system
  base: './',
  server: {
    port: 5187,
    strictPort: true,
  }
})
