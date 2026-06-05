import { defineConfig } from 'vitest/config'

// Test config for the module's pure frontend logic. Unlike the production build
// (frontend/vite.config.mjs, which aliases `vue` to the host runtime shim),
// tests resolve `vue` to the real test-only devDependency so composables that
// import { ref } work standalone. Node environment — these are pure functions,
// no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['frontend/**/*.test.{js,mjs}'],
  },
})
