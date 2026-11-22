import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Тесты не должны зависеть от переменных окружения машины (например, PORT=0 от внешних инструментов).
    env: {
      NODE_ENV: 'test',
      PORT: '4000',
      // Временные каталоги тестов: не засоряют рабочее дерево и не пересекаются с dev-файлами.
      UPLOADS_DIR: 'test/.tmp/uploads',
      STORAGE_DIR: 'test/.tmp/storage',
      BACKUP_DIR: 'test/.tmp/backups',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/itadis_test?schema=public',
    },
  },
})
