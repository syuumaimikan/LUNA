import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@main': r('./src/main'),
      '@renderer': r('./src/renderer'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    coverage: { include: ['src/**/*.ts'], reporter: ['text', 'html'] },
  },
})
