/**
 * The one place git runs.
 *
 * Git runs in repositories the server does not control, and a repository's own
 * configuration can name programs for git to run (hooks, fsmonitor, filter
 * drivers, transport helpers, ssh commands) or files for it to write (trace2). So:
 * - the git binary is resolved once to an absolute path, from absolute PATH
 *   entries outside the project, and the child gets only such entries;
 * - no shell; the process group is killed on timeout or on too much output;
 * - hooks, fsmonitor, implicit bare repositories, optional locks, and every
 *   network protocol are off on the command line, which repository configuration
 *   cannot override;
 * - the environment is built from scratch: no system config, no lazy fetch, no
 *   prompts, no trace2, and no global config when HOME is a sandbox;
 * - `openRepository` checks a repository before anything reads it: git version,
 *   work tree, top level, and a configuration preflight that neutralises every
 *   filter driver, forces repository-enabled protocols off, and refuses what cannot
 *   be made safe (a partial clone on a git without GIT_NO_LAZY_FETCH, a
 *   `core.worktree` pointing elsewhere).
 * git's own messages are never passed on: results carry exit codes and stdout.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonical, refusedBaseReason, protectedHomes, within } from './project-root.js'

/** Command-line settings no repository configuration can override. */
const GIT_FLAGS = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'safe.bareRepository=explicit',
  '-c', 'protocol.allow=never',
  ...['ext', 'ssh', 'file', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`]),
  '--no-optional-locks'
]

/** The oldest git whose flags above all exist. */
const MIN_VERSION: Version = [2, 38]
/** The first git that honours GIT_NO_LAZY_FETCH. */
const LAZY_FETCH_SWITCH: Version = [2, 45]

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_BYTES = 64 * 1024

type Version = [number, number]

export type GitRefusalCode = 'not-a-git-repo' | 'git-unavailable' | 'unsupported-repository' | 'git-failure'

export class GitRefusal extends Error {
  constructor(readonly code: GitRefusalCode, message: string) {
    super(message)
    this.name = 'GitRefusal'
  }
}

export interface GitResult {
  /** Exit code; -1 when git did not run to completion */
  code: number
  stdout: string
  /** Why git did not run to completion */
  failure?: 'timeout' | 'overflow' | 'spawn'
}

export interface GitOptions {
  /** The project root: PATH entries and git binaries under it are never used */
  projectRoot?: string
  timeoutMs?: number
  maxBytes?: number
  /** Extra configuration, passed through the environment (never split on `=`) */
  configOverrides?: [string, string][]
  /** Run outside every repository: from the filesystem root, with discovery stopped there */
  outsideRepositories?: boolean
}

/** Where git runs when it must read no repository: the filesystem root, which no user can plant a `.git` in. */
export const NEUTRAL_DIR = path.parse(process.cwd()).root

/**
 * Directories any process can write to, by real path: the temp directories. A
 * binary is never taken from one, and git never runs in one.
 */
function tempDirs(): string[] {
  const dirs = [os.tmpdir(), process.env.TMPDIR, '/tmp', '/var/tmp', '/dev/shm'].filter((d): d is string => !!d && path.isAbsolute(d))
  return [...new Set(dirs.map((d) => canonical(d)))]
}


/** Absolute PATH entries that are neither inside the project nor in a temp directory. */
export function safePathEntries(projectRoot?: string): string[] {
  const root = projectRoot ? canonical(projectRoot) : undefined
  const temps = tempDirs()
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry && path.isAbsolute(entry))
    .filter((entry) => {
      const real = canonical(entry)
      return (!root || !within(real, root)) && !temps.some((t) => within(real, t))
    })
}

const binaryCache = new Map<string, string | null>()

/**
 * An executable by file name: the first on the safe PATH entries whose real
 * path is also outside the project. A binary planted in the project is never run.
 */
export function resolveBinary(name: string, projectRoot?: string): string | null {
  const key = `${name}\0${process.env.PATH ?? ''}\0${projectRoot ?? ''}`
  if (binaryCache.has(key)) return binaryCache.get(key)!
  const root = projectRoot ? canonical(projectRoot) : undefined
  let found: string | null = null
  for (const entry of safePathEntries(projectRoot)) {
    const candidate = path.join(entry, name)
    try {
      if (!fs.statSync(candidate).isFile()) continue
      fs.accessSync(candidate, fs.constants.X_OK)
    } catch {
      continue
    }
    const real = canonical(candidate)
    if (root && within(real, root)) continue
    found = candidate
    break
  }
  binaryCache.set(key, found)
  return found
}

/** The git executable: the first on the safe PATH entries, outside the project. */
export function resolveGitBinary(projectRoot?: string): string | null {
  return resolveBinary(process.platform === 'win32' ? 'git.exe' : 'git', projectRoot)
}

/** HOME is a sandbox (inside the project, or not the account's own home): its git config is not the user's. */
function homeIsSandbox(projectRoot?: string): boolean {
  const home = os.homedir()
  if (!home) return true
  const real = canonical(home)
  if (projectRoot && within(real, canonical(projectRoot))) return true
  const account = protectedHomes().find((h) => h.ancestors)
  return !account || account.dir !== real
}

function gitEnv(options: GitOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: safePathEntries(options.projectRoot).join(path.delimiter),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_TRACE2: '0',
    GIT_TRACE2_EVENT: '0',
    GIT_TRACE2_PERF: '0'
  }
  for (const k of ['HOME', 'LANG']) if (process.env[k] !== undefined) env[k] = process.env[k]
  if (homeIsSandbox(options.projectRoot)) env.GIT_CONFIG_GLOBAL = os.devNull
  // No repository discovery above the root: a `.git` planted anywhere cannot be picked up.
  if (options.outsideRepositories) env.GIT_CEILING_DIRECTORIES = NEUTRAL_DIR
  const overrides = options.configOverrides ?? []
  if (overrides.length > 0) {
    env.GIT_CONFIG_COUNT = String(overrides.length)
    overrides.forEach(([key, value], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = key
      env[`GIT_CONFIG_VALUE_${i}`] = value
    })
  }
  return env
}

/** Run git with the hardened flags and environment. Never throws; never passes git's stderr on. */
export function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const binary = resolveGitBinary(options.projectRoot)
  if (!binary) return Promise.resolve({ code: -1, stdout: '', failure: 'spawn' })
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const detached = process.platform !== 'win32'

  return new Promise((resolve) => {
    let settled = false
    let size = 0
    const chunks: Buffer[] = []
    const child = spawn(binary, [...GIT_FLAGS, ...args], {
      cwd,
      env: gitEnv(options),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so a timeout reaches helpers git started, and no
      // controlling terminal to read from.
      detached,
      windowsHide: true
    })
    const finish = (result: GitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const killGroup = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      killGroup()
      finish({ code: -1, stdout: '', failure: 'timeout' })
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.stdout!.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        killGroup()
        finish({ code: -1, stdout: '', failure: 'overflow' })
        return
      }
      chunks.push(chunk)
    })
    child.stderr!.resume()
    child.on('error', () => finish({ code: -1, stdout: '', failure: 'spawn' }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout: Buffer.concat(chunks).toString('utf8') }))
  })
}

function atLeast(version: Version, floor: Version): boolean {
  return version[0] > floor[0] || (version[0] === floor[0] && version[1] >= floor[1])
}

/** The installed git's version, refusing one older than the flags need. */
export async function assertGitUsable(options: GitOptions = {}): Promise<Version> {
  // Outside every repository: `git version` reads none.
  const result = await runGit(NEUTRAL_DIR, ['version'], { ...options, outsideRepositories: true })
  const match = /git version (\d+)\.(\d+)/.exec(result.stdout)
  if (result.code !== 0 || !match) throw new GitRefusal('git-unavailable', 'git is not available')
  const version: Version = [Number(match[1]), Number(match[2])]
  if (!atLeast(version, MIN_VERSION)) {
    throw new GitRefusal('git-unavailable', `git ${MIN_VERSION.join('.')} or later is required`)
  }
  return version
}

/** Whether `cwd` is inside a git work tree: git must say exactly `true`. */
export async function isInsideWorkTree(cwd: string, options: GitOptions = {}): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], options)
  return result.code === 0 && result.stdout.trim() === 'true'
}

/** The full object name `rev` names as a commit, or null. */
export async function resolveCommit(cwd: string, rev: string, options: GitOptions = {}): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], options)
  const sha = result.stdout.trim()
  return result.code === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null
}

/**
 * The commit HEAD names, or null while its branch has no commit yet. HEAD is read
 * from the HEAD file itself: on a branch with no commit, `HEAD^{commit}` falls
 * back to any ref named HEAD (a tag can arrive by fetch), so a branch is resolved
 * by its full ref name, and `HEAD^{commit}` only when HEAD is detached (the HEAD
 * file then holds the object id). Throws GitRefusal.
 */
async function resolveHead(cwd: string, options: GitOptions = {}): Promise<string | null> {
  const symbolic = await runGit(cwd, ['symbolic-ref', '-q', 'HEAD'], options)
  if (symbolic.code === 1) return resolveCommit(cwd, 'HEAD', options)
  if (symbolic.code !== 0) throw new GitRefusal('git-failure', 'git could not read HEAD')
  const target = symbolic.stdout.trim()
  if (!/^refs\/[A-Za-z0-9._/-]{1,240}$/.test(target) || target.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new GitRefusal('unsupported-repository', 'HEAD names a ref that is not read')
  }
  const result = await runGit(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${target}^{commit}`], options)
  const sha = result.stdout.trim()
  return result.code === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null
}

/** Whether `sha` is an ancestor of HEAD (or HEAD itself). */
export async function isAncestor(cwd: string, sha: string, options: GitOptions = {}): Promise<boolean> {
  return (await runGit(cwd, ['merge-base', '--is-ancestor', sha, 'HEAD'], options)).code === 0
}

/** What the repository's configuration asks for that the runner must answer. */
interface ConfigPreflight {
  filterDrivers: string[]
  protocolKeys: string[]
  promisor: boolean
  worktree: boolean
}

const PREFLIGHT_KEYS = '^(filter\\.|extensions\\.partialclone$|remote\\..*\\.promisor$|core\\.worktree$|protocol\\.)'

async function preflight(cwd: string, options: GitOptions): Promise<ConfigPreflight> {
  const result = await runGit(cwd, ['config', '-z', '--name-only', '--get-regexp', PREFLIGHT_KEYS], options)
  // Exit 1 with no output: no such keys. Anything else unexpected is a failure, never "none".
  if (result.code === 1 && result.stdout === '') return { filterDrivers: [], protocolKeys: [], promisor: false, worktree: false }
  if (result.code !== 0) throw new GitRefusal('git-failure', 'git could not read the repository configuration')

  const found: ConfigPreflight = { filterDrivers: [], protocolKeys: [], promisor: false, worktree: false }
  for (const name of result.stdout.split('\0').map((n) => n.replace(/\n$/, '')).filter(Boolean)) {
    if (name.startsWith('filter.')) {
      // Driver names keep their case and may be empty or contain dots: the
      // variable is whatever follows the last dot.
      const rest = name.slice('filter.'.length)
      const dot = rest.lastIndexOf('.')
      if (dot >= 0) found.filterDrivers.push(rest.slice(0, dot))
    } else if (name === 'extensions.partialclone' || /^remote\..*\.promisor$/.test(name)) {
      found.promisor = true
    } else if (name === 'core.worktree') {
      found.worktree = true
    } else if (name.startsWith('protocol.') && name.endsWith('.allow') && name !== 'protocol.allow') {
      found.protocolKeys.push(name)
    }
  }
  found.filterDrivers = [...new Set(found.filterDrivers)]
  found.protocolKeys = [...new Set(found.protocolKeys)]
  return found
}

/** A checked repository: every command runs with the repository's programs neutralised. */
export interface GitRepository {
  readonly toplevel: string
  run(args: string[], options?: Omit<GitOptions, 'projectRoot' | 'configOverrides'>): Promise<GitResult>
  resolveCommit(rev: string): Promise<string | null>
  /** The commit HEAD names, or null while its branch has no commit yet (throws GitRefusal) */
  resolveHead(): Promise<string | null>
  isAncestor(sha: string): Promise<boolean>
}

/**
 * Check `dir` before git reads anything in it, and return a runner bound to it.
 * Throws GitRefusal.
 */
export async function openRepository(
  dir: string,
  options: { projectRoot?: string; timeoutMs?: number } = {}
): Promise<GitRepository> {
  const base: GitOptions = { projectRoot: options.projectRoot, timeoutMs: options.timeoutMs }
  const version = await assertGitUsable(base)
  if (!(await isInsideWorkTree(dir, base))) {
    throw new GitRefusal('not-a-git-repo', 'the directory is not inside a git work tree')
  }

  const config = await preflight(dir, base)
  if (config.worktree) {
    throw new GitRefusal('unsupported-repository', 'the repository sets core.worktree; it is not read')
  }
  if (config.promisor && !atLeast(version, LAZY_FETCH_SWITCH)) {
    throw new GitRefusal(
      'git-unavailable',
      `a partial clone needs git ${LAZY_FETCH_SWITCH.join('.')} or later to be read without fetching`
    )
  }
  const overrides: [string, string][] = [
    ...config.filterDrivers.flatMap((d): [string, string][] => [
      [`filter.${d}.clean`, ''],
      [`filter.${d}.smudge`, ''],
      [`filter.${d}.process`, ''],
      [`filter.${d}.required`, 'false']
    ]),
    ...config.protocolKeys.map((k): [string, string] => [k, 'never'])
  ]
  const bound: GitOptions = { ...base, configOverrides: overrides }

  const top = await runGit(dir, ['rev-parse', '--show-toplevel'], bound)
  if (top.code !== 0 || !top.stdout.trim()) throw new GitRefusal('git-failure', 'git could not find the top level')
  const toplevel = canonical(top.stdout.trim())
  if (refusedBaseReason(toplevel)) {
    throw new GitRefusal('unsupported-repository', 'the repository spans the home directory or a parent of it')
  }

  return {
    toplevel,
    run: (args, runOptions = {}) => runGit(dir, args, { ...bound, ...runOptions }),
    resolveCommit: (rev) => resolveCommit(dir, rev, bound),
    resolveHead: () => resolveHead(dir, bound),
    isAncestor: (sha) => isAncestor(dir, sha, bound)
  }
}
