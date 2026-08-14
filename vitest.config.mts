import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'packages/client/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.{ts,tsx}'],
    exclude: ['packages/server/test/**', '**/node_modules/**'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
})
