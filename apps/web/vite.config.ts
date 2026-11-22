import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** В разработке /api проксируется на backend, в продакшене — VITE_API_URL. */
export default defineConfig({
  plugins: [react()],
  // @livedigital/client использует Node-совместимый EventEmitter; без полифила Vite
  // заменяет модуль пустым объектом и SDK падает при создании клиента.
  resolve: { alias: { events: 'events/' } },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
