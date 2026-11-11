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

/**
 * Whether a glob of one path segment (`*` any run, `?` one character, the rest literal) matches a name with no '/'. On a
 * mismatch only the last `*` takes one more character, so the time is the name's length times the glob's, never more.
 */
export function globMatches(glob, name) {
  let g = 0
  let n = 0
  // The last `*` met, and where in the name it took its first character from.
  let star = -1
  let resume = 0
  while (n < name.length) {
    if (glob[g] === '*') {
      star = g++
      resume = n
    } else if (glob[g] === '?' || glob[g] === name[n]) {
      g++
      n++
    } else if (star >= 0) {
      g = star + 1
      n = ++resume
    } else return false
  }
  while (glob[g] === '*') g++
  return g === glob.length
}

/** Whether a '/'-joined path ends with the segments a path glob names, each matched whole by `globMatches`. */
export function pathGlobMatches(glob, rel) {
  const want = glob.split('/')
  const have = rel.split('/')
  return have.length >= want.length && want.every((g, k) => globMatches(g, have[have.length - want.length + k]))
}
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
  if (SECRET_EXCEPTIONS.some((g) => globMatches(g, base))) return false
  return SECRET_SUFFIXES.some((g) => globMatches(g, base)) || SECRET_PATHS.some((g) => pathGlobMatches(g, rel))
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
  const slashed = p.replace(/\\/g, '/')
  if (slashed.startsWith('/') && aliasedPath(collapsed(slashed))) return true
  // As written, and with empty, `.` and `..` segments collapsed: a write lands where the collapsed path points.
  const written = `/${normal(p)}`
  return [written, collapsed(written)].some((rel) =>
    GUARDED_CONFIG.some((end) => rel.endsWith(`/${end}`)) ||
    GUARDED_DIRS.some((d) => rel.includes(`/${d}/`) || rel.endsWith(`/${d}`)) ||
    underHome(rel, codexHome, CODEX_HOME_GUARDED) || underHome(rel, claudeConfig, CLAUDE_CONFIG_GUARDED))
}

/** Folders through which the system reaches a file by another name than the path's (see `aliasedPath`). */
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
export function aliasedPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return false
  const segs = p.slice(1, 400).split('/').slice(0, 5).map((s) => s.toLowerCase())
  if (ALIAS_ROOTS.has(segs[0])) return true
  if (segs[0] === 'system' && segs[1] === 'volumes' && segs[2] === 'data') return true
  if (segs[0] === 'dev' && segs[1] === 'fd') return segs.length !== 3 || !/^[012]$/.test(segs[2])
  if (segs[0] !== 'proc') return false
  if (segs[1] === 'self' || segs[1] === 'thread-self') return true
  return /^\d+$/.test(segs[1] ?? '') && (PROC_LINKS.has(segs[2]) || (segs[2] === 'task' && PROC_LINKS.has(segs[4])))
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
  let later
  return printsSecretFrom(args, 0, fed, () => (later ??= laterAsksSecret(args)))
}

/** For each place in the words, whether a word from there on asks for an item's secret (`-w`, `-g`): read from the end once. */
function laterAsksSecret(args) {
  const out = new Array(args.length + 1).fill(false)
  for (let k = args.length - 1; k >= 0; k--) out[k] = out[k + 1] || (typeof args[k] === 'string' && /^-[A-Za-z]*[wg]/.test(args[k]))
  return out
}

/** `securityPrintsSecret` on the words from `start` on, `later` giving `laterAsksSecret` of them. */
function printsSecretFrom(args, start, fed, later) {
  let i = start
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
  if (could.every((s) => SECURITY_QUIET.has(s) || s === 'find-generic-password' || s === 'find-internet-password')) return later()[i + 1]
  return true
}

/** Whether a word names macOS's `security`: its file name, or a glob that matches it (`securit?`). */
export function namesSecurity(word, globs = true) {
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
  // One pass: where each word stands, and what the words after it ask, are each read once for all of them.
  let places
  let later
  // An `xargs` or `parallel` before the word: what it runs takes input words.
  let fed = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if ((namesSecurity(w, globs || i === 0) || names.has(w)) && ((i > 0 && FIND_RUNS.test(words[i - 1])) || (places ??= commandPlaces(words))[i]) &&
      printsSecretFrom(words, i + 1, fed, () => (later ??= laterAsksSecret(words)))) return true
    if (typeof w === 'string' && /^(?:xargs|parallel)$/.test(w.replace(/^.*\//, ''))) fed = true
  }
  return false
}

/** `find`'s options that run the word after them as a command. */
const FIND_RUNS = /^-(?:exec|execdir|ok|okdir)$/

/** Whether a word starts a command after it: a function's body or a group (`{`, `(`, `f()`, `f(){`), or a case label (`*)`). */
const opensCommand = (w) => typeof w === 'string' && (w === '{' || w === '(' || /\(\)\{?$/.test(w) || w.endsWith('{') || /\)$/.test(w))

/**
 * For each word of a simple command, whether it is the command the words run: only wrappers, keywords, assignments,
 * options and their values stand between it and the last place a command starts (the start, a function's body, a group,
 * a case label). Read in one pass, for every word at once.
 */
function commandPlaces(words) {
  const places = new Array(words.length)
  let open = true
  let value = false
  for (let p = 0; p < words.length; p++) {
    places[p] = open
    const w = words[p]
    if (opensCommand(w)) {
      open = true
      value = false
      continue
    }
    if (!open || typeof w !== 'string') continue
    const name = w.replace(/^.*\//, '')
    const prefix = COMMAND_PREFIXES.has(name) || RUNS_ITS_WORDS.test(name) || /^(?:xargs|parallel)$/.test(name)
    if (prefix || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || /^\d+(?:\.\d+)?$/.test(w) || w === '/dev/null' || w === '{' || w === '(') value = false
    else if (w.startsWith('-')) value = true
    else if (value) value = false
    else open = false
  }
  return places
}

/**
 * Whether the text runs `security` with, after its own options, a subcommand the shell builds (`$X`, `"$1"`, `$(…)`, a
 * backtick): looked for at each place the name stands, so a long text is read once.
 */
export function buildsSubcommand(text) {
  // ASCII letters only: a wider lower case (`İ`) can change the length, and the places would no longer match the text's.
  const lower = text.replace(/[A-Z]+/g, (s) => s.toLowerCase())
  const after = /['"]?\s+(?:-[hilqvp]+\s+)*["']?[$`]/y
  // Where each word starts, and what stands before each place: read once for the whole text, on the first `security`.
  let places
  for (let at = lower.indexOf('security'); at >= 0; at = lower.indexOf('security', at + 1)) {
    if (at > 0 && !/[\s(`'"{/;&|)]/.test(text[at - 1])) continue
    after.lastIndex = at + 'security'.length
    if (!after.test(text)) continue
    places ??= textPlaces(text)
    if (places.atCommand(places.wordStart[at])) return true
  }
  return false
}

/** Words that may stand before a command and leave it the command: wrappers and the shell's own keywords. */
export const COMMAND_PREFIXES = new Set(['env', 'command', 'exec', 'builtin', 'nohup', 'nice', 'time', 'timeout', 'stdbuf', 'sudo', 'doas',
  'xcrun', 'caffeinate', 'arch', 'script', 'watch', 'coproc', 'then', 'do', 'else', 'if', 'while', 'until', '!'])
/** The shell's built-in that runs its words as a command, spelled as a pattern so the shipped build's text check, which
 * refuses that word in its output, does not take this list for a use of it. */
const RUNS_ITS_WORDS = /^ev[a]l$/

/** Characters after which a command starts: an operator, a parenthesis, a case label's `)`, a brace or a backtick. */
const COMMAND_STARTS = new Set(['(', ')', '{', '`', ';', '&', '|', '\n'])
const BLANK_CHAR = /\s/

/**
 * What `buildsSubcommand` asks of a text at each place, read in one pass: where the word holding a place starts (after
 * a blank, a quote, `(`, a backtick or `{`), and whether a command stands there: a script's start (`-c '`), or after only
 * wrappers, keywords, assignments, options and numbers since the last place a command starts.
 */
function textPlaces(text) {
  const n = text.length
  const wordStart = new Array(n + 1)
  wordStart[0] = 0
  // The last place a command starts before each place.
  const lastStart = new Array(n + 1)
  lastStart[0] = -1
  for (let k = 1; k <= n; k++) {
    const c = text[k - 1]
    wordStart[k] = /[\s'"(`{]/.test(c) ? k : wordStart[k - 1]
    lastStart[k] = COMMAND_STARTS.has(c) ? k - 1 : lastStart[k - 1]
  }
  // The pieces between blanks and command starts, and how many of the first m stand in front of a command.
  const pieceStarts = []
  const pieceEnds = []
  const standBefore = [0]
  for (let k = 0; k < n; ) {
    if (BLANK_CHAR.test(text[k]) || COMMAND_STARTS.has(text[k])) {
      k++
      continue
    }
    let e = k
    while (e < n && !BLANK_CHAR.test(text[e]) && !COMMAND_STARTS.has(text[e])) e++
    pieceStarts.push(k)
    pieceEnds.push(e)
    standBefore.push(standBefore.at(-1) + (standsBefore(text.slice(k, e)) ? 1 : 0))
    k = e
  }
  // The index of the first piece starting at or after `k`.
  const firstPieceFrom = (k) => {
    let lo = 0
    let hi = pieceStarts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pieceStarts[mid] < k) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const atCommand = (start) => {
    // A script's start: `-c` and blanks before a quote, at the text's start or after a blank.
    if (start > 0 && (text[start - 1] === "'" || text[start - 1] === '"')) {
      let j = start - 2
      while (j >= 0 && BLANK_CHAR.test(text[j])) j--
      if (j < start - 2 && text[j] === 'c' && text[j - 1] === '-' && (j - 1 === 0 || BLANK_CHAR.test(text[j - 2]))) return true
    }
    const from = firstPieceFrom(lastStart[start] + 1)
    // A word cut short at `start` (a quote before the name) stands in front only as an option or an assignment.
    const last = start > 0 && !BLANK_CHAR.test(text[start - 1]) && !COMMAND_STARTS.has(text[start - 1]) ? firstPieceFrom(start) - 1 : -1
    const whole = last >= from ? last : firstPieceFrom(start)
    if (standBefore[whole] - standBefore[from] !== whole - from) return false
    return last < from || standsBefore(text.slice(pieceStarts[last], start), true)
  }
  return { wordStart, atCommand }
}

/**
 * Whether a word may stand in front of a command and leave it the command: a wrapper or keyword, an assignment, an
 * option, a number or `/dev/null`. `cut`: the word ends in a quote, where only an option or an assignment can.
 */
function standsBefore(w, cut = false) {
  if (w.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) return true
  if (cut) return false
  const name = w.replace(/^.*\//, '')
  return COMMAND_PREFIXES.has(name) || RUNS_ITS_WORDS.test(name) || /^\d+(?:\.\d+)?$/.test(w) || w === '/dev/null'
}

/** The text with each `{a,b}` written out as `a b`, as the shell expands it. */
function braced(text) {
  // The first comma ends the first run: no two ways to read one brace, so the time stays linear.
  return text.replace(/\{([^{}\s,]*,[^{}\s]*)\}/g, (_m, inner) => inner.split(',').join(' '))
}

/**
 * The longest shell command judged by name; a longer one counts as naming guarded files, unjudged. A bound on the time
 * one judgement takes, apart from the read-only agent's own limit in `shell-check.mjs`.
 */
export const COMMAND_MAX_LENGTH = 32 * 1024

/**
 * Whether a shell command names a secret file or guarded configuration in any of its words, as written and with the
 * homes' variables (`vars`, from `guardedHomes`) written as their values; or prints a secret from the macOS keychain.
 * A command longer than `COMMAND_MAX_LENGTH` does.
 */
export function commandNamesGuarded(command, codexHome, claudeConfig, vars) {
  if (typeof command === 'string' && command.length > COMMAND_MAX_LENGTH) return true
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

/** A blank at a patch line's end: JavaScript's `\s`, and U+0085, which Codex trims too. */
const BLANK = /[\s\u0085]/
/** The text without the blanks (`\s` and U+0085) it starts and ends with, read from each end once. */
function withoutBlankEnds(text) {
  let start = 0
  let end = text.length
  while (start < end && BLANK.test(text[start])) start++
  while (end > start && BLANK.test(text[end - 1])) end--
  return text.slice(start, end)
}

const PATCH_HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to):(.*)$/

/** The paths a Codex patch's headers name (all four kinds), or null when it names none. */
export function patchPaths(text) {
  if (typeof text !== 'string') return null
  const paths = []
  for (const raw of text.split('\n')) {
    const m = PATCH_HEADER.exec(withoutBlankEnds(raw.replace(/\r$/, '')))
    if (m) paths.push(withoutBlankEnds(m[2]))
  }
  return paths.length ? paths : null
}

/** Whether a patch touches a secret file or guarded configuration; a patch that names no file does. */
export function patchTouchesGuarded(text, codexHome, claudeConfig) {
  const paths = patchPaths(text)
  if (!paths) return true
  return paths.some((p) => !p || namesSecret(p) || namesGuardedConfig(p, codexHome, claudeConfig))
}
