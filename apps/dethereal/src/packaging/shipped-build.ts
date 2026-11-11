import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options } from 'tsup'
import { shippedChecks } from './metafile-checks.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { version } = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string }

/**
 * The options every shipped build uses, and every test that builds the server
 * spreads, so tests exercise what ships: everything bundled (the package has no
 * runtime dependencies; a plugin install gets no node_modules), minified with
 * names kept, `cross-fetch` served by Node's own fetch, and the build-time
 * checks (nothing left for run time, process starts only where allowed,
 * licenses, notices, no build-machine paths). The package's version is stamped in
 * as `__DETHEREAL_VERSION__`, which the server reports.
 */
export const shippedBuild: Options = {
  format: ['esm'],
  target: 'node20',
  bundle: true,
  noExternal: [/.*/],
  minify: true,
  keepNames: true,
  sourcemap: false,
  dts: false,
  esbuildPlugins: [shippedChecks()],
  define: { __DETHEREAL_VERSION__: JSON.stringify(version) },
  esbuildOptions(options) {
    options.mainFields = ['module', 'main']
    options.legalComments = 'none'
    options.alias = { ...options.alias, 'cross-fetch': path.join(pkgRoot, 'src', 'packaging', 'fetch.ts') }
    options.logOverride = { ...options.logOverride, 'direct-eval': 'error' }
  },
}
