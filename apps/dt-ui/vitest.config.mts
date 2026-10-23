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
    // Stylesheets load as empty strings in tests, ?raw included, unless they match here: a test that
    // reads a stylesheet's source imports it with ?raw.
    css: { include: [/\.s?css\?raw$/] },
    // Drops the harness's "Failed to resolve component" warnings and nothing else — see the file.
    setupFiles: ['./src/test-setup.ts'],
  },
})
