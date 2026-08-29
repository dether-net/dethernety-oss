import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// Separate from vite.config.ts: the test environment has no business in the config that
// produces the embedded production bundle (and pulling the Tailwind plugin into the test run
// would compile CSS the component tests never assert on).
export default defineConfig({
  plugins: [vue()],
  // NOT set to the production base. It was, with a comment claiming that made import.meta.env.BASE_URL
  // '/console/' in tests and so exercised the base-path threading. Measured, it does not: under vitest the
  // value is '/' regardless, so the claim was false and the threading went untested behind it. The prefix
  // is covered directly instead, by stubbing the variable per case — see test/base-path.test.ts.
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
