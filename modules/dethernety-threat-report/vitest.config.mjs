import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Test config for the module's unit tests (the e2e suites have vitest.e2e.config.mjs). Unlike the production build
// (frontend/vite.config.mjs, which aliases `vue` to the host runtime shim),
// tests resolve `vue` to the real test-only devDependency so composables that
// import { ref } work standalone. Node environment, no DOM: the manifest
// contract test compiles the SFCs through the frontend entry but never mounts
// them.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    // Frontend tests (.js/.mjs), the manifest contract test among them, the backend adapter test (.ts under src/)
    // and the test-database harness's routing test (test/*.test.ts, no database). vitest transpiles TS via esbuild,
    // so no extra transform config is needed.
    include: ['frontend/**/*.test.{js,mjs}', 'src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
