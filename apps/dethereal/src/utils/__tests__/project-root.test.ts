/**
 * Project root resolution: which directory model paths are confined to, whichever
 * harness started the server and wherever it started it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  resolveProjectRoot,
  refusedBaseReason,
  initProjectRoot,
  getProjectRoot,
  resetProjectRoot,
  type ProtectedHome,
} from '../project-root.js'

const uid = process.getuid?.() ?? null

describe('resolveProjectRoot', () => {
  let tmp: string
  let home: string
  let homes: ProtectedHome[]

  /** Create `rel` (a directory) under the scratch dir and return its real path. */
  const dir = (rel: string): string => {
    const p = path.join(tmp, rel)
    fs.mkdirSync(p, { recursive: true })
    return fs.realpathSync.native(p)
  }
  const resolve = (cwd: string, env: NodeJS.ProcessEnv = {}) => resolveProjectRoot({ cwd, env, homes, uid })

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-root-')))
    home = dir('home/user')
    homes = [{ dir: home, ancestors: true }]
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('resolves a subdirectory of a git repository to its top level', () => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    expect(resolve(dir('work/proj/src/deep'))).toEqual({ root: proj, source: 'marker' })
  })

  it('takes the nearest marker: a .dethernety directory inside a repository wins', () => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    const sub = dir('work/proj/models')
    fs.mkdirSync(path.join(sub, '.dethernety'))
    expect(resolve(dir('work/proj/models/a'))).toEqual({ root: sub, source: 'marker' })
  })

  it('counts a .git file (worktree or submodule) as a marker without reading it', () => {
    const proj = dir('work/wt')
    fs.writeFileSync(path.join(proj, '.git'), 'gitdir: /somewhere/else\n')
    expect(resolve(dir('work/wt/src'))).toEqual({ root: proj, source: 'marker' })
  })

  it('ignores a .git symlink and a .dethernety file', () => {
    const proj = dir('work/proj')
    fs.symlinkSync(dir('elsewhere'), path.join(proj, '.git'))
    fs.writeFileSync(path.join(proj, '.dethernety'), '')
    const cwd = dir('work/proj/src')
    expect(resolve(cwd)).toEqual({ root: cwd, source: 'cwd' })
  })

  it.skipIf(process.platform === 'win32')('does not block on a .git FIFO', () => {
    const proj = dir('work/fifo')
    const made = spawnSync('mkfifo', [path.join(proj, '.git')])
    if (made.status !== 0) return
    const cwd = dir('work/fifo/src')
    expect(resolve(cwd)).toEqual({ root: cwd, source: 'cwd' })
  })

  it('falls back to the working directory when there is no marker', () => {
    const cwd = dir('work/plain/sub')
    expect(resolve(cwd)).toEqual({ root: cwd, source: 'cwd' })
  })

  it('resolves a symlinked working directory to its real path', () => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    const link = path.join(tmp, 'link')
    fs.symlinkSync(dir('work/proj/src'), link)
    expect(resolve(link)).toEqual({ root: proj, source: 'marker' })
  })

  it('prefers CLAUDE_PROJECT_DIR over the walk', () => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    const claude = dir('work/proj/app')
    expect(resolve(dir('work/proj/app/src'), { CLAUDE_PROJECT_DIR: claude })).toEqual({
      root: claude,
      source: 'claude_project_dir',
    })
  })

  it.each([
    ['a literal placeholder', '${CLAUDE_PROJECT_DIR}'],
    ['a missing directory', '/nonexistent/dethereal/project'],
    ['a relative path', 'work/proj'],
  ])('ignores CLAUDE_PROJECT_DIR set to %s and walks instead', (_label, value) => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    expect(resolve(dir('work/proj/src'), { CLAUDE_PROJECT_DIR: value })).toEqual({ root: proj, source: 'marker' })
  })

  it('prefers DETHEREAL_PROJECT_ROOT over CLAUDE_PROJECT_DIR', () => {
    const explicit = dir('work/explicit')
    const claude = dir('work/claude')
    expect(
      resolve(dir('work/claude/src'), { DETHEREAL_PROJECT_ROOT: explicit, CLAUDE_PROJECT_DIR: claude })
    ).toEqual({ root: explicit, source: 'explicit' })
  })

  it.each([
    ['relative', () => 'work/explicit', /absolute/],
    ['missing', () => '/nonexistent/dethereal/explicit', /not an existing directory/],
    ['a file', (t: string) => { const f = path.join(t, 'file'); fs.writeFileSync(f, ''); return f }, /not an existing directory/],
  ])('rejects a %s DETHEREAL_PROJECT_ROOT instead of falling through', (_label, value, reason) => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    const result = resolve(dir('work/proj/src'), { DETHEREAL_PROJECT_ROOT: value(tmp) })
    expect(result.root).toBeNull()
    expect(result).toMatchObject({ reason: expect.stringMatching(reason) })
  })

  it.each([
    ['the home directory', () => home],
    ['a parent of the home directory', () => path.dirname(home)],
    ['the filesystem root', () => path.parse(tmp).root],
  ])('refuses a working directory that is %s', (_label, cwd) => {
    const result = resolve(cwd())
    expect(result.root).toBeNull()
    expect(result).toMatchObject({ reason: expect.stringMatching(/^refused: /) })
  })

  it.each([
    ['DETHEREAL_PROJECT_ROOT', 'explicit'],
    ['CLAUDE_PROJECT_DIR', 'claude'],
  ])('refuses %s set to the home directory, with no fall-through', (name) => {
    const proj = dir('work/proj')
    fs.mkdirSync(path.join(proj, '.git'))
    const result = resolve(dir('work/proj/src'), { [name]: home })
    expect(result.root).toBeNull()
  })

  it('refuses a root at or under the session store', () => {
    const store = dir('home/user/.dethernety/sub')
    expect(resolve(store).root).toBeNull()
    expect(resolve(dir('work/x'), { DETHEREAL_PROJECT_ROOT: path.dirname(store) }).root).toBeNull()
  })

  it('never lets a marker in the home directory make it the root', () => {
    fs.mkdirSync(path.join(home, '.dethernety'), { recursive: true })
    fs.mkdirSync(path.join(home, '.git'))
    const cwd = dir('home/user/proj/sub')
    expect(resolve(cwd)).toEqual({ root: cwd, source: 'cwd' })
  })

  it('never walks above the home directory to a marker in one of its parents', () => {
    fs.mkdirSync(path.join(path.dirname(home), '.git'))
    const cwd = dir('home/user/proj/sub')
    expect(resolve(cwd)).toEqual({ root: cwd, source: 'cwd' })
  })

  it('refuses an overridden home exactly, but not the directories above it', () => {
    const sandbox = dir('work/proj/sandbox-home')
    const exact: ProtectedHome[] = [{ dir: sandbox, ancestors: false }]
    expect(resolveProjectRoot({ cwd: sandbox, env: {}, homes: exact, uid }).root).toBeNull()
    const proj = dir('work/proj')
    expect(resolveProjectRoot({ cwd: proj, env: {}, homes: exact, uid })).toEqual({ root: proj, source: 'cwd' })
  })

  it('ignores markers in directories another user owns', () => {
    const proj = dir('work/shared')
    fs.mkdirSync(path.join(proj, '.git'))
    const cwd = dir('work/shared/mine')
    // Every scratch directory belongs to us, so under a different uid none is trusted.
    expect(resolveProjectRoot({ cwd, env: {}, homes, uid: (uid ?? 0) + 4242 })).toEqual({ root: cwd, source: 'cwd' })
  })

  it.skipIf(process.platform !== 'darwin')('refuses a case variant of the home directory', () => {
    const variant = home.toUpperCase()
    if (!fs.existsSync(variant)) return // case-sensitive volume
    expect(resolve(dir('work/x'), { DETHEREAL_PROJECT_ROOT: variant }).root).toBeNull()
  })

  it('never runs git or any other program', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'project-root.ts'), 'utf8')
    expect(source).not.toMatch(/['"](node:)?child_process['"]|\bspawn(Sync)?\(|\bexec(File)?(Sync)?\(|\bfork\(/)
  })
})

describe('refusedBaseReason', () => {
  const homes: ProtectedHome[] = [{ dir: path.join(path.sep, 'home', 'user'), ancestors: true }]

  it('names the kind of directory, never the path', () => {
    for (const p of [path.sep, path.join(path.sep, 'home'), path.join(path.sep, 'home', 'user')]) {
      const reason = refusedBaseReason(p, homes)
      expect(reason).toBeTruthy()
      expect(reason).not.toContain('user')
    }
  })

  it('accepts a project inside the home directory', () => {
    expect(refusedBaseReason(path.join(path.sep, 'home', 'user', 'proj'), homes)).toBeNull()
    expect(refusedBaseReason(path.join(path.sep, 'home', 'username'), homes)).toBeNull()
  })
})

describe('initProjectRoot', () => {
  afterEach(() => resetProjectRoot())

  it('keeps the startup result for the process', () => {
    expect(getProjectRoot()).toBeUndefined()
    const result = initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: 'relative' } })
    expect(getProjectRoot()).toBe(result)
    expect(result.root).toBeNull()
  })
})
