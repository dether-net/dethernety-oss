import { defineConfig } from 'vitest/config'

// Test config for the module's pure frontend logic. Unlike the production build
// (frontend/vite.config.mjs, which aliases `vue` to the host runtime shim),
// tests resolve `vue` to the real test-only devDependency so composables that
// import { ref } work standalone. Node environment — these are pure functions,
// no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    // Frontend pure-logic tests (.js/.mjs) plus the backend adapter test (.ts under src/). vitest
    // transpiles TS via esbuild, so no extra transform config is needed.
    include: ['frontend/**/*.test.{js,mjs}', 'src/**/*.test.ts'],
  },
})
