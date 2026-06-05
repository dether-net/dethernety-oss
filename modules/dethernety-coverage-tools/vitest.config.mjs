import { defineConfig } from 'vitest/config'

// Tests cover the pure coverage aggregator (src/aggregateCoverage.ts) over
// fixture rows — the graph-traversal Cypher itself is verified live against a
// real graph. Tests live outside src/ so tsc (which builds only src/**) never
// compiles them. Node environment — pure functions, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.{ts,js,mjs}'],
  },
})
