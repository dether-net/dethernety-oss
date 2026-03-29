import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  bundle: true,
  // Bundle only workspace dependencies. npm deps are resolved at runtime
  // via npx, which installs them in a proper node_modules.
  noExternal: ['@dethernety/dt-core'],
})
