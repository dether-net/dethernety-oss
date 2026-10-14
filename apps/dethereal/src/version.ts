import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@dether.net/dethereal'

/**
 * This package's version, from the nearest package.json above this module that names the package: its root from
 * src/, from the bundled dist/index.js (package.json ships in the published package), and from a test bundle built
 * elsewhere under the package. 'unknown' when there is none.
 */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string }
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version
    } catch {
      // No package.json here, or not readable: look one level up.
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'unknown'
}

export const PACKAGE_VERSION: string = readPackageVersion()
