import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { committedPackageRootFiles } from '../generator/cli.js'
import { LEGACY_ROOT_PATHS } from '../generator/targets/claude/index.js'

/**
 * What the published package holds, read from the packed file list — the only place an
 * unpublished runtime file, or a stray path Claude Code would load, is visible: in a checkout
 * every file is right there.
 *
 * The plugin root is the package root: the generated manifest and `bundles/claude/`, next to the
 * server in `dist/`. Claude Code also loads skills, commands, agents, hooks, an MCP config and
 * settings from their default root paths, on top of what the manifest names; none may ship.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * What npm never packs from the package root, and what other test files create and delete there while this one
 * runs: their model directories (`.test-*`), which path confinement keeps inside the project.
 */
const unpacked = (top: string) => top === 'node_modules' || top === '.turbo' || top.startsWith('.test-')

/**
 * The package as npm packs it, from a still copy outside the package: npm walks the whole tree it packs from, and a
 * test folder that appears or goes while it walks fails the pack. Only a copy that fails is tried again, once, with
 * the first failure printed; a pack that fails, or prints what cannot be read, fails the test.
 */
function packedFiles(): string[] {
  let first: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    const copy = mkdtempSync(path.join(os.tmpdir(), 'dethereal-pack-'))
    try {
      try {
        cpSync(pkgRoot, copy, { recursive: true, verbatimSymlinks: true, filter: (src) => !unpacked(path.relative(pkgRoot, src).split(path.sep)[0] ?? '') })
      } catch (err) {
        if (attempt === 2) throw new Error(`the package could not be copied twice; first: ${String(first)}; then: ${String(err)}`, { cause: err })
        first = err
        console.warn(`the package copy failed once (${String(err)}): copying again`)
        continue
      }
      let out: string
      try {
        out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: copy, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        throw new Error(`npm pack --dry-run failed: ${String((err as { stderr?: unknown }).stderr ?? err)}`, { cause: err })
      }
      return (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path)
    } finally {
      rmSync(copy, { recursive: true, force: true })
    }
  }
  throw new Error('unreachable')
}

const packed: string[] = packedFiles()

describe('the published package', () => {
  it('ships the generated plugin, every file of it', () => {
    const plugin = [...committedPackageRootFiles(pkgRoot).keys()]
    expect(plugin.length).toBeGreaterThan(20)
    expect(packed).toEqual(expect.arrayContaining(plugin))
  })

  it('ships the server when it is built', () => {
    if (!existsSync(path.join(pkgRoot, 'dist', 'index.js'))) return
    expect(packed).toContain('dist/index.js')
  })

  it('ships nothing Claude Code would load beside the manifest, and no legacy tree', () => {
    const stray = packed.filter((p) => [...LEGACY_ROOT_PATHS, 'docs', 'scripts'].some((legacy) => p === legacy || p.startsWith(`${legacy}/`)))
    expect(stray).toEqual([])
    expect(packed.filter((p) => p.startsWith('src/'))).toEqual(['src/utils/source-globs.v1.json'])
    // One bundle per harness, nothing else under bundles/.
    expect([...new Set(packed.filter((p) => p.startsWith('bundles/')).map((p) => p.split('/')[1]))].sort()).toEqual(['claude', 'codex', 'opencode'])
  })

  it('ships no development guide: nothing reads it at run time', () => {
    expect(packed.filter((p) => !p.includes('/'))).toEqual(['package.json'])
  })
})
