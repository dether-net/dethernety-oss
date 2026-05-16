import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import Vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [Vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
