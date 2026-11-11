/**
 * The secret guard: a PreToolUse hook on Read, Grep and Bash. A secret file in the project (named by
 * `utils/secret-paths.ts`, or a `kind: Secret` manifest by its content) is never opened, printed or
 * searched by an agent; it is reported by name only. The workflow's own rule says so; this hook holds
 * it when an agent does not follow it.
 *
 *  - Read: a secret file is denied. A file under a registered model's own folders is never secret.
 *  - Grep: a secret file is denied in every output mode; a directory is denied in content and count
 *    mode when a secret file is below it (names-only output is allowed).
 *  - Bash: a command naming a secret file is denied (its words resolved as the shell would: quotes,
 *    braces, globs in any segment, a leading `cd`, redirects, `rev:path`), as are a recursive content
 *    search over a folder holding one, `find` running a reader on what it finds (`-exec`, `| xargs`),
 *    a folder named in a line where `xargs` runs a reader, and a command that prints configuration
 *    values. The workflow's three name-only searches are allowed. A shell is not a sandbox: a name the
 *    shell builds (a variable, `$(…)`, an interpreter, a file of names) is not seen.
 *  - A file a kustomization (`secretGenerator` envs and files) or a compose file (`env_file`, the
 *    top-level `secrets: <name>: file:`) names as a secret source is secret too. Those files are looked
 *    for only in the target's own folder and its ancestors up to the project root; a reference only a
 *    file elsewhere makes (a sibling overlay's `../x/y.env`) stays with the workflow's own rule.
 *  - Glob lists names only and is not guarded.
 *
 * Fail closed. Read and Grep: an event that cannot be read (its tool or its file unknown), a path that
 * cannot be placed, a file that cannot be scanned, an internal error or the deadline deny the call.
 * Bash: what a check cannot finish (a folder or a glob past the bound or the deadline, a file that
 * cannot be scanned) denies the command; a fault before any check (no project root) denies it only when
 * its text names a secret file. A wrong --harness denies every call. Nothing a denial says comes from a
 * file's content.
 *
 * Other harnesses map their calls onto the same decision. OpenCode's plugin sends read, grep and bash.
 * Codex has no read tool: its shell reaches the hook as Bash, and before the decision, failing closed,
 * the guard denies a command the event does not carry, a patch run through the shell (Codex applies it
 * past the hook), a shell or interpreter started with no script, and any command reaching the server's
 * own folder in the home directory. Codex's limits stay: input sent later to a running command
 * (`write_stdin`) is never checked, and a per-call working folder it leaves out of the event makes
 * relative paths judged from the session's folder.
 */

import { closeSync, existsSync, lstatSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type SanctionedSecretCommand,
  SECRET_MANIFEST_PATTERN,
  isSecretManifestLine,
  sanctionedSecretCommand,
  secretPathClass,
  isSafeBarePath,
  shellTokens,
  secretSourceKind,
  secretSourceReferences,
} from '../utils/secret-paths.js'
import { type GuardDecision, type RawEvent, openRegular, rawEventFrom, readOpened, readRegularText } from './config-guard.js'
import { resolveProjectRoot } from '../utils/project-root.js'
import { LINE_ENDS, type LinearPattern, linearPattern } from '../utils/linear-pattern.js'
import { aliasedPath, commandRunsKeychainSecret, keychainNames, keychainSecretInWords } from '../utils/secret-fallback.mjs'

/** The guard's own deadline: it denies before the harness's hook timeout would let the call through. */
export const SECRET_GUARD_DEADLINE_MS = 6000
/** Entries a directory walk visits at most; past it, the directory cannot be checked. */
export const SECRET_WALK_MAX_ENTRIES = 50_000
const CONTENT_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])
const SCAN_CHUNK = 64 * 1024

export interface SecretGuardEnv {
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly now: () => number
  /** Entries a directory walk visits at most (default SECRET_WALK_MAX_ENTRIES). */
  readonly maxEntries?: number
}

class Unchecked extends Error {}

const ALLOW: GuardDecision = { deny: false }
/** Every denial starts with this marker, so a transcript tells the guard's refusal from any other. */
export const SECRET_GUARD_MARKER = 'dethereal-secret-guard: '
const deny = (reason: string): GuardDecision => ({ deny: true, reason: SECRET_GUARD_MARKER + reason })

const SANCTIONED = [
  `grep -rliE '${SECRET_MANIFEST_PATTERN}' -- '<dir>'`,
  "git ls-files --format='%(objectmode) %(path)' -- '<path>'",
  "grep -lwF -d skip -- 'name: <secret-name>' '<file>'",
]

function secretReason(rel: string, cls: string, bash: boolean): string {
  return (
    `${rel} is a secret file (${cls}): it is never opened, printed, copied or searched, with any tool. ` +
    'Report it by name only (unreadSecretFiles), and take its key names and mount targets from the workloads that reference it.' +
    (bash ? ` The only commands on a secret file are the workflow's name-only searches, exactly: ${SANCTIONED.join(' ; ')}` : '')
  )
}

const uncheckedReason = (what: string, why: string) =>
  `${what} could not be checked for secret files (${why}), so it is not opened. Narrow the path, or list file names only.`

// ── paths ────────────────────────────────────────────────────────────────────────────────────────

/**
 * What one decision has read of the filesystem: each path's canonical form and identity, read once whichever check
 * asks. It lives only while a decision runs, so no answer outlives the call that read it.
 */
let decision: {
  readonly canonical: Map<string, string>
  readonly identify: Identify
  readonly folders: Map<string, boolean>
  /** When the decision started, by its own clock: one deadline bounds the whole of it. */
  readonly start: number
  readonly now: () => number
  /** Whether the shell may brace-expand anything in the command judged (see `bracesMayExpand`); unset, it may. */
  braces?: boolean
} | null = null

/** Runs a decision with its own lookups and deadline; one started inside another shares the outer one's. */
function oneDecision<T>(g: SecretGuardEnv, fn: () => T): T {
  if (decision) return fn()
  decision = { canonical: new Map(), identify: identities(), folders: new Map(), start: g.now(), now: g.now }
  try {
    return fn()
  } finally {
    decision = null
  }
}

/** Why a path the system reaches by another name than its text is not judged (see `aliasedPath`). */
const ALIASED = 'the path reaches a file by another name (a volume or descriptor alias), which cannot be followed'

/** The canonical path of `p` (on-disk case, links resolved) through its nearest existing ancestor. */
function canonicalish(p: string): string {
  if (aliasedPath(path.resolve(p))) throw new Unchecked(ALIASED)
  const known = decision?.canonical.get(p)
  if (known !== undefined) return known
  const found = canonicalOf(p)
  decision?.canonical.set(p, found)
  return found
}

/** Throws when the decision has run past its deadline: what it has not judged by then is not run. */
function onTime(): void {
  if (decision && decision.now() - decision.start > SECRET_GUARD_DEADLINE_MS) throw new Unchecked('the check ran out of time')
}

/** Whether `p` is a folder (through links), read once per decision. */
function isFolder(p: string): boolean {
  const known = decision?.folders.get(p)
  if (known !== undefined) return known
  let folder: boolean
  try {
    folder = statSync(p).isDirectory()
  } catch {
    folder = false
  }
  decision?.folders.set(p, folder)
  return folder
}

/** The path and each of its parents (`path.dirname` until it stops), deepest first. */
function withAncestors(p: string): string[] {
  const out = [p]
  for (let up = path.dirname(p); up !== out[out.length - 1]; up = path.dirname(up)) out.push(up)
  return out
}

/**
 * Of `chain` (deepest first), the index of the deepest that exists, or -1 when none does. Nothing exists below a
 * folder that does not, so the answer is found by halving: a few lookups, however deep the path.
 */
function deepestExisting(chain: readonly string[]): number {
  let lo = 0
  let hi = chain.length - 1
  if (!existsSync(chain[hi]!)) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (existsSync(chain[mid]!)) hi = mid
    else lo = mid + 1
  }
  return lo
}

function canonicalOf(p: string): string {
  const chain = withAncestors(p)
  const at = deepestExisting(chain)
  if (at < 0) return p
  const existing = chain[at]!
  try {
    return path.join(realpathSync.native(existing), path.relative(existing, p))
  } catch {
    // A path that exists but resolves to nothing the system names (a volume or descriptor alias) cannot be judged; a
    // device (`/dev/stderr` is a descriptor's) holds no file to judge, and `/dev/fd` is refused as an alias.
    if (existing === '/dev' || existing.startsWith('/dev/')) return p
    throw new Unchecked(ALIASED)
  }
}

interface Place {
  readonly root: string
  readonly fold: (p: string) => string
}

/** The path of `abs` relative to the project root, or null when it is outside. */
function relInside(abs: string, place: Place): string | null {
  const a = place.fold(abs)
  const r = place.fold(place.root)
  if (a === r) return ''
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return a.startsWith(prefix) ? abs.slice(prefix.length).split(path.sep).join('/') : null
}

// ── the model's own files ────────────────────────────────────────────────────────────────────────

/** A model registry larger than this lists no model directories. */
const REGISTRY_MAX_BYTES = 8 * 1024 * 1024

/**
 * The registered model directories (canonical), from the project's registry (`{ models: [{ path }] }`).
 * A registry that is not a regular file lists none: no file is then exempt as the model's own.
 */
function modelDirectories(place: Place): string[] {
  try {
    const text = readRegularText(path.join(place.root, '.dethernety', 'models.json'), REGISTRY_MAX_BYTES)
    if (text === null) return []
    const doc = JSON.parse(text) as { models?: unknown }
    if (!Array.isArray(doc?.models)) return []
    const dirs: string[] = []
    for (const e of doc.models as unknown[]) {
      const rel = isRecord(e) && typeof e.path === 'string' && e.path && !e.path.includes('\0') ? e.path : null
      if (!rel) continue
      const dir = canonicalish(path.resolve(place.root, rel))
      if (relInside(dir, place)) dirs.push(dir)
    }
    return dirs
  } catch {
    return []
  }
}

/**
 * A file the model itself is made of: a regular file directly in a registered model directory's
 * `attributes/` or `controls/` (`*.json`), or under its `.dethereal/` or `.dethernety/`, its real path
 * inside that directory.
 */
function isModelFile(lexical: string, real: string, place: Place, models: () => string[]): boolean {
  let st
  try {
    st = lstatSync(lexical)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  for (const dir of models()) {
    const inside = (p: string) => {
      const f = place.fold(p)
      const d = place.fold(dir)
      return f.startsWith(d + path.sep) ? p.slice(dir.length + 1).split(path.sep) : null
    }
    const parts = inside(real)
    if (!parts || !inside(canonicalish(lexical))) continue
    if ((parts[0] === 'attributes' || parts[0] === 'controls') && parts.length === 2 && parts[1]!.toLowerCase().endsWith('.json')) return true
    if ((parts[0] === '.dethereal' || parts[0] === '.dethernety') && parts.length >= 2) return true
  }
  return false
}

// ── one file ─────────────────────────────────────────────────────────────────────────────────────

type FileVerdict = { readonly secret: false } | { readonly secret: true; readonly rel: string; readonly cls: string }

interface Judge {
  readonly place: Place
  readonly models: () => string[]
  readonly deadline: () => void
  readonly maxEntries: number
  /** Per folder: the secret sources its kustomization and compose files name (folded real path → the naming file). */
  readonly sources: Map<string, Map<string, string>>
}

/** A kustomization or compose file larger than this names nothing the guard resolves (never a denial). */
const SOURCE_FILE_MAX_BYTES = 1024 * 1024

/**
 * The secret sources named by the kustomization and compose files in `dir` itself: each resolved from
 * the naming file's folder, kept when inside the project. An I/O error on such a file cannot be checked,
 * and neither can one that is not a regular file (a FIFO, a socket): it may name the secret sources of
 * every file below it, and it cannot be read without blocking.
 */
function folderSources(dir: string, j: Judge): Map<string, string> {
  const cached = j.sources.get(dir)
  if (cached) return cached
  const out = new Map<string, string>()
  j.sources.set(dir, out)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const kind = secretSourceKind(name)
    if (!kind) continue
    const file = path.join(dir, name)
    let text: string | null
    try {
      const f = openRegular(file)
      if (f.kind === 'missing' || f.kind === 'directory') continue
      if (f.kind === 'special') throw new Unchecked(`${relInside(file, j.place) ?? name} is not a regular file`)
      try {
        text = f.size > SOURCE_FILE_MAX_BYTES ? null : readOpened(f.fd, SOURCE_FILE_MAX_BYTES)
      } finally {
        closeSync(f.fd)
      }
    } catch (e) {
      if (e instanceof Unchecked) throw e
      throw new Unchecked(`${relInside(file, j.place) ?? name} cannot be read`)
    }
    if (text === null) continue
    for (const ref of secretSourceReferences(kind, text)) {
      const target = canonicalish(path.resolve(dir, ref))
      if (relInside(target, j.place)) out.set(j.place.fold(target), relInside(file, j.place) ?? name)
    }
  }
  return out
}

/**
 * The kustomization or compose file that names `real` as a secret source, looked for only in its own
 * folder and each ancestor up to the project root (the cost grows with depth, not with the repository);
 * a reference only a file elsewhere makes (a sibling overlay's `../x/y.env`) is not seen here.
 */
function namedAsSecretSource(real: string, j: Judge): string | null {
  const key = j.place.fold(real)
  const chain = withAncestors(path.dirname(real))
  if (relInside(chain[0]!, j.place) === null) return null
  // A folder that does not exist names nothing, and lies below the root (it extends a path inside the project), as
  // every folder below it does: the walk starts at the deepest that exists.
  for (let k = Math.max(0, deepestExisting(chain)); k < chain.length; k++) {
    const dir = chain[k]!
    if (relInside(dir, j.place) === null) return null
    const naming = folderSources(dir, j).get(key)
    if (naming) return naming
    if (j.place.fold(dir) === j.place.fold(j.place.root)) return null
  }
  return null
}

/**
 * Whether the file's text holds a `kind: Secret` line, read as a stream. Missing or a directory: no.
 * Not a regular file (a FIFO, a socket, a device): cannot be checked, since its content can only be
 * streamed, may carry a manifest, and opening it plainly would block.
 */
function holdsSecretManifest(file: string, j: Judge): boolean {
  let fd: number
  try {
    const f = openRegular(file)
    if (f.kind === 'missing' || f.kind === 'directory') return false
    if (f.kind === 'special') throw new Unchecked('not a regular file')
    fd = f.fd
  } catch (e) {
    if (e instanceof Unchecked) throw e
    throw new Unchecked(`${(e as NodeJS.ErrnoException).code ?? 'unreadable'}`)
  }
  try {
    const buf = Buffer.alloc(SCAN_CHUNK)
    let carry = ''
    for (;;) {
      j.deadline()
      const n = readSync(fd, buf, 0, SCAN_CHUNK, null)
      if (n === 0) break
      const lines = (carry + buf.toString('utf8', 0, n)).split('\n')
      carry = lines.pop() ?? ''
      // A line longer than a chunk is still tested whole: keep its tail bounded to the chunk size.
      if (carry.length > 4 * SCAN_CHUNK) carry = carry.slice(-4 * SCAN_CHUNK)
      if (lines.some(isSecretManifestLine)) return true
    }
    return isSecretManifestLine(carry)
  } catch (e) {
    if (e instanceof Unchecked) throw e
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EISDIR') return false
    throw new Unchecked(`${code ?? 'unreadable'}`)
  } finally {
    closeSync(fd)
  }
}

/** Whether `abs` (absolute) is a secret file of the project. Outside the project: never. */
function judgeFile(abs: string, j: Judge): FileVerdict {
  const real = canonicalish(abs)
  const relLex = relInside(abs, j.place)
  const relReal = relInside(real, j.place)
  if (relLex === null && relReal === null) return { secret: false }
  if (relReal === null) throw new Unchecked('a link out of the project')
  if (isModelFile(abs, real, j.place, j.models)) return { secret: false }
  for (const rel of [relLex, relReal]) {
    if (rel === null || rel === '') continue
    const cls = secretPathClass(rel)
    if (cls) return { secret: true, rel: relReal || rel, cls }
  }
  const naming = namedAsSecretSource(real, j)
  if (naming) return { secret: true, rel: relReal, cls: `referenced by ${naming} as a secret source` }
  if (CONTENT_EXTENSIONS.has(path.extname(real).toLowerCase()) && holdsSecretManifest(real, j)) return { secret: true, rel: relReal, cls: 'secret-manifest' }
  return { secret: false }
}

/**
 * The files below `dir` a search would read: `.git` skipped, links not followed (a search does not
 * follow them), `glob` applied only when it is a simple file-name glob (anything else is ignored, so
 * the walk reads more, never less).
 */
function* walk(dir: string, glob: LinearPattern | null, j: Judge): Generator<string> {
  let seen = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw new Unchecked(`${code ?? 'unreadable'} below ${path.basename(dir) || dir}`)
    }
    for (const e of entries) {
      if (++seen > j.maxEntries) throw new Unchecked(`more than ${j.maxEntries} entries`)
      j.deadline()
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== '.git') stack.push(p)
      } else if (e.isFile() && (!glob || glob.test(e.name, onTime))) yield p
    }
  }
}

/** A Grep/rg glob with only `*`, `?` and `[...]` and no `/`, as the source of a file-name test (any letter case); otherwise null. */
export function simpleGlobSource(glob: unknown): string | null {
  if (typeof glob !== 'string' || !glob || /[{}/!\\]|\*\*/.test(glob)) return null
  return `^${glob.replace(/[.+^$()|]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
}

/** That glob as a file-name test, linear in the name; null when there is none or it does not compile. */
function simpleGlob(glob: unknown): LinearPattern | null {
  const source = simpleGlobSource(glob)
  if (source === null) return null
  try {
    return linearPattern(source, 'i')
  } catch {
    return null
  }
}

/**
 * The first secret file below `target` (or `target` itself when a file). Only the project is walked:
 * a folder outside it holds none of its files, and a folder above it is walked from the project root.
 */
function secretBelow(target: string, glob: LinearPattern | null, j: Judge): FileVerdict {
  let st
  try {
    st = statSync(target)
  } catch {
    return { secret: false }
  }
  if (!st.isDirectory()) return judgeFile(target, j)
  const real = canonicalish(target)
  let from = real
  if (relInside(real, j.place) === null) {
    const r = j.place.fold(j.place.root)
    const d = j.place.fold(real)
    if (!(r.startsWith(d.endsWith(path.sep) ? d : d + path.sep))) return { secret: false }
    from = j.place.root
  }
  for (const f of walk(from, glob, j)) {
    const v = judgeFile(f, j)
    if (v.secret) return v
  }
  return { secret: false }
}

// ── Bash ─────────────────────────────────────────────────────────────────────────────────────────

/** Shell words of one simple command, quotes removed; null when the text needs a shell to read. */
export function shellWords(segment: string): string[] | null {
  if (/\$\(|`|<\(|>\(|\beval\b|\$\{|\$[A-Za-z_]/.test(segment)) return null
  const words: string[] = []
  let cur = ''
  let has = false
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '$' && segment[i + 1] === "'") {
      // ANSI-C quoting: the shell decodes its escapes (`$'\x2e'` is a dot).
      let end = i + 2
      while (end < segment.length && segment[end] !== "'") end += segment[end] === '\\' ? 2 : 1
      if (end >= segment.length) return null
      cur += ansiC(segment.slice(i + 2, end))
      has = true
      i = end
    } else if (c === '$' && segment[i + 1] === '"') {
      // A translated string reads as a double-quoted one.
      continue
    } else if (c === "'") {
      const end = segment.indexOf("'", i + 1)
      if (end < 0) return null
      cur += segment.slice(i + 1, end)
      has = true
      i = end
    } else if (c === '"') {
      const end = segment.indexOf('"', i + 1)
      if (end < 0) return null
      cur += segment.slice(i + 1, end).replace(/\\(["\\$`])/g, '$1')
      has = true
      i = end
    } else if (c === '\\') {
      cur += segment[i + 1] ?? ''
      has = true
      i++
    } else if (/\s/.test(c) || c === '<' || c === '>') {
      // A redirect's target is a word of its own (`cat<file`, `>out`).
      if (has) words.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has) words.push(cur)
  return words
}

/** The text of `$'…'` with its escapes decoded, as bash and zsh read it. */
function ansiC(body: string): string {
  const named: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
  return body.replace(/\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3}|c[\s\S]|[\s\S])/g, (_m, e: string) => {
    const k = e[0]!
    if (k === 'x' || k === 'u' || k === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16) % 0x110000)
    if (/[0-7]/.test(k)) return String.fromCharCode(parseInt(e, 8) & 0xff)
    if (k === 'c' && e.length === 2) return String.fromCharCode(e.charCodeAt(1) & 0x1f)
    return named[k] ?? `\\${e}`
  })
}

/**
 * A simple command without the grouping and keywords around it: a subshell's or a group's opening
 * bracket, `!`, and `if`, `then`, `elif`, `else`, `do`, `while`, `until`, `time` before it, a
 * subshell's closing bracket after it. A closing `}`, `fi`, `done` or `esac` is a segment of its own.
 */
export function bareCommand(segment: string): string {
  // The command is segment[a, b), narrowed from both ends in one pass: no copy, no expression run over the rest.
  let a = 0
  let b = segment.length
  let blanksAt = -1
  let blanksFrom = 0
  const space = (k: number) => k < b && BLANK.test(segment[k]!)
  for (;;) {
    const before = [a, b]
    // At the start: `(`s, or `{` or `!` before a blank, or a keyword before a blank or the end; then blanks.
    if (segment[a] === '(') {
      while (segment[a] === '(' && a < b) a++
      while (space(a)) a++
    } else if ((segment[a] === '{' || segment[a] === '!') && space(a + 1)) {
      a++
      while (space(a)) a++
    } else {
      const keyword = OPENING_KEYWORDS.find((w) => segment.startsWith(w, a) && a + w.length <= b && (a + w.length === b || space(a + w.length)))
      if (keyword) {
        a += keyword.length
        while (space(a)) a++
      }
    }
    // At the end: blanks, one run of `)`, blanks. Where the end's blanks start is found once for each end: the start moving
    // on through a long run of keywords does not read the end's blanks again.
    if (blanksAt !== b) {
      blanksAt = b
      blanksFrom = b
      while (blanksFrom > 0 && BLANK.test(segment[blanksFrom - 1]!)) blanksFrom--
    }
    let e = Math.max(a, blanksFrom)
    if (e > a && segment[e - 1] === ')') {
      while (e > a && segment[e - 1] === ')') e--
      while (e > a && BLANK.test(segment[e - 1]!)) e--
      b = e
    }
    if (b - a <= 4 && CLOSING_WORDS.has(segment.slice(a, b))) b = a
    if (a === before[0] && b === before[1]) break
  }
  return segment.slice(a, b).trim()
}

const BLANK = /\s/
const OPENING_KEYWORDS = ['if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time']
const CLOSING_WORDS = new Set(['}', 'fi', 'done', 'esac'])

/** Simple commands of a command line: split on `;`, `&&`, `||`, `|`, `&` and newlines (outside quotes). */
export function commandSegments(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      cur += c
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"') cur += command[++i] ?? ''
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
    } else if (c === '\\') {
      cur += c + (command[++i] ?? '')
    } else if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (bareCommand(cur)) out.push(bareCommand(cur))
      cur = ''
      if ((c === '|' || c === '&') && command[i + 1] === c) i++
    } else cur += c
  }
  if (bareCommand(cur)) out.push(bareCommand(cur))
  return out
}

/**
 * Where `ch` next stands in `text` from a place on, for places that only move forward: looked up again only once
 * passed, and never again once none is left, so many lookups take one pass. -1 when none is left.
 */
function nextOf(text: string, ch: string): (from: number) => number {
  let at = -1
  let looked = false
  return (from) => {
    if (!looked || (at >= 0 && at < from)) {
      at = text.indexOf(ch, from)
      looked = true
    }
    return at
  }
}

/**
 * The word's leftmost brace group that holds a comma and no other brace, with no line end before it or after it, as
 * [before, inside, after]; or null. One pass over the word.
 */
export function firstBraceGroup(word: string): [string, string, string] | null {
  let firstLineEnd = word.length
  let lastLineEnd = -1
  for (let k = 0; k < word.length; k++) {
    if (!LINE_ENDS.has(word[k]!)) continue
    if (firstLineEnd === word.length) firstLineEnd = k
    lastLineEnd = k
  }
  // Each `{` closes at the first brace after it, the leftmost first; a comma must stand between.
  let comma = false
  let open = -1
  for (let k = 0; k < word.length; k++) {
    const c = word[k]!
    if (c === '{') {
      open = k
      comma = false
    } else if (c === ',') comma = true
    else if (c === '}' && open >= 0) {
      if (comma && open < firstLineEnd && k > lastLineEnd) return [word.slice(0, open), word.slice(open + 1, k), word.slice(k + 1)]
      open = -1
    }
  }
  return null
}

/**
 * Brace expansion of one word (`a{b,c}d` → `abd`, `acd`), the work bounded. Past `budget` words, or twice as many
 * steps: where the shell may expand the command's braces, the word cannot be checked, since every word it names would
 * have to be; where it cannot (the braces stand in quotes or a here-document, as JSON does), the words read so far are
 * the reading, as the shell names none of them.
 */
export function braces(word: string, expands: boolean, budget = 64, work = { steps: 0, words: 0, done: false }): string[] {
  const past = (): string[] => {
    if (expands) throw new Unchecked(`a brace expansion past ${budget} words`)
    work.done = true
    return []
  }
  if (work.done) return []
  if (++work.steps > 2 * budget) return past()
  // A sequence (`{x..z}`, `{1..9}`) names what the matching glob would: a letter class, or any run of digits.
  word = word.replace(/\{([A-Za-z])\.\.([A-Za-z])(?:\.\.-?\d+)?\}/g, (_m, a: string, b: string) => (a <= b ? `[${a}-${b}]` : `[${b}-${a}]`))
    .replace(/\{-?\d+\.\.-?\d+(?:\.\.-?\d+)?\}/g, '*')
  const m = firstBraceGroup(word)
  if (!m) return ++work.words > budget ? past() : [word]
  const out: string[] = []
  for (const alt of m[1].split(',')) {
    for (const w of braces(`${m[0]}${alt}${m[2]}`, expands, budget, work)) out.push(w)
    if (work.done) break
  }
  return out
}

/**
 * The words of a word with its braces written out, read twice: as bash reads it, and as zsh with BRACE_CCL (which a
 * startup file may set) does, a group without a comma being a set of characters (`.en{v}` is `.env`).
 */
function braceWords(word: string, expands: boolean): string[] {
  // Not after `$`: `${…}` is a parameter, not a group.
  const sets = word.replace(/(?<!\$)\{([^{},]+)\}/g, (group, set: string) => {
    const chars = braceSet(set)
    return chars.length === 0 ? group : chars.length === 1 ? chars[0]! : `{${chars.join(',')}}`
  })
  return sets === word ? braces(word, expands) : [...new Set([...braces(word, expands), ...braces(sets, expands)])]
}

/** The characters of a zsh BRACE_CCL set (`a-c` a range): more than 64 of them, and the bound is passed. */
function braceSet(set: string): string[] {
  const out: string[] = []
  for (let k = 0; k < set.length && out.length <= 64; k++) {
    if (set[k + 1] === '-' && k + 2 < set.length) {
      for (let c = set.charCodeAt(k); c <= set.charCodeAt(k + 2) && out.length <= 64; c++) out.push(String.fromCharCode(c))
      k += 2
    } else out.push(set[k]!)
  }
  return out.filter((c) => c !== ',' && c !== '{' && c !== '}')
}

/**
 * Commands that run text they are given through a shell again, whose braces it then expands; the shell's own built-in
 * that does is spelled as a pattern, so the shipped build's text check does not take this list for a use of it.
 */
const RUNS_TEXT = new Set(['ssh', 'su', 'runuser', 'sudo', 'doas', 'watch', 'script', 'tmux', 'screen', 'parallel', 'source', '.', 'trap',
  'rbash', 'ash', 'mksh', 'lksh', 'oksh', 'pdksh', 'ksh93', 'yash', 'posh', 'busybox'])
const RUNS_ITS_WORDS = /^ev[a]l$/

/**
 * Whether the shell may brace-expand anything in a command line: a `{` outside quotes and here-documents, or a command
 * that runs text through a shell again (a shell, `eval`, `ssh`, `su`, …, also as a piece of a word, as `env -S` splits
 * one), whose quoted braces then expand there. Where this reading may part from the shell's, it says may: a quote left
 * open, a substitution inside double quotes, a comment, arithmetic (`((`, `$((`, `$[`), a line continued with a
 * backslash, a here-document delimiter other than a plain name or one quoted whole.
 */
export function bracesMayExpand(command: string): boolean {
  const words: string[] = []
  let word = ''
  const end = () => {
    if (word) words.push(word)
    word = ''
  }
  // Here-documents opened on this line, their bodies skipped at its end: [delimiter, tabs stripped]. A here-document
  // and a substitution in one line may be read in another order by the shell (a body starting after the substitution).
  let docs: Array<[string, boolean]> = []
  let opened = false
  let substitutes = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (c === "'") {
      const close = command.indexOf("'", i + 1)
      if (close < 0) return true
      word += command.slice(i + 1, close)
      i = close
    } else if (c === '$' && command[i + 1] === '$') {
      word += '$$'
      i++
    } else if (c === '$' && (command[i + 1] === '[' || command.startsWith('((', i + 1))) {
      return true
    } else if ((c === '$' || c === '<' || c === '>') && command[i + 1] === '(') {
      substitutes = true
      end()
      i++
    } else if (c === '(' && command[i + 1] === '(') {
      return true
    } else if (c === '#' && !word) {
      return true
    } else if (c === '$' && command[i + 1] === "'") {
      let j = i + 2
      while (j < command.length && command[j] !== "'") j += command[j] === '\\' ? 2 : 1
      if (j >= command.length) return true
      word += command.slice(i + 2, j)
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < command.length && command[j] !== '"') j += command[j] === '\\' ? 2 : 1
      if (j >= command.length) return true
      const inside = command.slice(i + 1, j)
      if (inside.includes('$(') || inside.includes('`')) return true
      word += inside
      i = j
    } else if (c === '\\') {
      if (command[i + 1] === '\n') return true
      word += command[i + 1] ?? ''
      i++
    } else if (c === '<' && command.startsWith('<<<', i)) {
      // A here-string: its word is read as any other.
      end()
      i += 2
    } else if (c === '<' && command[i + 1] === '<') {
      end()
      const dash = command[i + 2] === '-'
      let j = i + (dash ? 3 : 2)
      while (command[j] === ' ' || command[j] === '\t') j++
      // The delimiter: a plain name, or one quoted whole; any other spelling may be read otherwise than here.
      let delimiter = ''
      const quote = command[j] === "'" || command[j] === '"' ? command[j] : ''
      if (quote) {
        const close = command.indexOf(quote, j + 1)
        if (close < 0) return true
        delimiter = command.slice(j + 1, close)
        j = close + 1
      } else for (; j < command.length && /[A-Za-z0-9_.-]/.test(command[j]!); j++) delimiter += command[j]
      if (!/^[A-Za-z0-9_.-]+$/.test(delimiter) || (j < command.length && !/[ \t\n;&|()<>]/.test(command[j]!))) return true
      opened = true
      docs.push([delimiter, dash])
      i = j - 1
    } else if (c === '\n' && docs.length) {
      end()
      // Each body runs to a line that is its delimiter alone; one never closed runs to the end.
      let k = i + 1
      for (const [delimiter, dash] of docs) {
        for (;;) {
          const lineEnd = command.indexOf('\n', k)
          const line = command.slice(k, lineEnd < 0 ? command.length : lineEnd)
          k = lineEnd < 0 ? command.length : lineEnd + 1
          if ((dash ? line.replace(/^\t+/, '') : line) === delimiter || lineEnd < 0) break
        }
      }
      docs = []
      i = k - 1
    } else if (c === '{') {
      return true
    } else if (/\s/.test(c) || ';&|()<>`'.includes(c)) {
      if (c === '`') substitutes = true
      end()
    } else word += c
  }
  end()
  if (opened && substitutes) return true
  // A word the shell builds (`$SHELL`, `$b`) may be any of them.
  return words.flatMap((w) => w.split(/\s+/)).some((w) =>
    w.startsWith('$') || SHELL.test(path.basename(w)) || RUNS_TEXT.has(path.basename(w)) || RUNS_ITS_WORDS.test(path.basename(w)))
}

/**
 * The paths a shell word can name: itself, the parts after `=`, `:` and `@`, redirect targets, and each
 * blank-separated piece of a quoted word (a `sed` script's `w <file>`), braces expanded.
 */
/**
 * A path with its trailing zsh glob qualifier `(…)` removed, or null when it has none. zsh reads `.env(N)`, `*(D)` and
 * the like as the glob before the `(…)` with a qualifier, so the guard reads the file the glob names, not the literal
 * `.env(N)`, which no file is named. The segment splitter cuts a line at `(`, so the closing `)` may be gone by here;
 * the group holds no `(`, `)` or `|`, so an extglob group `(a|b)` is left alone.
 */
function withoutQualifier(p: string): string | null {
  const m = /^(.+?)\([^()|]*\)?$/.exec(p)
  return m && !m[1]!.endsWith('/') ? m[1]! : null
}

function wordPaths(word: string): string[] {
  const parts = new Set<string>([word])
  if (/\s/.test(word)) for (const piece of word.split(/\s+/)) if (piece) parts.add(piece)
  for (const sep of ['=', ':', '@']) for (const piece of word.split(sep).slice(1)) if (piece) parts.add(piece)
  const redirect = /^\d*(?:<|>|>>|&>)(.+)$/.exec(word)
  if (redirect) parts.add(redirect[1]!)
  // Each path with any trailing glob qualifier peeled off (`.env(N)` → `.env`, `*(.)(D)` → `*`), read as well. A real
  // stacked qualifier peels in a step or two; the cap keeps a long run of literal `(` from making this quadratic.
  for (const p of [...parts]) {
    let q = withoutQualifier(p)
    for (let n = 0; q !== null && n < 8; q = withoutQualifier(q), n++) parts.add(q)
  }
  return [...parts].flatMap((p) => braceWords(p, decision?.braces !== false))
}

/** One glob segment as a regex body: `*` and `?` within the segment, `[...]` as written. */
function segmentRe(seg: string): string {
  let out = ''
  const close = nextOf(seg, ']')
  // A run of `*` is one: the same names, and no pattern that grows with the run.
  let star = false
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!
    if (c === '*') {
      if (!star) out += '[^/]*'
      star = true
      continue
    }
    star = false
    if (c === '?') out += '[^/]'
    else if (c === '[') {
      const end = close(i + 1)
      if (end < 0) out += '\\['
      else {
        out += `[${seg.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else out += c.replace(/[.+^$(){}|\\]/g, '\\$&')
  }
  return out
}

const GLOB = /[*?[]/

/** The segments of a glob, from its first glob segment, as the source of a whole-path test (`**` crossing segments). */
export function expandSource(segs: readonly string[]): string {
  // A run of `**` segments is one (two at the end, the last read as `.*`): the same paths, and no pattern that grows
  // with the run.
  const pattern = segs
    .filter((x, k) => x !== '**' || segs[k - 1] !== '**' || k === segs.length - 1)
    .map((x) => (x === '**' ? '(?:[^/]+/)*' : `${segmentRe(x)}/`))
    .join('')
    .replace(/\/$/, '')
    .replace(/\(\?:\[\^\/\]\+\/\)\*$/, '.*')
  return `^${pattern}$`
}

/**
 * Files a word names under `base`. A word with no glob is itself. A glob is expanded within the project:
 * from its last glob-free ancestor, matching the whole path (`**` crossing segments), by the bounded
 * walk; past the bound it cannot be checked. A glob that reaches no part of the project names nothing
 * the guard judges.
 */
function expand(word: string, base: string, j: Judge): string[] {
  const abs = path.resolve(base, word.replace(/^~(?=\/|$)/, '/nonexistent-home'))
  if (!GLOB.test(abs)) return [abs]
  const segs = abs.split(path.sep)
  const firstGlob = segs.findIndex((x) => GLOB.test(x))
  const anchor = segs.slice(0, firstGlob).join(path.sep) || path.sep
  const re = linearPattern(expandSource(segs.slice(firstGlob)), j.place.fold('A') === 'a' ? 'i' : '')
  const real = canonicalish(anchor)
  let from = real
  if (relInside(real, j.place) === null) {
    const r = j.place.fold(j.place.root)
    const d = j.place.fold(real)
    if (!r.startsWith(d.endsWith(path.sep) ? d : d + path.sep)) return []
    from = j.place.root
  }
  const out: string[] = []
  for (const f of walk(from, null, j)) {
    const rel = path.relative(real, f).split(path.sep).join('/')
    if (re.test(rel, onTime)) out.push(f)
  }
  return out
}

/** git configuration keys that make git run a program, over the key in lower case (`alias.*` by its value, below). */
const GIT_CODE_KEYS: readonly RegExp[] = [
  /^core\.(?:fsmonitor|pager|sshcommand|hookspath|editor|askpass|gitproxy)$/, /^diff\.external$/, /^diff\..+\.(?:textconv|command)$/,
  /^filter\..+\.(?:clean|smudge|process)$/, /^merge\..+\.driver$/, /^credential\.(?:.+\.)?helper$/, /^sequence\.editor$/, /^pager\..+/, /^gpg\.(?:.+\.)?program$/,
  /^interactive\.difffilter$/, /^include\.path$/, /^includeif\..+\.path$/, /^remote\..+\.(?:uploadpack|receivepack)$/,
  /^uploadpack\.packobjectshook$/, /^hook\..+\.command$/, /^(?:diff|merge)tool\..+\.cmd$/, /^init\.templatedir$/,
]
/** The sections those keys live in, which a renamed section must not become. */
const GIT_CODE_SECTIONS = new Set(['core', 'diff', 'filter', 'merge', 'credential', 'sequence', 'pager', 'gpg', 'interactive', 'include',
  'includeif', 'remote', 'uploadpack', 'hook', 'difftool', 'mergetool', 'alias', 'init'])
/** Variables that make one git run a program, as `-c` would, or read its configuration or programs from elsewhere. */
const GIT_PROGRAM_VARS = new Set(['GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_SSH', 'GIT_SSH_COMMAND',
  'GIT_ASKPASS', 'GIT_PROXY_COMMAND', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG', 'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR', 'PAGER', 'EDITOR', 'VISUAL'])
const GIT_PAGERS = new Set(['GIT_PAGER', 'PAGER'])
const GIT_EDITORS = new Set(['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'EDITOR', 'VISUAL'])
/** A pager that runs nothing: `cat` only prints, an empty one is none. An editor that runs nothing: `true` and `:`. */
const noOpPager = (v: string) => v === 'cat' || v === ''
const noOpEditor = (v: string) => v === 'true' || v === ':'

/**
 * Whether setting `key` to `value` makes git run a program. A key the shell fills in counts. An alias counts when it
 * runs a program (`!…`), passes git options (`-c …`), runs `git config`, or the shell fills it in; a pager or editor
 * that runs nothing, and `pager.<command>` switched on or off, do not.
 */
function gitCodeKey(key: string, value: string | undefined): boolean {
  const k = key.toLowerCase()
  if (/[$`]/.test(k)) return true
  if (k.startsWith('alias.')) {
    if (value === undefined) return true
    const words = value.trim().split(/\s+/)
    return value.trimStart().startsWith('!') || /[$`]/.test(value) || (words[0] ?? '').startsWith('-') || words.includes('config')
  }
  if (value !== undefined) {
    if ((k === 'core.pager' || k.startsWith('pager.')) && noOpPager(value)) return false
    if (k.startsWith('pager.') && /^(?:true|false|yes|no|on|off|1|0)$/i.test(value)) return false
    if ((k === 'core.editor' || k === 'sequence.editor') && noOpEditor(value)) return false
  }
  return GIT_CODE_KEYS.some((re) => re.test(k))
}

/** The key a `key=value` word sets, when it makes git run a program. */
const codeAssignment = (kv: string): string | null => {
  const eq = kv.indexOf('=')
  const key = eq < 0 ? kv : kv.slice(0, eq)
  return gitCodeKey(key, eq < 0 ? 'true' : kv.slice(eq + 1)) ? key : null
}

/**
 * What a `git` command's words set that makes git run a program: a `-c`, `--config-env` or `--exec-path=` before its
 * subcommand; a `git config` write of such a key (a word naming one with a word after it, so every mode, scope, file
 * and abbreviated option reads alike), a section renamed to one holding such keys, or any `git config --edit`; a
 * template folder `git init` or `git clone` copies hooks from, or a `git clone -c`. A read or a removal of one key
 * passes. `fed` when more words follow, as from `xargs`. Null when it sets none.
 */
function gitCommandSetsCode(run: readonly string[], fed = false): string | null {
  let i = 1
  for (; i < run.length && run[i]!.startsWith('-'); i++) {
    const a = run[i]!
    if (a === '-c' || a === '--config-env') {
      const kv = run[++i] ?? ''
      const key = a === '-c' ? codeAssignment(kv) : gitCodeKey(kv.split('=')[0]!, undefined) ? kv.split('=')[0]! : null
      if (key) return key
    } else if (a.startsWith('-c')) {
      const key = codeAssignment(a.slice(2))
      if (key) return key
    } else if (a.startsWith('--config-env=')) {
      const k = a.slice('--config-env='.length).split('=')[0]!
      if (gitCodeKey(k, undefined)) return k
    } else if (a.startsWith('--exec-path=')) return "git's program folder (--exec-path)"
    else if (['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--attr-source'].includes(a)) i++
  }
  const sub = run[i]
  const args = run.slice(i + 1)
  if (sub === 'init' || sub === 'clone') {
    for (let j = 0; j < args.length; j++) {
      const a = args[j]!
      if (/^--te(?:m(?:p(?:l(?:a(?:t(?:e)?)?)?)?)?)?(?:=|$)/.test(a)) return 'a template folder (its hooks)'
      if (sub !== 'clone') continue
      const kv = a === '-c' || /^--con(?:f(?:i(?:g)?)?)?$/.test(a) ? args[++j] ?? '' : /^--con(?:f(?:i(?:g)?)?)?=/.test(a) ? a.slice(a.indexOf('=') + 1) : /^-c./.test(a) ? a.slice(2) : null
      const key = kv === null ? null : codeAssignment(kv)
      if (key) return key
    }
    return null
  }
  if (sub !== 'config') return null
  const words = args.filter((a) => !a.startsWith('-'))
  if (words[0] === 'edit' || args.some((a) => /^--e(?:d(?:i(?:t)?)?)?$/.test(a) || /^-[lz]*e/.test(a))) return 'the configuration file (opened in an editor)'
  if (words[0] === 'rename-section' || args.some((a) => /^--ren/.test(a))) {
    const into = words.find((w) => /[$`]/.test(w) || GIT_CODE_SECTIONS.has(w.split('.')[0]!.toLowerCase()))
    return into === undefined ? null : `the section ${into}`
  }
  // A value may itself start with `-` (an alias's `-c …`): the word after a key is its value.
  for (let j = 0; j < args.length; j++) {
    const w = args[j]!
    if (w.startsWith('-')) continue
    if (j + 1 < args.length ? gitCodeKey(w, args[j + 1]) : fed && gitCodeKey(w, undefined)) return w
  }
  return null
}

/**
 * The git runs a command's words start: at its command position, behind `xargs`, `xcrun` or `find -exec`, or dashed
 * (`git-config`); and the assignments made on the way there, layer by layer (`X=1 nice env GIT_PAGER=less git log`).
 */
function gitRuns(words: readonly string[]): { runs: { run: string[]; fed: boolean }[]; assignments: [string, string][] } {
  const runs: { run: string[]; fed: boolean }[] = []
  const assignments: [string, string][] = []
  const visit = (ws: string[], fed: boolean, depth: number): void => {
    let run = ws
    for (let n = 0; n < 8; n++) {
      const w = unwrapped(run)
      const lead = w.findIndex((x) => !/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(x))
      const next = lead >= 0 ? w.slice(lead) : []
      for (const x of run.slice(0, run.length - next.length)) {
        const m = ASSIGNMENT.exec(x)
        if (m) assignments.push([m[1]!, m[2]!])
      }
      if (next.length === run.length) break
      run = next
    }
    assignments.push(...assignmentsOf(run))
    const name = path.basename(run[0] ?? '')
    if (name === 'git') runs.push({ run, fed })
    else if (name.startsWith('git-')) runs.push({ run: ['git', name.slice(4), ...run.slice(1)], fed })
    else if (depth > 4) return
    else if (name === 'xargs') visit(xargsCommand(run), true, depth + 1)
    else if (name === 'find') for (const c of findExecs(run)) visit(c, false, depth + 1)
    else if (name === 'xcrun') {
      let j = 1
      while (j < run.length && run[j]!.startsWith('-')) j += /^--?(?:sdk|toolchain)$/.test(run[j]!) ? 2 : 1
      visit(run.slice(j), fed, depth + 1)
    }
  }
  visit([...words], false, 0)
  return { runs, assignments }
}

/** A variable assignment: `NAME=value` or `NAME+=value`. */
const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)\+?=([\s\S]*)$/

/** The assignments a command's words make: those before its command, and the arguments of `export`, `declare` or `env`. */
function assignmentsOf(words: readonly string[]): [string, string][] {
  const out: [string, string][] = []
  let i = 0
  for (let m; i < words.length && (m = ASSIGNMENT.exec(words[i]!)); i++) out.push([m[1]!, m[2]!])
  if (['export', 'declare', 'typeset', 'local', 'readonly', 'env'].includes(path.basename(words[i] ?? ''))) {
    for (const w of words.slice(i + 1)) {
      const m = ASSIGNMENT.exec(w)
      if (m) out.push([m[1]!, m[2]!])
    }
  }
  return out
}

const gitWord = (w: string) => /^git(?:-|$)/.test(path.basename(w))

/**
 * A part the guard cannot read word by word, as pieces of words: quotes keep a word whole and are dropped, and an
 * unquoted separator (`;`, `&`, `|`, `(`, `)`, a backquote) ends a piece. A part holds no line end outside quotes.
 */
function textPieces(text: string): string[][] {
  const pieces: string[][] = []
  let piece: string[] = []
  let word: string | null = null
  const endWord = () => {
    if (word !== null) piece.push(word)
    word = null
  }
  const endPiece = () => {
    endWord()
    if (piece.length) pieces.push(piece)
    piece = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "'") {
      const j = text.indexOf("'", i + 1)
      const end = j < 0 ? text.length : j
      word = (word ?? '') + text.slice(i + 1, end)
      i = end
    } else if (c === '"') {
      let j = i + 1
      let w = ''
      for (; j < text.length && text[j] !== '"'; j++) w += text[j] === '\\' && j + 1 < text.length && '$`"\\\n'.includes(text[j + 1]!) ? text[++j] : text[j]
      word = (word ?? '') + w
      i = j
    } else if (c === '\\') {
      if (i + 1 < text.length && text[i + 1] !== '\n') word = (word ?? '') + text[i + 1]
      i++
    } else if (';&|()`\n'.includes(c)) endPiece()
    else if (c === ' ' || c === '\t') endWord()
    else word = (word ?? '') + c
  }
  endPiece()
  return pieces
}

/** The text without the bodies of its here-documents, wherever they stand. */
function withoutDocs(text: string): string {
  const opener = /<<(-?)[ \t]*(?:'([^'\n]{1,64})'|"([^"\n]{1,64})"|\\?([^\s;&|()<>'"]{1,64}))/g
  let out = ''
  let from = 0
  for (let m; (m = opener.exec(text)); ) {
    const lineEnd = text.indexOf('\n', opener.lastIndex)
    if (lineEnd < 0) break
    const delim = m[2] ?? m[3] ?? m[4]!
    let k = lineEnd + 1
    for (;;) {
      const e = text.indexOf('\n', k)
      const line = text.slice(k, e < 0 ? text.length : e)
      if ((m[1] ? line.replace(/^\t+/, '') : line) === delim) break
      if (e < 0) {
        k = text.length
        break
      }
      k = e + 1
    }
    out += text.slice(from, lineEnd + 1)
    from = k
    opener.lastIndex = k
  }
  return out + text.slice(from)
}

/**
 * Whether a part's text names git, a way to set its configuration (`config`, `-c`, `--config…`, `--template…`), and a
 * key that makes git run a program, wherever in the part each stands: what a substitution hides from `textPieces`.
 * Here-documents are left to `textPieces`, which reads the bodies the shell expands. A value cut short by a quote counts
 * as unknown.
 */
function namesGitCode(text: string): string | null {
  // Its words as written and with their quotes taken out (`"co"nfig`), but for a quoted text holding a line end, as a
  // commit message does.
  const unquoted = textPieces(text).flat().filter((w) => !w.includes('\n')).flatMap((w) => w.split(/[\s()]+/))
  const words = [...withoutDocs(text).split(/[\s"'`()]+/), ...unquoted]
  if (!words.some(gitWord)) return null
  if (!words.some((w) => w === 'config' || w.startsWith('-c') || w.startsWith('--config') || w.startsWith('--te') || path.basename(w) === 'git-config')) return null
  for (const w of words) {
    const t = w.replace(/^(?:-c|--config-env=|--config=)/, '')
    const eq = t.indexOf('=')
    const key = eq < 0 ? t : t.slice(0, eq)
    if (!key.includes('.') || /[$`]/.test(key)) continue
    if (gitCodeKey(key, eq < 0 || eq === t.length - 1 ? undefined : t.slice(eq + 1))) return key
  }
  return null
}

/**
 * What a command sets that makes git run a program (`gitCommandSetsCode`, inside its scripts too), or a variable that
 * does so set or exported anywhere in a command that runs git (`GIT_PAGER`, `GIT_CONFIG_PARAMETERS`, a
 * `GIT_CONFIG_KEY_<n>` naming such a key). A part the guard cannot read word by word is read by its text: each run from
 * a `git` word to the next separator. Null when it sets none.
 */
function setsGitCode(command: string): string | null {
  const scan = gitScan(command, 0)
  return scan.key ?? (scan.runsGit ? scan.variable : null)
}

function gitScan(command: string, depth: number): { key: string | null; runsGit: boolean; variable: string | null } {
  let runsGit = false
  let variable: string | null = null
  for (const segment of commandSegments(command)) {
    const words = shellWords(segment)
    onTime()
    if (!words) {
      for (const piece of textPieces(segment)) {
        for (const [name, value] of gitRuns(piece).assignments) variable ??= gitVariable(name, value)
        const at = piece.findIndex(gitWord)
        if (at < 0) continue
        runsGit = true
        const name = path.basename(piece[at]!)
        const key = gitCommandSetsCode(name === 'git' ? piece.slice(at) : ['git', name.slice(4), ...piece.slice(at + 1)], at > 0)
        if (key) return { key, runsGit, variable }
      }
      const named = namesGitCode(segment)
      if (named) return { key: named, runsGit: true, variable }
      continue
    }
    for (const script of new Set(innerCommands(words).scripts)) {
      if (depth >= 4) return { key: 'a script nested too deep', runsGit, variable }
      const inner = gitScan(script, depth + 1)
      if (inner.key) return inner
      runsGit ||= inner.runsGit
      variable ??= inner.variable
    }
    const found = gitRuns(words)
    for (const [name, value] of found.assignments) variable ??= gitVariable(name, value)
    for (const { run, fed } of found.runs) {
      runsGit = true
      const key = gitCommandSetsCode(run, fed)
      if (key) return { key, runsGit, variable }
    }
  }
  return { key: null, runsGit, variable }
}

/** A variable that makes git run a program, by its name and value; a pager or editor that runs nothing passes. */
function gitVariable(name: string, value: string): string | null {
  if (GIT_PAGERS.has(name) && noOpPager(value)) return null
  if (GIT_EDITORS.has(name) && noOpEditor(value)) return null
  if ((name === 'GIT_CONFIG_GLOBAL' || name === 'GIT_CONFIG_SYSTEM') && value === '/dev/null') return null
  if (GIT_PROGRAM_VARS.has(name)) return name
  return /^GIT_CONFIG_KEY_\d+$/.test(name) && gitCodeKey(value, undefined) ? name : null
}

const gitCodeReason = (what: string) =>
  `this command sets ${what} for git, which makes git run a program, now or when the operator next runs it: an agent never does; the operator sets it by hand.`

const KEYCHAIN_REASON =
  "this command runs macOS's `security` in a way that can print a secret from a keychain (a password, a key, the whole keychain), or runs what it is sent: it is never run. Certificates, identities and keychains may be listed, and an item's attributes found without -w or -g."

/**
 * Whether a command runs macOS's `security` as the fallback's keychain rule refuses: by the words of each part as the
 * shell reads them (a quoted text is one word), inside its scripts too; a part it cannot read word by word, by the
 * check by name's reading.
 */
function printsKeychainSecret(command: string, names = keychainNames(command), depth = 0): boolean {
  return commandSegments(command).some((segment) => {
    const words = shellWords(segment)
    if (!words) return commandRunsKeychainSecret(segment, undefined, names)
    const inner = innerCommands(words)
    if (inner.unplaced || inner.scripts.some((script) => depth >= 4 || printsKeychainSecret(script, names, depth + 1))) {
      return inner.unplaced ? commandRunsKeychainSecret(segment, undefined, names) : true
    }
    // A brace group the shell writes out (`{security,dump-keychain}`) is read as written out.
    return keychainSecretInWords(words, names, false) || (/\{[^{},]*,[^{}]*\}/.test(segment) && commandRunsKeychainSecret(segment, undefined, names))
  })
}

/** Commands that print configuration values outright. Written as expressions, but tested only through `linearPattern`. */
export const VALUE_PRINTER_SOURCES: readonly RegExp[] = [
  /^docker(?:-compose|\s+compose)\b.*\sconfig\b/,
  /^kubectl\b.*\bget\s+secrets?\b.*(?:-o\s*|--output[=\s])(?:yaml|json|jsonpath|go-template)/,
  /^kubectl\b.*\bdescribe\b.*\bsecrets?\b.*(?:-o|--output)/,
  /^terraform\s+(?:show|output)\b/,
  /^printenv\b/,
  /^env\s*$/,
  /^helm\s+get\s+(?:values|all|manifest)\b/,
  /^sops\s+(?:-d|--decrypt|decrypt)\b/,
]
// Two `.*` around a word backtrack over a long line; read in one pass instead.
const VALUE_PRINTERS: readonly LinearPattern[] = VALUE_PRINTER_SOURCES.map((re) => linearPattern(re.source, re.flags))

const NAMES_ONLY = /^(?:-l|-L|-c|--files-with-matches|--files-without-match|--files-without-matches|--count|--count-matches|--name-only|--files)$/

/**
 * Whether a search's flags make it print only names or counts. Each tool's own meaning: `-L` lists the files without a
 * match for grep, git grep, ugrep, ag and ack, but makes ripgrep follow links, so for `rg` it never does.
 */
function searchNamesOnly(cmd: string, flags: readonly string[]): boolean {
  // A short group ends at a letter taking a value (`-eclient` is a pattern, not `-c`).
  const shortFlags = flags.filter((w) => /^-[A-Za-z]/.test(w) && !w.startsWith('--')).map((w) => {
    let out = ''
    for (const c of w.slice(1)) {
      if (!/[A-Za-z]/.test(c) || 'efgmtTABCMjdD'.includes(c) || (path.basename(cmd) === 'rg' && 'rE'.includes(c))) break
      out += c
    }
    return out
  }).join('')
  if (path.basename(cmd) === 'rg') return flags.some((w) => w !== '-L' && NAMES_ONLY.test(w)) || /[lc]/.test(shortFlags)
  return flags.some((w) => NAMES_ONLY.test(w)) || /[lLc]/.test(shortFlags)
}

/** A recursive content search: its directory operands, or null when the command is not one. */
function recursiveSearch(words: string[]): string[] | null {
  const [cmd, ...rest] = words
  const flags = rest.filter((w) => w.startsWith('-'))
  const shortFlags = flags.filter((w) => /^-[A-Za-z]+$/.test(w)).join('')
  const namesOnly = searchNamesOnly(cmd ?? '', flags)
  const operands = rest.filter((w) => !w.startsWith('-'))
  if (cmd === 'grep' || cmd === 'egrep' || cmd === 'fgrep') {
    if (!(/[rR]/.test(shortFlags) || flags.includes('--recursive') || flags.includes('--dereference-recursive')) || namesOnly) return null
    return operands.slice(1).length ? operands.slice(1) : ['.']
  }
  // ugrep (`ug`, and the grep of a sandboxed shell on macOS) searches folders by default, as rg does.
  if (cmd === 'rg' || cmd === 'ag' || cmd === 'ack' || cmd === 'ugrep' || cmd === 'ug') {
    if (namesOnly) return null
    return operands.slice(1).length ? operands.slice(1) : ['.']
  }
  if (cmd === 'git' && rest[0] === 'grep') {
    if (namesOnly) return null
    const ops = rest.slice(1).filter((w) => !w.startsWith('-'))
    return ops.slice(1).length ? ops.slice(1) : ['.']
  }
  return null
}

/**
 * Where `cd` or `pushd` goes: its operand after the options (`--`, `-P`, `-L`, `-e`, `-@`); with no
 * operand, the home folder (outside the project); null when it cannot be told (`cd -`, `popd`, a bare `pushd`).
 */
function changeDirectory(words: string[], base: string, home: string): string | null {
  if (words[0] === 'popd') return null
  let i = 1
  while (i < words.length && /^-[PLe@]+$/.test(words[i]!)) i++
  if (words[i] === '--') i++
  const operand = words[i]
  // A bare `pushd` swaps to the folder below it on the stack.
  if (operand === undefined) return words[0] === 'pushd' ? null : home
  if (operand === '-' || operand.startsWith('+') || (words[0] === 'pushd' && /^-\d/.test(operand))) return null
  return path.resolve(base, operand)
}

/** Commands that read only names, sizes or counts of the files they are given. */
const NAME_READERS = new Set(['ls', 'stat', 'file', 'du', 'basename', 'dirname', 'realpath', 'readlink', 'echo', 'printf', 'test', '[', 'true', 'wc'])

/** Whether a reader command (with its arguments) prints file contents. */
function readsContent(words: string[]): boolean {
  const [cmd, ...rest] = words
  if (!cmd) return false
  if (NAME_READERS.has(path.basename(cmd))) return path.basename(cmd) === 'wc' ? !rest.some((w) => /^-[clmw]+$/.test(w)) : false
  if (['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ugrep', 'ug'].includes(path.basename(cmd))) {
    return !searchNamesOnly(cmd, rest.filter((w) => w.startsWith('-')))
  }
  return true
}

/** xargs's command: the words after its own options (those taking a value skip it). */
function xargsCommand(words: string[]): string[] {
  let i = 1
  while (i < words.length && words[i]!.startsWith('-')) {
    const w = words[i]!
    if (w === '--') {
      i++
      break
    }
    i += /^-[nIPLdsEaS]$/.test(w) ? 2 : 1
  }
  return words.slice(i)
}

/** find's start directories (its operands before the first expression word); `.` when none. */
function findStarts(words: string[]): string[] {
  const starts: string[] = []
  for (const w of words.slice(1)) {
    if (/^[-(!]/.test(w) || w === ')') break
    starts.push(w)
  }
  return starts.length ? starts : ['.']
}

/** The commands find runs on what it finds (`-exec`, `-execdir`, `-ok`, `-okdir`). */
function findExecs(words: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < words.length; i++) {
    if (!/^-(exec|execdir|ok|okdir)$/.test(words[i]!)) continue
    const cmd: string[] = []
    for (i++; i < words.length && words[i] !== ';' && words[i] !== '+'; i++) cmd.push(words[i]!)
    out.push(cmd)
  }
  return out
}

/** What makes a command that names a secret file differ from the workflow's name-only search it resembles. */
function nearMiss(segment: string): string | null {
  const toks = shellTokens(segment)
  const words = toks?.map((t) => t.value) ?? []
  const looks = /^grep\s+-lwF\b/.test(segment) ? 'name' : /^git\s+ls-files\b/.test(segment) ? 'tracked' : /^grep\s+-rliE\b/.test(segment) ? 'manifest' : null
  if (!looks) return null
  if (!toks) return 'it holds a variable, a substitution or an escape: write the command out in full'
  const dd = toks.findIndex((t) => t.raw === '--')
  if (dd < 0) return "it has no `--` before the operands"
  const bad = toks.slice(dd + 1).find((t) => !t.quoted && !isSafeBarePath(t.value))
  if (bad || toks.slice(dd + 1).some((t) => t.raw.startsWith('"'))) return "quote each path in single quotes ('<path>')"
  if (looks === 'name') {
    const names = words.slice(dd + 1).filter((w) => w.startsWith('name: '))
    if (names.length !== 1) return 'one Secret name per command'
    if (toks.slice(0, dd + 1).map((t) => t.raw).join(' ') !== 'grep -lwF -d skip --') return "use exactly `grep -lwF -d skip -- 'name: <secret-name>' '<file>'`"
    return 'the name is not a Kubernetes object name'
  }
  if (looks === 'tracked') return "use exactly `git ls-files --format='%(objectmode) %(path)' -- '<path>'`"
  return "use the workflow's Secret-manifest pattern verbatim, on one folder"
}

/**
 * The command with its comment runs removed (a `#` at a word start, outside quotes, here-documents, arithmetic and
 * `${…}`, to the end of its line), and the command as written, when they differ. The guard's lexer reads a `#` as an
 * ordinary character, so a quote inside a comment desyncs its quote tracking and hides the commands after it, which
 * the shell runs. Both readings are judged, and the call is refused if either is: a `#` this reads as a comment that
 * the shell does not only removes commands from one reading, which the other still holds, so erring toward a comment
 * only adds denials.
 */
export function commentReadings(command: string): string[] {
  let out = ''
  let docs: Array<[string, boolean]> = []
  let wordStart = true
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (c === "'") {
      const close = command.indexOf("'", i + 1)
      const end = close < 0 ? command.length : close
      out += command.slice(i, end + 1)
      i = end
      wordStart = false
    } else if (c === '$' && command[i + 1] === "'") {
      let j = i + 2
      while (j < command.length && command[j] !== "'") j += command[j] === '\\' ? 2 : 1
      out += command.slice(i, j + 1)
      i = j
      wordStart = false
    } else if (c === '"') {
      let j = i + 1
      while (j < command.length && command[j] !== '"') j += command[j] === '\\' ? 2 : 1
      out += command.slice(i, j + 1)
      i = j
      wordStart = false
    } else if (c === '\\') {
      out += command.slice(i, i + 2)
      i++
      // A line continuation (`\\` then a newline) the shell removes before tokenizing, so it is transparent to word
      // boundaries: the `#` after it is at a word start exactly when it was before. An escaped character is not.
      if (command[i] !== '\n') wordStart = false
    } else if (c === '$' && (command[i + 1] === '(' || command[i + 1] === '{' || command[i + 1] === '[' || command.startsWith('((', i + 1))) {
      // A substitution or an expansion, up to its matching close, read as one span: a `#` inside it is no comment.
      const open = command[i + 1] === '(' || command.startsWith('((', i + 1) ? '(' : command[i + 1] === '{' ? '{' : '['
      const shut = open === '(' ? ')' : open === '{' ? '}' : ']'
      let depth2 = 0
      let j = i + 1
      for (; j < command.length; j++) {
        if (command[j] === open) depth2++
        else if (command[j] === shut && --depth2 === 0) break
      }
      out += command.slice(i, (j < command.length ? j : command.length - 1) + 1)
      i = j
      wordStart = false
    } else if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      const dash = command[i + 2] === '-'
      let j = i + (dash ? 3 : 2)
      while (command[j] === ' ' || command[j] === '\t') j++
      let delim = ''
      for (; j < command.length && !/[\s;&|()<>]/.test(command[j]!); j++) {
        const q = command[j]!
        if (q === "'" || q === '"') {
          const close = command.indexOf(q, j + 1)
          if (close < 0) { j = command.length; break }
          delim += command.slice(j + 1, close)
          j = close
        } else if (q !== '\\') delim += q
      }
      out += command.slice(i, j)
      i = j - 1
      if (delim) docs.push([delim, dash])
      wordStart = false
    } else if (c === '\n') {
      out += c
      if (docs.length) {
        // Each here-document body, kept as written: its `#` lines are no comments.
        let k = i + 1
        for (const [delim, strip] of docs) {
          for (;;) {
            const nl = command.indexOf('\n', k)
            const line = command.slice(k, nl < 0 ? command.length : nl)
            if ((strip ? line.replace(/^\t+/, '') : line) === delim || nl < 0) { out += command.slice(i + 1, nl < 0 ? command.length : nl + 1); k = nl < 0 ? command.length : nl + 1; break }
            k = nl + 1
          }
        }
        docs = []
        i = k - 1
      }
      wordStart = true
    } else if (c === '#' && wordStart) {
      const nl = command.indexOf('\n', i)
      i = nl < 0 ? command.length : nl - 1
    } else {
      out += c
      wordStart = c === ' ' || c === '\t' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '`'
    }
  }
  return out === command ? [command] : [command, out]
}

function decideBash(command: string, cwd: string, j: Judge, home: string, depth = 0): GuardDecision {
  let base: string | null = cwd
  // A backslash at a line's end continues the command on the next line, as the shell reads it.
  const segments = commandSegments(command.replace(/\\\r?\n/g, ''))
  const parsed = segments.map((segment) => ({ segment, words: shellWords(segment) }))
  // xargs running a reader reads files whose names another command of the line produces: the folders
  // those commands name are read in full, as a recursive search's are.
  const fedReader = parsed.some((x) => x.words?.[0] === 'xargs' && readsContent(xargsCommand(x.words)))
  for (const { segment, words } of parsed) {
    if (sanctionedSecretCommand(segment)) continue
    if (VALUE_PRINTERS.some((re) => re.test(segment, onTime))) return deny(`\`${segment.slice(0, 80)}\` prints configuration values, which may hold secrets: it is never run. Take names from the files' structure instead.`)
    if (!words || base === null) {
      // Not readable without a shell, or run from a folder the guard cannot tell: judged by its text.
      const named = textualSecret(segment)
      if (named) {
        const hint = nearMiss(segment)
        return deny(secretReason(named.rel, named.cls, true) + (hint ? ` This is close to one of those searches, but: ${hint}.` : ''))
      }
      continue
    }
    // Command lines a command runs inside it (a shell's `-c` script anywhere in it, an `env -S` string)
    // are judged as command lines of their own, from the same folder.
    const inner = innerCommands(words)
    if (inner.unplaced) return deny(uncheckedReason(`\`${segment.slice(0, 120)}\``, 'a shell is given -c with no script the guard can read'))
    for (const script of inner.scripts) {
      const v = depth < 4 ? decideBash(script, base, j, home, depth + 1) : deny(uncheckedReason(`\`${segment.slice(0, 120)}\``, 'shells nested too deep'))
      if (v.deny) return v
    }
    if (words[0] === 'cd' || words[0] === 'pushd' || words[0] === 'popd') {
      base = changeDirectory(words, base, home)
      continue
    }
    // `env -C` runs its command in another folder, and a subshell's `cd` may have ended: the command is
    // judged from each folder it may run in.
    const chdir = envFolder(words)
    const segBase = chdir === undefined ? base : path.resolve(base, chdir.replace(/^~(?=\/|$)/, home))
    try {
      let v: FileVerdict = { secret: false }
      for (const b of new Set([segBase, base, cwd])) {
        v = judgeSegment(words, b, fedReader, j)
        if (v.secret) break
      }
      if (v.secret) {
        const hint = nearMiss(segment)
        return deny(secretReason(v.rel, v.cls, true) + (hint ? ` This is close to one of those searches, but: ${hint}.` : ''))
      }
    } catch (e) {
      // What cannot be checked (a folder or a glob past the bound or the deadline, a file that cannot
      // be scanned) is not run, as for a read.
      if (e instanceof Unchecked) return deny(uncheckedReason(`\`${segment.slice(0, 120)}\``, e.message))
      throw e
    }
  }
  return ALLOW
}

/** The first secret file one simple command reaches, from `base`. */
function judgeSegment(words: string[], base: string, fedReader: boolean, j: Judge): FileVerdict {
  // echo and printf print their words and read no file, unless what they print feeds a reader (xargs).
  if ((words[0] === 'echo' || words[0] === 'printf') && !fedReader) return { secret: false }
  const isXargs = words[0] === 'xargs'
  const dirs = [
    ...(recursiveSearch(words) ?? []),
    ...(words[0] === 'find' && (fedReader || findExecs(words).some(readsContent)) ? findStarts(words) : []),
  ]
  for (const d of dirs) {
    // A folder operand with a glob qualifier (`src(N)`) names the folder the glob names; the walk reads it in full.
    for (const dir of [d, ...(withoutQualifier(d) !== null ? [withoutQualifier(d)!] : [])]) {
      const v = secretBelow(path.resolve(base, dir), null, j)
      if (v.secret) return v
    }
  }
  // find's expression is patterns, not paths: only the files its commands name are judged. xargs's own
  // options are not paths; its command's `{}` stands for any name.
  const operands =
    words[0] === 'find'
      ? findExecs(words).flatMap((c) => c.slice(1)).filter((w) => w !== '{}')
      : isXargs
        ? xargsCommand(words).slice(1).map((w) => w.replaceAll('{}', '*'))
        : words.slice(1)
  for (const w of operands) {
    for (const p of wordPaths(w)) {
      for (const f of expand(p, base, j)) {
        // A folder named in a line where xargs runs a reader: the names it yields are read in full.
        if (fedReader && !isXargs && words[0] !== 'find' && isDirectory(f)) {
          const v = secretBelow(f, null, j)
          if (v.secret) return v
          continue
        }
        const v = judgeFile(f, j)
        if (v.secret) return v
      }
    }
  }
  return { secret: false }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** A secret file's name anywhere in the text (for a command the guard cannot tokenise). */
function textualSecret(text: string): { rel: string; cls: string } | null {
  for (const m of text.matchAll(/[A-Za-z0-9._~@:/-]+/g)) {
    for (const piece of m[0].split(/[=:@]/)) {
      const rel = piece.replace(/^\.?\//, '').replace(/^~\//, '')
      if (!rel || rel.startsWith('/')) continue
      const cls = secretPathClass(rel)
      if (cls && cls !== 'unclassifiable') return { rel, cls }
    }
  }
  return null
}

// ── the decision ─────────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** What a content search refused over a folder can do instead, named in the harness's own search tool. */
const FOLDER_SEARCH_WAY = {
  claude: 'search a narrower path, exclude it with glob, or list file names only (output_mode files_with_matches).',
  opencode: 'search a narrower path, or narrow include so it matches no secret file; to list file names only, run the ' +
    'name-only shell search the secret-file instructions give.',
} as const

export function decideSecretAccess(raw: RawEvent, g: SecretGuardEnv, search: keyof typeof FOLDER_SEARCH_WAY = 'claude'): GuardDecision {
  return oneDecision(g, () => decideSecretAccessOnce(raw, g, search))
}

function decideSecretAccessOnce(raw: RawEvent, g: SecretGuardEnv, search: keyof typeof FOLDER_SEARCH_WAY): GuardDecision {
  let event: Record<string, unknown> | undefined
  try {
    const parsed = raw.text === null ? undefined : (JSON.parse(raw.text) as unknown)
    event = isRecord(parsed) ? parsed : undefined
  } catch {
    event = undefined
  }
  const field = (name: string) => raw.fields.get(name)?.[0]
  const tool = str(event?.tool_name) ?? field('tool_name')
  const input = isRecord(event?.tool_input) ? event.tool_input : undefined
  const cwd = str(event?.cwd) ?? field('cwd') ?? g.cwd

  // The server's own folder in the home directory, whatever the project: by the path and through links.
  const home = str(g.env.HOME) ?? os.homedir()
  const stateRoots = [stateRoot(home)]
  if (tool === 'Bash') {
    const command = str(input?.command) ?? field('command')
    if (!command) return ALLOW
    // Both the command as written and with comments removed (see `commentReadings`): a secret reached by either is refused.
    for (const reading of commentReadings(command)) {
      if (decision) decision.braces = bracesMayExpand(reading)
      // Judged on its own: a command the check cannot read is denied, never left to the project's checks below.
      let reached: ShellRoot | null
      try {
        reached = reachedRoot(reading, cwd, home, folding(g), stateRoots, cdPathOf(g)) ??
          reachedRoot(reading, cwd, home, folding(g), signInRoots(g, home), { ...homeVarsOf(g), ...cdPathOf(g) })
      } catch (e) {
        return deny(uncheckedReason(`\`${reading.slice(0, 120)}\``, e instanceof Unchecked ? e.message : 'its words could not be placed'))
      }
      if (reached) return deny(reached.reason)
      // Wherever it runs, project or not.
      if (printsKeychainSecret(reading)) return deny(KEYCHAIN_REASON)
      let gitKey: string | null
      try {
        gitKey = setsGitCode(reading)
      } catch (e) {
        return deny(uncheckedReason(`\`${reading.slice(0, 120)}\``, e instanceof Unchecked ? e.message : 'its words could not be placed'))
      }
      if (gitKey) return deny(gitCodeReason(gitKey))
      let d: GuardDecision
      try {
        d = withPlace(cwd, g, (j) => decideBash(reading, cwd, j, home))
      } catch {
        const named = textualSecret(reading)
        d = named ? deny(secretReason(named.rel, named.cls, true)) : ALLOW
      }
      if (d.deny) return d
    }
    return ALLOW
  }
  // The hook is routed Read, Grep and Bash only: a call whose tool cannot be told is not run.
  if (tool === undefined) return deny(uncheckedReason('This call', 'the event could not be read'))
  if (tool !== 'Read' && tool !== 'NotebookRead' && tool !== 'Grep') return ALLOW

  const target = str(input?.file_path) ?? str(input?.notebook_path) ?? str(input?.path) ?? field('file_path') ?? field('notebook_path') ?? field('path')
  try {
    // A read or search inside the server's folder or a harness's sign-in, and a search over a folder holding one (a
    // names-only search too: its patterns can spell out a file's content), is never run.
    if (target || tool === 'Grep') {
      // A path the harness would expand from ~ is judged as the home directory it names.
      const named = target === '~' ? home : target?.startsWith('~/') ? path.join(home, target.slice(2)) : target
      const at = path.resolve(cwd, named ?? '.')
      const signIns = signInRoots(g, home)
      const inside = insideRoot(at, stateRoots, folding(g)) ?? insideRoot(at, signIns, folding(g))
      if (inside) return deny(inside.reason)
      if (tool === 'Grep' && holdsRoot(at, stateRoots, folding(g))) return deny(STATE_ROOT_SEARCH_REASON)
      if (tool === 'Grep' && holdsRoot(at, signIns, folding(g))) return deny(SIGN_IN_REASON)
    }
    return withPlace(cwd, g, (j) => {
      if (tool === 'Grep') {
        const dir = path.resolve(cwd, target ?? '.')
        // Unset, the mode is names only; unknown (an event that could not be read whole), it is content.
        const mode = str(input?.output_mode) ?? field('output_mode') ?? (event ? 'files_with_matches' : 'content')
        let st
        try {
          st = statSync(dir)
        } catch {
          return ALLOW
        }
        if (!st.isDirectory()) {
          const v = judgeFile(dir, j)
          return v.secret ? deny(secretReason(v.rel, v.cls, false)) : ALLOW
        }
        if (mode === 'files_with_matches') return ALLOW
        const v = secretBelow(dir, simpleGlob(input?.glob ?? field('glob')), j)
        return v.secret
          ? deny(`${secretReason(v.rel, v.cls, false)} A search that shows lines never runs over a folder holding one: ${FOLDER_SEARCH_WAY[search]}`)
          : ALLOW
      }
      if (!target) throw new Unchecked('no file is named')
      const v = judgeFile(path.resolve(cwd, target), j)
      return v.secret ? deny(secretReason(v.rel, v.cls, false)) : ALLOW
    })
  } catch (e) {
    return deny(uncheckedReason(target ? `\`${target.slice(0, 200)}\`` : tool === 'Grep' ? 'This search' : 'This read', e instanceof Unchecked ? e.message : 'an internal error'))
  }
}

/**
 * OpenCode's event, from the plugin's `tool.execute.before` ({ tool, args, directory }), decided as the
 * Claude call it stands for: `read` a Read, `grep` a content Grep (it prints lines; `include` is its
 * glob), `bash` a Bash run in `args.workdir` (resolved from `directory`) when it names one, `glob` and
 * `list` names only. Before that, whatever the project, a path or a working folder inside the server's
 * own folder in the home directory, as written or through links and `..`, and a shell command reaching
 * it, are denied; so is a bash call with no command. An event too large to read whole is decided on
 * the fields recovered from it; one that names no tool denies the call.
 */
export function decideOpenCodeAccess(raw: RawEvent, g: SecretGuardEnv): GuardDecision {
  return oneDecision(g, () => decideOpenCodeAccessOnce(raw, g))
}

function decideOpenCodeAccessOnce(raw: RawEvent, g: SecretGuardEnv): GuardDecision {
  let e: Record<string, unknown> | undefined
  try {
    const parsed = raw.text === null ? undefined : (JSON.parse(raw.text) as unknown)
    e = isRecord(parsed) ? parsed : undefined
  } catch {
    e = undefined
  }
  const field = (name: string) => raw.fields.get(name)?.[0]
  const tool = e ? str(e.tool) : field('tool')
  const args: Record<string, unknown> = e
    ? isRecord(e.args) ? e.args : {}
    : { filePath: field('filePath'), path: field('path'), include: field('include'), command: field('command'), workdir: field('workdir') }
  const directory = (e ? str(e.directory) : field('directory')) ?? g.cwd
  const as = (tool_name: string, tool_input: Record<string, unknown>, cwd = directory) =>
    decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name, tool_input, cwd })), g, 'opencode')
  // The server's own folder in the home directory, whatever the project: by the path and through links.
  const home = str(g.env.HOME) ?? os.homedir()
  const roots = [stateRoot(home)]
  const inside = (p: unknown) => (str(p) ? insideRoot(path.resolve(directory, String(p)), roots, folding(g)) : null)
  if (tool === 'read' || tool === 'grep') {
    let hit: ShellRoot | null
    try {
      hit = inside(tool === 'read' ? args.filePath : args.path)
    } catch (e) {
      return deny(uncheckedReason(tool === 'read' ? 'This read' : 'This search', e instanceof Unchecked ? e.message : 'an internal error'))
    }
    if (hit) return deny(hit.reason)
  }
  if (tool === 'read') return as('Read', { file_path: args.filePath })
  if (tool === 'grep') return as('Grep', { pattern: args.pattern, path: args.path, glob: args.include, output_mode: 'content' })
  if (tool === 'bash') {
    const command = str(args.command)
    if (!command) return deny(uncheckedReason('This command', 'the call carries no command'))
    const cwd = str(args.workdir) ? path.resolve(directory, String(args.workdir)) : directory
    for (const reading of commentReadings(command)) {
      if (decision) decision.braces = bracesMayExpand(reading)
      let hit: ShellRoot | null
      try {
        hit = inside(cwd) ?? reachedRoot(reading, cwd, home, folding(g), roots, cdPathOf(g))
      } catch (e) {
        return deny(uncheckedReason(`\`${reading.slice(0, 120)}\``, e instanceof Unchecked ? e.message : 'its words could not be placed'))
      }
      if (hit) return deny(hit.reason)
    }
    return as('Bash', { command }, cwd)
  }
  if (tool === 'glob' || tool === 'list') return ALLOW
  return tool ? ALLOW : deny(uncheckedReason('This call', 'the event could not be read'))
}

/** The decision as OpenCode's plugin reads it: `{"deny":false}`, or `{"deny":true,"reason":…}`. */
export function openCodeOutput(d: GuardDecision): string {
  return JSON.stringify(d.deny ? { deny: true, reason: d.reason } : { deny: false })
}

// ── Codex ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The command a wrapper runs: past `exec`, `command`, `builtin`, `nohup`, `env` (its options and
 * `NAME=value` words), `nice`, `timeout` (its duration), `stdbuf`, `sudo`, `doas` and `time`, each with
 * its own options.
 */
function unwrapped(words: string[]): string[] {
  let w = words
  for (let n = 0; n < 8 && w.length; n++) {
    const cmd = path.basename(w[0]!)
    let i = 1
    if (cmd === 'exec' || cmd === 'command' || cmd === 'builtin' || cmd === 'nohup') {
      while (i < w.length && w[i]!.startsWith('-')) i++
    } else if (cmd === 'env') {
      while (i < w.length && (w[i]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!))) i += /^(?:-[uCS]|--unset|--chdir|--split-string)$/.test(w[i]!) ? 2 : 1
    } else if (cmd === 'nice') {
      while (i < w.length && w[i]!.startsWith('-')) i += w[i] === '-n' ? 2 : 1
    } else if (cmd === 'timeout') {
      while (i < w.length && w[i]!.startsWith('-')) i += /^(?:-[sk]|--signal|--kill-after)$/.test(w[i]!) ? 2 : 1
      i++
    } else if (cmd === 'stdbuf') {
      while (i < w.length && w[i]!.startsWith('-')) i += /^-[ioe]$/.test(w[i]!) ? 2 : 1
    } else if (cmd === 'sudo' || cmd === 'doas') {
      while (i < w.length && w[i]!.startsWith('-')) i += /^-[ugpCDhRTUr]$/.test(w[i]!) ? 2 : 1
    } else if (cmd === 'time') {
      while (i < w.length && w[i]!.startsWith('-')) i++
    } else return w
    w = w.slice(i)
  }
  return w
}

const SHELL = /^(?:ba|z|da|k|fi|c|tc)?sh$/

/**
 * The script the shell at `words[at]` runs with `-c`: the first word after its options once `-c` was
 * given (`--`, `-x` and the like skipped, `--rcfile F` and `-o name` taking their value); undefined
 * when it has no `-c`, null when the script is missing.
 */
function cScript(words: string[], at: number): string | null | undefined {
  let seen = false
  for (let k = at + 1; k < words.length; k++) {
    const a = words[k]!
    if (a === '--') {
      if (!seen) return undefined
      continue
    }
    if (/^(?:--rcfile|--init-file|[-+]o|[-+]O)$/.test(a)) k++
    else if (/^-[A-Zabd-z]*c[A-Za-z]*$/.test(a)) seen = true
    else if (!a.startsWith('-') && !a.startsWith('+')) return seen ? a : undefined
  }
  return seen ? null : undefined
}

/** The script a shell runs with `-c` (after any wrapper), or null when the words start no such shell. */
function shellScript(words: string[]): string | null {
  const w = unwrapped(words)
  if (!SHELL.test(path.basename(w[0] ?? ''))) return null
  const script = cScript(w, 0)
  return script === undefined ? null : (script ?? '')
}

/**
 * Command lines a simple command runs inside it: the `-c` script of a shell named anywhere in it
 * (`xargs sh -c …`, `find … -exec bash -c …`, behind wrappers) and an `env -S` string. `unplaced`
 * when a shell is given `-c` with no script the guard can read.
 */
function innerCommands(words: string[]): { scripts: string[]; unplaced: boolean } {
  const scripts: string[] = []
  let unplaced = false
  for (let i = 0; i < words.length; i++) {
    const name = path.basename(words[i]!)
    if (SHELL.test(name)) {
      const script = cScript(words, i)
      if (script === null) unplaced = true
      else if (script !== undefined) scripts.push(script)
    }
    if (name === 'env') {
      for (let k = i + 1; k < words.length; k++) {
        const a = words[k]!
        if (a === '-S' || a === '--split-string') scripts.push(words[++k] ?? '')
        else if (a.startsWith('--split-string=')) scripts.push(a.slice('--split-string='.length))
        else if (/^-S./.test(a)) scripts.push(a.slice(2))
        else if (!a.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) break
      }
    }
  }
  return { scripts, unplaced }
}

/** The folder `env -C`/`--chdir` runs its command in, when the words start with such an `env`. */
function envFolder(words: string[]): string | undefined {
  if (path.basename(words[0] ?? '') !== 'env') return undefined
  for (let k = 1; k < words.length; k++) {
    const a = words[k]!
    if (a === '-C' || a === '--chdir') return words[k + 1]
    if (a.startsWith('--chdir=')) return a.slice('--chdir='.length)
    if (/^-C./.test(a)) return a.slice(2)
    if (!a.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) return undefined
  }
  return undefined
}

/** The shell command of a Codex event: a string, or an argv, one that runs a shell with `-c` judged as its script. */
function codexCommand(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) return undefined
  const argv = v as string[]
  const script = shellScript(argv)
  if (script !== null) return script || undefined
  return argv.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ')
}

/** Shells and interpreters (versioned names too) that, started with no script, read what they run from their input. */
const INTERACTIVE = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|python\d*(?:\.\d+)*|node(?:js)?|irb|ruby\d*(?:\.\d+)*|perl\d*(?:\.\d+)*|script)$/
const ABOUT_ONLY = /^(?:-V|-v|--version|-h|--help)$/

/**
 * Whether a command starts a shell or an interpreter left waiting for input (past wrappers, inside
 * `sh -c`). A partial close only: input sent later to a command started with a script is not seen,
 * and other programs that run what they are sent (lua, php -a, sqlite3, an editor's `!`) are not
 * listed.
 */
function startsInteractive(command: string, depth = 0): boolean {
  return commandSegments(command).some((segment) => {
    const words = shellWords(segment)
    if (!words) return false
    const inner = innerCommands(words)
    if (inner.scripts.some((script) => depth < 4 && startsInteractive(script, depth + 1))) return true
    if (shellScript(words) !== null) return false
    const w = unwrapped(words)
    const name = path.basename(w[0] ?? '')
    if (!INTERACTIVE.test(name)) return false
    const args = w.slice(1)
    // `script` starts a shell unless it is given a command (`-c`, or a command after its file).
    if (name === 'script') return !args.some((a) => a === '-c' || a === '--command') && args.filter((a) => !a.startsWith('-')).length < 2
    // Reading the script from input (`-s`, `-`) or staying interactive after one (`-i`) waits for input too.
    if (args.some((a) => a === '-' || a === '-s' || a === '-i')) return true
    return args.every((a) => a.startsWith('-')) && !args.some((a) => ABOUT_ONLY.test(a))
  })
}

/** Commands that copy or pack a whole folder, with what is inside it. */
const FOLDER_COPIERS = new Set(['tar', 'zip', 'cp', 'rsync', 'scp', 'ditto', 'cpio'])

/** A place a shell command must not reach, the text that names it, and why. */
export interface ShellRoot {
  readonly dir: string
  readonly marker: string
  readonly reason: string
  /** A command that only reads may reach it (Codex reads its own skill files through the shell). */
  readonly readable?: boolean
}

/** Commands that read only names, sizes or counts (NAME_READERS but wc, which can read content), and a few more. */
const NAMES_ONLY_COMMANDS = new Set([...[...NAME_READERS].filter((c) => c !== 'wc'), 'pwd', 'tree', 'which', 'type'])

/** Whether a simple command reads no more than names: one of NAMES_ONLY_COMMANDS, or `find` without an action. */
function namesOnly(run: readonly string[]): boolean {
  const cmd = path.basename(run[0] ?? '')
  if (NAMES_ONLY_COMMANDS.has(cmd)) return true
  return cmd === 'find' && !run.some((a) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a))
}

/** `command -v` or `-V`, which a wrapper reading would take for running its operand: it only looks the name up. */
const commandLookup = (raw: readonly string[]): boolean => {
  const at = raw.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
  return path.basename(raw[at] ?? '') === 'command' && (raw[at + 1] === '-v' || raw[at + 1] === '-V')
}

/**
 * Whether a copier or archiver takes the names of what it copies from its input, or a file of names: `cpio`, `tar -T`,
 * `zip -@`, `rsync --files-from`, and `pax -w` naming no file.
 */
function readsNamesFromInput(run: readonly string[]): boolean {
  const name = path.basename(run[0] ?? '')
  const args = run.slice(1)
  if (name === 'cpio') return true
  // A list of names from a file or from input, as some readers take it.
  if (args.some((a) => /^--files0?-from(?:=|$)/.test(a) || a === '--stdin-paths' || ((name === 'xz' || name === 'zstd') && /^--files(?:=|$)/.test(a)))) return true
  if (name === 'tar' || name === 'bsdtar' || name === 'gtar') return args.some((a) => /^(?:-[A-Za-z]*T|--files-from)/.test(a))
  if (name === 'zip') return args.some((a) => a === '-@' || /^-[A-Za-z]*@/.test(a))
  if (name === 'rsync') return args.some((a) => a.startsWith('--files-from'))
  if (name === 'pax') return !args.some((a) => !a.startsWith('-'))
  return false
}

/** Whether a part holds a command or process substitution outside single quotes (`$(…)`, backticks, `<(…)`, `>(…)`). */
function hasSubstitution(segment: string): boolean {
  let quote: string | null = null
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote === "'") {
      if (c === "'") quote = null
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (c === '"') quote = quote === '"' ? null : '"'
    else if (c === "'" && quote === null) quote = "'"
    else if (c === '`' || (c === '$' && segment[i + 1] === '(') || ((c === '<' || c === '>') && segment[i + 1] === '(' && quote === null)) return true
  }
  return false
}

/** A part with its redirects (`2>/dev/null`, `>out`, `<<EOF`) and their targets taken out, quotes kept. */
function withoutRedirects(segment: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote) {
      out += c
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"') out += segment[++i] ?? ''
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      out += c
      continue
    }
    if (c === '\\') {
      out += c + (segment[++i] ?? '')
      continue
    }
    const atWord = i === 0 || /\s/.test(segment[i - 1]!)
    const op = (atWord ? /^(?:\d+|&)?(?:<<<|<<-?|>>|>&|<&|<>|>\||>|<)/ : /^(?:<<<|<<-?|>>|>&|<&|<>|>\||>|<)/).exec(segment.slice(i))
    if (!op) {
      out += c
      continue
    }
    // The operator, the blanks after it, and its target word, quoted or not.
    let j = i + op[0].length
    while (j < segment.length && /\s/.test(segment[j]!)) j++
    while (j < segment.length && !/[\s;&|]/.test(segment[j]!)) {
      if (segment[j] === "'" || segment[j] === '"') {
        const end = segment.indexOf(segment[j]!, j + 1)
        j = end < 0 ? segment.length : end + 1
      } else j++
    }
    out += ' '
    i = j - 1
  }
  return out
}

/**
 * The folders a command is told to work in, by the place of the word that holds each: `-C <dir>` (git, make, tar),
 * `-C<dir>`, `--directory`, `--chdir`, `--git-dir`, `--work-tree`.
 */
function optionFolders(words: readonly string[]): Map<number, string> {
  const out = new Map<number, string>()
  for (let i = 1; i < words.length; i++) {
    const a = words[i]!
    const long = /^--(?:directory|chdir|git-dir|work-tree)(?:=(.*))?$/.exec(a)
    if (long) {
      if (long[1] !== undefined) out.set(i, long[1])
      else if (words[i + 1] !== undefined) out.set(++i, words[i]!)
    } else if (a === '-C') {
      if (words[i + 1] !== undefined) out.set(++i, words[i]!)
    } else if (/^-C./.test(a)) out.set(i, a.slice(2))
  }
  return out
}

/**
 * Whether a part reads what another prints: an `xargs` or `parallel` running more than a names-only command, a loop or
 * `read`, `source` or `.`, a copier taking names from its input, or a shell or interpreter reading its input.
 */
function readsFed(run: readonly string[], raw: readonly string[], segment: string): boolean {
  const name = path.basename(run[0] ?? '')
  if (name === 'xargs') return !namesOnly(xargsCommand([...run]))
  if (name === 'parallel') return !namesOnly(run.slice(1))
  return LOOPS.has(name) || LOOPS.has(raw[0] ?? '') || SOURCING.has(name) || readsNamesFromInput(run) || startsInteractive(segment)
}

/** A word with each command substitution in it read as `*`, anything it may produce; null when it holds none. */
function builtAsAny(word: string): string | null {
  if (!/\$\(|`/.test(word)) return null
  return word.replace(/\$\((?:[^()]|\([^()]*\))*\)?|`[^`]*`?/g, '*')
}

/** Words that start a loop or read a line: what a line prints may be read through them. */
const LOOPS = new Set(['while', 'until', 'for', 'select', 'read', 'mapfile', 'readarray'])
/** Commands that run a file, or their input, in this shell. */
const SOURCING = new Set(['source', '.'])

/**
 * The text with each `${NAME}`, `${NAME…}` (`-`, `=`, `?`, `+`, with or without `:`, up to the next `}`) and `$NAME` (not
 * followed by a name's character) written as `value`, read left to right, in one pass: the next `}` is looked up again
 * only once passed, however many forms are left open.
 */
export function withVariable(text: string, name: string, value: string): string {
  const braced = `\${${name}`
  const plain = `$${name}`
  let out = ''
  let from = 0
  const nextClose = nextOf(text, '}')
  for (let i = text.indexOf('$'); i >= 0 && i < text.length; i = text.indexOf('$', i)) {
    let end = -1
    if (text.startsWith(braced, i)) {
      const k = i + braced.length
      const g = text[k] === ':' ? k + 1 : k
      if (text[k] === '}') end = k + 1
      else if (text[g] !== undefined && '-=?+'.includes(text[g]!)) {
        const c = nextClose(g + 1)
        if (c >= 0) end = c + 1
      }
    }
    if (end < 0 && text.startsWith(plain, i) && !/[A-Za-z0-9_]/.test(text[i + plain.length] ?? '')) end = i + plain.length
    if (end < 0) {
      i++
      continue
    }
    out += text.slice(from, i) + value
    from = end
    i = end
  }
  return out + text.slice(from)
}

/**
 * The text without its quoted parts: each '…' and each "…" (a backslash in double quotes escapes one character, not a
 * line end), read left to right, an unclosed one kept. One pass: a double quote that finds no end at f is not looked
 * at again for any double quote before f, since each would scan on to the same f.
 */
export function withoutQuoted(text: string): string {
  let out = ''
  let from = 0
  // No double quote before this place can be closed.
  let failsUntil = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      // An unclosed one is the last single quote: none is left to look for.
      const end = text.indexOf("'", i + 1)
      if (end >= 0) {
        out += text.slice(from, i)
        from = end + 1
        i = end
      }
    } else if (c === '"' && i >= failsUntil) {
      let k = i + 1
      for (; k < text.length && text[k] !== '"'; k++) {
        if (text[k] !== '\\') continue
        if (k + 1 === text.length || LINE_ENDS.has(text[k + 1]!)) break
        k++
      }
      if (text[k] === '"') {
        out += text.slice(from, i)
        from = k + 1
        i = k
      } else failsUntil = k
    }
  }
  return out + text.slice(from)
}

/**
 * Whether a command line passes what one part prints to another that may read it: an `xargs` or `parallel` running more
 * than a names-only command, a command or process substitution, a loop or `read`, or a copier taking names from its input
 * (`readsNamesFromInput`); and in a piped line, a script it cannot place, `source` or `.`, a shell or interpreter reading
 * its input, or a part that cannot be read word by word.
 */
function feedsReader(command: string, depth = 0): boolean {
  // A pipe (not `||`) outside quotes: only then can a part's input be another part's output.
  const piped = /(?<!\|)\|(?!\|)/.test(withoutQuoted(command))
  return commandSegments(command).some((segment) => {
    // A command or process substitution runs a command whose output becomes words of this one.
    if (hasSubstitution(segment)) return true
    // A loop is one by its first word, whether or not the rest can be read word by word.
    if (new RegExp(`^\\s*(?:${[...LOOPS].join('|')})(?:\\s|$)`).test(segment)) return true
    const words = shellWords(segment)
    if (!words) return piped
    const inner = innerCommands(words)
    if ((inner.unplaced && piped) || inner.scripts.some((script) => depth >= 4 || feedsReader(script, depth + 1))) return true
    const w = unwrapped(words)
    const lead = w.findIndex((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x))
    const run = lead >= 0 ? w.slice(lead) : []
    const name = path.basename(run[0] ?? '')
    if (LOOPS.has(name) || LOOPS.has(words[0] ?? '')) return true
    if (name === 'xargs') return !namesOnly(xargsCommand(run))
    if (name === 'parallel') return !namesOnly(run.slice(1))
    if (readsNamesFromInput(run)) return true
    return piped && (SOURCING.has(name) || startsInteractive(segment, depth))
  })
}

/** Commands that read the files they name and change nothing (output kept to the terminal). */
const PLAIN_READERS = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'stat', 'grep', 'egrep', 'fgrep'])

/**
 * Whether a simple command only reads: a plain reader, `rg` without a preprocessor, `sed -n` printing
 * a line range, or `find` without an action; and no output redirection anywhere in the segment.
 */
function readsOnly(words: string[], segment: string, raw: readonly string[] = words): boolean {
  if (/>/.test(withoutQuoted(segment))) return false
  const cmd = path.basename(words[0] ?? '')
  const args = words.slice(1)
  if (PLAIN_READERS.has(cmd)) return true
  // jq reads its files, unless its filter loads a module (`import`, `include`, `-L`) from a place no word names, or
  // comes from a file (`-f`) that may. git does not count: it reads its repository, wherever that is, not only the
  // files it names. Nor does any command with a variable set in its segment.
  if (cmd === 'jq') {
    return !raw.some((w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) &&
      !args.some((a) => /\b(?:import|include)\b/.test(a) || /^(?:--library-path|--from-file)|^-[A-Za-z]*[fL]/.test(a))
  }
  if (cmd === 'rg') return !args.some((a) => a === '--pre' || a.startsWith('--pre='))
  if (cmd === 'sed') {
    // Exactly `sed -n <range>p <file>…`: no other option anywhere (-e, -f, -i, -I, -E, …), one script.
    const quiet = (a: string) => a === '-n' || a === '--quiet' || a === '--silent'
    if (!args.some(quiet) || args.some((a) => a.startsWith('-') && !quiet(a))) return false
    const script = args.find((a) => !quiet(a))
    // Each blank run has one place, so the test cannot backtrack over a long one.
    return script !== undefined && /^\s*(?:(?:\d+|\$)\s*)?(?:,\s*(?:\d+|\$)\s*)?p\s*$/.test(script)
  }
  if (cmd === 'find') return !args.some((a) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a))
  return false
}

/**
 * A path segment as a pattern a root's name may match, or null for a plain name: globs, zsh's `(a|b)` groups, and
 * `?(…)`, `*(…)`, `+(…)`, `@(…)`, `!(…)` read as anything. At the end of a word, a trailing `(…)` may also be a glob
 * qualifier: the segment then matches with it dropped too.
 */
function rootPattern(seg: string, last: boolean, flags: string): ((name: string) => boolean) | null {
  // A plain name, the common case, is no pattern: answered before any lookup.
  if (!/[*?[(|#^~]/.test(seg)) return null
  const key = `${flags}${last ? '$' : ':'}${seg}`
  if (PATTERNS.has(key)) return PATTERNS.get(key)!
  const made = makeRootPattern(seg, last, flags)
  if (PATTERNS.size >= PATTERNS_MAX) PATTERNS.clear()
  PATTERNS.set(key, made)
  return made
}

/** Segment patterns already made: a pure function of the segment, its place and the case flag. */
const PATTERNS = new Map<string, ((name: string) => boolean) | null>()
const PATTERNS_MAX = 4096

/**
 * The sources a root's name is tested against for one segment (it matches when any does), `'any'` for a pattern taken
 * to match anything, or null for a plain name.
 */
export function rootPatternSources(seg: string, last: boolean): string[] | 'any' | null {
  // zsh's extended globs (`t#`, `^x`, `a~b`, `(#i)`), on in many shells' startup files, are taken to match anything.
  if (/[#^]/.test(seg) || seg.indexOf('~') > 0) return 'any'
  if (!/[*?[(|]/.test(seg)) return null
  const qualifier = last ? /\(([^()|]*)\)$/.exec(seg) : null
  const readings = [seg, ...(qualifier && qualifier.index > 0 ? [seg.slice(0, qualifier.index)] : [])]
  const sources: string[] = []
  for (const r of readings) {
    let out = ''
    const close = nextOf(r, ']')
    // A run of `*` (and of `*(…)` and the like) is one: the same names, and no pattern that grows with the run.
    let starred = false
    for (let i = 0; i < r.length; i++) {
      const c = r[i]!
      const extglob = '?*+@!'.includes(c) && r[i + 1] === '('
      if (extglob || c === '*') {
        if (extglob) {
          let depth = 0
          let j = i + 1
          for (; j < r.length; j++) if (r[j] === '(') depth++; else if (r[j] === ')' && --depth === 0) break
          i = j
        }
        if (!starred) out += '[^/]*'
        starred = true
        continue
      }
      starred = false
      if (c === '?') out += '[^/]'
      else if (c === '[') {
        const end = close(i + 1)
        if (end < 0) out += '\\['
        else {
          out += `[${r.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
          i = end
        }
      } else if (c === '(') out += '(?:'
      else if (c === ')' || c === '|') out += c
      else out += c.replace(/[.+^$(){}|\\]/g, '\\$&')
    }
    sources.push(`^${out}$`)
  }
  return sources
}

function makeRootPattern(seg: string, last: boolean, flags: string): ((name: string) => boolean) | null {
  const sources = rootPatternSources(seg, last)
  if (sources === 'any') return () => true
  if (sources === null) return null
  const res: LinearPattern[] = []
  for (const source of sources) {
    try {
      res.push(linearPattern(source, flags))
    } catch {
      // A pattern that cannot be read is taken to match.
      return () => true
    }
  }
  return (name) => res.some((re) => re.test(name, onTime))
}

/** The commands that change the shell's folder, in any spelling the shell runs (`builtin cd`, `\\cd`, inside a function). */
const FOLDER_CHANGERS = new Set(['cd', 'pushd', 'popd'])

/** A cd operand the shell looks up through CDPATH: relative, and not `.`, `..`, `./…`, `../…` or `-`. */
function cdPathOperand(w: string): boolean {
  return !w.startsWith('/') && !w.startsWith('~') && w !== '.' && w !== '..' && w !== '-' && !w.startsWith('./') && !w.startsWith('../')
}

/** A folder's identity, or null when it cannot be read: two paths of one folder share it (a link, a second volume path). */
type Identify = (p: string) => string | null

/** Identities read once per check: a command names the same folders many times. */
function identities(): Identify {
  const seen = new Map<string, string | null>()
  return (p) => {
    let id = seen.get(p)
    if (id === undefined) {
      try {
        const st = statSync(p, { bigint: true })
        id = `${st.dev}:${st.ino}`
      } catch {
        id = null
      }
      seen.set(p, id)
    }
    return id
  }
}

interface RootIdentity { root: ShellRoot; self: string; segs: string[]; ancestors: Map<string, string> }

/**
 * The roots by identity: each root's own, and its ancestors' by identity (to the path the root is under). A path that
 * names a root's folder in a way no text or link resolution matches (macOS reaches its data volume under two paths)
 * is still known by it.
 */
function rootIdentities(roots: readonly ShellRoot[], identify: Identify): RootIdentity[] {
  const out: RootIdentity[] = []
  for (const root of roots) {
    const self = identify(root.dir)
    if (!self) continue
    const ancestors = new Map<string, string>()
    for (let d = path.dirname(root.dir); ; d = path.dirname(d)) {
      const id = identify(d)
      if (id && !ancestors.has(id)) ancestors.set(id, d)
      if (d === path.dirname(d)) break
    }
    out.push({ root, self, segs: root.dir.split(path.sep).filter(Boolean), ancestors })
  }
  return out
}

/** Where a path stands to the roots: inside one, or a folder holding one (globs matched per segment). */
function reacher(given: readonly ShellRoot[], fold: (p: string) => string, identify: Identify = decision?.identify ?? identities()) {
  // The roots no command may read come first: where a path reaches one of each, that one is reported.
  const roots = [...given.filter((r) => !r.readable), ...given.filter((r) => r.readable)]
  const flags = fold('A') === 'a' ? 'i' : ''
  // Each root's segments (as written and canonical), and those folded, made once.
  const forms = roots.map((root) => ({
    root,
    segs: [root.dir, canonicalish(root.dir)].map((r) => {
      const raw = r.split(path.sep).filter(Boolean)
      return { raw, folded: raw.map(fold) }
    }),
  }))
  let ids: RootIdentity[] | undefined
  const byText = (p: string): { root: ShellRoot; how: 'inside' | 'holds' } | null => {
    // The path's segments, and what each matches, read once for every root.
    const ps = path.normalize(p).split(path.sep).filter(Boolean)
    const matchers = ps.map((seg, i) => (seg === '**' ? null : rootPattern(seg, i === ps.length - 1, flags)))
    const folded = ps.map(fold)
    // What is reported when the path reaches several: a root no command may read before one it may, inside before holding.
    const rank = (root: ShellRoot, how: 'inside' | 'holds') => (root.readable ? 2 : 0) + (how === 'inside' ? 0 : 1)
    let best: { root: ShellRoot; how: 'inside' | 'holds' } | null = null
    for (const { root, segs } of forms) {
      for (const rs of segs) {
        let r: 'inside' | 'holds' | null = ps.length >= rs.raw.length ? 'inside' : 'holds'
        for (let i = 0; i < ps.length && i < rs.raw.length; i++) {
          if (ps[i] === '**') break
          const pattern = matchers[i]
          const ok = pattern ? pattern(rs.raw[i]!) : folded[i] === rs.folded[i]
          if (!ok) {
            r = null
            break
          }
        }
        if (r !== null && (!best || rank(root, r) < rank(best.root, best.how))) {
          best = { root, how: r }
          if (rank(root, r) === 0) return best
        }
      }
    }
    return best
  }
  /**
   * By identity, where text did not tell: a path whose glob-free head is the root, or one of its ancestors under
   * another name (its rest then matched against the root's path from there), or a folder that holds the root under
   * the same names below it.
   */
  const byIdentity = (p: string, probeHolders: boolean): { root: ShellRoot; how: 'inside' | 'holds' } | null => {
    if (!path.isAbsolute(p)) return null
    ids ??= rootIdentities(roots, identify)
    if (!ids.length) return null
    const segs = path.normalize(p).split(path.sep).filter(Boolean)
    const glob = segs.findIndex((x) => GLOB.test(x))
    const head = glob < 0 ? segs.length : glob
    // Each ancestor's path, from the root folder down, made once.
    const prefixes: string[] = [path.sep]
    for (let k = 1; k <= head; k++) prefixes.push(k === 1 ? path.sep + segs[0]! : prefixes[k - 1]! + path.sep + segs[k - 1]!)
    // Nothing exists below a missing folder: the deepest ancestor that exists, found by halving, is where to start.
    let deepest = 0
    for (let hi = head; deepest < hi;) {
      const mid = (deepest + hi + 1) >> 1
      if (identify(prefixes[mid]!)) deepest = mid
      else hi = mid - 1
    }
    for (let k = deepest; k >= 0; k--) {
      const id = identify(prefixes[k]!)
      if (!id) continue
      const self = ids.find((r) => r.self === id)
      if (self) return { root: self.root, how: 'inside' }
      for (const r of ids) {
        const under = r.ancestors.get(id)
        // Under the same name, the text was already read above.
        if (under === undefined || fold(under) === fold(prefixes[k]!)) continue
        // The same folder under another name: the rest of the path read from the name the root is under.
        const named = byText(path.join(under, ...segs.slice(k)))
        if (named) return named
      }
    }
    if (glob >= 0 || !probeHolders) return null
    // A folder holding the root under the names the root has below one of its ancestors: only a folder can.
    if (!isFolder(p)) return null
    for (const r of ids) {
      for (let k = 1; k <= r.segs.length; k++) {
        if (identify(path.join(p, ...r.segs.slice(-k))) === r.self) return { root: r.root, how: 'holds' }
      }
    }
    return null
  }
  /**
   * `probeHolders`: whether to look for the root below the path by its identity. A caller to whom a holding folder
   * does not matter skips that cost; a holder found by the path's text is still reported as one.
   */
  // macOS reaches every path of the system volume's home folders again under the data volume.
  const offVolume = (p: string): string | null => (fold(p).startsWith(fold(`${DATA_VOLUME}/`)) ? p.slice(DATA_VOLUME.length) : null)
  return (p: string, probeHolders = true): { root: ShellRoot; how: 'inside' | 'holds' } | null => {
    if (path.isAbsolute(p) && aliasedPath(path.normalize(p))) throw new Unchecked(ALIASED)
    onTime()
    const off = offVolume(p)
    const text = [byText(p), off === null ? null : byText(off)]
    const unreadable = text.find((t) => t && !t.root.readable)
    if (unreadable) return unreadable
    // A root it may read found by its text does not hide one it may not read found by identity (a link to it).
    const id = byIdentity(p, probeHolders)
    return id && !id.root.readable ? id : (text[0] ?? text[1] ?? id)
  }
}

/** Where macOS mounts the volume that holds the home folders. */
const DATA_VOLUME = '/System/Volumes/Data'

/** A path with its glob-free head resolved through links (a glob word's links matter as much as any other's). */
function linkedHead(abs: string): string {
  const segs = abs.split(path.sep)
  const k = segs.findIndex((x) => GLOB.test(x))
  if (k < 0) return canonicalish(abs)
  return path.join(canonicalish(segs.slice(0, k).join(path.sep) || path.sep), ...segs.slice(k))
}

/**
 * The first of `roots` a shell command reaches, or null: a word naming one or anything in it — the
 * home spelled `~`, `~+`, `~user`, `$HOME`, `${HOME}`, `${HOME:-…}` or in full (and each variable in
 * `vars`), after `cd`, quotes, escapes, braces, globs and links, in any piece of a word (`if=…`,
 * `X=…`), inside a `sh -c` script — a link made to one or to a folder holding one, or a content
 * search, copy or archive of a folder holding one. A word the guard cannot place, and a command it
 * cannot read word by word, are judged by their text. A folder holding a root no command may read is
 * refused as well to any command that does more than list names, and to every part of a line that
 * feeds one part's output to another (`feedsReader`), the folders its `cd` goes to and the one each
 * part runs in included.
 */
export function reachedRoot(command: string, cwd: string, home: string, fold: (p: string) => string, roots: readonly ShellRoot[],
  vars: Readonly<Record<string, string>> = {}, depth = 0, outerDots = false, outerFed = false): ShellRoot | null {
  const reach = reacher(roots, fold)
  const flags = fold('A') === 'a' ? 'i' : ''
  // The command turns on dot matching (bash's dotglob, or GLOBIGNORE, which sets it; zsh's GLOB_DOTS, `set -4`).
  // A zsh glob qualifier holding `D` turns it on for its word; a setting made around a `sh -c` script holds inside it.
  const dotsOn = outerDots || /dotglob|globdots|globignore|\bset\s+[-+][a-z0-9]*4/i.test(command.replace(/_/g, '')) ||
    // The first `D` of a run is the one tried: no two ways to read one run.
    /\([^()|\sD]*D[^()|\s]*\)?(?=[\s;&|]|$)/.test(command)
  /**
   * Whether a path segment, read by its text, may be a segment of a root's marker: the same name, a pattern matching
   * it (one starting with a wildcard reaches a dot name only with dot matching on, as it is not by default), or a
   * segment the shell builds that holds it.
   */
  const segmentNames = (s: string, m: string, last: boolean): boolean => {
    if (/[$`]/.test(s)) return fold(s).includes(fold(m))
    const pattern = rootPattern(s, last, flags)
    if (!pattern) return fold(s) === fold(m)
    const hidden = m.startsWith('.') && /^[*?[]/.test(s) && !dotsOn
    return !hidden && pattern(m)
  }
  /**
   * A root no command may read that a piece may reach from an unknown folder: `.` or `..` alone, or a piece whose
   * segments (each `..` taking the one before it) read as a run of the root's own path, so the piece may be the root or a
   * folder on its way (`auth.json`, `../auth.json`, `.codex`, a glob such as `a*`; not `dist/*`).
   */
  const startsMarker = (piece: string): ShellRoot | null => {
    const named: string[] = []
    for (const s of piece.replace(/["'\\]/g, '').split('/')) {
      if (s === '..') named.pop()
      else if (s && s !== '.') named.push(s)
    }
    const same = (s: string, m: string, last: boolean) => {
      const pattern = rootPattern(s, last, flags)
      if (!pattern) return fold(s) === fold(m)
      // A pattern starting with a wildcard reaches a dot name only with dot matching on.
      return !(m.startsWith('.') && /^[*?[]/.test(s) && !dotsOn) && pattern(m)
    }
    return roots.find((r) => {
      if (r.readable) return false
      if (!named.length) return true
      const rs = r.dir.split(path.sep).filter(Boolean)
      return rs.some((_, j) => j + named.length <= rs.length && named.every((s, x) => same(s, rs[j + x]!, x === named.length - 1)))
    }) ?? null
  }
  /** Whether a part's command, read from its text, only lists names or changes folder. */
  const textLists = (segment: string): boolean => {
    const first = segment.replace(/["'\\]/g, '').trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? ''
    return namesOnly([first]) || FOLDER_CHANGERS.has(path.basename(first))
  }
  /** A piece read from a folder that cannot be told, by `startsMarker`; null for one named in full. */
  const lostPiece = (piece: string): ShellRoot | null => {
    const stack = /^~(?:[+-]\d*|\d+)(?=\/|$)/.exec(piece)
    if (stack) return startsMarker(`.${piece.slice(stack[0].length)}`)
    return path.isAbsolute(tilde(piece, null) ?? '/') ? null : startsMarker(piece)
  }
  /** A piece that names a root by its text alone, as a path from an unknown folder must be judged. */
  const namesRoot = (piece: string, reading = false): ShellRoot | null => {
    const segs = piece.split('/').filter(Boolean)
    for (const r of roots) {
      if (reading && r.readable) continue
      const ms = r.marker.split('/')
      for (let i = 0; i + ms.length <= segs.length; i++) {
        if (ms.every((m, j) => segmentNames(segs[i + j]!, m, i + j === segs.length - 1))) return r
      }
    }
    return null
  }
  const tilde = (w: string, base: string | null): string | null => {
    if (w === '~' || w.startsWith('~/')) return home + w.slice(1)
    if (w === '~+' || w.startsWith('~+/')) return base === null ? null : base + w.slice(2)
    if (w === '~-' || w.startsWith('~-/')) return null
    // An entry of the folder stack (`~1`, `~+2`, `~-0`).
    if (/^~[+-]?\d+(?=\/|$)/.test(w)) return null
    return /^~[\w.-]+(?=\/|$)/.test(w) ? path.join(path.dirname(home), w.slice(1)) : w
  }
  /** A path piece, judged from each folder it may run in; null when it cannot be placed. */
  /**
   * `holder`: the command reads or copies what a folder it names holds. `strong`: it does more than list names, so a
   * folder it names that holds a root no command may read is refused as well. A command that only reads passes a root it
   * may read, whether inside it or holding it.
   */
  const judge = (piece: string, bases: readonly (string | null)[], holder: boolean, reading = false, strong = false): ShellRoot | null => {
    for (const base of bases) {
      const p = tilde(piece, base)
      if (p === null || (base === null && !path.isAbsolute(p))) {
        // A folder searched, copied or linked from an unknown place may hold a root.
        const hit = holder ? roots.find((r) => !(reading && r.readable)) ?? null : namesRoot(piece, reading)
        if (hit) return hit
        continue
      }
      const abs = path.resolve(base ?? cwd, p)
      for (const form of [abs, linkedHead(abs)]) {
        const r = reach(form, holder || strong)
        // A root that may be read is passed by a command that only reads; one that may not is reported first.
        if (!r || (reading && r.root.readable)) continue
        if (r.how === 'inside' || holder || (strong && !r.root.readable)) return r.root
      }
    }
    return null
  }
  /**
   * A segment the guard cannot read word by word: each token naming a root's marker is judged as a
   * path, and one the shell builds (a substitution, a variable) cannot be placed, so it counts.
   */
  const textual = (segment: string, base: string | null, earlier: readonly string[], unsure: boolean): ShellRoot | null => {
    const decoded = segment.replace(/\$'((?:[^'\\]|\\[\s\S])*)'/g, (_m, body: string) => ansiC(body))
    for (const token of decoded.replace(/["'\\]/g, '').split(/[\s;|&<>]+/)) {
      for (const t of braceWords(token, decision?.braces !== false)) {
        // A word the shell builds cannot be placed: what it names is judged by its text. In a line that feeds one part
        // to another, a folder it names may be read through.
        const bases = [base, ...earlier, cwd, ...(unsure ? [null] : [])]
        const clean = t.replace(/\$\(|[`()]/g, '')
        const starred = builtAsAny(t)
        // The current or previous folder by its variable, after a change of folder that could not be followed.
        const pwd = /^\$(\{?PWD\}?|\{?OLDPWD\}?)(\/.*)?$/.exec(t)
        // Only for a command that does more than list names, and not a change of folder (judged where it lands).
        if (pwd && !textLists(decoded)) {
          // The current folder is the one the guard holds, unless it lost it; the previous one it does not keep.
          const rest = `.${pwd[2] ?? ''}`
          const hit = lost || /OLDPWD/.test(pwd[1]!) ? startsMarker(rest) : judge(rest, bases, false, false, true)
          if (hit) return hit
        }
        const hit = /[$`(){}]/.test(t)
          ? namesRoot(clean) ?? (fed ? judge(clean, bases, false, false, true) : null) ?? (starred === null ? null : judge(starred, bases, false, false, true))
          : judge(t, bases, false, false, fed)
        if (hit) return hit
      }
    }
    return null
  }
  let spelled = command.replace(/\\\r?\n/g, '')
  for (const [name, value] of Object.entries({ HOME: home, ...vars })) spelled = withVariable(spelled, name, value)
  // A line that feeds what one part prints to another that may read it: every folder named in it may be read through.
  const fed = outerFed || feedsReader(spelled)
  let base: string | null = cwd
  // Once a change of folder could not be followed, a relative path may be anywhere: it is judged by its text as well.
  let unsure = false
  // Whether a change of folder was not followed: the folder a part runs in may then be any.
  let lost = false
  // The folders the command may be in besides `base`: those held before (a `cd` in a pipeline or in the background
  // runs in a subshell and leaves the folder as it was), and those CDPATH may have sent a `cd` to.
  const earlier = new Set<string>()
  // CDPATH as the environment gives it, and as the command sets it.
  let cdpath: string | null = vars.CDPATH ?? null
  for (const segment of commandSegments(spelled)) {
    onTime()
    const raw = shellWords(segment)
    if (!raw) {
      // A change of folder inside it (a `sh -c` script's `cd $D`) leaves its later paths anywhere.
      if (/(?:^|[\s;&|('"`])(?:cd|pushd|popd)(?=[\s;&|)'"`]|$)/.test(segment)) unsure = lost = true
      const hit = textual(segment, base, [...earlier], unsure)
      if (hit) return hit
      unsure = true
      continue
    }
    const inner = innerCommands(raw)
    if (inner.unplaced) return roots[0] ?? null
    for (const script of inner.scripts) {
      if (depth >= 4) return roots[0] ?? null
      const hit = reachedRoot(script, base ?? cwd, home, fold, roots, vars, depth + 1, dotsOn, fed)
      if (hit) return hit
    }
    const words = unwrapped(raw)
    const bare = words.map((w) => w.replace(/["'\\]/g, ''))
    // Assignments before a command set its environment (`CDPATH=… cd x`): the command is the first word after them.
    const lead = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
    const changes = lead >= 0 && FOLDER_CHANGERS.has(bare[lead]!)
    // A change of folder anywhere else in the segment (`builtin cd`, `command cd`, a function's body) is not followed.
    if (bare.some((w, i) => FOLDER_CHANGERS.has(w) && !(changes && i === lead))) unsure = lost = true
    if (!changes) for (const w of words) if (/^CDPATH=/.test(w)) cdpath = w.slice('CDPATH='.length)
    const known = [base, ...earlier, cwd, ...(unsure ? [null] : [])]
    if (changes && lead > 0) {
      for (const w of words.slice(0, lead)) for (const piece of wordPaths(w)) {
        const hit = judge(piece, known, false)
        if (hit) return hit
      }
    }
    if (changes) {
      // A redirect's words (`2>/dev/null`) are no operands of the change of folder.
      const plain = shellWords(withoutRedirects(segment))
      const plainWords = plain ? unwrapped(plain) : null
      const plainLead = plainWords ? plainWords.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) : -1
      const rest = plainWords && plainLead >= 0 ? plainWords.slice(plainLead + 1) : words.slice(lead + 1)
      const operands = rest.filter((w) => !w.startsWith('-') || w === '-')
      // A change into a root is refused; one into a folder holding a root is not, so `~-` and `~N` are read as any folder.
      // An operand the shell builds is judged by its text as well.
      const built = operands.some((w) => /[$`]/.test(w))
      // Every word is judged, a redirect's target included (`cd . > file`); only the operands decide where it goes.
      for (const w of words.slice(lead + 1).filter((x) => !x.startsWith('-') || x === '-')) for (const piece of wordPaths(w)) {
        // In a line that feeds one part to another, what is listed there may be read.
        const hit = judge(piece, built ? [...known, null] : known, false, false, fed)
        if (hit) return hit
      }
      if (base !== null) earlier.add(base)
      // A bare relative operand is looked up through CDPATH: each folder it may land in is judged and kept.
      const local = words.slice(0, lead).findLast((w) => /^CDPATH=/.test(w))
      const lookup = local === undefined ? cdpath : local.slice('CDPATH='.length)
      if (lookup !== null && operands.length === 1 && cdPathOperand(operands[0]!) && base !== null) {
        for (const entry of lookup.split(':')) {
          const from = entry === '' ? base : /[$`]/.test(entry) ? null : tilde(entry, base)
          if (from === null) {
            unsure = lost = true
            continue
          }
          const landing = path.resolve(base, from, operands[0]!)
          const hit = judge(landing, [cwd], false, false, fed)
          if (hit) return hit
          earlier.add(landing)
        }
      }
      // zsh's `cd old new` replaces `old` with `new` in the folder's path: not followed, and judged by its text.
      if (operands.length > 1) {
        for (const w of operands) for (const piece of wordPaths(w)) {
          const hit = namesRoot(piece)
          if (hit) return hit
        }
      }
      if (operands.some((w) => /[$`]/.test(w)) || operands.length > 1) {
        unsure = lost = true
        base = null
        continue
      }
      const placed = [bare[lead]!, ...rest].map((w) => tilde(w, base))
      // A folder that cannot be told (`cd -`, `popd`) is null: what runs there is judged by its text, and from the
      // folders held before.
      base = base === null || placed.includes(null) ? null : changeDirectory(placed as string[], base, home)
      continue
    }
    // `env -C` runs its command in another folder; a subshell's `cd` may have ended: both are judged.
    const chdir = envFolder(raw)
    const placedChdir = chdir === undefined ? undefined : tilde(chdir, base)
    const segBase = placedChdir === undefined ? base : placedChdir === null || base === null ? null : path.resolve(base, placedChdir)
    // A folder the command is told to work in (`git -C`, `make -C`, `tar --directory`, `--work-tree`): its relative words
    // are read from there as well.
    const toldAt = optionFolders(raw)
    const toldWords = [...toldAt.values()]
    const told = toldWords.flatMap((f) => {
      const p = tilde(f, segBase)
      return p === null ? [] : path.isAbsolute(p) ? [p] : segBase === null ? [] : [path.resolve(segBase, p)]
    })
    const plainBases = [...new Set([segBase, ...known])]
    const bases = [...new Set([segBase, ...told, ...known])]
    // The folder option's own value, by its place among the words, is read from where the command runs, not from itself.
    const basesOf = (at: number) => (toldAt.has(at) ? plainBases : bases)
    // The command after the assignments that set its environment.
    const run = lead > 0 ? words.slice(lead) : words
    const operands = run.slice(1).filter((w) => !w.startsWith('-'))
    const holders = [
      ...(recursiveSearch(run) ?? []),
      ...(run[0] === 'find' && findExecs(run).some(readsContent) ? findStarts(run) : []),
      ...(FOLDER_COPIERS.has(path.basename(run[0] ?? '')) ? operands : []),
      // A link to a root, or to a folder holding one, opens it under another name.
      ...(path.basename(run[0] ?? '') === 'ln' ? (operands.length > 1 ? operands.slice(0, -1) : operands) : []),
    ]
    // In a line that feeds one part to another, a part that reads what another prints may read what is in its folder.
    if (fed && lead >= 0 && readsFed(words.slice(lead), raw, segment)) {
      // After `cd -` or `popd` it is one of the folders held before.
      const hit = lost ? startsMarker('.') : judge('.', segBase === null ? [...earlier, cwd] : [segBase], false, false, true)
      if (hit) return hit
    }
    // Every word, the wrappers' own included (`env -C <folder>`).
    const reading = readsOnly(words, segment, raw)
    // Assignments alone run nothing: what they hold is judged when a command uses it.
    const strong = lead >= 0 && (fed || !(namesOnly(run) || commandLookup(raw)))
    for (const [at, w] of [...raw.map((x, i) => [i, x] as const), ...holders.map((x) => [-1, x] as const)]) {
      for (const piece of wordPaths(w)) {
        const hit = judge(piece, basesOf(at), holders.includes(w), reading, strong) ??
          // After a change of folder that could not be followed, `.`, `..` or a path of a root's may reach one; the
          // previous folder or the folder stack (`~-`, `~N`), which the guard does not keep, may at any time.
          (strong && (lost || /^~(?:-\d*|\d+)(?=\/|$)/.test(piece)) ? lostPiece(piece) : null)
        if (hit) return hit
      }
    }
  }
  return null
}

/** CDPATH from the environment the hook runs in, which a shell started from it inherits. */
const cdPathOf = (g: SecretGuardEnv): Record<string, string> => (str(g.env.CDPATH) ? { CDPATH: String(g.env.CDPATH) } : {})

/** Claude Code's configuration directory when the environment sets it as an absolute path, as the config guard reads it. */
const claudeConfigOf = (g: SecretGuardEnv): Record<string, string> => {
  const dir = str(g.env.CLAUDE_CONFIG_DIR)
  return dir && path.isAbsolute(dir) ? { CLAUDE_CONFIG_DIR: dir } : {}
}

const GIT_CONFIG_SHELL_REASON =
  "this command changes, copies or links git's configuration, hooks or attributes, which can make git run a program when the operator next runs it: an agent only reads them; the operator changes them."

/**
 * git's configuration as a shell command must not change it: the repository's (the `.git` of the folder the command
 * runs in and of the nearest folder above holding one; where that `.git` is a file, as in a linked work tree or a
 * submodule, the file itself, the folder it names and that folder's `commondir`) — `config`, `config.worktree`,
 * `hooks`, `info/attributes`, `commondir`, `gitdir`, and the `worktrees` and `modules` folders whole — and the
 * user's (`~/.gitconfig`, and `git/config` and `git/attributes` in XDG's folder, as set and by default). Each may be
 * read. git's own commands, which write objects and the index, name none of them.
 */
function gitRoots(g: SecretGuardEnv, home: string, cwd: string): ShellRoot[] {
  const gitDirs: string[] = []
  const gitFiles: string[] = []
  const add = (dotGit: string): void => {
    gitDirs.push(dotGit)
    const named = /^gitdir:[ \t]*(\S[^\n]*?)[ \t\r]*$/m.exec(readRegularText(dotGit, 4096) ?? '')
    if (!named) return
    gitFiles.push(dotGit)
    const dir = path.resolve(path.dirname(dotGit), named[1]!)
    gitDirs.push(dir)
    const common = readRegularText(path.join(dir, 'commondir'), 4096)?.trim()
    if (common) gitDirs.push(path.resolve(dir, common))
  }
  add(path.join(cwd, '.git'))
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) {
      if (dir !== cwd) add(path.join(dir, '.git'))
      break
    }
    if (path.dirname(dir) === dir) break
  }
  const xdg = str(g.env.XDG_CONFIG_HOME) && path.isAbsolute(String(g.env.XDG_CONFIG_HOME)) ? String(g.env.XDG_CONFIG_HOME) : undefined
  const configDirs = [...new Set([path.join(home, '.config'), ...(xdg ? [xdg] : [])])]
  const files = [
    ...[...new Set(gitDirs)].flatMap((d) => ['config', 'config.worktree', 'hooks', path.join('info', 'attributes'), 'commondir', 'gitdir', 'worktrees', 'modules'].map((f) => path.join(d, f))),
    ...gitFiles,
    ...configDirs.flatMap((d) => [path.join(d, 'git', 'config'), path.join(d, 'git', 'attributes')]),
  ]
  const root = (dir: string, marker: string): ShellRoot => ({ dir, marker, reason: GIT_CONFIG_SHELL_REASON, readable: true })
  return [...files.map((f) => root(f, f.split(path.sep).slice(-2).join('/'))), root(path.join(home, '.gitconfig'), '.gitconfig')]
}

/** What the config guard keeps from an agent's writes in a Claude Code configuration directory. */
const CLAUDE_CONFIG_NAMES = ['settings.json', 'settings.local.json', 'plugins', 'skills', 'commands', 'agents']
const CLAUDE_JSON_REASON =
  "this command reaches Claude Code's .claude.json, which can hold the user's MCP servers and their keys: it is not read or changed through Codex's shell."
const CLAUDE_CONFIG_REASON =
  "this command changes, copies or links something in Claude Code's configuration (its settings, plugin cache, skills, commands or agents), which decides what runs without asking: an agent only reads it; the operator changes it."

/**
 * Claude Code's configuration as a shell command must not change it: in the user's folder, the project's (the folder
 * the command runs in) and a `CLAUDE_CONFIG_DIR` set as an absolute path. Each may be read, as the config guard lets an
 * agent read it; the user's `.claude.json` may not.
 */
function claudeRoots(g: SecretGuardEnv, home: string, cwd: string): ShellRoot[] {
  const set = claudeConfigOf(g).CLAUDE_CONFIG_DIR
  const dirs = [...new Set([path.join(home, '.claude'), path.join(cwd, '.claude'), ...(set ? [set] : [])])]
  const root = (dir: string, marker: string): ShellRoot => ({ dir, marker, reason: CLAUDE_CONFIG_REASON, readable: true })
  return [
    ...dirs.flatMap((d) => CLAUDE_CONFIG_NAMES.map((name) => root(path.join(d, name), `${path.basename(d)}/${name}`))),
    // Not even read: it can hold the user's MCP servers and their keys, as Codex's config.toml can.
    ...[home, ...(set ? [set] : [])].map((d): ShellRoot => ({ dir: path.join(d, '.claude.json'), marker: '.claude.json', reason: CLAUDE_JSON_REASON })),
  ]
}

const STATE_ROOT_REASON =
  "this command reaches the server's own folder in the home directory (.dethernety), which holds the sign-in: an agent never reads, lists, copies, links or searches it."

/** The server's own folder in `home`, as a root no shell command or file path may reach. */
const stateRoot = (home: string): ShellRoot => ({ dir: path.join(home, '.dethernety'), marker: '.dethernety', reason: STATE_ROOT_REASON })

const STATE_ROOT_SEARCH_REASON =
  "this search runs over a folder that holds the server's own folder in the home directory (.dethernety), which holds the sign-in: search a folder of the project instead."

const SIGN_IN_REASON =
  "this call reaches a harness's own sign-in (Claude Code's .credentials.json, Codex's auth.json or .credentials.json, OpenCode's auth.json or mcp-auth.json), which holds its tokens: an agent never reads, lists, copies, links or searches it."

/** Codex's home when the environment sets it as an absolute path, as Codex's shell guard reads it. */
const codexHomeOf = (g: SecretGuardEnv): string | undefined => {
  const dir = str(g.env.CODEX_HOME)
  return dir && path.isAbsolute(dir) ? dir : undefined
}

/** OpenCode's data folder's parent when the environment sets XDG_DATA_HOME as an absolute path. */
const dataHomeOf = (g: SecretGuardEnv): string | undefined => {
  const dir = str(g.env.XDG_DATA_HOME)
  return dir && path.isAbsolute(dir) ? dir : undefined
}

/**
 * What a command's `$CODEX_HOME`, `$CLAUDE_CONFIG_DIR` and `$XDG_DATA_HOME` are read as: each only when the environment
 * sets it as an absolute path. Unset, the shell writes it as nothing, so it is left as written, to be judged by its text.
 */
const homeVarsOf = (g: SecretGuardEnv): Record<string, string> => ({
  ...(codexHomeOf(g) ? { CODEX_HOME: codexHomeOf(g)! } : {}),
  ...(dataHomeOf(g) ? { XDG_DATA_HOME: dataHomeOf(g)! } : {}),
  ...claudeConfigOf(g),
})

/**
 * The harnesses' own sign-ins: Claude Code's `.credentials.json` in the user's folder and in a `CLAUDE_CONFIG_DIR` set
 * as an absolute path; Codex's `auth.json` and `.credentials.json` (its MCP servers' tokens, when kept in a file) in its
 * default home and in a `CODEX_HOME` set as one; OpenCode's `auth.json` and `mcp-auth.json` in its data folder, under
 * `~/.local/share` and under an `XDG_DATA_HOME` set as an absolute path. No tool reads them.
 */
function signInRoots(g: SecretGuardEnv, home: string): ShellRoot[] {
  const claude = claudeConfigOf(g).CLAUDE_CONFIG_DIR
  const codexHomes = [path.join(home, '.codex'), ...(codexHomeOf(g) ? [codexHomeOf(g)!] : [])]
  const dataHomes = [path.join(home, '.local', 'share'), ...(dataHomeOf(g) ? [dataHomeOf(g)!] : [])]
  const files = [
    path.join(home, '.claude', '.credentials.json'), ...(claude ? [path.join(claude, '.credentials.json')] : []),
    ...codexHomes.flatMap((h) => [path.join(h, 'auth.json'), path.join(h, '.credentials.json')]),
    ...dataHomes.flatMap((d) => [path.join(d, 'opencode', 'auth.json'), path.join(d, 'opencode', 'mcp-auth.json')]),
  ]
  return [...new Set(files)].map((f) => ({ dir: f, marker: `${path.basename(path.dirname(f))}/${path.basename(f)}`, reason: SIGN_IN_REASON }))
}

/** Whether a folder, as written or through its links, holds one of the roots. */
function holdsRoot(p: string, roots: readonly ShellRoot[], fold: (p: string) => string): ShellRoot | null {
  const reach = reacher(roots, fold)
  for (const form of [p, canonicalish(p)]) {
    const r = reach(form)
    if (r?.how === 'holds') return r.root
  }
  return null
}

/** Whether a path, as written and through its links, lies inside one of the roots. */
function insideRoot(p: string, roots: readonly ShellRoot[], fold: (p: string) => string): ShellRoot | null {
  const reach = reacher(roots, fold)
  for (const form of [p, canonicalish(p)]) {
    const r = reach(form)
    if (r?.how === 'inside') return r.root
  }
  return null
}

const folding = (g: SecretGuardEnv) => (g.platform === 'darwin' || g.platform === 'win32' ? (p: string) => p.toLowerCase() : (p: string) => p)

/**
 * Codex's event: its shell tool reaches the hook as Bash (`tool_input.command`, run in `cwd`, or in
 * `tool_input.workdir` when the event carries one). Before the Claude decision, and failing closed:
 * a command the event does not carry, a patch run through the shell (Codex applies it past the hook),
 * a shell or interpreter left waiting for input, and anything reaching the server's own folder,
 * Codex's plugin folder, its config.toml or its sign-in (a plugin's hook script changed through the
 * shell keeps the trust its hooks.json was given). Then what the config guard keeps from an agent's writes in
 * Claude Code's configuration (its settings, plugin cache, skills, commands and agents, in the user's,
 * the project's and a `CLAUDE_CONFIG_DIR` set as an absolute path), which a command may read but not
 * change, copy or link.
 */
export function decideCodexAccess(raw: RawEvent, g: SecretGuardEnv): GuardDecision {
  return oneDecision(g, () => decideCodexAccessOnce(raw, g))
}

function decideCodexAccessOnce(raw: RawEvent, g: SecretGuardEnv): GuardDecision {
  let event: Record<string, unknown> | undefined
  try {
    const parsed = raw.text === null ? undefined : (JSON.parse(raw.text) as unknown)
    event = isRecord(parsed) ? parsed : undefined
  } catch {
    event = undefined
  }
  if (!event) return deny(uncheckedReason('This call', 'the event could not be read'))
  if (str(event.tool_name) !== 'Bash') return decideSecretAccess(raw, g)
  const input = isRecord(event.tool_input) ? event.tool_input : {}
  const command = codexCommand(input.command)
  if (!command) return deny(uncheckedReason('This command', 'the event carries no command'))
  const start = str(event.cwd) ?? g.cwd
  const cwd = str(input.workdir) ? path.resolve(start, String(input.workdir)) : start
  const readings = commentReadings(command)
  if (readings.some((r) => /\*\*\* Begin Patch/.test(r))) {
    return deny('a patch run through the shell is never checked, so it is not run: use the apply_patch tool.')
  }
  if (readings.some((r) => startsInteractive(r))) {
    return deny('a shell or an interpreter left waiting for input is not started, since nothing sent to it later is checked: run each command on its own.')
  }
  const home = str(g.env.HOME) ?? os.homedir()
  const codexHome = codexHomeOf(g) ?? path.join(home, '.codex')
  const pluginReason =
    "this command changes, copies or runs something in Codex's plugin folder, whose files decide what runs without asking: an agent only reads them; the operator changes them."
  const configReason =
    "this command reaches Codex's config.toml, which decides what runs without asking and can hold other servers' keys: an agent never reads or changes it."
  // Codex's home as set, and the default one: both are looked at, whichever the session uses.
  const codexHomes = [...new Set([codexHome, path.join(home, '.codex')])]
  const roots: ShellRoot[] = [
    stateRoot(home),
    ...codexHomes.flatMap((h) => [
      { dir: path.join(h, 'config.toml'), marker: `${path.basename(h)}/config.toml`, reason: configReason },
      { dir: path.join(h, 'auth.json'), marker: `${path.basename(h)}/auth.json`, reason: SIGN_IN_REASON },
      { dir: path.join(h, 'plugins'), marker: `${path.basename(h)}/plugins`, reason: pluginReason, readable: true },
    ]),
    { dir: path.join(cwd, '.codex', 'plugins'), marker: '.codex/plugins', reason: pluginReason, readable: true },
  ]
  for (const reading of readings) {
    if (decision) decision.braces = bracesMayExpand(reading)
    let hit: ShellRoot | null
    try {
      hit = reachedRoot(reading, cwd, home, folding(g), roots, { CODEX_HOME: codexHome, ...cdPathOf(g) }) ??
        reachedRoot(reading, cwd, home, folding(g), claudeRoots(g, home, cwd), { CODEX_HOME: codexHome, ...claudeConfigOf(g), ...cdPathOf(g) }) ??
        reachedRoot(reading, cwd, home, folding(g), gitRoots(g, home, cwd), cdPathOf(g))
    } catch (e) {
      return deny(uncheckedReason(`\`${reading.slice(0, 120)}\``, e instanceof Unchecked ? e.message : 'its words could not be placed'))
    }
    if (hit) return deny(hit.reason)
  }
  return decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd })), g)
}

/**
 * Whether `abs` is a secret file of the project `cwd` lies in, judged as a read of it is: null when no
 * project can be placed (outside a project nothing is a project secret).
 */
export function projectSecretFile(abs: string, cwd: string, g: SecretGuardEnv): GuardDecision | null {
  if (!resolveProjectRoot({ cwd, env: g.env }).root) return null
  try {
    return withPlace(cwd, g, (j) => {
      const v = judgeFile(abs, j)
      return v.secret ? deny(secretReason(v.rel, v.cls, false)) : ALLOW
    })
  } catch (e) {
    return deny(uncheckedReason(`\`${abs.slice(0, 200)}\``, e instanceof Unchecked ? e.message : 'an internal error'))
  }
}

/** Runs `fn` with the project's place and the deadline; Unchecked when the project cannot be placed. */
function withPlace(cwd: string, g: SecretGuardEnv, fn: (j: Judge) => GuardDecision): GuardDecision {
  // The decision's own start when there is one: the checks before this one count against the same deadline.
  const start = decision?.start ?? g.now()
  const deadline = () => {
    if (g.now() - start > SECRET_GUARD_DEADLINE_MS) throw new Unchecked('the check ran out of time')
  }
  const found = resolveProjectRoot({ cwd, env: g.env })
  if (!found.root) throw new Unchecked('the project root cannot be resolved')
  const insensitive = g.platform === 'darwin' || g.platform === 'win32'
  const place: Place = { root: found.root, fold: insensitive ? (p) => p.toLowerCase() : (p) => p }
  let models: string[] | null = null
  return fn({ place, models: () => (models ??= modelDirectories(place)), deadline, maxEntries: g.maxEntries ?? SECRET_WALK_MAX_ENTRIES, sources: new Map() })
}

export function processSecretGuardEnv(): SecretGuardEnv {
  return { env: process.env, cwd: process.cwd(), platform: process.platform, now: Date.now }
}
