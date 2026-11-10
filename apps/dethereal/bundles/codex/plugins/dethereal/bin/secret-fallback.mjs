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
import path from 'node:path'

/** Secret files named by their extension or a name part, matched against the file's own name. */
export const SECRET_SUFFIXES = [
  '*.env', '*.envrc', '*.tfstate', '*.tfstate.*', '*.tfvars', '*.tfvars.json',
  '*.pem', '*.key', '*.p8', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '*.npmrc', '*.pypirc', '*.netrc', '*.git-credentials', '*.kubeconfig',
  '*application_default_credentials.json', '*service-account*.json', '*-sa-key.json',
  '*.dec',
]

/** Secret files named by their path, at the project root or nested. */
export const SECRET_PATHS = [
  'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*',
  '.aws/credentials', '.docker/config.json', 'credentials.json', '.credentials.json', 'credentials.tfrc.json', '.terraformrc',
  '.pgpass', '.my.cnf', '.htpasswd', '.vault-token', 'secrets*.yaml', 'values*secret*.yaml',
  '.env.*', 'kubeconfig', '.kube/config', 'kubeconfig*.yaml', 'kubeconfig*.yml',
  'secrets*.yml', 'values*secret*.yml', 'secret.yaml', 'secret.yml',
]

/** Env files that hold names only: never secret, whatever else matches. */
export const SECRET_EXCEPTIONS = ['*.env.example', '*.env.template', '*.env.sample', '*.env.dist']

/**
 * Configuration the full guards protect, as path endings (any letter case): harness settings, Codex's
 * and OpenCode's sign-ins (which the secret guard keeps from every tool; OpenCode's under any data
 * folder), and plugin or definition directories, and Dethereal's own state directory.
 */
export const GUARDED_CONFIG = [
  '.codex/config.toml', '.codex/auth.json', 'opencode/auth.json', 'opencode/mcp-auth.json', '.claude/settings.json', '.claude/settings.local.json', '.claude.json',
  'opencode.json', 'opencode.jsonc',
]
/** Directories whose contents the config guard protects, matched as a path segment run. */
export const GUARDED_DIRS = ['.codex/plugins', '.codex/agents', '.claude/plugins', '.claude/skills', '.claude/commands', '.claude/agents',
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
export function withoutTrailingSlashes(text) {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 47) end--
  return text.slice(0, end)
}

/** Whether a path names a secret file. Climbing segments are dropped: the name still counts. */
export function namesSecret(p) {
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
export function guardedHomes(env, homeDir) {
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
export function namesGuardedConfig(p, codexHome, claudeConfig) {
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
export function commandWords(command) {
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
export function securityPrintsSecret(args, fed = false) {
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
export function keychainNames(command) {
  if (typeof command !== 'string') return new Set()
  return new Set(commandWords(command).filter((w) => /^[A-Za-z_][A-Za-z0-9_]*=(?:.*\/)?security$/.test(w)).map((w) => w.slice(0, w.indexOf('='))))
}

/**
 * Whether, among the words of one simple command, a `security` (or a name standing for it) runs as refused. `globs`: a
 * word may be a pattern naming it (false where quoting was lost, so a quoted `'*'` is not taken for one).
 */
export function keychainSecretInWords(words, names = new Set(), globs = true) {
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
export function commandNamesGuarded(command, codexHome, claudeConfig, vars) {
  if (commandRunsKeychainSecret(command, vars)) return true
  const readings = [command, ...(typeof command === 'string' ? expansions(command, vars) : [])].map(commandWords)
  return readings.flat().some((w) => namesSecret(w) || namesGuardedConfig(w, codexHome, claudeConfig))
}

/**
 * Whether a shell command runs macOS's `security` as `securityPrintsSecret` refuses, read from its words as
 * `commandNamesGuarded` reads them: under any path or wrapper, inside a script, behind `xargs` or `parallel`. The full
 * guards hold the same rule.
 */
export function commandRunsKeychainSecret(command, vars, names) {
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
export function patchPaths(text) {
  if (typeof text !== 'string') return null
  const paths = []
  for (const raw of text.split('\n')) {
    const m = PATCH_HEADER.exec(raw.replace(/\r$/, '').replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''))
    if (m) paths.push(m[2].replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''))
  }
  return paths.length ? paths : null
}

/** Whether a patch touches a secret file or guarded configuration; a patch that names no file does. */
export function patchTouchesGuarded(text, codexHome, claudeConfig) {
  const paths = patchPaths(text)
  if (!paths) return true
  return paths.some((p) => !p || namesSecret(p) || namesGuardedConfig(p, codexHome, claudeConfig))
}
