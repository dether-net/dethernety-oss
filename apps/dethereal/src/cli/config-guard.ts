/**
 * The config guard: a PreToolUse hook on file-writing tools. An agent never writes a harness's
 * permission configuration, nor a skill, command or agent definition that grants a Dethereal tool,
 * so no model can pre-approve a tool that must ask the operator.
 *
 * Three classes of path are guarded, project and user level:
 *  - configuration — Claude Code settings (and `.claude.json`), the Codex `config.toml`, OpenCode's
 *    `opencode.json(c)` — judged by what the edit changes (see config-content.ts): denied only when
 *    it widens what runs without the operator (a Dethereal or wildcard allow rule, a bypass mode, a
 *    weakened deny or ask rule, hooks or MCP servers, the plugin disabled);
 *  - OpenCode plugin directories, denied by path: plugin code cannot be judged;
 *  - definitions — skills, commands and agents under `.claude/`, `.opencode/` (or OpenCode's config
 *    directory) and `.codex/` — denied when the text they would hold grants a Dethereal tool or a
 *    wildcard of tools.
 *
 * Codex writes through `apply_patch`, whose patch can change several files at once. There, a guarded
 * file is only ever created whole or deleted: an update or a move of one is denied (Codex applies its
 * hunks in sequence, under aliases, so the text it would leave cannot be told for certain), as are two
 * operations on one guarded file, a patch naming another environment, anything under the server's
 * state folder in the home directory, and the Codex plugin folders (code, like OpenCode's).
 *
 * A write is denied when its target is in one of these classes and it cannot be judged — an event
 * too large, too slow or unparseable (the target path is recovered from the raw event), a file too
 * large or unreadable, an edit whose text is not found exactly once, content that does not parse.
 * Every other write is allowed, so a malformed event never blocks unrelated work.
 *
 * Only `node:` builtins and the import-free config-content module are imported: the guard keeps
 * working whatever else is broken. It reads the event and the file an edit changes; nothing else.
 */

import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type ConfigKind, judgeConfigEdit } from './config-content.js'

/** The event kept in full up to this size; past it, only the paths are recovered. */
export const GUARD_EVENT_CAP = 32 * 1024 * 1024
/** How long a harness may take to deliver and close stdin. */
const GUARD_TIMEOUT_MS = 3000
/** A guarded file larger than this cannot be judged, so an edit to it is denied. */
export const GUARDED_FILE_MAX_BYTES = 16 * 1024 * 1024
/** Overlap kept between chunks, so a key split across two chunks is still found. */
const SCAN_OVERLAP = 8192

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
const FIELD = /"(file_path|notebook_path|cwd|tool_name|command|path|glob|output_mode|tool|filePath|include|workdir|directory)"\s*:\s*"((?:[^"\\]|\\.){0,4096})"/g

/** A Dethereal tool, on any harness, or a grant of every tool of a server or of all servers. */
const GRANT = /mcp__plugin_dethereal|mcp__dethereal|dethereal_[a-z*]|mcp__\*|mcp__plugin_\*|["']\*["']\s*[:=]\s*["']?allow/i

export interface RawEvent {
  /** The whole event when it arrived complete and within the cap; otherwise null. */
  readonly text: string | null
  /**
   * Values of `file_path`, `notebook_path`, `cwd`, `tool_name`, `command`, `path`, `glob` and `output_mode`
   * (and OpenCode's `tool`, `filePath`, `include`, `workdir` and `directory`) found anywhere in the stream.
   */
  readonly fields: ReadonlyMap<string, readonly string[]>
}

export interface GuardEnv {
  readonly env: NodeJS.ProcessEnv
  readonly home: string
  readonly platform: NodeJS.Platform
  readonly cwd: string
  /** Reads a guarded file an edit would change; null when it cannot be read or is too large. */
  readonly readFile: (file: string) => string | null
}

export type GuardDecision = { readonly deny: false } | { readonly deny: true; readonly reason: string }

function unescape(raw: string): string | undefined {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return undefined
  }
}

class FieldScanner {
  private tail = ''
  readonly fields = new Map<string, string[]>()
  /** Each field's values as a set too: an event may repeat a field a million times, and a list search would be quadratic. */
  private readonly seen = new Map<string, Set<string>>()

  push(chunk: string): void {
    const window = this.tail + chunk
    for (const m of window.matchAll(FIELD)) {
      const value = unescape(m[2]!)
      if (value === undefined) continue
      const list = this.fields.get(m[1]!) ?? []
      const seen = this.seen.get(m[1]!) ?? new Set<string>()
      if (!seen.has(value)) {
        seen.add(value)
        list.push(value)
      }
      this.fields.set(m[1]!, list)
      this.seen.set(m[1]!, seen)
    }
    this.tail = window.slice(-SCAN_OVERLAP)
  }
}

/** A raw event from a string that arrived whole (tests, and the CLI's own stdin reader). */
export function rawEventFrom(text: string): RawEvent {
  const scanner = new FieldScanner()
  scanner.push(text)
  return { text: Buffer.byteLength(text) <= GUARD_EVENT_CAP ? text : null, fields: scanner.fields }
}

/** Reads the event from a stream: kept whole up to the cap and the timeout, scanned throughout. */
export function readGuardEvent(input: NodeJS.ReadStream = process.stdin): Promise<RawEvent> {
  if (input.isTTY) return Promise.resolve({ text: null, fields: new Map() })
  return new Promise((resolve) => {
    const scanner = new FieldScanner()
    const chunks: Buffer[] = []
    let size = 0
    let whole = true
    const done = (complete: boolean) => {
      clearTimeout(timer)
      input.removeAllListeners('data')
      input.removeAllListeners('end')
      input.removeAllListeners('error')
      input.destroy()
      resolve({ text: complete && whole ? Buffer.concat(chunks).toString('utf8') : null, fields: scanner.fields })
    }
    const timer = setTimeout(() => done(false), GUARD_TIMEOUT_MS)
    input.on('data', (chunk: Buffer) => {
      size += chunk.length
      scanner.push(chunk.toString('utf8'))
      if (size > GUARD_EVENT_CAP) {
        whole = false
        chunks.length = 0
      } else chunks.push(chunk)
    })
    input.on('end', () => done(true))
    input.on('error', () => done(false))
  })
}

/**
 * The real path of `p` through its nearest existing ancestor; `p` itself when none resolves. A link
 * whose target does not exist yet is followed too: a write through it creates the target.
 *
 * The nearest existing ancestor is found by bisection, not by testing every ancestor from `p` up: a
 * path can hold many thousand segments, and each test passes the whole path to the system. Bisection
 * finds the same one because nothing exists below a missing folder. Only the missing entry directly
 * under it can be a link: any deeper entry has a missing parent, so `lstat` cannot reach it.
 */
export function realish(p: string, depth = 0): string {
  // `p` and its ancestors, nearest first, as `path.dirname` gives them; the root last.
  const chain = [p]
  for (let parent = path.dirname(p); parent !== chain.at(-1); parent = path.dirname(parent)) chain.push(parent)
  let lo = 0
  let hi = chain.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (existsSync(chain[mid]!)) hi = mid
    else lo = mid + 1
  }
  if (lo > 0) {
    const missing = chain[lo - 1]!
    if (depth < 8) {
      let link: string | undefined
      try {
        link = lstatSync(missing).isSymbolicLink() ? readlinkSync(missing) : undefined
      } catch {
        link = undefined
      }
      if (link !== undefined) return realish(path.join(path.resolve(path.dirname(missing), link), path.relative(missing, p)), depth + 1)
    }
    if (lo === chain.length) return p
  }
  const existing = chain[lo]!
  try {
    return path.join(realpathSync(existing), path.relative(existing, p))
  } catch {
    // A path that exists but resolves to nothing the system names (a volume or descriptor alias) cannot be judged; a
    // device (`/dev/stderr` is a descriptor's) holds no configuration, and `/dev/fd` is refused as an alias.
    if (existing === '/dev' || existing.startsWith('/dev/')) return p
    throw new Unresolved()
  }
}

export type PathClass = `config:${ConfigKind}` | 'plugin' | 'plugin-cache' | 'git-config' | 'definition' | undefined

export interface Roots {
  /** The user's own git configuration and attributes: `~/.gitconfig`, and `git/config` and `git/attributes` in XDG's folder. */
  readonly gitUser: readonly string[]
  readonly claudeConfig?: string
  readonly codexHome?: string
  readonly opencodeDir: string
  readonly opencodeConfig?: string
}

function roots(g: GuardEnv, norm: (p: string) => string): Roots {
  const abs = (v: string | undefined) => (v && path.isAbsolute(v) ? norm(realish(path.resolve(v))) : undefined)
  const xdg = g.env.XDG_CONFIG_HOME && path.isAbsolute(g.env.XDG_CONFIG_HOME) ? g.env.XDG_CONFIG_HOME : path.join(g.home, '.config')
  return {
    // XDG's folder as set, and the default one: git reads either, whichever the session uses.
    gitUser: [...new Set([xdg, path.join(g.home, '.config')])].flatMap((d) => [path.join(d, 'git', 'config'), path.join(d, 'git', 'attributes')])
      .concat(path.join(g.home, '.gitconfig')).map((p) => norm(realish(p))),
    claudeConfig: abs(g.env.CLAUDE_CONFIG_DIR),
    codexHome: abs(g.env.CODEX_HOME),
    opencodeDir: norm(realish(path.join(xdg, 'opencode'))),
    opencodeConfig: abs(g.env.OPENCODE_CONFIG),
  }
}

function under(p: string, dir: string | undefined): string[] | undefined {
  if (!dir) return undefined
  const rel = path.relative(dir, p)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep) : undefined
}

/**
 * Whether path segments name git's own configuration inside a `.git` folder: `config`, `config.worktree`, `commondir`
 * or `gitdir` (also a submodule's under `modules/…` and a work tree's under `worktrees/…`), anything under `hooks`, or
 * `info/attributes`; or a `.git` file, which names the folder git reads in a linked work tree or a submodule.
 */
function gitInternal(segments: readonly string[]): boolean {
  // Read by index, never sliced per `.git`: a path can hold many thousand of them.
  const n = segments.length
  const last = segments.at(-1) ?? ''
  const lastHooks = segments.lastIndexOf('hooks')
  const infoAttributes = segments.at(-2) === 'info' && last === 'attributes'
  const configFile = ['config', 'config.worktree', 'commondir', 'gitdir'].includes(last)
  return segments.some((s, i) => {
    if (s !== '.git') return false
    if (i === n - 1) return true
    const nested = segments[i + 1] === 'modules' || segments[i + 1] === 'worktrees'
    if (segments[i + 1] === 'hooks' || (nested && lastHooks > i)) return true
    if (i <= n - 3 && infoAttributes) return true
    return configFile && (i === n - 2 || nested)
  })
}

/**
 * The folders below a root folder: a list of folder names and the index the root's contents start at.
 * Kept as an index, never sliced: a path can hold many thousand root folders.
 */
type Below = readonly [dirs: readonly string[], from: number]

/** The class of an absolute, normalised path. */
export function classify(p: string, r: Roots): PathClass {
  const segments = p.split(path.sep)
  const base = segments.at(-1) ?? ''
  const parent = segments.at(-2) ?? ''
  const dirs = segments.slice(0, -1)
  /** The last index of any of `kinds` in `list`, searched once per pair. */
  const lastKinds = new Map<readonly string[], Map<readonly string[], number>>()
  const lastKind = (list: readonly string[], kinds: readonly string[]) => {
    const byKinds = lastKinds.get(list) ?? new Map<readonly string[], number>()
    lastKinds.set(list, byKinds)
    const at = byKinds.get(kinds) ?? list.findLastIndex((d) => kinds.includes(d))
    byKinds.set(kinds, at)
    return at
  }
  /** A `<root>/<kind>/…` directory, or `<root>/plugins/…/<kind>/…` when `plugins` is allowed. */
  const kindUnder = ([list, from]: Below, kinds: readonly string[], viaPlugins: boolean) =>
    kinds.includes(list[from] ?? '') || (viaPlugins && list[from] === 'plugins' && lastKind(list, kinds) > from)
  const below = (name: string): Below[] => dirs.flatMap((d, i) => (d === name ? [[dirs, i + 1] as const] : []))
  const rel = (dir: string | undefined): Below[] => {
    const parts = under(p, dir)
    return parts ? [[parts.slice(0, -1), 0]] : []
  }

  // git's own configuration, hooks and attributes, a repository's or the user's: they can make git run a program.
  if (r.gitUser.includes(p) || gitInternal(segments)) return 'git-config'
  // Claude Code's plugin cache (its servers, hooks and skills, as installed): denied by path, whatever the file.
  if ([...below('.claude'), ...rel(r.claudeConfig)].some(([list, from]) => list[from] === 'plugins')) return 'plugin-cache'
  // Configuration: judged by what the edit changes.
  if (base === '.claude.json') return 'config:claude'
  if ((base === 'settings.json' || base === 'settings.local.json') && (parent === '.claude' || (r.claudeConfig && path.dirname(p) === r.claudeConfig))) return 'config:claude'
  if (base === 'config.toml' && (parent === '.codex' || (r.codexHome && path.dirname(p) === r.codexHome))) return 'config:codex'
  if (base === 'opencode.json' || base === 'opencode.jsonc' || p === r.opencodeConfig) return 'config:opencode'
  // OpenCode and Codex plugins: code, denied by path.
  const opencode = [...below('.opencode'), ...rel(r.opencodeDir)]
  if (opencode.some((d) => kindUnder(d, ['plugin', 'plugins'], false))) return 'plugin'
  if ([...below('.codex'), ...rel(r.codexHome)].some(([list, from]) => list[from] === 'plugins')) return 'plugin'

  // Definitions: denied by content.
  const claudeKinds = ['skills', 'commands', 'agents']
  if ([...below('.claude'), ...rel(r.claudeConfig)].some((d) => kindUnder(d, claudeKinds, true))) return 'definition'
  if (opencode.some((d) => kindUnder(d, ['agent', 'agents', 'command', 'commands', 'skill', 'skills', 'mode', 'modes'], false))) return 'definition'
  if (dirs.includes('.codex') || under(p, r.codexHome)) return 'definition'
  return undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * The file's text before the write and after it, as the tool would leave it; undefined when that
 * cannot be known — an unreadable or oversized file, an edit whose text is not found exactly once
 * (the tool would fail too), a notebook edit.
 */
function beforeAndAfter(tool: string, input: Record<string, unknown>, file: string, g: GuardEnv): { before: string; after: string; fragments: string[] } | undefined {
  const before = existsSync(file) ? g.readFile(file) : ''
  if (before === null) return undefined
  if (tool === 'Write') {
    const content = str(input.content)
    return content === undefined ? undefined : { before, after: content, fragments: [] }
  }
  if (tool === 'NotebookEdit') {
    const source = str(input.new_source)
    return source === undefined ? undefined : { before, after: before, fragments: [source] }
  }
  const edits = tool === 'MultiEdit' ? input.edits : [input]
  if (!Array.isArray(edits) || edits.length === 0) return undefined
  let text = before
  const fragments: string[] = []
  for (const edit of edits) {
    if (!isRecord(edit)) return undefined
    const oldString = str(edit.old_string)
    const newString = str(edit.new_string)
    if (oldString === undefined || newString === undefined || oldString === '') return undefined
    const count = text.split(oldString).length - 1
    if (count === 0 || (count > 1 && edit.replace_all !== true)) return undefined
    text = text.split(oldString).join(newString)
    fragments.push(newString)
  }
  return { before, after: text, fragments }
}

const REASON = {
  config: (rule: string) => `Dethereal: this edit to harness configuration ${rule}, which widens what runs without asking the operator; the operator edits it by hand.`,
  plugin: 'Dethereal: an agent does not write an OpenCode plugin, whose code could approve tools; the operator writes it by hand.',
  pluginCache: "Dethereal: an agent does not write Claude Code's plugin cache, whose servers, hooks and skills run as installed; the operator reinstalls the plugin instead.",
  gitConfig: "Dethereal: an agent does not write git's configuration, hooks or attributes, which can make git run a program when the operator next runs it; the operator edits them by hand.",
  settlement: 'Dethereal: this edit to harness configuration changes whether the settlement is on, which changes what the server holds back and refuses; the operator edits it by hand.',
  definition: 'Dethereal: an agent does not write a skill, command or agent definition that grants a Dethereal tool or a wildcard of tools; the operator writes it by hand.',
  unchecked: 'Dethereal: this write targets harness configuration or a definition file, and its content could not be checked.',
  aliased: 'Dethereal: this write names a file by another name than its path (a volume or descriptor alias), which cannot be checked; write it by its path.',
  patchEdit: 'Dethereal: a patch does not update or move harness configuration, a definition file or a plugin file; the operator edits it by hand (a patch may create such a file whole, or delete it).',
  patchTwice: 'Dethereal: this patch reaches one harness configuration or definition file twice; it is not run.',
  patchUnread: 'Dethereal: this patch could not be read for the files it changes, so it is not run.',
  patchEnvironment: 'Dethereal: a patch that names another environment is not run.',
  stateRoot: "Dethereal: the server's own folder in the home directory (.dethernety) is never written by an agent.",
} as const

/** One file operation of a Codex patch. */
export interface PatchOperation {
  readonly kind: 'add' | 'update' | 'delete' | 'move'
  /** The path as written; for a move, the destination. */
  readonly path: string
  /** add: the file's whole new text; undefined when its lines could not all be read. */
  readonly content?: string
}

const PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to):(.*)$/
/**
 * Whitespace at a line's ends as either reader sees it: Codex trims header lines with Rust's
 * `str::trim` (Unicode White_Space, U+0085 included, which JavaScript's trim keeps), so both sets go.
 * Wider than Rust on purpose (U+FEFF too): reading more lines as headers only adds checks.
 */
const PATCH_SPACE = /[\s\u0085]/

/**
 * A line without the whitespace at its ends, read one character at a time from each end: a regex
 * anchored at the end retries from every space in a long run, which is quadratic.
 */
function trimPatchSpace(line: string): string {
  let start = 0
  let end = line.length
  while (start < end && PATCH_SPACE.test(line[start]!)) start++
  while (end > start && PATCH_SPACE.test(line[end - 1]!)) end--
  return line.slice(start, end)
}

/**
 * The file operations of a Codex patch, read more widely than Codex reads them: every line that is a
 * file header once trimmed counts, wherever it stands, so a header Codex accepts is never missed.
 * Null when the patch names another environment or names no file at all.
 */
export function patchOperations(text: string): PatchOperation[] | null {
  const ops: { kind: PatchOperation['kind']; path: string; lines?: string[]; bad?: boolean }[] = []
  let adding: { lines?: string[]; bad?: boolean } | undefined
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const trimmed = trimPatchSpace(line)
    if (/^\*\*\* Environment ID:/.test(trimmed)) return null
    const header = PATCH_HEADER.exec(trimmed)
    if (header) {
      const kind = header[1] === 'Add File' ? 'add' : header[1] === 'Update File' ? 'update' : header[1] === 'Delete File' ? 'delete' : 'move'
      const op = { kind, path: header[2]!.replace(/^ /, ''), ...(kind === 'add' ? { lines: [] as string[] } : {}) } as const
      ops.push(op)
      adding = kind === 'add' ? op : undefined
      continue
    }
    if (!adding) continue
    if (/^\*\*\* End (Patch|of File)\b/.test(trimmed) || /^\*\*\* Begin Patch\b/.test(trimmed)) {
      adding = undefined
      continue
    }
    if (line.startsWith('+')) adding.lines!.push(line.slice(1))
    else if (line !== '' || adding.lines!.length > 0) adding.bad = true
  }
  if (ops.length === 0) return null
  return ops.map((o) => ({ kind: o.kind, path: o.path, ...(o.kind === 'add' && !o.bad ? { content: o.lines!.map((l) => `${l}\n`).join('') } : {}) }))
}

/** Decides a Codex patch: each file it creates, updates, moves or deletes, resolved as Codex resolves it. */
function decidePatch(text: string | undefined, base: string, g: GuardEnv, r: Roots, norm: (p: string) => string): GuardDecision {
  const ops = text === undefined ? null : patchOperations(text)
  if (ops === null) return { deny: true, reason: text !== undefined && /\*\*\* Environment ID:/.test(text) ? REASON.patchEnvironment : REASON.patchUnread }
  const stateRoot = norm(realish(path.join(g.home, '.dethernety')))
  const touched = new Set<string>()
  for (const op of ops) {
    // Codex resolves a path against the session's folder and never expands `~`; the expanded and the
    // trimmed spellings are judged as well, so a guard never trusts one reading of the path.
    const spellings = new Set([op.path, op.path.trim()])
    for (const s of [...spellings]) if (s === '~' || s.startsWith('~/')) spellings.add(s === '~' ? g.home : path.join(g.home, s.slice(2)))
    let guarded: PathClass = undefined
    for (const s of spellings) {
      if (!s) continue
      const abs = path.resolve(base, s)
      if (aliasedPath(abs)) return { deny: true, reason: REASON.aliased }
      for (const p of [norm(abs), norm(realish(abs))]) {
        if (p === stateRoot || under(p, stateRoot)) return { deny: true, reason: REASON.stateRoot }
        const c = classify(p, r)
        if (c === 'plugin' || c === 'plugin-cache') return { deny: true, reason: c === 'plugin' ? REASON.plugin : REASON.pluginCache }
        if (c === 'git-config') return { deny: true, reason: REASON.gitConfig }
        guarded ??= c
      }
    }
    if (!guarded) continue
    const abs = path.resolve(base, op.path)
    const key = norm(realish(abs))
    if (touched.has(key)) return { deny: true, reason: REASON.patchTwice }
    touched.add(key)
    if (op.kind === 'update' || op.kind === 'move') return { deny: true, reason: REASON.patchEdit }
    const before = existsSync(realish(abs)) ? g.readFile(realish(abs)) : ''
    if (before === null) return { deny: true, reason: REASON.unchecked }
    if (op.kind === 'delete') {
      if (!guarded.startsWith('config:')) continue
      const verdict = judgeConfigEdit(guarded.slice('config:'.length) as ConfigKind, before, '')
      if (verdict === undefined) return { deny: true, reason: REASON.unchecked }
      if (!verdict.ok) return { deny: true, reason: configReason(verdict) }
      continue
    }
    if (op.content === undefined) return { deny: true, reason: REASON.unchecked }
    if (guarded.startsWith('config:')) {
      const verdict = judgeConfigEdit(guarded.slice('config:'.length) as ConfigKind, before, op.content)
      if (verdict === undefined) return { deny: true, reason: REASON.unchecked }
      if (!verdict.ok) return { deny: true, reason: configReason(verdict) }
    } else if (GRANT.test(op.content)) return { deny: true, reason: REASON.definition }
  }
  return { deny: false }
}

/** The refusal for a configuration edit the content judge denied. */
function configReason(verdict: { rule: string; kind?: 'settlement' }): string {
  return verdict.kind === 'settlement' ? REASON.settlement : REASON.config(verdict.rule)
}

/** What a case-insensitive disk reads these letters as, beyond lower case. */
const FULL_FOLD: Record<string, string> = {
  '\u017f': 's', '\u00df': 'ss', '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st',
}

/** Decides a PreToolUse event. */
export function decideConfigWrite(raw: RawEvent, g: GuardEnv): GuardDecision {
  try {
    return decideConfigWriteOnce(raw, g)
  } catch (e) {
    if (e instanceof Unresolved) return { deny: true, reason: REASON.aliased }
    throw e
  }
}

/** Folders through which the system reaches a file by another name than the path's (see `aliasedPath`). The guard keeps
 * to node builtins and its own content rules, so this is a copy of the by-name fallback's; the alias tests hold both. */
const ALIAS_ROOTS = new Set(['.vol', '.resolve', '.nofollow'])
/** A process's folders in `/proc/<pid>/` that name another file: its root, folder, descriptors, maps and program. */
const PROC_LINKS = new Set(['root', 'cwd', 'fd', 'fdinfo', 'map_files', 'exe'])

/**
 * Whether an absolute path (normalised, '/' separators) reaches a file by another name than its text, which a guard
 * cannot follow: macOS's volume-by-id forms (`/.vol/<device>/<inode>/…`, `/.resolve/…`, `/.nofollow/…`) and its data
 * volume (`/System/Volumes/Data/…`, the same files under another path); a process's descriptors and folders
 * (`/dev/fd/…`, `/proc/self/…`, `/proc/<pid>/root`, `cwd`, `fd`, …), which a guard sees as its own process does, not
 * as the command's; but for the standard streams (`/dev/fd/0` to `2`, as `/dev/stdin` reads), which name no file. In
 * any letter case: a disk that folds case may reach them so.
 */
export function aliasedPath(p: string): boolean {
  if (!p.startsWith('/')) return false
  const segs = p.slice(1, 400).split('/').slice(0, 5).map((s) => s.toLowerCase())
  if (ALIAS_ROOTS.has(segs[0]!)) return true
  if (segs[0] === 'system' && segs[1] === 'volumes' && segs[2] === 'data') return true
  if (segs[0] === 'dev' && segs[1] === 'fd') return segs.length !== 3 || !/^[012]$/.test(segs[2]!)
  if (segs[0] !== 'proc') return false
  if (segs[1] === 'self' || segs[1] === 'thread-self') return true
  return /^\d+$/.test(segs[1] ?? '') && (PROC_LINKS.has(segs[2] ?? '') || (segs[2] === 'task' && PROC_LINKS.has(segs[4] ?? '')))
}

/** A path that exists but whose real path cannot be read: not judged, so not written. */
class Unresolved extends Error {}

function decideConfigWriteOnce(raw: RawEvent, g: GuardEnv): GuardDecision {
  const fold = g.platform === 'darwin' || g.platform === 'win32'
  // The disk folds case in full: the long s, the sharp s and the Latin ligatures too.
  // And it reads a name in either Unicode normal form (an accented letter composed or not) as the same.
  const norm = (p: string) => (fold ? p.normalize('NFC').toLowerCase().replace(/[\u017f\u00df\ufb00-\ufb06]/g, (c) => FULL_FOLD[c]!) : p)
  const r = roots(g, norm)

  let event: unknown
  if (raw.text !== null) {
    try {
      event = JSON.parse(raw.text)
    } catch {
      event = undefined
    }
  }
  const parsed = isRecord(event) && isRecord(event.tool_input) ? event : undefined
  const tool = parsed ? str(parsed.tool_name) : raw.fields.get('tool_name')?.[0]
  if (tool !== undefined && !WRITE_TOOLS.has(tool)) return { deny: false }

  const input = parsed ? (parsed.tool_input as Record<string, unknown>) : undefined
  const cwdField = parsed ? str(parsed.cwd) : raw.fields.get('cwd')?.[0]
  const base = cwdField && path.isAbsolute(cwdField) ? cwdField : g.cwd
  // A patch is judged only whole: one that could not be read in full names files no field recovers.
  if (tool === 'apply_patch') return decidePatch(input ? str(input.command) : undefined, base, g, r, norm)
  const targets = input
    ? [str(input.file_path), str(input.notebook_path)].filter((p): p is string => !!p)
    : [...(raw.fields.get('file_path') ?? []), ...(raw.fields.get('notebook_path') ?? [])]

  const stateRoot = norm(realish(path.join(g.home, '.dethernety')))
  for (const target of targets) {
    const expanded = target === '~' ? g.home : target.startsWith('~/') ? path.join(g.home, target.slice(2)) : target
    const abs = path.resolve(base, expanded)
    if (aliasedPath(abs)) return { deny: true, reason: REASON.aliased }
    // The server's own folder (its sign-in, and the runtime the hooks execute) is never written by an agent.
    if ([norm(abs), norm(realish(abs))].some((p) => p === stateRoot || under(p, stateRoot))) return { deny: true, reason: REASON.stateRoot }
    const classes = [classify(norm(abs), r), classify(norm(realish(abs)), r)]
    if (classes.includes('plugin')) return { deny: true, reason: REASON.plugin }
    if (classes.includes('plugin-cache')) return { deny: true, reason: REASON.pluginCache }
    if (classes.includes('git-config')) return { deny: true, reason: REASON.gitConfig }
    const config = classes.find((c): c is `config:${ConfigKind}` => !!c?.startsWith('config:'))
    const definition = classes.includes('definition')
    if (!config && !definition) continue
    const change = input && tool ? beforeAndAfter(tool, input, realish(abs), g) : undefined
    if (change === undefined) return { deny: true, reason: REASON.unchecked }
    if (config) {
      if (tool === 'NotebookEdit') return { deny: true, reason: REASON.unchecked }
      const verdict = judgeConfigEdit(config.slice('config:'.length) as ConfigKind, change.before, change.after)
      if (verdict === undefined) return { deny: true, reason: REASON.unchecked }
      if (!verdict.ok) return { deny: true, reason: configReason(verdict) }
      continue
    }
    if (GRANT.test([change.after, ...change.fragments].join('\n'))) return { deny: true, reason: REASON.definition }
  }
  return { deny: false }
}

/**
 * An OpenCode write, from the plugin (`{ tool, directory, args }`), as the Claude event the guard
 * judges: `write` a Write, `edit` an Edit, `multiedit` a MultiEdit, `patch` and `apply_patch` a patch
 * whose text names its files (resolved from `directory`). Null for any other tool, or an event that
 * cannot be read.
 */
export function openCodeWriteEvent(event: unknown): { tool: string; text: string } | null {
  if (!isRecord(event) || typeof event.tool !== 'string') return null
  const args = isRecord(event.args) ? event.args : {}
  const cwd = str(event.directory)
  const edit = (e: Record<string, unknown>) => ({ old_string: e.oldString, new_string: e.newString, replace_all: e.replaceAll === true })
  let tool_name: string
  let tool_input: Record<string, unknown>
  if (event.tool === 'write') [tool_name, tool_input] = ['Write', { file_path: args.filePath, content: args.content }]
  else if (event.tool === 'edit') [tool_name, tool_input] = ['Edit', { file_path: args.filePath, ...edit(args) }]
  else if (event.tool === 'multiedit') {
    const edits = Array.isArray(args.edits) ? args.edits.map((e) => (isRecord(e) ? edit(e) : {})) : undefined
    ;[tool_name, tool_input] = ['MultiEdit', { file_path: args.filePath, edits }]
  } else if (event.tool === 'patch' || event.tool === 'apply_patch') [tool_name, tool_input] = ['apply_patch', { command: args.patchText }]
  else return null
  return { tool: event.tool, text: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, ...(cwd ? { cwd } : {}) }) }
}

// ── opening a project file without blocking ─────────────────────────────────────────────────────

/*
 * A plain open of a FIFO waits for a writer in the kernel, before any deadline can fire, so a named
 * pipe planted where a hook reads would hang the hook until the harness gives up on it. Files are
 * opened non-blocking and judged by `fstat` on the open descriptor, so a file swapped in after a
 * `stat` is judged too. The secret guard reads through these as well.
 */

export type OpenedFile =
  | { readonly kind: 'regular'; readonly fd: number; readonly size: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'directory' }
  /** A FIFO, socket, device or anything else that is not a regular file. */
  | { readonly kind: 'special' }

/**
 * Opens `file` for reading. A regular file comes back open (the caller closes `fd`); anything else is
 * closed and named. A missing file (or a missing folder on the way) is `missing`; other errors throw.
 */
export function openRegular(file: string): OpenedFile {
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    if (code === 'EISDIR') return { kind: 'directory' }
    // A socket cannot be opened at all.
    if (code === 'ENXIO' || code === 'EOPNOTSUPP') return { kind: 'special' }
    throw e
  }
  let st
  try {
    st = fstatSync(fd)
  } catch (e) {
    closeSync(fd)
    throw e
  }
  if (st.isFile()) return { kind: 'regular', fd, size: st.size }
  closeSync(fd)
  return st.isDirectory() ? { kind: 'directory' } : { kind: 'special' }
}

/**
 * The text of a regular file of at most `maxBytes`, read through `openRegular`; null for a missing
 * file, a directory, a special file or one larger than the limit. Other errors throw.
 */
export function readRegularText(file: string, maxBytes: number): string | null {
  const f = openRegular(file)
  if (f.kind !== 'regular') return null
  try {
    return f.size > maxBytes ? null : readOpened(f.fd, maxBytes)
  } finally {
    closeSync(f.fd)
  }
}

/** The rest of an open file as text, or null once it passes `maxBytes` (a file that grew since its fstat). */
export function readOpened(fd: number, maxBytes: number): string | null {
  const chunks: Buffer[] = []
  let total = 0
  const buf = Buffer.alloc(64 * 1024)
  for (;;) {
    const r = readSync(fd, buf, 0, buf.length, null)
    if (r === 0) break
    total += r
    if (total > maxBytes) return null
    chunks.push(Buffer.from(buf.subarray(0, r)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The guard's environment in a real process. */
export function processGuardEnv(): GuardEnv {
  return {
    env: process.env,
    home: os.homedir(),
    platform: process.platform,
    cwd: process.cwd(),
    // Opened non-blocking: a FIFO at a guarded path is not a file the guard can judge (null: unchecked).
    readFile: (file) => {
      try {
        return readRegularText(file, GUARDED_FILE_MAX_BYTES)
      } catch {
        return null
      }
    },
  }
}

/** The hook's stdout for a decision: a deny, or nothing. */
export function guardOutput(decision: GuardDecision): string {
  if (!decision.deny) return ''
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } })
}
