import { defineConfig } from 'tsup'
import { shippedBuild } from './src/packaging/shipped-build.js'

export default defineConfig({
  ...shippedBuild,
  entry: ['src/index.ts'],
  outDir: 'dist',
  clean: true,
})
