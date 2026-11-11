import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // As in the shipped build: Node's own fetch serves cross-fetch.
    alias: { 'cross-fetch': fileURLToPath(new URL('./src/packaging/fetch.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/test-setup/isolated-home.ts'],
    // Half the cores: the scorer's end-to-end tests are heavy, and a host already busy with other work starves them.
    maxWorkers: '50%',
  },
});
