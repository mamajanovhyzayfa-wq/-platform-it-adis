import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** В разработке /api проксируется на backend, в продакшене — VITE_API_URL. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
