import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'packages/client/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
})
