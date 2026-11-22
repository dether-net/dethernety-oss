import { defineConfig } from 'vitest/config'

// Tests cover the module's pure parts (the edge-kind table, the fold, the matching) over
// fixtures, and lint its data against the repository. Database-backed read specs live in
// the platform's integration suite. Tests live outside src/ so tsc never compiles them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.{ts,js,mjs}'],
  },
})
