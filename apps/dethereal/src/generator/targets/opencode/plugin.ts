/**
 * Dethereal's OpenCode plugin. OpenCode runs it in its own process, with the operator's rights.
 *
 * - Before `read`, `grep` and `bash`: the secret guard (`dethereal hook secret-guard`); before every
 *   file write: the config guard (`dethereal hook config-guard`). A denial throws, so OpenCode refuses
 *   the call and the model reads why. A call is let through only when the guard ran and allowed it.
 *   When the guard cannot be started at all (no node at the path the installer wrote), a read, a
 *   search or a write is refused, and a shell command is judged by name: refused when Codex's runner
 *   would refuse it then (it names a secret file or guarded configuration), and also when any of its
 *   arguments holds `dethernety`, it runs in or names a path in a harness's home, OpenCode's data
 *   folder or the server's folder, names such a folder anywhere (a `.codex`, `.claude`, `.dethernety`
 *   or `.local/share/opencode` segment), spells a variable that names one, or cannot be judged. A
 *   tool this plugin does not know is refused when its arguments reach for the server's folder from
 *   outside the project. OpenCode's own text-only tools, in their exact argument shape, are not
 *   judged that way (BUILTIN_SHAPES): a delegation's prompt goes to a subagent whose every call
 *   passes through this hook again. But OpenCode reads the files a `task` prompt mentions (`@path`)
 *   itself, past this hook and its permission rules, so each mention is judged as a `read` of that
 *   path is, whatever else the call holds: refused in a harness's home, OpenCode's data folder or
 *   the server's folder, and outside the project, where a read would ask first and a mention is
 *   read without asking. A mention is judged when the call is made; OpenCode reads it later (after the
 *   delegation's own question, or once a background delegation starts), so a file changed between
 *   the two is not seen.
 *   `skill`, `lsp`, `webfetch`, `websearch`, the MCP resource tools, every MCP server's tools, any
 *   custom tool, and a built-in name in another shape stay judged.
 * - When OpenCode builds its configuration: the questions the Dethereal tools that need the
 *   operator ask, and the denies on the server's own folder, set again last, over any later layer.
 * - After a file write: which threat models the change touched (`hook post-write`), appended to
 *   the tool's output.
 * - When a session is compacted: the workspace state (`hook session-start --source compact`), with
 *   an instruction to the summariser to keep it verbatim.
 *
 * It starts only node with the Dethereal CLI, never a shell, and sends each hook the fields it needs.
 * As installed, it imports node builtins only and exports one function: OpenCode calls every export
 * as a plugin. The generator writes the by-name judgement (`secret-fallback.mjs`) into it in place
 * of its import, so it needs no other file and no runtime to judge by name.
 */

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import * as fallback from '../../../utils/secret-fallback.mjs'

// dethereal-opencode-plugin: the installer recognises this file by this line.

// The installer writes all three, each as JSON.
const NODE: string = "<node-abs>"
const ENTRY: string = "<runtime>/dist/index.js"
/** The platform URL given at install, as the server gets it: a DETHERNETY_URL in OpenCode's environment still wins. */
const URL_ENV: Record<string, string> = {"DETHERNETY_PLATFORM_URL":"<platform-url>"}

/** Longer than the guard's own deadline, so the guard answers first. */
const TIMEOUT_MS = 12_000
const OUTPUT_MAX = 1024 * 1024
const GUARDED = new Set(['read', 'grep', 'bash'])
const WRITES = new Set(['write', 'edit', 'multiedit', 'patch', 'apply_patch'])
const ALLOW = '{"deny":false}'
/** Filled by the generator: the Dethereal tools that ask the operator before they run. */
const ASK_TOOLS: readonly string[] = ["<ask-tools>"]
/** The server's own folder in the home directory, as OpenCode spells a home path in its permission rules. */
const STATE_ROOT_RULES = ['~/.dethernety', '~/.dethernety/*']
const KEEP_STATE = 'Copy the block below verbatim at the end of the summary, under its own heading: the next turn re-reads the Dethereal state from it.'

type Args = Record<string, unknown>

interface PluginInput {
  readonly directory: string
  /** The project's root, against which OpenCode resolves a mentioned file: `/` when the project is no git checkout. */
  readonly worktree?: string
}

interface ToolCall {
  readonly tool: string
  readonly args?: Args
}

interface Hooks {
  config: (config: Record<string, unknown>) => Promise<void>
  'tool.execute.before': (input: ToolCall, output: { args?: Args }) => Promise<void>
  'tool.execute.after': (input: ToolCall, output: { output?: unknown; metadata?: unknown }) => Promise<void>
  'experimental.session.compacting': (input: unknown, output: { context?: unknown }) => Promise<void>
}

interface Run {
  /** False when there was nothing to start: no file, or not one that may be run. */
  readonly started: boolean
  /** Exited 0 on its own, within the time and the output limit. */
  readonly ok: boolean
  readonly stdout: string
}

function run(command: readonly string[], input: string, cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    let settled = false
    let started = true
    let size = 0
    const chunks: Buffer[] = []
    let child: ReturnType<typeof spawn> | undefined
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ started, ok, stdout: ok ? Buffer.concat(chunks).toString('utf8') : '' })
    }
    const timer = setTimeout(() => {
      child?.kill('SIGKILL')
      finish(false)
    }, TIMEOUT_MS)
    try {
      child = spawn(NODE, [ENTRY, 'hook', ...command, '--harness', 'opencode'], { cwd, env: { ...process.env, ...URL_ENV }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      finish(false)
      return
    }
    let running = false
    child.on('spawn', () => {
      running = true
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      started = running || (e.code !== 'ENOENT' && e.code !== 'EACCES')
      finish(false)
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= OUTPUT_MAX) chunks.push(chunk)
      else {
        child?.kill('SIGKILL')
        finish(false)
      }
    })
    child.on('close', (code, signal) => finish(code === 0 && signal === null))
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })
}

const unchecked = (why: string) =>
  `dethereal-secret-guard: this call is not run: it could not be checked for secret files (${why}). Report this to the operator; do not reach the file another way.`

/** Whether any string in the arguments names the server's own folder, however it is quoted. */
function namesStateRoot(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return /dethernety/i.test(v.replace(/["'\\]/g, ''))
  if (depth > 4 || !v || typeof v !== 'object') return false
  return Object.values(v as object).some((x) => namesStateRoot(x, depth + 1))
}

/** Whether any string reaches for the server's folder from outside the project: a home spelling or a climb with it. */
function reachesStateRoot(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') {
    const t = v.replace(/["'\\]/g, '')
    return /dethernety/i.test(t) && /(^|[\s=:])(~|\$\{?HOME|\/)|\.\./.test(t)
  }
  if (depth > 4 || !v || typeof v !== 'object') return false
  return Object.values(v as object).some((x) => reachesStateRoot(x, depth + 1))
}

/** Past this length a command is not judged by name but refused: the name check grows with the square of its length, in OpenCode's own process. */
const BY_NAME_MAX = 8 * 1024
/** A glob or brace character: beside a home spelling, it lets the shell build a name the check never reads. */
const SHELL_PATTERN = /[*?[{]/
/** A run of slashes or backslashes this long is refused unjudged: the fallback's name check is slowest on one. BY_NAME_MAX bounds the cost of a run built otherwise. */
const SLASH_RUN = /[/\\]{64}/
/** The parts of OpenCode's data folder below the home that name nothing guarded on their own (`cd ~ && cd .local/share` reaches it in two steps), wherever a word names them, the project included. */
const DATA_PART = /(^|\/)\.local(\/share)?\/?$|(^|\/)share\/opencode(\/|$)/i
/** The commands that change folder: in any of their forms, one can reach the home without naming it. */
const CHANGES_FOLDER = new Set(['cd', 'pushd', 'popd'])
/** The home as a command spells it: `~`, `$HOME` or `${HOME}`. */
const HOME_SPELLING = /~|\$\{?HOME(?![A-Za-z0-9_])/
/** A harness's home, OpenCode's data folder or the server's folder, as a path segment wherever it sits: in the project too. */
const GUARDED_SEGMENT = /(^|\/)(\.codex|\.claude|\.dethernety|\.local\/share\/opencode)(\/|$)/i
/** A variable that names a guarded folder or the folder holding one, as a command may spell it, set or not. */
const HOME_VARIABLE = /\$\{?(CODEX_HOME|CLAUDE_CONFIG_DIR|XDG_DATA_HOME)(?![A-Za-z0-9_])/

/**
 * The folders a shell command may not reach when the guard cannot be started: each harness's home
 * (Codex's default and an absolute CODEX_HOME; Claude Code's default and an absolute CLAUDE_CONFIG_DIR),
 * OpenCode's data folder (the default, and an absolute XDG_DATA_HOME's beside it) and the server's
 * own folder. A default stays guarded beside the variable's; a folder that reads as the root names
 * nothing, as in the fallback.
 */
function guardedFolders(env: NodeJS.ProcessEnv, home: string, homes: ReturnType<typeof fallback.guardedHomes>): string[] {
  const data = env.XDG_DATA_HOME
  return [
    path.join(home, '.codex'), ...homes.codexHome.filter((h) => path.isAbsolute(h)),
    path.join(home, '.claude'), ...(homes.claudeConfig ? [homes.claudeConfig] : []),
    path.join(home, '.local', 'share', 'opencode'), ...(data && path.isAbsolute(data) ? [path.join(data, 'opencode')] : []),
    path.join(home, '.dethernety'),
  ].map((f) => path.resolve(f)).filter((f) => path.dirname(f) !== f)
}

/** A path as text: quotes dropped, a leading `~`, `$HOME` or `${HOME}` written as the home, and resolved from `from`. */
function resolvedText(p: string, from: string, home: string): string {
  return path.resolve(from, p.replace(/["']/g, '').replace(/^(~|\$\{HOME\}|\$HOME)(?=\/|$)/, () => home))
}

/** Whether a resolved path lies in one of the folders (resolved, none the root), in any letter case. */
function inFolders(at: string, folders: readonly string[]): boolean {
  const p = at.toLowerCase()
  return folders.some((f) => {
    const root = f.toLowerCase()
    return p === root || p.startsWith(root + path.sep)
  })
}

/**
 * The folders that hold a guarded folder, below the home (or the root, for one outside it): a
 * command that names one can reach the guarded folder by a relative name (`cd ~/.local/share &&
 * cat opencode/auth.json`).
 */
function ancestors(folders: readonly string[], home: string): string[] {
  const top = path.resolve(home || '/')
  const out = new Set<string>()
  for (const f of folders) {
    for (let p = path.dirname(f); p !== top && path.dirname(p) !== p; p = path.dirname(p)) out.add(p.toLowerCase())
  }
  return [...out]
}

/**
 * The highest folder a glob word can reach: its fixed folders up to the first glob component, then up one for each later
 * `..`, and for each glob component starting with a dot, which an older shell matches to `..` (`.?`, `.[.]`, `.*`).
 */
function globReach(w: string, cwd: string, home: string): string {
  const parts = w.replace(/\\/g, '/').split('/')
  const first = parts.findIndex((p) => SHELL_PATTERN.test(p))
  let at = resolvedText(parts.slice(0, first).join('/') || (w.startsWith('/') ? '/' : '.'), cwd, home)
  let depth = 0
  let lowest = 0
  for (const p of parts.slice(first)) {
    if (p === '..' || (p.startsWith('.') && SHELL_PATTERN.test(p))) depth--
    else if (p !== '.' && p !== '') depth++
    lowest = Math.min(lowest, depth)
  }
  for (let i = 0; i < -lowest; i++) at = path.dirname(at)
  return at
}

/** A name as the segment check reads it: '/'-separated, normalised, and relative when it lies in the session folder (whose own path is the operator's choice). */
function segmentText(t: string, directory: string): string {
  // In lower case throughout: a letter's lower case can be longer than the letter, and the segments match in any case.
  const n = path.posix.normalize(t.replace(/\\/g, '/')).toLowerCase()
  const d = directory.replace(/\\/g, '/').toLowerCase()
  return n === d ? '' : n.startsWith(`${d}/`) ? n.slice(d.length + 1) : n
}

/**
 * Whether a shell command is refused, judged by name only, when the guard cannot be started: it
 * cannot be judged (no command text, a working folder that is not text, or past BY_NAME_MAX); any
 * of its arguments holds `dethernety`; Codex's runner would refuse it then (a secret file or
 * guarded configuration); it spells a variable that names a guarded folder (HOME_VARIABLE: so the
 * values `vars` gives that check never decide anything here); it holds a glob or brace character
 * beside a home spelling, or from the home or a folder above it (where it runs, a word, the highest
 * folder a glob word can reach, or any change of folder); it runs in a guarded folder (its working folder, else the session's); or a word of it
 * (as written and with `$HOME` written as `~`, read from the folder it runs in) lies in one or is a folder
 * holding one, names a part of OpenCode's data folder (DATA_PART), or names or lands on a
 * GUARDED_SEGMENT outside the session folder's own path. A run of 64 slashes or backslashes is
 * refused unjudged. Names the shell builds (command output, other variables, quoting) are not seen.
 */
function refusedByName(args: Args, directory: string): boolean {
  const command = args.command
  const workdir = args.workdir ?? undefined
  if (typeof command !== 'string' || (workdir !== undefined && typeof workdir !== 'string')) return true
  const slashes = (t: string) => SLASH_RUN.test(t) || SLASH_RUN.test(t.replace(/["']/g, ''))
  if (command.length + (workdir?.length ?? 0) > BY_NAME_MAX || slashes(command) || (workdir !== undefined && slashes(workdir))) return true
  if (namesStateRoot(args)) return true
  const home = homedir()
  const env = process.env
  const homes = fallback.guardedHomes(env, home)
  const texts = workdir === undefined ? [command] : [command, workdir]
  // The variable test first: it is cheap, and the fallback reads each such command several ways.
  if (texts.some((t) => HOME_VARIABLE.test(t) || fallback.commandNamesGuarded(t, homes.codexHome, homes.claudeConfig, homes.vars))) return true
  const homeText = home && path.dirname(path.resolve(home)) !== path.resolve(home) ? path.resolve(home).toLowerCase() : undefined
  if (texts.some((t) => SHELL_PATTERN.test(t) && (HOME_SPELLING.test(t) || (homeText !== undefined && t.toLowerCase().includes(homeText))))) return true
  const folders = guardedFolders(env, home, homes)
  const parents = ancestors(folders, home)
  const session = path.resolve(directory)
  const cwd = workdir === undefined ? session : resolvedText(workdir, session, home)
  // A segment as written, and where the path lands: a climb names no segment as written.
  const segment = (text: string, at: string) => GUARDED_SEGMENT.test(segmentText(text, session)) || GUARDED_SEGMENT.test(segmentText(at, session))
  if (inFolders(cwd, folders) || (workdir !== undefined && (segment(workdir, cwd) || DATA_PART.test(segmentText(workdir, session))))) return true
  // The words as written, and with `$HOME` written as `~` (`${HOME}` never gets here: its brace is refused above):
  // commandWords splits a word at each dollar sign, so `$HOME/x` reads as `HOME/x`, and at a blank, which the home's own
  // path may hold. Both, since the split also ends a word before `$HOME` (`.codex$HOME`).
  const written = command.replace(/\$HOME(?![A-Za-z0-9_])/g, '~')
  const words = [...fallback.commandWords(command), ...fallback.commandWords(written)].map((w) => ({ w, at: resolvedText(w, cwd, home) }))
  // A glob or brace from the home, or a folder above it, builds a name there without spelling the home: refused when the
  // command changes folder at all, runs there, or a glob word can reach there (globReach).
  const top = path.resolve(home || '/').toLowerCase()
  const atOrAboveHome = (p: string) => { const l = p.toLowerCase(); return l === top || top.startsWith(l.endsWith(path.sep) ? l : l + path.sep) }
  if (SHELL_PATTERN.test(command) && (atOrAboveHome(cwd) || words.some(({ w, at }) =>
    CHANGES_FOLDER.has(w) || atOrAboveHome(at) || (SHELL_PATTERN.test(w) && atOrAboveHome(globReach(w, cwd, home)))))) return true
  return words.some(({ w, at }) => segment(w, at) || DATA_PART.test(segmentText(w, session)) || inFolders(at, folders) || parents.includes(at.toLowerCase()))
}

/** The reason to refuse the call, or null to let it run. */
function refusal(tool: string, r: Run, args: Args, directory: string): string | null {
  if (!r.started) return tool === 'bash' && !refusedByName(args, directory) ? null : unchecked('the guard could not be started')
  if (!r.ok) return unchecked('the guard failed or took too long')
  const out = r.stdout.trim()
  if (out === ALLOW) return null
  try {
    const d = JSON.parse(out) as { deny?: unknown; reason?: unknown }
    if (d.deny === true && typeof d.reason === 'string' && d.reason) return d.reason
  } catch {
    // An answer it cannot read refuses the call below.
  }
  return unchecked('the guard gave no answer it could read')
}

/** A permission block with our rules set last: a string block becomes `*` first, then ours. */
function withLast(block: unknown, rules: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = typeof block === 'string' ? { '*': block } : block && typeof block === 'object' ? { ...(block as Record<string, unknown>) } : {}
  for (const [key, action] of Object.entries(rules)) {
    delete out[key]
    out[key] = action
  }
  return out
}

const pick = (args: Args, keys: readonly string[]): Args => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]))
const FIELDS: Record<string, readonly string[]> = {
  read: ['filePath'],
  grep: ['pattern', 'path', 'include'],
  bash: ['command', 'workdir'],
  write: ['filePath', 'content'],
  edit: ['filePath', 'oldString', 'newString', 'replaceAll'],
  multiedit: ['filePath', 'edits'],
  patch: ['patchText'],
  apply_patch: ['patchText'],
}
/** Tools that read names only, or run nothing: no guard. */
const NAMES_ONLY = new Set(['glob', 'list'])

type Kind = 'string' | 'array' | 'boolean'
/**
 * OpenCode's built-in tools whose arguments are only text, in the exact shape each takes: `task`
 * (starts a subagent; OpenCode reads its prompt's mentions itself, judged below), `todowrite` (the
 * session's todo list), `question` and `plan_exit` (ask the operator) and `invalid` (reports bad
 * arguments). Apart from those mentions they run no command and read no file themselves. A tool of
 * the same name in another shape (a custom or plugin tool may take a built-in's name) is judged as
 * any tool this plugin does not know. A tool that runs, reads, fetches
 * or writes anything itself never belongs here: `skill` (reads a skill's files), `lsp`, `webfetch`,
 * `websearch`, the MCP resource tools, every MCP server's tools and any custom tool stay judged.
 */
const BUILTIN_SHAPES: Readonly<Record<string, { readonly required: Readonly<Record<string, Kind>>; readonly optional?: Readonly<Record<string, Kind>> }>> = {
  task: { required: { description: 'string', prompt: 'string', subagent_type: 'string' }, optional: { task_id: 'string', command: 'string', background: 'boolean' } },
  todowrite: { required: { todos: 'array' } },
  question: { required: { questions: 'array' } },
  invalid: { required: { tool: 'string', error: 'string' } },
  plan_exit: { required: {} },
}

/** Whether the call is one of OpenCode's text-only built-ins, in exactly the shape it takes. */
function inBuiltinShape(tool: string, args: Args): boolean {
  if (!Object.hasOwn(BUILTIN_SHAPES, tool)) return false
  const shape = BUILTIN_SHAPES[tool]!
  const kinds: Record<string, Kind> = { ...shape.required, ...shape.optional }
  const kind = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v)
  // An optional field left undefined (a subtask without a command) is absent.
  return Object.keys(shape.required).every((k) => Object.hasOwn(args, k)) &&
    Object.entries(args).every(([k, v]) => Object.hasOwn(kinds, k) && (kind(v) === kinds[k] || (v === undefined && !Object.hasOwn(shape.required, k))))
}

/** A file a prompt mentions, as OpenCode finds it (`@path`): a delegation reads each one itself, past this hook. */
const MENTION = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
/** Past this many mentions a delegation is refused unjudged: each one starts a guard. */
const MENTIONS_MAX = 32

/** Guards a delegation's mentions start at once: each is a node process. */
const GUARDS_AT_ONCE = 4

/** Each item through `f`, at most `width` at a time, results in order. */
async function inTurns<T, R>(items: readonly T[], width: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await f(items[i]!)
    }
  }))
  return out
}

/**
 * The paths a mention may reach: as resolved, and the real path it lands on, in its on-disk letter
 * case (a case-insensitive disk opens `ſhare` as `share`) and past any link. OpenCode reads a
 * mention only when it exists.
 */
function mentionPaths(at: string): string[] {
  try {
    return [...new Set([at, realpathSync.native(at)])]
  } catch {
    // Not there: nothing to read.
    return [at]
  }
}

/**
 * Why a delegation's prompt may not run, or null. OpenCode reads each file the prompt mentions itself,
 * resolved from the home (`~/`) or the project's root, past this hook, its permission rules and their
 * questions; so each mention is judged as a `read` of that path would be, and refused where a read
 * would have been refused or asked about, since a mention is read without asking: when it is spelled
 * with `%`, `\`, `#` or `?` (OpenCode reads it through a file URL, which may read those otherwise),
 * when any path it may reach lies outside the project (a read there asks first), in a harness's home,
 * OpenCode's data folder or the server's folder, or in such a folder within the project; then by the
 * secret guard, and when the guard cannot be started. The prose around the mentions is never judged.
 */
async function mentionRefusal(prompt: string, root: string, directory: string): Promise<string | null> {
  const names = [...new Set(Array.from(prompt.matchAll(MENTION), (m) => m[1]).filter((m): m is string => !!m))]
  if (names.length === 0) return null
  if (names.length > MENTIONS_MAX) return unchecked('a delegation mentions more files than can be checked')
  const not = (m: string, why: string) => `dethereal-secret-guard: @${m} ${why}; a delegation reads the files it mentions without asking, so it is not run. Report this to the operator; do not reach the file another way.`
  const spelled = names.find((m) => /[%\\#?]/.test(m))
  if (spelled !== undefined) return not(spelled, 'is spelled with %, \\, # or ?, which the reading through a file URL may read otherwise')
  const home = homedir()
  const folders = guardedFolders(process.env, home, fallback.guardedHomes(process.env, home))
  const session = path.resolve(directory)
  // OpenCode resolves a mention from the worktree: `/` in a project that is no git checkout, whose own
  // folder is then the session's.
  const base = path.resolve(root)
  const top = root === '/' ? session : base
  const tops = mentionPaths(top)
  const inProject = (p: string) => inFolders(p, tops)
  // A segment counts outside the project's own path, as written and as it really lies, read from the session folder and
  // from the project's root alike.
  const bases = [...new Set([...mentionPaths(session), ...tops])]
  const segment = (p: string) => bases.every((b) => GUARDED_SEGMENT.test(segmentText(p, b)))
  const guarded = (p: string) => inFolders(p, folders) || segment(p)
  const files = names.map((m) => ({ m, at: m.startsWith('~/') ? path.join(home, m.slice(2)) : path.resolve(base, m) }))
  for (const { m, at } of files) {
    // As written first: a mention refused so is never looked up on disk (a network path could hang the lookup).
    if (guarded(at)) return not(m, "lies in a harness's home, OpenCode's data folder or the server's folder, or in such a folder within the project")
    if (!inProject(at)) return not(m, 'lies outside the project')
    const reach = mentionPaths(at)
    if (reach.some(guarded)) return not(m, "lies in a harness's home, OpenCode's data folder or the server's folder, or in such a folder within the project")
    if (!reach.every(inProject)) return not(m, 'lies outside the project')
  }
  // The guard judges the path as OpenCode reads it, and resolves links itself.
  const runs = await inTurns(files, GUARDS_AT_ONCE, ({ at }) => run(['secret-guard'], JSON.stringify({ tool: 'read', directory, args: { filePath: at } }), directory))
  for (const [i, r] of runs.entries()) {
    const reason = refusal('read', r, { filePath: files[i]!.at }, directory)
    if (reason !== null) return reason
  }
  return null
}

/** The files an apply_patch result names, without their patches. */
function patchedFiles(metadata: unknown): Args[] | undefined {
  const files = metadata && typeof metadata === 'object' ? (metadata as { files?: unknown }).files : undefined
  if (!Array.isArray(files)) return undefined
  return files.map((f) => (f && typeof f === 'object' ? pick(f as Args, ['filePath', 'movePath']) : {}))
}

export const DetherealPlugin = async ({ directory, worktree }: PluginInput): Promise<Hooks> => ({
  config: async (config) => {
    const asks = Object.fromEntries(ASK_TOOLS.map((t) => [t, 'ask']))
    const permission = withLast(config.permission, asks)
    // The server-folder denies come last of all: OpenCode takes the last rule that matches, and a "*"
    // key in any layer matches every permission, so the block is moved after it, not set in place.
    const external = withLast(permission.external_directory, Object.fromEntries(STATE_ROOT_RULES.map((r) => [r, 'deny'])))
    delete permission.external_directory
    permission.external_directory = external
    config.permission = permission
    const agents = config.agent && typeof config.agent === 'object' ? (config.agent as Record<string, unknown>) : {}
    const explore = agents.explore && typeof agents.explore === 'object' ? (agents.explore as Record<string, unknown>) : {}
    config.agent = { ...agents, explore: { ...explore, permission: withLast(explore.permission, { 'dethereal_*': 'deny' }) } }
  },

  'tool.execute.before': async (input, output) => {
    const all = output.args ?? {}
    if (NAMES_ONLY.has(input.tool)) return
    // OpenCode reads a delegation's mentions itself, whatever else the call holds: judged first.
    if (input.tool === 'task' && typeof all.prompt === 'string') {
      const reason = await mentionRefusal(all.prompt, worktree || directory, directory)
      if (reason !== null) throw new Error(reason)
    }
    if (inBuiltinShape(input.tool, all)) return
    const guard = GUARDED.has(input.tool) ? 'secret-guard' : WRITES.has(input.tool) ? 'config-guard' : null
    if (guard === null) {
      if (reachesStateRoot(all)) throw new Error(unchecked('a tool this plugin does not know names the server\'s own folder'))
      return
    }
    const args = pick(all, FIELDS[input.tool] ?? [])
    const reason = refusal(input.tool, await run([guard], JSON.stringify({ tool: input.tool, directory, args }), directory), args, directory)
    if (reason !== null) throw new Error(reason)
  },

  'tool.execute.after': async (input, output) => {
    if (!WRITES.has(input.tool)) return
    try {
      const files = patchedFiles(output.metadata)
      const event = { tool: input.tool, directory, args: pick(input.args ?? {}, ['filePath', 'patchText']), ...(files ? { metadata: { files } } : {}) }
      const r = await run(['post-write'], JSON.stringify(event), directory)
      const hint = r.ok ? r.stdout.trim() : ''
      if (hint) output.output = `${typeof output.output === 'string' ? output.output : ''}\n\n${hint}`
    } catch {
      // The hint is advice: the write stands without it.
    }
  },

  'experimental.session.compacting': async (_input, output) => {
    try {
      const r = await run(['session-start', '--source', 'compact'], '', directory)
      const state = r.ok ? r.stdout.trim() : ''
      // The summariser reads these lines as optional context unless told to keep them.
      if (state && Array.isArray(output.context)) output.context.push(`${KEEP_STATE}\n\n${state}`)
    } catch {
      // The summary goes on without the state.
    }
  },
})
