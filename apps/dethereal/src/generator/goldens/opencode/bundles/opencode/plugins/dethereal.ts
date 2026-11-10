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
// The by-name judgement, written in by the generator from secret-fallback.mjs.
const fallback = (() => {
/**
 * Secret files and guarded configuration, by name only: what a guard can still judge when it cannot
 * run in full. A shell command is judged by the words it holds, a patch by the files its headers name.
 * Nothing is opened or resolved; a name that matches is enough to refuse.
 *
 * The secret lists here are the ones `secret-paths.ts` names (that module re-exports them), so both
 * read the same names. Only `node:` builtins: a hook runner carries a copy of this file.
 *
 * Also inlined into OpenCode's plugin: see `inlineFallback` in the OpenCode generator target, which lists
 * the rules this file must keep and fails generation when one breaks.
 */

/** Secret files named by their extension or a name part, matched against the file's own name. */
const SECRET_SUFFIXES = [
  '*.env', '*.envrc', '*.tfstate', '*.tfstate.*', '*.tfvars', '*.tfvars.json',
  '*.pem', '*.key', '*.p8', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '*.npmrc', '*.pypirc', '*.netrc', '*.git-credentials', '*.kubeconfig',
  '*application_default_credentials.json', '*service-account*.json', '*-sa-key.json',
  '*.dec',
]

/** Secret files named by their path, at the project root or nested. */
const SECRET_PATHS = [
  'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*',
  '.aws/credentials', '.docker/config.json', 'credentials.json', '.credentials.json', 'credentials.tfrc.json', '.terraformrc',
  '.pgpass', '.my.cnf', '.htpasswd', '.vault-token', 'secrets*.yaml', 'values*secret*.yaml',
  '.env.*', 'kubeconfig', '.kube/config', 'kubeconfig*.yaml', 'kubeconfig*.yml',
  'secrets*.yml', 'values*secret*.yml', 'secret.yaml', 'secret.yml',
]

/** Env files that hold names only: never secret, whatever else matches. */
const SECRET_EXCEPTIONS = ['*.env.example', '*.env.template', '*.env.sample', '*.env.dist']

/**
 * Configuration the full guards protect, as path endings (any letter case): harness settings, Codex's
 * and OpenCode's sign-ins (which the secret guard keeps from every tool; OpenCode's under any data
 * folder), and plugin or definition directories, and Dethereal's own state directory.
 */
const GUARDED_CONFIG = [
  '.codex/config.toml', '.codex/auth.json', 'opencode/auth.json', 'opencode/mcp-auth.json', '.claude/settings.json', '.claude/settings.local.json', '.claude.json',
  'opencode.json', 'opencode.jsonc',
]
/** Directories whose contents the config guard protects, matched as a path segment run. */
const GUARDED_DIRS = ['.codex/plugins', '.codex/agents', '.claude/plugins', '.claude/skills', '.claude/commands', '.claude/agents',
  '.opencode/plugin', '.opencode/plugins', '.opencode/agent', '.opencode/agents', '.opencode/command', '.opencode/commands',
  '.opencode/skill', '.opencode/skills', '.dethernety']

const segmentGlob = (glob) => glob.split('').map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : /[\\^$.|+()[\]{}]/.test(c) ? `\\${c}` : c)).join('')
const SUFFIX_RES = SECRET_SUFFIXES.map((g) => new RegExp(`^${segmentGlob(g)}$`))
const PATH_RES = SECRET_PATHS.map((g) => new RegExp(`(^|/)${segmentGlob(g)}$`))
const EXCEPTION_RES = SECRET_EXCEPTIONS.map((g) => new RegExp(`^${segmentGlob(g)}$`))
const hasControl = (t) => [...t].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)

/** A path as the matchers read it: '/' separators, lower case, no leading `./`, `/`, `~/` or drive. */
function normal(p) {
  return withoutTrailingSlashes(p.replace(/\\/g, '/').replace(/^[a-z]:/i, '').replace(/^~(?=\/|$)/, '').replace(/^(\.\/)+/, '').replace(/^\/+/, '')).toLowerCase()
}

/** The text without the slashes it ends with, read back from its end once (a pattern anchored at the end is not). */
function withoutTrailingSlashes(text) {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 47) end--
  return text.slice(0, end)
}

/** Whether a path names a secret file. Climbing segments are dropped: the name still counts. */
function namesSecret(p) {
  if (typeof p !== 'string' || !p || hasControl(p)) return false
  const rel = normal(p).split('/').filter((s) => s && s !== '..' && s !== '.').join('/')
  if (!rel) return false
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  if (EXCEPTION_RES.some((re) => re.test(base))) return false
  return SUFFIX_RES.some((re) => re.test(base)) || PATH_RES.some((re) => re.test(rel))
}

/** What Codex's home and Claude Code's configuration directory hold that the full guards protect: files, and directories. */
const CODEX_HOME_GUARDED = { files: ['config.toml', 'auth.json', '.credentials.json'], dirs: ['plugins', 'agents'] }
const CLAUDE_CONFIG_GUARDED = { files: ['settings.json', 'settings.local.json'], dirs: ['plugins', 'skills', 'commands', 'agents'] }

/**
 * Whether `rel` (as `normal` reads it, with a leading '/') is one of `guarded` under `home`, or inside one of its
 * directories. A home that reads as the root names nothing: matched against every relative path, it would refuse them.
 */
function underHome(rel, home, guarded) {
  return [home].flat().some((h) => {
    // Its doubled separators, `.` and `..` collapsed, as a path written under it is read.
    const root = typeof h === 'string' ? collapsed(`/${normal(h)}`).slice(1) : ''
    if (!root) return false
    const at = (name) => `/${root}/${name}`
    return guarded.files.some((f) => rel === at(f)) || guarded.dirs.some((d) => rel === at(d) || rel.startsWith(`${at(d)}/`))
  })
}

/** The variables naming the harnesses' homes, as a shell command may spell them. */
const HOME_VARS = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_DATA_HOME']

/**
 * Codex's home and Claude Code's configuration directory from the environment, and the values a command's `$CODEX_HOME`,
 * `$CLAUDE_CONFIG_DIR` and `$XDG_DATA_HOME` stand for (only those set and not empty). A value counts as a home when it is an absolute
 * path, as the full guards read them, and is resolved here as text only (nothing is opened, no link followed, where the
 * full config guard follows links). Codex's home is otherwise its default, `.codex` in `homeDir`. A relative
 * `CODEX_HOME`, which the full guards do not read, is kept here beside it as a name, since Codex may still use it.
 */
function guardedHomes(env, homeDir) {
  const set = (v) => (typeof v === 'string' && v ? v : undefined)
  const absolute = (v) => (set(v) && path.isAbsolute(v) ? path.resolve(v) : undefined)
  const relative = set(env.CODEX_HOME) && !path.isAbsolute(env.CODEX_HOME) ? [env.CODEX_HOME] : []
  const vars = Object.fromEntries(HOME_VARS.flatMap((name) => (set(env[name]) ? [[name, env[name]]] : [])))
  return { codexHome: [absolute(env.CODEX_HOME) ?? path.join(homeDir, '.codex'), ...relative], claudeConfig: absolute(env.CLAUDE_CONFIG_DIR), vars }
}

/** A shell variable's name, read where a `${` leaves off. */
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y

/**
 * The command with each `${NAME…}` written as `as(name, rest)`, `rest` being what follows the name up to its matching
 * brace (nested braces counted, or to the end when none closes it); left as written where `as` gives undefined. Only
 * `names` are read when given, any variable otherwise.
 */
function replaceBraced(command, as, names) {
  let out = ''
  let i = 0
  for (let at = command.indexOf('${'); at >= 0; at = command.indexOf('${', i)) {
    IDENT.lastIndex = at + 2
    const ident = IDENT.exec(command)?.[0]
    const name = ident && (!names || names.includes(ident)) ? ident : undefined
    if (!name) {
      out += command.slice(i, at + 2)
      i = at + 2
      continue
    }
    let end = at + 2 + name.length
    for (let depth = 1; end < command.length && depth > 0; end++) {
      if (command[end] === '{') depth++
      else if (command[end] === '}') depth--
    }
    const rest = command.slice(at + 2 + name.length, command[end - 1] === '}' ? end - 1 : end)
    out += command.slice(i, at) + (as(name, rest) ?? command.slice(at, end))
    i = end
  }
  return out + command.slice(i)
}

/** The operators whose word a `${NAME…}` may stand for: a default (`-`, `=`), an alternative (`+`), an error (`?`). */
const WORD_OPERATOR = /^:?[-=+?]/

/**
 * The command read more ways: with each `$NAME` or `${NAME…}` of `vars` written as its value (any `${NAME…}` form, a
 * trimmed or replaced one too, read as the whole value), its braces read both to the matching one and to the first
 * one (as unbalanced braces may be meant); and with the word of each `${ANY:-word}` (`-`, `=`, `+`, `?`, with or
 * without `:`) written in its place, as the shell may use it. Two rounds, so a word holding another form is read too.
 * Each copy only names more.
 */
function expansions(command, vars) {
  const set = (name) => (typeof vars?.[name] === 'string' && vars[name] ? vars[name] : undefined)
  const plain = (text) => HOME_VARS.reduce((out, name) => {
    const value = set(name)
    return value ? out.replace(new RegExp(`\\$${name}(?![A-Za-z0-9_])`, 'g'), () => value) : out
  }, text)
  const values = (text) => plain(replaceBraced(text, (name) => set(name), HOME_VARS))
  // To the first brace, or the end when none is left: one pass over the text, however many forms are unclosed.
  const toFirstBrace = (text) => plain(HOME_VARS.reduce((out, name) => {
    const value = set(name)
    return value ? out.replace(new RegExp(`\\$\\{${name}(?![A-Za-z0-9_])[^}]*(?:\\}|$)`, 'g'), () => value) : out
  }, text))
  const words = (text) => replaceBraced(text, (_name, rest) => (WORD_OPERATOR.test(rest) ? rest.replace(WORD_OPERATOR, '') : undefined))
  const seen = new Set([command])
  let round = [command]
  for (let r = 0; r < 2 && round.length; r++) {
    round = round.flatMap((t) => [values(t), toFirstBrace(t), words(t)]).filter((t) => !seen.has(t) && seen.add(t))
  }
  seen.delete(command)
  return [...seen]
}

/**
 * Whether a path names guarded configuration. `codexHome` (one home or a list) adds its `config.toml`, `auth.json`,
 * `.credentials.json` (a secret by its name anyway), `plugins` and `agents`; `claudeConfig`, Claude Code's configuration directory when the environment sets one (absolute), adds
 * its settings and its `plugins`, `skills`, `commands` and `agents`. `guardedHomes` reads both.
 */
function namesGuardedConfig(p, codexHome, claudeConfig) {
  if (typeof p !== 'string' || !p) return false
  // As written, and with empty, `.` and `..` segments collapsed: a write lands where the collapsed path points.
  const written = `/${normal(p)}`
  return [written, collapsed(written)].some((rel) =>
    GUARDED_CONFIG.some((end) => rel.endsWith(`/${end}`)) ||
    GUARDED_DIRS.some((d) => rel.includes(`/${d}/`) || rel.endsWith(`/${d}`)) ||
    underHome(rel, codexHome, CODEX_HOME_GUARDED) || underHome(rel, claudeConfig, CLAUDE_CONFIG_GUARDED))
}

/** A '/'-led path with its empty and `.` segments dropped and each `..` taking the segment before it. */
function collapsed(rel) {
  const out = []
  for (const s of rel.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return `/${out.join('/')}`
}

/**
 * The words of a shell command that could be paths: split on blanks and shell punctuation, quotes
 * removed, and the value side of `name=value` and `--flag=value` kept too; and split again with its
 * quotes and escapes dropped first, so a word quoted in part (`"$HOME"/x`) is read whole as well.
 * Wider than a shell reads it on purpose: more words only add checks.
 */
function commandWords(command) {
  if (typeof command !== 'string') return []
  return [...splitWords(command), ...splitWords(command.replace(/["'\\]/g, ''))]
}

/** One of the splittings `commandWords` joins: the text split on blanks and shell punctuation, value sides kept too. */
function splitWords(text) {
  const out = []
  for (const raw of text.split(/[\s;&|()<>`$"'{}]+/)) {
    if (!raw) continue
    out.push(raw)
    const eq = raw.indexOf('=')
    if (eq >= 0 && eq < raw.length - 1) out.push(raw.slice(eq + 1))
    if (raw.startsWith('@')) out.push(raw.slice(1))
  }
  return out
}

/** macOS `security`'s subcommands, as `security help` lists them: a word that is none of these is no call of it. */
const SECURITY_SUBCOMMANDS = new Set([
  'add-certificates', 'add-generic-password', 'add-internet-password', 'add-trusted-cert', 'authorizationdb', 'authorize',
  'cms', 'create-db', 'create-filevaultmaster-keychain', 'create-keychain', 'create-keypair', 'default-keychain',
  'delete-certificate', 'delete-generic-password', 'delete-identity', 'delete-internet-password', 'delete-keychain',
  'dump-keychain', 'dump-trust-settings', 'error', 'execute-with-privileges', 'export', 'export-smartcard', 'filevault',
  'find-certificate', 'find-generic-password', 'find-identity', 'find-internet-password', 'find-key',
  'get-identity-preference', 'help', 'import', 'install-mds', 'leaks', 'list-keychains', 'list-smartcards', 'lock-keychain',
  'login-keychain', 'platformsso', 'remove-trusted-cert', 'requirement-evaluate', 'set-generic-password-partition-list',
  'set-identity-preference', 'set-internet-password-partition-list', 'set-key-partition-list', 'set-keychain-password',
  'set-keychain-settings', 'show-keychain-info', 'smartcards', 'translocate-original-path', 'translocate-policy-check',
  'translocate-status-check', 'trust-settings-export', 'trust-settings-import', 'unlock-keychain',
  'user-trust-settings-enable', 'verify-cert',
])

/** macOS `security` subcommands that print no secret: certificates, identities and keychains by name. */
const SECURITY_QUIET = new Set(['find-certificate', 'find-identity', 'list-keychains', 'default-keychain', 'show-keychain-info', 'verify-cert', 'help'])

/**
 * Whether macOS's `security`, given these arguments, may print a secret from a keychain or run what it is sent: every
 * subcommand but those few, `find-generic-password` and `find-internet-password` only with `-w` or `-g` (alone they print
 * an item's attributes), interactive mode (`-i`, or `-p`, which implies it), and a subcommand the shell builds (`$X`,
 * `$(…)`). A word after it that is no subcommand means the word `security` was text, not the tool, unless `fed`: xargs
 * or parallel runs it, so its subcommand may come from its input.
 */
function securityPrintsSecret(args, fed = false) {
  let i = 0
  // Its own options only (`-h`, `-i`, `-l`, `-q`, `-v`, `-p prompt`); `-i`, and `-p`, which implies it, read what to run
  // from input. Any other option means the word before was not the tool.
  for (; i < args.length && typeof args[i] === 'string' && args[i].startsWith('-'); i++) {
    if (args[i] === '--') {
      i++
      break
    }
    if (!/^-[hilqvp]+$/.test(args[i])) return fed
    if (/[ip]/.test(args[i])) return true
  }
  const word = args[i]
  // A word the shell builds may be any subcommand.
  if (typeof word === 'string' && /[$`]/.test(word)) return true
  // The tool takes any unique start of a subcommand's name (`dump-k`, `find-g`): every one the word may stand for counts.
  const could = typeof word === 'string' && word ? [...SECURITY_SUBCOMMANDS].filter((s) => s.startsWith(word)) : []
  if (!could.length) return fed
  if (could.every((s) => SECURITY_QUIET.has(s))) return false
  if (could.every((s) => SECURITY_QUIET.has(s) || s === 'find-generic-password' || s === 'find-internet-password')) {
    return args.slice(i + 1).some((a) => typeof a === 'string' && /^-[A-Za-z]*[wg]/.test(a))
  }
  return true
}

/** Whether a word names macOS's `security`: its file name, or a glob that matches it (`securit?`). */
function namesSecurity(word, globs = true) {
  // In any letter case: a case-insensitive disk finds the tool so.
  const name = word.replace(/^.*\//, '').toLowerCase()
  if (name === 'security') return true
  if (!globs || !/[*?[]/.test(name)) return false
  const glob = name.replace(/\[!/g, '[^').split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : '[]^'.includes(c) ? c : /[\\$.|+(){}]/.test(c) ? `\\${c}` : c)).join('')
  const pieces = globPieces(glob)
  // A pattern the shell cannot read either (`[`, `[[`) is a word as written.
  return pieces !== null && matchesPieces(pieces, 'security')
}

/**
 * The pattern `namesSecurity` builds, as the pieces a regular expression reads it as: `star` for `.*`, `start` for a `^`
 * outside a class, and a test of one character for everything else (a literal, `.`, a `[…]` class), each compiled with
 * the same flags so it matches exactly as it would inside the whole. Null when the whole would not compile.
 */
function globPieces(glob) {
  const pieces = []
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '.' && glob[i + 1] === '*') {
      if (pieces.at(-1) !== 'star') pieces.push('star')
      i++
      continue
    }
    if (c === '^') {
      pieces.push('start')
      continue
    }
    let source = c
    if (c === '\\') {
      source = glob.slice(i, i + 2)
      i++
    } else if (c === '[') {
      // A class runs to the first `]` not escaped, as a regular expression reads it (`[]` holds nothing, `[^]` anything).
      let j = i + 1
      if (glob[j] === '^') j++
      while (j < glob.length && glob[j] !== ']') j += glob[j] === '\\' ? 2 : 1
      if (j >= glob.length) return null
      source = glob.slice(i, j + 1)
      i = j
    }
    try {
      pieces.push(new RegExp(`^(?:${source})$`, 'i'))
    } catch {
      return null
    }
  }
  return pieces
}

/** Whether the pieces match `text` whole: one pass over them, each against every place in the text. */
function matchesPieces(pieces, text) {
  let at = new Array(text.length + 1).fill(false)
  at[0] = true
  for (const p of pieces) {
    const next = new Array(text.length + 1).fill(false)
    for (let j = 0; j <= text.length; j++) {
      if (!at[j]) continue
      if (p === 'star') {
        for (let k = j; k <= text.length; k++) next[k] = true
        break
      }
      if (p === 'start') {
        if (j === 0) next[0] = true
      } else if (j < text.length && p.test(text[j])) next[j + 1] = true
    }
    at = next
  }
  return at[text.length]
}

/** Whether an `xargs` or `parallel` comes before the word at `i` in its simple command: what it runs takes input words. */
function runByFeeder(words, i) {
  return words.slice(0, i).some((w) => /^(?:xargs|parallel)$/.test(w.replace(/^.*\//, '')))
}

/** The names a command's words assign `security` to, which then stand for it (`S=security; $S dump-keychain`). */
function keychainNames(command) {
  if (typeof command !== 'string') return new Set()
  return new Set(commandWords(command).filter((w) => /^[A-Za-z_][A-Za-z0-9_]*=(?:.*\/)?security$/.test(w)).map((w) => w.slice(0, w.indexOf('='))))
}

/**
 * Whether, among the words of one simple command, a `security` (or a name standing for it) runs as refused. `globs`: a
 * word may be a pattern naming it (false where quoting was lost, so a quoted `'*'` is not taken for one).
 */
function keychainSecretInWords(words, names = new Set(), globs = true) {
  return words.some((w, i) => (namesSecurity(w, globs || i === 0) || names.has(w)) && commandAt(words, i) &&
    securityPrintsSecret(words.slice(i + 1), runByFeeder(words, i)))
}

/**
 * Whether the word at `i` of a simple command's words is the command it runs: only wrappers, keywords, assignments,
 * options and their values stand before it, or it follows `find`'s `-exec`, `-execdir`, `-ok` or `-okdir`.
 */
function commandAt(words, i) {
  if (i > 0 && /^-(?:exec|execdir|ok|okdir)$/.test(words[i - 1])) return true
  // A function's body or a group starts a command: read from there.
  let from = 0
  for (let p = 0; p < i; p++) {
    // A function's body or a group, or a case label (`*)`).
    if (words[p] === '{' || words[p] === '(' || /\(\)\{?$/.test(words[p]) || words[p].endsWith('{') || /\)$/.test(words[p])) from = p + 1
  }
  let value = false
  for (let p = from; p < i; p++) {
    const w = words[p]
    const name = w.replace(/^.*\//, '')
    const prefix = COMMAND_PREFIXES.has(name) || RUNS_ITS_WORDS.test(name) || /^(?:xargs|parallel)$/.test(name)
    if (prefix || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || /^\d+(?:\.\d+)?$/.test(w) || w === '/dev/null' || w === '{' || w === '(') value = false
    else if (w.startsWith('-')) value = true
    else if (value) value = false
    else return false
  }
  return true
}

/**
 * Whether the text runs `security` with, after its own options, a subcommand the shell builds (`$X`, `"$1"`, `$(…)`, a
 * backtick): looked for at each place the name stands, so a long text is read once.
 */
function buildsSubcommand(text) {
  const lower = text.toLowerCase()
  const after = /['"]?\s+(?:-[hilqvp]+\s+)*["']?[$`]/y
  for (let at = lower.indexOf('security'); at >= 0; at = lower.indexOf('security', at + 1)) {
    if (at > 0 && !/[\s(`'"{/]/.test(text[at - 1])) continue
    after.lastIndex = at + 'security'.length
    if (!after.test(text)) continue
    let start = at
    while (start > 0 && !/[\s'"(`{]/.test(text[start - 1])) start--
    if (atCommandPosition(text, start)) return true
  }
  return false
}

/** Words that may stand before a command and leave it the command: wrappers and the shell's own keywords. */
const COMMAND_PREFIXES = new Set(['env', 'command', 'exec', 'builtin', 'nohup', 'nice', 'time', 'timeout', 'stdbuf', 'sudo', 'doas',
  'xcrun', 'caffeinate', 'arch', 'script', 'watch', 'coproc', 'then', 'do', 'else', 'if', 'while', 'until', '!'])
/** The shell's built-in that runs its words as a command, spelled as a pattern so the shipped build's text check, which
 * refuses that word in its output, does not take this list for a use of it. */
const RUNS_ITS_WORDS = /^ev[a]l$/

/** Whether the word starting at `start` is where a command stands: a script's start, or after only prefixes. */
function atCommandPosition(text, start) {
  const before = text.slice(0, start)
  if (/(?:^|\s)-c\s+['"]$/.test(before)) return true
  // A command starts after an operator, a parenthesis, a case label's `)`, a brace or a backtick.
  const cut = Math.max(...['(', ')', '{', '`', ';', '&', '|', '\n'].map((c) => before.lastIndexOf(c)))
  return before.slice(cut + 1).trim().split(/\s+/).filter(Boolean).every((w) =>
    COMMAND_PREFIXES.has(w.replace(/^.*\//, '')) || RUNS_ITS_WORDS.test(w.replace(/^.*\//, '')) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w.startsWith('-') || /^\d+(?:\.\d+)?$/.test(w) || w === '/dev/null')
}

/** The text with each `{a,b}` written out as `a b`, as the shell expands it. */
function braced(text) {
  return text.replace(/\{([^{}\s]*,[^{}\s]*)\}/g, (_m, inner) => inner.split(',').join(' '))
}

/**
 * Whether a shell command names a secret file or guarded configuration in any of its words, as written and with the
 * homes' variables (`vars`, from `guardedHomes`) written as their values; or prints a secret from the macOS keychain.
 */
function commandNamesGuarded(command, codexHome, claudeConfig, vars) {
  if (commandRunsKeychainSecret(command, vars)) return true
  const readings = [command, ...(typeof command === 'string' ? expansions(command, vars) : [])].map(commandWords)
  return readings.flat().some((w) => namesSecret(w) || namesGuardedConfig(w, codexHome, claudeConfig))
}

/**
 * Whether a shell command runs macOS's `security` as `securityPrintsSecret` refuses, read from its words as
 * `commandNamesGuarded` reads them: under any path or wrapper, inside a script, behind `xargs` or `parallel`. The full
 * guards hold the same rule.
 */
function commandRunsKeychainSecret(command, vars, names) {
  if (typeof command !== 'string') return false
  const known = names ?? keychainNames(command)
  // Each simple command and each splitting on its own: a word's neighbours are its own reading's.
  return [command, ...expansions(command, vars)].flatMap((t) => [t, braced(t)]).some((text) => buildsSubcommand(text) ||
    // A simple command ends at an operator, a parenthesis or a backtick; a substitution or a `-c` script starts one.
    text.split(/[;&|\n()`]+|\$\(|\s-[A-Za-z]*c\s+['"]/).some((part) =>
      [splitWords(part), splitWords(part.replace(/["'\\]/g, ''))].some((words) => keychainSecretInWords(words, known))))
}

const PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to):(.*)$/

/** The paths a Codex patch's headers name (all four kinds), or null when it names none. */
function patchPaths(text) {
  if (typeof text !== 'string') return null
  const paths = []
  for (const raw of text.split('\n')) {
    const m = PATCH_HEADER.exec(raw.replace(/\r$/, '').replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''))
    if (m) paths.push(m[2].replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''))
  }
  return paths.length ? paths : null
}

/** Whether a patch touches a secret file or guarded configuration; a patch that names no file does. */
function patchTouchesGuarded(text, codexHome, claudeConfig) {
  const paths = patchPaths(text)
  if (!paths) return true
  return paths.some((p) => !p || namesSecret(p) || namesGuardedConfig(p, codexHome, claudeConfig))
}

return { SECRET_SUFFIXES, SECRET_PATHS, SECRET_EXCEPTIONS, GUARDED_CONFIG, GUARDED_DIRS, withoutTrailingSlashes, namesSecret, guardedHomes, namesGuardedConfig, commandWords, securityPrintsSecret, keychainNames, keychainSecretInWords, commandNamesGuarded, commandRunsKeychainSecret, patchPaths, patchTouchesGuarded }
})()

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
const ASK_TOOLS: readonly string[] = ["dethereal_login","dethereal_logout","dethereal_model_state_waive","dethereal_model_state_settle","dethereal_model_state_prune","dethereal_import_model","dethereal_export_model","dethereal_update_model","dethereal_create_threat_model","dethereal_update_attributes","dethereal_generate_attribute_stubs","dethereal_manage_controls","dethereal_manage_countermeasures","dethereal_manage_analyses"]
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
