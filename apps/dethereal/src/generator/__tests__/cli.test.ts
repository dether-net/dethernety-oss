import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_WORKFLOW, main, MARKER, writeScratchRoot, writeTree } from '../cli.js'

const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'generator-cli-')))
afterAll(() => rmSync(base, { recursive: true, force: true }))

let n = 0
/** A fresh directory layout per test: a fake repo, a fake home, an entry file, and room outside. */
function layout() {
  const root = path.join(base, String(n++))
  const dirs = { repo: path.join(root, 'repo'), home: path.join(root, 'home'), outside: path.join(root, 'outside') }
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
  const entry = path.join(dirs.outside, 'index.js')
  writeFileSync(entry, '')
  return { ...dirs, entry }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('scratch roots', () => {
  it('writes the bundle and its marker, and replaces a root it wrote before', () => {
    const l = layout()
    const out = path.join(l.outside, 'root')
    const opts = { harness: 'claude' as const, workflow: FIXTURE_WORKFLOW, out, repo: l.repo, home: l.home }
    expect(writeScratchRoot(opts)).toBeGreaterThan(5)
    expect(readFileSync(path.join(out, MARKER), 'utf8')).toBe('claude\n')
    expect(existsSync(path.join(out, '.claude-plugin', 'plugin.json'))).toBe(true)
    writeFileSync(path.join(out, 'stale.txt'), 'x')
    writeScratchRoot(opts)
    expect(existsSync(path.join(out, 'stale.txt'))).toBe(false)
  })

  it('points the MCP server at the given build under the sandbox HOME', () => {
    const l = layout()
    const out = path.join(l.outside, 'root')
    const sandbox = path.join(l.outside, 'sandbox')
    writeScratchRoot({ harness: 'claude', workflow: FIXTURE_WORKFLOW, out, mcpEntry: l.entry, sandboxHome: sandbox, url: 'http://127.0.0.1:9', repo: l.repo, home: l.home })
    const server = JSON.parse(readFileSync(path.join(out, 'bundles/claude/.mcp.json'), 'utf8')).mcpServers.dethereal
    expect(server.command).toBe(process.execPath)
    expect(server.args).toEqual([l.entry])
    expect(server.env).toMatchObject({ HOME: sandbox, DETHERNETY_URL: 'http://127.0.0.1:9' })
    expect(existsSync(sandbox)).toBe(true)
  })

  it.each([
    ['a non-empty directory it did not create', (l: ReturnType<typeof layout>) => {
      const out = path.join(l.outside, 'mine')
      mkdirSync(out)
      writeFileSync(path.join(out, 'keep.txt'), 'x')
      return { out }
    }, 'is not empty and was not created by this command'],
    ['an out directory inside the repository', (l: ReturnType<typeof layout>) => ({ out: path.join(l.repo, 'root') }), '--out must be outside the repository'],
    ['a sandbox that is the home directory', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: l.entry, sandboxHome: l.home }), 'must not be your home directory'],
    ['a sandbox above the home directory', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: l.entry, sandboxHome: path.dirname(l.home) }), 'must not be your home directory'],
    ['a sandbox inside the repository', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: l.entry, sandboxHome: path.join(l.repo, 's') }), 'must be outside the repository'],
    ['overlapping out and sandbox', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: l.entry, sandboxHome: path.join(l.outside, 'r', 's') }), 'must not overlap'],
    ['an entry without a sandbox', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: l.entry }), 'go together'],
    ['a URL without an entry', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), url: 'http://x' }), '--url needs --mcp-entry'],
    ['a missing entry', (l: ReturnType<typeof layout>) => ({ out: path.join(l.outside, 'r'), mcpEntry: path.join(l.outside, 'none.js'), sandboxHome: path.join(l.outside, 's') }), 'does not exist'],
  ])('refuses %s', (_, make, message) => {
    const l = layout()
    expect(() => writeScratchRoot({ harness: 'claude', workflow: FIXTURE_WORKFLOW, repo: l.repo, home: l.home, ...make(l) })).toThrow(message)
  })

  it('never writes a path outside the target directory', () => {
    const l = layout()
    for (const bad of ['../escape.txt', '/abs.txt', 'a/../../escape.txt']) {
      expect(() => writeTree(l.outside, new Map([[bad, 'x']]))).toThrow('refusing to write outside')
    }
  })
})

describe('main', () => {
  it('exits 2 on usage errors', () => {
    expect(main(['--harness', 'gemini', '--workflow', 'w', '--out', 'o'])).toBe(2)
    expect(main(['--frob'])).toBe(2)
    expect(main(['--harness'])).toBe(2)
    expect(main(['--harness', 'claude'])).toBe(2)
    expect(main(['--update-goldens', '--harness', 'claude'])).toBe(2)
  })

  it('exits 1 when generation fails', () => {
    const l = layout()
    const workflow = path.join(l.outside, 'wf')
    mkdirSync(path.join(workflow, 'skills', 'x'), { recursive: true })
    writeFileSync(path.join(workflow, 'skills', 'x', 'SKILL.md'), 'no frontmatter\n')
    expect(main(['--harness', 'claude', '--workflow', workflow, '--out', path.join(l.outside, 'r')])).toBe(1)
  })
})
