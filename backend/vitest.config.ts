import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Тесты не должны зависеть от переменных окружения машины (например, PORT=0 от внешних инструментов).
    env: {
      NODE_ENV: 'test',
      PORT: '4000',
    },
  },
})
