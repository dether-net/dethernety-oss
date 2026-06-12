import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Drift guard: the .mcp.json npx invocation must pin the exact package
 * version that ships alongside the skills/agents/hooks. An unpinned (or
 * stale-pinned) invocation resolves whatever the registry serves, so users
 * run an MCP server out of sync with the plugin's instructions — the exact
 * skew this repo shipped when the registry was versions behind the plugin.
 * Bumping package.json without updating the pin fails this test.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('.mcp.json version pin', () => {
  it('pins the npx package to the exact package.json version', () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'))
    const mcp = JSON.parse(readFileSync(path.join(pkgRoot, '.mcp.json'), 'utf-8'))

    const server = mcp.mcpServers?.dethereal
    expect(server).toBeDefined()
    expect(server.command).toBe('npx')
    expect(server.args).toEqual([`@dether.net/dethereal@${pkg.version}`])
  })
})
