import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@react-native-async-storage\/async-storage$/,
        replacement: fileURLToPath(new URL('./test/async-storage-mock.ts', import.meta.url)),
      },
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL('./src/', import.meta.url))}`,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
