import { defineConfig } from 'vitest/config'

// Separate from vitest.config.mjs on purpose. The default `test` script is Docker-free and safe to
// run anywhere; these specs each start a Memgraph container, so folding them into the default
// discovery would make `pnpm test` fail on any machine or CI job without a Docker socket.
//
// `fileParallelism: false` because every spec file starts its own container — running them at once
// starves the Node process and turns a 0.3s container start into a startup-timeout failure.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.e2e.spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 200_000,
  },
})
