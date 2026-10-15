import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PACKAGE_VERSION } from '../version.js'

describe('PACKAGE_VERSION', () => {
  it('is the version in package.json, which the MCP server reports as its own', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(PACKAGE_VERSION).toBe(pkg.version)
  })
})
