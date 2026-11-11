/**
 * Secret files, by name: the one list the workflow's secret-file rule names (`workflow/shared/
 * secret-files.md`), shared by the read guard, the OpenCode target's read rules and the acceptance
 * scorer. A secret file is never opened, printed, copied or searched; it is reported by name only.
 *
 * Names are matched in any letter case. A suffix entry is matched against the file's own name; a path
 * entry against the end of the path (at the project root or nested), its `*` within one segment. The
 * exceptions win. Files that are secret by their content (a `kind: Secret` manifest) are recognised by
 * `isSecretManifestText`; files a compose or kustomize file names as secret sources are known only by
 * reading that file, so they stay with the workflow's own rule.
 *
 * Only `node:` builtins and that import-free matcher: the read guard keeps working whatever else is broken.
 */

// The lists live in the import-free fallback matcher, which a hook runner carries as a copy: one source.
import { SECRET_EXCEPTIONS, SECRET_PATHS, SECRET_SUFFIXES, globMatches, pathGlobMatches, withoutTrailingSlashes } from './secret-fallback.mjs'
export { SECRET_EXCEPTIONS, SECRET_PATHS, SECRET_SUFFIXES }

export type SecretClass =
  | 'env'
  | 'terraform'
  | 'key-or-certificate'
  | 'ssh-key'
  | 'cloud-credentials'
  | 'package-credentials'
  | 'kubeconfig'
  | 'database-credentials'
  | 'secret-values'
  /** A path that cannot be placed (empty, absolute, climbing): treated as secret. */
  | 'unclassifiable'

const CLASS_OF: Readonly<Record<string, SecretClass>> = {
  '*.env': 'env', '*.envrc': 'env', '.env.*': 'env',
  '*.tfstate': 'terraform', '*.tfstate.*': 'terraform', '*.tfvars': 'terraform', '*.tfvars.json': 'terraform',
  'credentials.tfrc.json': 'terraform', '.terraformrc': 'terraform',
  '*.pem': 'key-or-certificate', '*.key': 'key-or-certificate', '*.p8': 'key-or-certificate', '*.p12': 'key-or-certificate',
  '*.pfx': 'key-or-certificate', '*.jks': 'key-or-certificate', '*.keystore': 'key-or-certificate',
  'id_rsa*': 'ssh-key', 'id_dsa*': 'ssh-key', 'id_ecdsa*': 'ssh-key', 'id_ed25519*': 'ssh-key',
  '.aws/credentials': 'cloud-credentials', '.docker/config.json': 'cloud-credentials', 'credentials.json': 'cloud-credentials',
  '.credentials.json': 'cloud-credentials', '*application_default_credentials.json': 'cloud-credentials',
  '*service-account*.json': 'cloud-credentials', '*-sa-key.json': 'cloud-credentials', '.vault-token': 'cloud-credentials',
  '*.npmrc': 'package-credentials', '*.pypirc': 'package-credentials', '*.netrc': 'package-credentials',
  '*.git-credentials': 'package-credentials',
  '*.kubeconfig': 'kubeconfig', 'kubeconfig': 'kubeconfig', '.kube/config': 'kubeconfig',
  'kubeconfig*.yaml': 'kubeconfig', 'kubeconfig*.yml': 'kubeconfig',
  '.pgpass': 'database-credentials', '.my.cnf': 'database-credentials', '.htpasswd': 'database-credentials',
  'secrets*.yaml': 'secret-values', 'values*secret*.yaml': 'secret-values', 'secrets*.yml': 'secret-values',
  'values*secret*.yml': 'secret-values', 'secret.yaml': 'secret-values', 'secret.yml': 'secret-values',
  '*.dec': 'secret-values',
}

/** Whether the text holds a control character (a newline included). */
const hasControl = (t: string) => [...t].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)

/**
 * The class of a secret file, from its project-relative path ('/' separators), or null when the name
 * is not a secret file's. An empty, absolute or climbing path is `unclassifiable`.
 */
export function secretPathClass(relPath: string): SecretClass | null {
  if (typeof relPath !== 'string') return 'unclassifiable'
  const rel = withoutTrailingSlashes(relPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '')).toLowerCase()
  if (!rel || rel.startsWith('/') || /^[a-z]:/.test(rel) || rel.split('/').includes('..') || hasControl(rel)) return 'unclassifiable'
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  // The fallback's glob matcher: time linear in the path, where a glob read as a regular expression backtracks.
  if (SECRET_EXCEPTIONS.some((g) => globMatches(g, base))) return null
  for (const g of SECRET_SUFFIXES) if (globMatches(g, base)) return CLASS_OF[g] ?? 'secret-values'
  for (const g of SECRET_PATHS) if (pathGlobMatches(g, rel)) return CLASS_OF[g] ?? 'secret-values'
  return null
}

export function isSecretPath(relPath: string): boolean {
  return secretPathClass(relPath) !== null
}

const SPACE = /\s/
const LINE_END = new Set(['\n', '\r', '\u2028', '\u2029'])

/**
 * Whether a line of text is a `kind: Secret` line: the workflow's Secret-manifest search (YAML and JSON, any letter
 * case), `^\s*[-{]?\s*"?kind"?\s*:\s*.?secret.?\s*,?\s*(#.*)?$` as a regular expression reads it, but read in one
 * pass. That expression backtracks over a long run of blanks; the line comes from a file in the workspace.
 */
export function isSecretManifestLine(line: string): boolean {
  const s = line.replace(/\r$/, '')
  const space = (from: number) => {
    while (from < s.length && SPACE.test(s[from]!)) from++
    return from
  }
  // An ASCII word in any letter case, as the expression's `i` flag reads it.
  const word = (at: number, w: string) => [...w].every((c, k) => s[at + k] === c || s[at + k] === c.toUpperCase())
  // `\s*,?\s*(#.*)?$` from `from`: `.` in the comment takes no line end.
  const rest = (from: number) => {
    let r = space(from)
    if (s[r] === ',') r = space(r + 1)
    if (s[r] !== '#') return r === s.length
    for (let k = r; k < s.length; k++) if (LINE_END.has(s[k]!)) return false
    return true
  }
  // `.?` and the rest after `secret`, the optional character not taken or taken. A line end `.` cannot take is a blank,
  // which the rest skips anyway, so taking any character here reads the same.
  const tail = (at: number) => rest(at) || (at < s.length && rest(at + 1))
  let i = space(0)
  if (s[i] === '-' || s[i] === '{') i = space(i + 1)
  if (s[i] === '"') i++
  if (!word(i, 'kind')) return false
  i += 4
  if (s[i] === '"') i++
  i = space(i)
  if (s[i] !== ':') return false
  i = space(i + 1)
  // `.?secret`: the word where the blanks end, or one character later. That character is never a line end, since a
  // line end is a blank and the blanks were all taken, so `.` would take it.
  return (word(i, 'secret') && tail(i + 6)) || (word(i + 1, 'secret') && tail(i + 7))
}

/** Whether a manifest's text holds a `kind: Secret` line (any document of a multi-document file). */
export function isSecretManifestText(text: string): boolean {
  return text.split('\n').some(isSecretManifestLine)
}

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
/** The Secret-manifest search's pattern, exactly as the workflow's rule spells it. */
export const SECRET_MANIFEST_PATTERN = '^[[:space:]]*[-{]?[[:space:]]*"?kind"?[[:space:]]*:[[:space:]]*.?Secret.?[[:space:]]*,?[[:space:]]*(#.*)?$'
/** A single-quoted path the workflow may name: no quote, no control character, never empty. */
const QUOTED = "'([^'\\x00-\\x1f\\x7f]+)'"
const MANIFEST_SEARCH = new RegExp(`^${escapeRe(`grep -rliE '${SECRET_MANIFEST_PATTERN}' -- `)}${QUOTED}$`)
const GIT_TRACKED = new RegExp(`^${escapeRe("git ls-files --format='%(objectmode) %(path)' -- ")}${QUOTED}$`)
/** A Kubernetes object name: lowercase letters, digits, '-' and '.', starting and ending alphanumeric. */
const K8S_NAME = '[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?'
const NAME_SEARCH = new RegExp(`^grep -lwF -d skip -- 'name: ${K8S_NAME}'((?: ${QUOTED})+)$`)

export type SanctionedSecretCommand = 'secret-manifest-search' | 'git-tracked' | 'secret-name-search'

/** One shell word: as written (quotes kept), as the shell reads it, and whether it was quoted. */
export interface ShellToken {
  readonly raw: string
  readonly value: string
  readonly quoted: boolean
}

/**
 * The words of one simple command, quotes kept and read; null when reading it needs a shell (a `$`,
 * a backquote or a backslash outside single quotes, an unbalanced quote).
 */
export function shellTokens(segment: string): ShellToken[] | null {
  const out: ShellToken[] = []
  let raw = ''
  let value = ''
  let quoted = false
  const push = () => {
    if (raw) out.push({ raw, value, quoted })
    raw = ''
    value = ''
    quoted = false
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === "'" || c === '"') {
      const end = segment.indexOf(c, i + 1)
      if (end < 0) return null
      const inner = segment.slice(i + 1, end)
      if (c === '"' && /[$`\\]/.test(inner)) return null
      raw += segment.slice(i, end + 1)
      value += inner
      quoted = true
      i = end
    } else if (c === ' ' || c === '\t') push()
    else if (/[$`\\]/.test(c) || hasControl(c)) return null
    else {
      raw += c
      value += c
    }
  }
  push()
  return out
}

/** A path written bare that the shell keeps as it is: letters, digits, `.`, `_`, `/`, `-`; no leading `-`, no `..`. */
export function isSafeBarePath(v: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(v) && !v.startsWith('-') && !v.split('/').includes('..')
}

const GIT_TRACKED_HEAD = "git ls-files --format='%(objectmode) %(path)' --"

/** One simple command against the three forms: paths after `--` single-quoted, or bare when safe. */
function sanctionedSimple(segment: string): { kind: SanctionedSecretCommand; paths: string[] } | null {
  const toks = shellTokens(segment)
  if (!toks) return null
  const dd = toks.findIndex((t) => t.raw === '--')
  if (dd < 0) return null
  const head = toks.slice(0, dd + 1).map((t) => t.raw).join(' ')
  const after = toks.slice(dd + 1)
  if (!after.length || after.some((t) => (t.quoted ? !/^'[^']+'$/.test(t.raw) : !isSafeBarePath(t.value)))) return null
  const quote = (t: ShellToken) => (t.quoted ? t.raw : `'${t.value}'`)
  const exact = `${head} ${after.map(quote).join(' ')}`
  if (MANIFEST_SEARCH.test(exact) && after.length === 1) return { kind: 'secret-manifest-search', paths: [after[0]!.value] }
  if (head === GIT_TRACKED_HEAD && after.every((t) => GIT_TRACKED.test(`${head} ${quote(t)}`))) return { kind: 'git-tracked', paths: after.map((t) => t.value) }
  // One name per search: a second `name: …` operand would be taken for a file name.
  if (NAME_SEARCH.test(exact) && after[0]!.quoted && after[0]!.value.startsWith('name: ') && !after.slice(1).some((t) => t.value.startsWith('name:'))) return { kind: 'secret-name-search', paths: after.slice(1).map((t) => t.value) }
  return null
}

/**
 * The workflow's name-only command <command> is, or null. Written as the rule spells it, or as agents
 * write it: a path after `--` bare when the shell keeps it as it is, spaces repeated, `git ls-files`
 * with several paths (it prints names and modes only), lines continued with a backslash, and plain
 * `echo`/`printf` steps before it (`echo "--- x" && <search>`). Everything else as the rule spells it:
 * the flags, the pattern, the format, one `name: <secret-name>` per search, its name a Kubernetes name.
 */
function sanctioned(command: string): { kind: SanctionedSecretCommand; paths: string[] } | null {
  if (typeof command !== 'string') return null
  const text = command.replace(/\\\r?\n/g, '').trim()
  if (/[\r\n]/.test(text)) return null
  // Split on the operators, then trim: the same steps, without an expression that rescans a run of blanks.
  const steps = text.split(/&&|;/).map((s) => s.trim())
  const last = steps.pop() ?? ''
  for (const step of steps) {
    const toks = shellTokens(step)
    if (!toks || !toks.length || (toks[0]!.raw !== 'echo' && toks[0]!.raw !== 'printf')) return null
  }
  return sanctionedSimple(last)
}

/** Which of the workflow's three name-only commands <command> is (see `sanctioned` for the forms), or null. */
export function sanctionedSecretCommand(command: string): SanctionedSecretCommand | null {
  return sanctioned(command)?.kind ?? null
}

/** The paths a sanctioned command names (its operands after `--`, the name aside). */
export function sanctionedCommandPaths(command: string): string[] {
  return sanctioned(command)?.paths ?? []
}

// ── secret sources a configuration file names ──────────────────────────────────────────────────

export type SecretSourceKind = 'kustomize' | 'compose'

/** Whether a file, by its own name, is a kustomization or a compose file (which name secret sources). */
export function secretSourceKind(fileName: string): SecretSourceKind | null {
  const n = fileName.toLowerCase()
  if (n === 'kustomization.yaml' || n === 'kustomization.yml' || n === 'kustomization') return 'kustomize'
  if (/^(docker-)?compose(\.[a-z0-9_.-]+)?\.ya?ml$/.test(n)) return 'compose'
  return null
}

interface YamlLine {
  readonly indent: number
  readonly text: string
}

/** A line's text without a trailing comment (a `#` after a space, outside quotes). */
function withoutComment(raw: string): string {
  let quote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) return raw.slice(0, i)
  }
  return raw
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2').trim()

/** The values of a key whose own line is `lines[i]` (indent `keyIndent`): inline scalar or flow list, or a block list. */
function keyValues(lines: readonly YamlLine[], i: number, keyIndent: number, inline: string): string[] {
  const v = inline.trim()
  if (v.startsWith('[')) {
    const m = /^\[(.*)\]$/.exec(v)
    return m ? m[1]!.split(',').map(unquote).filter(Boolean) : []
  }
  if (v) return [unquote(v)]
  const out: string[] = []
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k]!
    if (l.indent < keyIndent || (l.indent === keyIndent && !l.text.startsWith('-'))) break
    if (!l.text.startsWith('-')) continue
    const item = l.text.replace(/^-\s*/, '')
    // The long form `- path: x` (compose env_file with `required:`); other mapping keys are not paths.
    const long = /^path:\s*(.+)$/.exec(item)
    if (long) out.push(unquote(long[1]!))
    else if (item && !/^[A-Za-z_][\w-]*:(\s|$)/.test(item)) out.push(unquote(item))
    else if (!item) {
      const next = lines[k + 1]
      const p = next && next.indent > l.indent ? /^path:\s*(.+)$/.exec(next.text) : null
      if (p) out.push(unquote(p[1]!))
    }
  }
  return out
}

/**
 * The secret sources a kustomization or compose file names, as written (relative to the file's own
 * folder): kustomize `secretGenerator[].envs`, `.files` (a `key=path` entry's path) and `.env`; compose
 * `env_file` (a string, a list, or `- path:` entries) and the top-level `secrets: <name>: file:`. Read
 * by lines, with no YAML parser: a form it does not recognise names nothing.
 */
export function secretSourceReferences(kind: SecretSourceKind, text: string): string[] {
  const lines: YamlLine[] = text
    .split(/\r?\n/)
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: withoutComment(raw).trim() }))
    .filter((l) => l.text && !l.text.startsWith('#'))
  const refs: string[] = []
  const blockEnd = (start: number, indent: number) => {
    let k = start + 1
    while (k < lines.length && (lines[k]!.indent > indent || (lines[k]!.indent === indent && lines[k]!.text.startsWith('-')))) k++
    return k
  }
  if (kind === 'kustomize') {
    lines.forEach((l, i) => {
      if (!/^secretGenerator:\s*$/.test(l.text)) return
      const end = blockEnd(i, l.indent)
      for (let k = i + 1; k < end; k++) {
        const m = /^(-\s*)?(envs|files|env):\s*(.*)$/.exec(lines[k]!.text)
        if (!m) continue
        const keyIndent = lines[k]!.indent + (m[1] ? m[1].length : 0)
        for (const v of keyValues(lines, k, keyIndent, m[3]!)) refs.push(m[2] === 'files' && v.includes('=') ? v.slice(v.indexOf('=') + 1).trim() : v)
      }
    })
  } else {
    lines.forEach((l, i) => {
      const m = /^(-\s*)?env_file:\s*(.*)$/.exec(l.text)
      if (m) refs.push(...keyValues(lines, i, l.indent + (m[1] ? m[1].length : 0), m[2]!))
      if (l.indent === 0 && /^secrets:\s*$/.test(l.text)) {
        const end = blockEnd(i, 0)
        for (let k = i + 1; k < end; k++) {
          const f = /^file:\s*(.+)$/.exec(lines[k]!.text)
          if (f) refs.push(unquote(f[1]!))
        }
      }
    })
  }
  return [...new Set(refs.filter(Boolean))]
}
