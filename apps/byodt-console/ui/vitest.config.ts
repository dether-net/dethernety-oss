import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// Separate from vite.config.ts: the test environment has no business in the config that
// produces the embedded production bundle (and pulling the Tailwind plugin into the test run
// would compile CSS the component tests never assert on).
export default defineConfig({
  plugins: [vue()],
  // Match the production build's base so import.meta.env.BASE_URL is '/console/' in tests too —
  // otherwise the base-path threading (api request prefix, redirect derivation) is never exercised.
  base: '/console/',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
})
