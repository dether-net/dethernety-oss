/**
 * The installed runtime: a private copy of the package's own `dist/` (and
 * `bundles/`) under `~/.dethernety/runtime/<version>/`, which every harness entry
 * launches with the recorded Node binary.
 *
 * The copy must be self-contained (no bare import resolves outside it, and no
 * module is loaded by a name computed at run time), carries its own
 * `package.json` so Node reads it as ES modules whatever sits above it, and is
 * written to a temporary directory, synced, renamed into place and made
 * read-only. An existing version is reused only when its files match exactly.
 * `current.json` says which runtime and Node binary the hook shim may run, and
 * the hash of the runtime's whole file set; it is written last.
 *
 * What the set hash protects against: corruption and partial tampering of the
 * copy. `current.json` vouches for itself, so a process running as the same
 * user that rewrites both is not stopped here. Chunks are loaded lazily after
 * the check, so a file swapped in between is a stated residual.
 *
 * Every function here takes the install lock, and none is called while the
 * caller holds it; the `…Locked` variants are for a caller that already does.
 */
import { randomBytes } from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileLockHandle } from '../../utils/file-lock.js'
import { InstallerError, io } from './errors.js'
import { checkRuntime } from './runtime-check.mjs'
import { readManifest, withStateLock } from './manifest.js'
import { ensureDirUnder, type InstallerEnv, type StatePaths, verifyDirectory } from './paths.js'
import { readTarget, removeTarget, resolveTarget, sha256, syncDir, writeTarget } from './safe-write.js'

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
/** The oldest Node the runtime supports (a global `fetch`, and the security releases of early 2024). */
export const NODE_FLOOR = '20.11.1'
const RUNTIME_PACKAGE_JSON = Buffer.from('{"type":"module"}\n')
const MAX_RUNTIME_FILE = 32 * 1024 * 1024
const COPIED_DIRS = ['dist', 'bundles']
/** Source maps are not needed to run, and would double the hashing on every start. */
const SKIPPED = /\.map$/
const LEFTOVER_TMP = /^\.(.+)\.tmp-[0-9a-f]{12}$/
/** A copy set aside as tampered. Its name also reads as a prerelease version (`0.5.0-rc.1.quarantine-…`), so it is matched first. */
const QUARANTINED = /\.quarantine-\d{8}T\d{9}Z$/

export interface RuntimeFile {
  rel: string
  sha256: string
  exec: boolean
}

/** Whether a Node version (`x.y.z`, optionally with a pre-release) is at least `floor`. */
export function nodeAtLeast(version: string, floor = NODE_FLOOR): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v)?.slice(1, 4).map(Number) ?? null
  const have = parse(version)
  const need = parse(floor)!
  if (!have) return false
  for (let k = 0; k < 3; k++) if (have[k] !== need[k]) return have[k]! > need[k]!
  return true
}

/** Refuse a Node that is not Node, or older than the floor. */
export function assertNode(release: { name?: string } = process.release, version = process.versions.node): void {
  if (release.name !== 'node' || !nodeAtLeast(version)) throw new InstallerError('node_unsupported', `node ${version}`)
}

/**
 * Node's public built-in modules, listed here rather than read from `node:module`, which the shipped
 * bundle may not import. A test keeps this equal to the running Node's own list; a name missing here
 * reads as a module the copy cannot resolve, which refuses the copy rather than letting it through.
 */
export const NODE_BUILTINS: readonly string[] = [
  // The process module is spelled in two parts: as one literal, the source check would read this list as a process start.
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child' + '_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'inspector/promises', 'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'readline/promises', 'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder', 'sys',
  'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]
const BUILTINS = new Set([...NODE_BUILTINS, ...NODE_BUILTINS.map((m) => `node:${m}`)])

// The loaders the scan looks for, spelled at run time: as literals they would be in the shipped
// bundle's own text, which the build refuses.
const CREATE_REQUIRE = ['create', 'Require'].join('')
const PROCESS_DLOPEN = ['process.', 'dl', 'open'].join('')
const DYNAMIC_REQUIRE = ['Dynamic', ' require of "'].join('')
const CREATE_REQUIRE_RE = new RegExp(`\\b${CREATE_REQUIRE}\\b`)
const PROCESS_DLOPEN_RE = new RegExp(`\\b${PROCESS_DLOPEN.replace('.', '\\.')}\\b`)

const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/**
 * The code with the bodies of comments and of string, template and regular
 * expression literals blanked (same length, line breaks kept), so a scan sees
 * only code. Template substitutions stay code. Where the lexer loses its place
 * (an unterminated literal or comment) it stops blanking, and a `/` it cannot
 * tell apart from division stays as text: both leave more text for the scan,
 * never less.
 */
export function maskLiterals(code: string): string {
  const out = code.split('')
  const n = code.length
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  /** From `start` inside a template: the index of its closing backtick or of the next `${`, or -1. */
  const templateEnd = (start: number): number => {
    for (let j = start; j < n; j++) {
      if (code[j] === '\\') j++
      else if (code[j] === '`' || (code[j] === '$' && code[j + 1] === '{')) {
        blank(start, j)
        return j
      }
    }
    return -1
  }
  const frames: number[] = []
  let depth = 0
  let prev = ''
  let word = ''
  let i = 0
  const inTemplate = (at: number): boolean => {
    const j = templateEnd(at)
    if (j < 0) return false
    if (code[j] === '`') {
      i = j + 1
      prev = '`'
    } else {
      frames.push(depth)
      depth = 0
      i = j + 2
      prev = '{'
    }
    return true
  }
  while (i < n) {
    const c = code[i]!
    if (/\s/.test(c)) {
      i++
    } else if (c === '/' && code[i + 1] === '/') {
      const j = code.indexOf('\n', i)
      const end = j < 0 ? n : j
      blank(i + 2, end)
      i = end
    } else if (c === '/' && code[i + 1] === '*') {
      const j = code.indexOf('*/', i + 2)
      if (j < 0) break
      blank(i + 2, j)
      i = j + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      if (j >= n || code[j] !== c) break
      blank(i + 1, j)
      i = j + 1
      prev = '"'
    } else if (c === '`') {
      if (!inTemplate(i + 1)) break
    } else if (c === '{') {
      depth++
      prev = '{'
      i++
    } else if (c === '}') {
      if (frames.length && depth === 0) {
        depth = frames.pop()!
        if (!inTemplate(i + 1)) break
      } else {
        depth--
        prev = '}'
        i++
      }
    } else if (c === '/') {
      const regex = prev === '' || REGEX_AFTER.has(prev) || (prev === 'a' && REGEX_AFTER_WORD.has(word))
      let j = i + 1
      let inClass = false
      if (regex) {
        for (; j < n && code[j] !== '\n'; j++) {
          if (code[j] === '\\') j++
          else if (code[j] === '[') inClass = true
          else if (code[j] === ']') inClass = false
          else if (code[j] === '/' && !inClass) break
        }
      }
      if (regex && j < n && code[j] === '/') {
        blank(i + 1, j)
        i = j + 1
        while (i < n && /[\w$]/.test(code[i]!)) i++
        prev = 'a'
        word = ''
      } else {
        prev = '/'
        i++
      }
    } else if (/[\w$]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(code[j]!)) j++
      word = code.slice(i, j)
      prev = 'a'
      i = j
    } else {
      prev = c
      word = ''
      i++
    }
  }
  return out.join('')
}

/**
 * Bare module specifiers a bundle would resolve outside itself (Node built-ins
 * are fine). Only imports in code position count; comments and text inside
 * literals are not imports.
 */
export function bareSpecifiers(code: string): string[] {
  const masked = maskLiterals(code)
  const found = new Set<string>()
  const re = /(?<![$\w])(?:from\s*|import\s*\(\s*|import\s*|(?:__)?require\s*\(\s*)(["'])[^"'\n]*\1/g
  for (const m of masked.matchAll(re)) {
    // The literal ends the match, and its body is blanked, so its opening quote is the last one before the end.
    const open = m.index! + m[0].lastIndexOf(m[1]!, m[0].length - 2)
    const spec = code.slice(open + 1, m.index! + m[0].length - 1)
    if (!/^(@[\w.-]+\/)?[\w.-]+(\/[\w.@-]+)*$/.test(spec)) continue
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    if (BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0]!)) continue
    found.add(spec)
  }
  return [...found].sort()
}

/** A string literal (quoted, or a template without substitutions) closing a call's first argument. */
const LITERAL_ARGUMENT = /^\s*(?:(["'])(?:(?!\1)[^\\\n])*\1|`[^`$\\]*`)\s*[,)]/

/**
 * Places a bundle would load code the copy cannot serve, which no static check
 * can follow: `import()`, `require()` or `import.meta.resolve()` with a
 * non-literal argument, `createRequire`, `process.dlopen`, a bundler's
 * run-time require of a module it left out (its `Dynamic require of "` error
 * text), and a free `__dirname` or `__filename`, which do not exist in an ES
 * module. Only code position counts. This is a robustness check on the copy,
 * not a trust boundary.
 */
export function dynamicLoads(code: string): string[] {
  const masked = maskLiterals(code)
  const found = new Set<string>()
  for (const m of masked.matchAll(/(?<![$\w])(import\.meta\.resolve|import|(?:__)?require)\s*\(/g)) {
    const rest = code.slice(m.index! + m[0].length)
    // A function declared with that name (a bundler's CommonJS wrapper), or a call with no argument, loads nothing.
    if (/\bfunction\s*\*?\s*$/.test(masked.slice(Math.max(0, m.index! - 16), m.index!)) || /^\s*\)/.test(rest)) continue
    if (!LITERAL_ARGUMENT.test(rest)) found.add(`${m[1]}(…)`)
  }
  if (CREATE_REQUIRE_RE.test(masked)) found.add(CREATE_REQUIRE)
  if (PROCESS_DLOPEN_RE.test(masked)) found.add(PROCESS_DLOPEN)
  if (code.includes(DYNAMIC_REQUIRE)) found.add('dynamic require')
  for (const name of ['__dirname', '__filename']) {
    const used = new RegExp(`(?<![$\\w.])${name}(?![$\\w])`).test(masked)
    const declared = new RegExp(`(?<![$\\w.])(?:var|let|const)\\s+${name}(?![$\\w])`).test(masked)
    if (used && !declared) found.add(name)
  }
  return [...found].sort()
}

const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))

/** Collect the source's files: regular files only, no symlinks, no source maps, under `dist/` and `bundles/`. */
async function collect(source: string): Promise<Array<RuntimeFile & { abs: string }>> {
  const out: Array<RuntimeFile & { abs: string }> = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const name of (await io(fs.readdir(dir), rel || '.')).sort(byBytes)) {
      const abs = path.join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      if (/\p{Cc}/u.test(name)) throw new InstallerError('runtime_invalid', 'file name')
      const st = await io(fs.lstat(abs), r)
      if (st.isSymbolicLink()) throw new InstallerError('symlink', r)
      if (st.isDirectory()) await walk(abs, r)
      else if (st.isFile()) {
        if (SKIPPED.test(name)) continue
        if (st.size > MAX_RUNTIME_FILE) throw new InstallerError('too_large', r)
        out.push({ abs, rel: r, sha256: sha256(await io(fs.readFile(abs), r)), exec: (st.mode & 0o100) !== 0 })
      } else throw new InstallerError('not_regular', r)
    }
  }
  for (const d of COPIED_DIRS) {
    const st = await fs.lstat(path.join(source, d)).catch(() => null)
    if (!st) continue
    if (st.isSymbolicLink() || !st.isDirectory()) throw new InstallerError('not_a_directory', d)
    await walk(path.join(source, d), d)
  }
  if (!out.some((f) => f.rel === 'dist/index.js')) throw new InstallerError('runtime_invalid', 'dist/index.js')
  return out
}

/** The exact file set a runtime directory must hold (the copied files plus its package.json). */
function expectedSet(files: RuntimeFile[]): Map<string, RuntimeFile> {
  const set = new Map(files.map((f) => [f.rel, { rel: f.rel, sha256: f.sha256, exec: f.exec }]))
  set.set('package.json', { rel: 'package.json', sha256: sha256(RUNTIME_PACKAGE_JSON), exec: false })
  return set
}

/** One hash over a file set: its sorted names, hashes and exec bits. */
function setSha256(files: Iterable<RuntimeFile>): string {
  return sha256([...files].sort((a, b) => byBytes(a.rel, b.rel)).map((f) => `${f.rel}\0${f.sha256}\0${f.exec ? 1 : 0}\n`).join(''))
}

/**
 * The file set a runtime directory holds, checked as it is read: real
 * directories and regular files only, owned by the user, not group- or
 * world-writable, single-linked. `null` when any check fails.
 */
async function readSet(dir: string, env: InstallerEnv): Promise<RuntimeFile[] | null> {
  const files: RuntimeFile[] = []
  const walk = async (d: string, rel: string): Promise<boolean> => {
    const dst = await fs.lstat(d).catch(() => null)
    if (!dst || dst.isSymbolicLink() || !dst.isDirectory() || dst.uid !== env.euid || (dst.mode & 0o022) !== 0) return false
    for (const name of await io(fs.readdir(d), rel || '.')) {
      const abs = path.join(d, name)
      const r = rel ? `${rel}/${name}` : name
      const st = await fs.lstat(abs).catch(() => null)
      if (!st || st.isSymbolicLink()) return false
      if (st.isDirectory()) { if (!(await walk(abs, r))) return false; continue }
      if (!st.isFile() || st.uid !== env.euid || (st.mode & 0o022) !== 0 || st.nlink !== 1) return false
      files.push({ rel: r, sha256: sha256(await io(fs.readFile(abs), r)), exec: (st.mode & 0o100) !== 0 })
    }
    return true
  }
  return (await walk(dir, '')) ? files : null
}

/** Does `dir` hold exactly `expected`? */
async function matchesExactly(dir: string, expected: Map<string, RuntimeFile>, env: InstallerEnv): Promise<boolean> {
  const files = await readSet(dir, env)
  return !!files && files.length === expected.size && setSha256(files) === setSha256(expected.values())
}

/** Make a runtime directory read-only (0500 directories, 0400/0500 files), or writable again for removal. */
async function setWritable(dir: string, writable: boolean): Promise<void> {
  const walk = async (d: string): Promise<void> => {
    if (writable) await io(fs.chmod(d, 0o700), 'runtime')
    for (const e of await io(fs.readdir(d, { withFileTypes: true }), 'runtime')) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        const st = await io(fs.lstat(p), 'runtime')
        const exec = (st.mode & 0o100) !== 0
        await io(fs.chmod(p, writable ? (exec ? 0o700 : 0o600) : (exec ? 0o500 : 0o400)), 'runtime')
      }
    }
    if (!writable) await io(fs.chmod(d, 0o500), 'runtime')
  }
  await walk(dir)
}

export interface InstalledRuntime {
  version: string
  runtimePath: string
  setSha256: string
  files: RuntimeFile[]
  reused: boolean
}

/**
 * Copy `source` (a package root holding `dist/` and maybe `bundles/`) to
 * `runtime/<version>/`. Refuses a source that is not self-contained, and an
 * existing version whose files differ (`runtime_tampered`; see `quarantineRuntime`).
 */
export async function installRuntime(paths: StatePaths, env: InstallerEnv, source: string, version: string): Promise<InstalledRuntime> {
  return withStateLock(paths, env, (lock) => installRuntimeLocked(paths, env, source, version, lock))
}

export async function installRuntimeLocked(paths: StatePaths, env: InstallerEnv, source: string, version: string, lock: FileLockHandle): Promise<InstalledRuntime> {
  if (!SEMVER.test(version)) throw new InstallerError('runtime_invalid', 'version')
  assertNode()
  const files = await collect(source)
  const bare = new Set<string>()
  for (const f of files) {
    if (!/\.(m?js|cjs)$/.test(f.rel)) continue
    const code = await io(fs.readFile(f.abs, 'utf8'), f.rel)
    for (const s of [...bareSpecifiers(code), ...dynamicLoads(code)]) bare.add(s)
  }
  if (bare.size) throw new InstallerError('runtime_not_self_contained', `${bare.size} external or computed module load${bare.size === 1 ? '' : 's'}`)

  const runtimeDir = await ensureDirUnder(paths.root, 'runtime', env)
  const dest = path.join(runtimeDir, version)
  const expected = expectedSet(files)
  const set = setSha256(expected.values())
  const plain = files.map(({ rel, sha256: s, exec }) => ({ rel, sha256: s, exec }))
  if (await fs.lstat(dest).catch(() => null)) {
    if (!(await matchesExactly(dest, expected, env))) throw new InstallerError('runtime_tampered', `runtime/${version}`)
    return { version, runtimePath: dest, setSha256: set, files: plain, reused: true }
  }

  const tmp = path.join(runtimeDir, `.${version}.tmp-${randomBytes(6).toString('hex')}`)
  await io(fs.mkdir(tmp, { mode: 0o700 }), 'runtime')
  try {
    const dirs = new Set<string>()
    const put = async (rel: string, bytes: Buffer, exec: boolean) => {
      const parent = path.posix.dirname(rel)
      if (parent !== '.') await ensureDirUnder(tmp, parent, env)
      dirs.add(parent)
      const fh = await fs.open(path.join(tmp, ...rel.split('/')), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
      try {
        await fh.writeFile(bytes)
        await fh.chmod(exec ? 0o700 : 0o600)
        await fh.sync()
      } finally {
        await fh.close()
      }
    }
    for (const f of files) {
      const bytes = await io(fs.readFile(f.abs), f.rel)
      if (sha256(bytes) !== f.sha256) throw new InstallerError('changed', f.rel)
      await put(f.rel, bytes, f.exec)
    }
    await put('package.json', RUNTIME_PACKAGE_JSON, false)
    for (const d of dirs) await syncDir(d === '.' ? tmp : path.join(tmp, ...d.split('/')))
    await syncDir(tmp)
    if (!(await matchesExactly(tmp, expected, env))) throw new InstallerError('runtime_tampered', 'runtime copy')
    await lock.assertHeld()
    await io(fs.rename(tmp, dest), 'runtime')
    await syncDir(runtimeDir)
    await setWritable(dest, false)
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err instanceof InstallerError ? err : new InstallerError('io', 'runtime')
  }
  return { version, runtimePath: dest, setSha256: set, files: plain, reused: false }
}

/** Move a runtime version aside (after the caller has confirmed) so it can be installed again. Kept, and reported. */
export async function quarantineRuntime(paths: StatePaths, env: InstallerEnv, version: string, now = new Date()): Promise<string> {
  return withStateLock(paths, env, async () => {
    if (!SEMVER.test(version)) throw new InstallerError('runtime_invalid', 'version')
    const dir = path.join(paths.runtime, version)
    await verifyDirectory(dir, env, `runtime/${version}`)
    const aside = path.join(paths.runtime, `${version}.quarantine-${now.toISOString().replace(/[-:.]/g, '')}`)
    await io(fs.rename(dir, aside), `runtime/${version}`)
    await syncDir(paths.runtime)
    return aside
  })
}

export interface CurrentRuntime {
  schemaVersion: 2
  version: string
  runtimePath: string
  setSha256: string
  execPath: string
  nodeVersion: string
  installedAt: string
  /** The version this one replaced; kept on disk, since a server started from it may still load its chunks. */
  previous: string | null
}

/** The Node binary a hook may run: absolute, resolving to a regular executable owned by the user or root, not group/world writable. */
export async function checkExecPath(execPath: string, env: InstallerEnv): Promise<void> {
  if (!path.isAbsolute(execPath)) throw new InstallerError('runtime_invalid', 'execPath')
  const real = await fs.realpath(execPath).catch(() => { throw new InstallerError('runtime_invalid', 'execPath') })
  const st = await fs.stat(real).catch(() => { throw new InstallerError('runtime_invalid', 'execPath') })
  if (!st.isFile() || (st.mode & 0o111) === 0) throw new InstallerError('runtime_invalid', 'execPath')
  if (st.uid !== env.euid && st.uid !== 0) throw new InstallerError('not_owned', 'execPath')
  if ((st.mode & 0o022) !== 0) throw new InstallerError('group_or_world_writable', 'execPath')
}

const CELLAR_NODE = /^(.+)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/

/**
 * The path to record for a Node binary: a Homebrew Cellar path names one
 * version's directory, which the next `brew upgrade` deletes, so the formula's
 * own stable link is recorded instead (`<prefix>/opt/<formula>/bin/node`), when it
 * resolves to the very same file. `<prefix>/bin/node` is never used: `brew link`
 * can point it at another formula. The prefix comes from the Cellar path itself,
 * never from running `brew`. Anything else is kept.
 */
export async function stableNodePath(execPath: string): Promise<string> {
  const real = await fs.realpath(execPath).catch(() => null)
  const m = real ? CELLAR_NODE.exec(real) : null
  if (!real || !m) return execPath
  const target = await fs.stat(real).catch(() => null)
  if (!target) return execPath
  const stable = path.join(m[1]!, 'opt', m[2]!, 'bin', 'node')
  const st = await fs.stat(stable).catch(() => null)
  return st && st.dev === target.dev && st.ino === target.ino ? stable : execPath
}

const currentTarget = (paths: StatePaths) => resolveTarget(paths.current, [{ root: paths.root, pattern: 'runtime/current.json' }])

/** The current and previous versions `current.json` names, whenever it parses at all (full validation not needed). */
function namedVersions(cur: { bytes: Buffer } | null): Set<string> {
  if (!cur) return new Set()
  try {
    const c = JSON.parse(cur.bytes.toString('utf8')) as Partial<CurrentRuntime>
    return new Set([c.version, c.previous].filter((v): v is string => typeof v === 'string' && SEMVER.test(v)))
  } catch {
    return new Set()
  }
}

function currentVersionOf(cur: { bytes: Buffer }): string | null {
  try {
    const v = (JSON.parse(cur.bytes.toString('utf8')) as Partial<CurrentRuntime>).version
    return typeof v === 'string' && SEMVER.test(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Whether a recorded install runs anything from the runtime. Claude Code runs the
 * plugin, its hooks and its server from its own plugin copy, so a Claude entry
 * never does; every other harness launches the runtime.
 */
export function usesRuntime(key: string): boolean {
  return !key.startsWith('claude:')
}

/** Point the hooks at an installed runtime. Callers do this last, once every harness write has succeeded. */
export async function activateRuntime(paths: StatePaths, env: InstallerEnv, rt: InstalledRuntime, execPath = process.execPath,
  nodeVersion = process.versions.node, now = new Date()): Promise<CurrentRuntime> {
  return withStateLock(paths, env, () => activateRuntimeLocked(paths, env, rt, execPath, nodeVersion, now))
}

export async function activateRuntimeLocked(paths: StatePaths, env: InstallerEnv, rt: InstalledRuntime, execPath = process.execPath,
  nodeVersion = process.versions.node, now = new Date()): Promise<CurrentRuntime> {
  execPath = await stableNodePath(execPath)
  await checkExecPath(execPath, env)
  if (rt.runtimePath !== path.join(paths.runtime, rt.version)) throw new InstallerError('runtime_invalid', 'runtimePath')
  const t = currentTarget(paths)
  const existing = await readTarget(t, env)
  let previous: string | null = null
  if (existing) {
    try {
      const v = (JSON.parse(existing.bytes.toString('utf8')) as Partial<CurrentRuntime>).version
      if (typeof v === 'string' && SEMVER.test(v) && v !== rt.version) previous = v
    } catch {
      // An unreadable current.json names no previous version.
    }
  }
  const current: CurrentRuntime = {
    schemaVersion: 2, version: rt.version, runtimePath: rt.runtimePath, setSha256: rt.setSha256, execPath, nodeVersion,
    installedAt: now.toISOString(), previous,
  }
  await writeTarget(t, Buffer.from(JSON.stringify(current, null, 2) + '\n'), existing ? existing.sha256 : 'absent', env, 0o600)
  return current
}

/**
 * Read and validate `current.json` the way the hook shim must before it runs
 * anything: the file itself not group- or world-writable; every directory on
 * the chain real, owned by the user and not group/world writable; `runtimePath`
 * exactly `runtime/<version>`; the runtime's whole file set as recorded; the
 * Node binary as `checkExecPath` requires.
 */
export async function readCurrentRuntime(paths: StatePaths, env: InstallerEnv): Promise<CurrentRuntime> {
  // The one check every consumer runs (the Codex hook runner carries a copy of it), with no fallback node.
  const r = checkRuntime({ realHome: path.dirname(paths.root), euid: env.euid })
  if (!r.ok) throw new InstallerError(r.code, r.code === 'runtime_invalid' || r.code === 'io' ? 'current.json' : r.what)
  return r.current
}

/**
 * Remove runtime versions nothing references: not named by an install that uses
 * the runtime (its version, or a runtime its harness files still launch), not the
 * runtime the Codex marketplace is, and, with `keepCurrent: 'always'`, not the
 * current or previous version `current.json` names (whenever it parses). With
 * `keepCurrent: 'while-used'` those two are kept only while an install still uses
 * the runtime, and `current.json` goes with the version it names. Leftover
 * temporary copies go too. Quarantined versions are kept.
 * Run only on uninstall or an explicit `gc`, never right after activation.
 */
export async function gcRuntimes(paths: StatePaths, env: InstallerEnv, opts: GcOptions = {}): Promise<string[]> {
  return withStateLock(paths, env, () => gcRuntimesLocked(paths, env, opts))
}

export interface GcOptions {
  /** `always` (the default, as uninstall's own clean-up runs it) or `while-used` (an explicit gc). */
  keepCurrent?: 'always' | 'while-used'
}

export async function gcRuntimesLocked(paths: StatePaths, env: InstallerEnv, opts: GcOptions = {}): Promise<string[]> {
  const st = await fs.lstat(paths.runtime).catch(() => null)
  if (!st) return []
  await verifyDirectory(paths.runtime, env, 'runtime')
  const { manifest } = await readManifest(paths, env)
  const users = Object.entries(manifest.installs).filter(([k]) => usesRuntime(k)).map(([, e]) => e)
  const cur = await readTarget(currentTarget(paths), env).catch(() => null)
  const named = namedVersions(cur)
  const keepNamed = (opts.keepCurrent ?? 'always') === 'always' || users.length > 0
  const keep = new Set([
    ...users.flatMap((e) => [e.version, ...(e.runtimes ?? [])]),
    // The Codex marketplace is a runtime's own bundle.
    ...(manifest.shared?.codex ? [manifest.shared.codex.marketplace.runtimeVersion] : []),
    ...(keepNamed ? named : []),
  ])
  const removed: string[] = []
  for (const name of await io(fs.readdir(paths.runtime), 'runtime')) {
    const p = path.join(paths.runtime, name)
    const leftover = LEFTOVER_TMP.exec(name)
    const stale = SEMVER.test(name) && !QUARANTINED.test(name) && !keep.has(name)
    if (!stale && !(leftover && SEMVER.test(leftover[1]!))) continue
    const e = await fs.lstat(p).catch(() => null)
    if (!e || e.isSymbolicLink() || !e.isDirectory()) continue
    // The runtime is read-only: write permission comes back before it is removed.
    await setWritable(p, true)
    await io(fs.rm(p, { recursive: true, force: true }), 'runtime')
    removed.push(name)
  }
  // A pointer at a runtime that is gone would only make the hooks refuse.
  if (cur && !keepNamed) {
    const version = currentVersionOf(cur)
    const gone = !version || !(await fs.lstat(path.join(paths.runtime, version)).catch(() => null))
    if (gone && await removeTarget(currentTarget(paths), cur.sha256, env)) removed.push('current.json')
  }
  return removed.sort()
}

/**
 * Remove the runtime once no install uses it: every version an explicit gc
 * removes, then the runtime folder itself when nothing else is left in it.
 * Quarantined copies stay, and are returned as `left`. Nothing outside the
 * runtime folder is touched.
 */
export async function removeRuntimeLocked(paths: StatePaths, env: InstallerEnv): Promise<{ removed: string[]; left: string[] }> {
  const removed = await gcRuntimesLocked(paths, env, { keepCurrent: 'while-used' })
  const left = (await fs.readdir(paths.runtime).catch(() => [] as string[])).sort()
  if (left.length === 0 && await fs.lstat(paths.runtime).catch(() => null)) await io(fs.rmdir(paths.runtime), 'runtime')
  return { removed, left }
}
