/**
 * Two checks on a shell command line, for Codex's Bash hook.
 *
 * `runsLaterInput`, for every caller: a command that runs input sent to it later — a shell reading
 * its script from input (`sh -s`, `bash /dev/stdin`, a shell or interpreter with no script), `source
 * /dev/stdin`, `read` with `eval` or a variable as the command, `xargs … sh -c` — is refused, since
 * Codex sends later input to a running command (`write_stdin`) with no hook to check it. Best effort:
 * a line this file cannot read is left to the secret guard.
 *
 * `notOnlyReading`, for a read-only Dethereal agent: only commands that read.
 *
 * Codex's sandbox setting for an agent may not cover its shell, so the hook runner judges a read-only
 * agent's command here before anything else. It is an allowlist: every simple command of the line —
 * those a `sh -c` script, an `eval`, a `$( )` or a backtick runs included — must be a reader from the
 * table below, with no option that makes it write or run something else. Anything this file cannot
 * read is refused: expansions in a command name, loops and branches, heredocs, redirects other than
 * to `/dev/null` or between descriptors, nesting past a depth, a line past a length. Best effort: a
 * repository's own git configuration can still run code under `git status` or `git diff`.
 * Only `node:` builtins; no state. The Codex plugin's hook runner ships a copy of this file (`bin/shell-check.mjs`).
 */

const MAX_LENGTH = 32 * 1024
const MAX_DEPTH = 6
const MAX_STEPS = 200_000

/**
 * In arithmetic, which is not judged as commands: any expansion but a plain parameter (`$x`, `$1`, `$#`), a backtick or
 * a process substitution. zsh can build and run a command from `${…}` flags there.
 */
const RUNS_INSIDE = /\$(?![A-Za-z0-9_@*#?$!-])|`|[<>]\(/

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'])
/** Interpreters that, given no script, read what they run from their input. */
const INTERPRETERS = /^(?:python\d*(?:\.\d+)*|node(?:js)?|ruby\d*(?:\.\d+)*|perl\d*(?:\.\d+)*|irb|php|lua|tclsh|script)$/
const ABOUT_ONLY = /^(?:-V|-v|--version|-h|--help)$/
const STDIN_PATHS = new Set(['-', '/dev/stdin', '/dev/fd/0', '/proc/self/fd/0'])
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function', 'coproc', '[[', ']]'])
// Assignments a reader may run under: locale and display only.
const SAFE_ASSIGNMENT = /^(?:LC_[A-Z]+|LANG|LANGUAGE|TZ|COLUMNS|LINES|TERM|NO_COLOR)=/

class Refused extends Error {}
/** A line the check cannot read; for `runsLaterInput`, the secret guard judges it. */
class Unreadable extends Refused {}
const refuse = (why) => {
  throw new Refused(why)
}
const unreadable = (why) => {
  throw new Unreadable(why)
}

const plain = (...names) => new Map(names.map((n) => [n, () => null]))
const withoutOptions = (bad) => (args) => {
  const hit = args.find((a) => bad.some((b) => (b.endsWith('=') ? a.startsWith(b) : a === b || (b.length === 2 && /^-[A-Za-z]+$/.test(a) && a.slice(1).includes(b[1])))))
  return hit ? `\`${hit}\` (it writes or runs something)` : null
}

const SPACE = /\s/
const LINE_END = new Set(['\n', '\r', '\u2028', '\u2029'])
const isDigit = (c) => c >= '0' && c <= '9'

/**
 * Whether a sed script only prints, deletes from the output, counts or quits: commands p d = q l n,
 * `{` and `}`, or s/…/…/ with g p i I or a number as flags; each after an optional address (a line
 * number, `$` or /…/), a second one after a comma (also +N or ~N) and `!`; separated by `;`, a
 * newline or nothing. One pass, no backtracking, so its time is linear in the script: it runs on
 * model input before the guard. The s delimiter may be any character but a backslash or a line end.
 */
export function sedScriptOnlyPrints(s) {
  let i = 0
  const space = () => {
    while (i < s.length && SPACE.test(s[i])) i++
  }
  const digits = () => {
    const from = i
    while (isDigit(s[i])) i++
    return i > from
  }
  // From a `[`, the index of the `]` that closes it as BSD sed reads a bracket expression (`[:…:]`, `[=…=]`, `[.….]`
  // inside), or -1 when none does.
  const bracketEnd = (from) => {
    let j = from + 1
    if (s[j] === '^') j++
    if (s[j] === ']') j++
    for (; j < s.length && s[j] !== ']'; j++) {
      const kind = s[j + 1]
      if (s[j] !== '[' || (kind !== '.' && kind !== ':' && kind !== '=')) continue
      j += 2
      const start = j
      while (j < s.length && !(j > start && s[j] === ']' && s[j - 1] === kind)) j++
      if (j >= s.length) return -1
    }
    return j < s.length ? j : -1
  }
  // Up to the closing delimiter, past characters a backslash escapes; a backslash can't escape a line end. BSD sed
  // reads past a delimiter inside a bracket expression, GNU sed does not: a bracket expression holding the delimiter,
  // a backslash or a line end is refused, so both read the same end.
  const delimited = (d) => {
    while (i < s.length) {
      if (s[i] === d) {
        i++
        return true
      }
      if (s[i] === '[') {
        const end = bracketEnd(i)
        if (end < 0) return false
        for (let k = i + 1; k <= end; k++) if (s[k] === d || s[k] === '\\' || LINE_END.has(s[k])) return false
        i = end + 1
        continue
      }
      if (s[i] === '\\') {
        if (i + 1 === s.length || LINE_END.has(s[i + 1])) return false
        i++
      }
      i++
    }
    return false
  }
  const address = () => {
    const c = s[i]
    if (c !== '$' && c !== '/') return digits()
    i++
    return c === '$' || delimited('/')
  }
  let addressed = false
  for (;;) {
    if (!addressed) {
      space()
      if (i === s.length) return true
      if (isDigit(s[i]) || s[i] === '$' || s[i] === '/') {
        if (!address()) return false
        addressed = true
      }
    }
    if (addressed) {
      space()
      if (s[i] === ',') {
        i++
        space()
        if (s[i] === '+' || s[i] === '~') {
          i++
          if (!digits()) return false
        } else if (!address()) return false
      }
      space()
      if (s[i] === '!') i++
      space()
      addressed = false
    }
    const c = s[i]
    if (c !== undefined && 'pdq=ln{}'.includes(c)) i++
    else if (c === 's') {
      const d = s[i + 1]
      // Not a backslash, and printable ASCII: sed compares bytes, so a wider character could end the command elsewhere.
      if (d === undefined || d === '\\' || d < ' ' || d > '~') return false
      i += 2
      if (!delimited(d) || !delimited(d)) return false
      const flags = i
      while (i < s.length && 'gpiI0123456789'.includes(s[i])) i++
      // Digits that end the flags, already read, may instead be the next command's address, as in `s/a/b/1,3p`: when
      // a comma or `!` follows, read on as after an address (an address's other forms start with `$` or `/`, no flag).
      if (i > flags && isDigit(s[i - 1])) {
        space()
        addressed = s[i] === ',' || s[i] === '!'
      }
    } else return false
    space()
    if (s[i] === ';') i++
  }
}

/** sed options that both GNU and BSD sed read and that change only how a script prints: alone, or in a group (`-nE`). */
const SED_FLAGS = new Set(['n', 'E', 'r', 'u'])

/**
 * Why a sed command line may write or run something, or null. An allowlist: every option before `--` must be one of
 * SED_FLAGS or `-e` (its script attached or the next word, alone or ending a group: `-e'1p'`, `-ne 1p`), wherever it
 * stands, as GNU sed reads options after operands too; a long option is refused. Every script is checked, however it is
 * given; with no `-e`, the first operand is the script.
 */
function sedArgs(args) {
  const scripts = []
  const operands = []
  let options = true
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!options || a === '-' || !a.startsWith('-')) {
      operands.push(a)
      continue
    }
    // BSD sed reads options only before the first operand: one after it is a file there, and that operand the script.
    if (operands.length) return `\`${a}\` after an operand (only options before the script and files)`
    if (a === '--') {
      options = false
      continue
    }
    if (a.startsWith('--')) return `\`${a}\` (only -n, -E, -r, -u and -e)`
    for (let k = 1; k < a.length; k++) {
      const c = a[k]
      if (c === 'e') {
        const script = k + 1 < a.length ? a.slice(k + 1) : args[++i]
        if (script === undefined) return `\`${a}\` with no script`
        scripts.push(script)
        break
      }
      if (c === 'i' || c === 'I') return `\`${a}\` (it edits a file in place)`
      if (c === 'f') return `\`${a}\` (a sed script from a file)`
      if (!SED_FLAGS.has(c)) return `\`${a}\` (only -n, -E, -r, -u and -e)`
    }
  }
  if (scripts.length === 0) scripts.push(operands[0] ?? '')
  const bad = scripts.find((s) => !sedScriptOnlyPrints(s))
  return bad === undefined ? null : `the sed script \`${bad}\` (only printing scripts such as \`sed -n '1,40p'\`)`
}

function findArgs(args) {
  const bad = ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']
  const hit = args.find((a) => bad.includes(a))
  return hit ? `\`find ${hit}\` (it deletes, writes or runs a command)` : null
}

const GIT_READS = new Set(['log', 'show', 'diff', 'status', 'ls-files', 'ls-tree', 'blame', 'grep', 'rev-parse', 'cat-file', 'shortlog', 'describe', 'rev-list', 'name-rev', 'for-each-ref', 'show-ref', 'version'])
function gitArgs(args) {
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i]
    if (a === '-C') { i += 2; continue }
    if (a === '--no-pager' || a === '-P' || a === '--no-optional-locks' || a === '--literal-pathspecs') { i++; continue }
    return `\`git ${a}\` (an option that can change what git runs)`
  }
  const subcommand = args[i]
  if (!subcommand) return '`git` with no subcommand'
  if (!GIT_READS.has(subcommand)) return `\`git ${subcommand}\` (only git log, show, diff, status, ls-files, ls-tree, blame, grep, rev-parse and cat-file)`
  const hit = args.slice(i + 1).find((a) => a.startsWith('--output') || a === '-O' || a.startsWith('--open-files-in-pager') || a === '--ext-diff' || a === '--textconv')
  return hit ? `\`git ${subcommand} ${hit}\` (it writes a file or runs a program)` : null
}

const KUBECTL_VALUE_OPTIONS = new Set(['-n', '--namespace', '--context', '--cluster', '--kubeconfig', '--user', '-s', '--server', '-l', '--selector', '-o', '--output', '--field-selector'])
function kubectlArgs(args) {
  let verb
  for (let j = 0; j < args.length; j++) {
    if (KUBECTL_VALUE_OPTIONS.has(args[j])) { j++; continue }
    if (args[j].startsWith('-')) continue
    verb = args[j]
    break
  }
  return verb === 'get' || verb === 'describe' || verb === 'version' || verb === 'api-resources' || verb === 'explain'
    ? withoutOptions(['--output-watch-events', '-w', '--watch'])(args)
    : `\`kubectl ${verb ?? ''}\` (only kubectl get and describe)`
}

/** The readers, and what each must not be given. */
/** Readers with no option that writes or runs something: their arguments may be anything. */
const PLAIN_READERS = new Set(['cat', 'head', 'tail', 'wc', 'nl', 'cut', 'tr', 'comm', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'du', 'pwd',
  'true', 'false', 'echo', 'test', '[', 'which', 'whoami', 'uname', 'id', 'diff', 'cmp', 'grep', 'egrep', 'fgrep', 'ls', 'jq', 'cd', 'column', 'fold',
  'rev', 'strings', 'od', 'hexdump', 'md5', 'md5sum', 'sha1sum', 'sha256sum', 'shasum'])

/** xxd's options that take a value, and its operands: a second one is a file it writes. */
function xxdArgs(args) {
  let operands = 0
  for (let i = 0; i < args.length; i++) {
    if (/^-(?:c|g|l|o|s|n|cols|groupsize|len|seek|name)$/.test(args[i])) i++
    else if (args[i] === '-' || !args[i].startsWith('-')) operands++
  }
  return operands > 1 ? '`xxd` with an output file' : null
}

const READERS = new Map([
  ...plain(...PLAIN_READERS),
  ['xxd', xxdArgs],
  ['file', withoutOptions(['-C', '--compile'])],
  // `printf -v` assigns, and zsh evaluates an array subscript in the name, running a command there.
  ['printf', withoutOptions(['-v'])],
  ['rg', withoutOptions(['--pre', '--pre=', '--pre-glob', '--pre-glob='])],
  ['sort', withoutOptions(['-o', '--output', '--output=', '--compress-program', '--compress-program='])],
  ['uniq', (args) => (args.filter((a) => !a.startsWith('-')).length > 1 ? '`uniq` with an output file' : null)],
  ['tree', withoutOptions(['-o'])],
  ['date', withoutOptions(['-s', '--set', '--set='])],
  ['sed', sedArgs],
  ['find', findArgs],
  ['git', gitArgs],
  ['kubectl', kubectlArgs],
])

/** Shell words of a command line, split into simple commands; sub-commands are judged as they are met. */
function judgeLine(src, depth, budget, ctx) {
  if (depth > MAX_DEPTH) unreadable('commands nested too deep to check')
  let i = 0
  let words = []
  const commands = []
  const end = () => {
    if (words.length) commands.push(words)
    words = []
  }
  const step = () => {
    if (++budget.steps > MAX_STEPS) unreadable('a command too long to check')
  }
  /** At `(`: the index of its matching `)`, quotes respected. */
  const matching = (open) => {
    let d = 0
    for (let k = open; k < src.length; k++) {
      step()
      const c = src[k]
      if (c === "'") { k = src.indexOf("'", k + 1); if (k < 0) unreadable('an unclosed quote'); continue }
      if (c === '"') { while (++k < src.length && src[k] !== '"') if (src[k] === '\\') k++; continue }
      if (c === '\\') { k++; continue }
      if (c === '(') d++
      else if (c === ')' && --d === 0) return k
    }
    unreadable('an unclosed parenthesis')
  }
  const readWord = () => {
    let text = ''
    let quoted = false
    let expanded = false
    // `lead`: the word may start with what its text does not (a glob, a brace, an expansion first); `splits`: an unquoted
    // expansion, which the shell may split into more words.
    let lead = false
    let splits = false
    let any = false
    while (i < src.length) {
      step()
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\n' || ';&|()<>'.includes(c)) break
      if (c === '\\') {
        if (src[i + 1] === '\n') { i += 2; continue }
        text += src[i + 1] ?? ''
        i += 2
        quoted = any = true
        continue
      }
      if (c === "'") {
        const k = src.indexOf("'", i + 1)
        if (k < 0) unreadable('an unclosed quote')
        text += src.slice(i + 1, k)
        i = k + 1
        quoted = any = true
        continue
      }
      if (c === '$' && src[i + 1] === "'") {
        if (ctx.mode === 'read') refuse("`$'…'` quoting")
        let k = i + 2
        while (k < src.length && src[k] !== "'") k += src[k] === '\\' ? 2 : 1
        if (k >= src.length) unreadable('an unclosed quote')
        text += src.slice(i + 2, k)
        i = k + 1
        quoted = any = true
        continue
      }
      if (c === '"') {
        i++
        quoted = any = true
        while (i < src.length && src[i] !== '"') {
          step()
          if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1] ?? '')) { text += src[i + 1] === '\n' ? '' : src[i + 1]; i += 2; continue }
          if (src[i] === '$' || src[i] === '`') { expanded = true; lead = lead || !text; text += readDollar(); continue }
          text += src[i]
          i++
        }
        if (i >= src.length) unreadable('an unclosed quote')
        i++
        continue
      }
      if (c === '$' || c === '`') { expanded = splits = true; lead = lead || !text; text += readDollar(); any = true; continue }
      if (c === '{' || c === '}' || c === '*' || c === '?' || c === '[' || c === '~') expanded = expanded || c === '{' || c === '~'
      if (!text && '*?[{'.includes(c)) lead = true
      text += c
      i++
      any = true
    }
    return any ? { text, quoted, expanded, lead, splits } : null
  }
  /** At `$` or a backtick: a substitution is judged as commands; a variable stands for an unknown value. */
  const readDollar = () => {
    if (src[i] === '`') {
      const k = src.indexOf('`', i + 1)
      if (k < 0) unreadable('an unclosed backtick')
      judgeLine(src.slice(i + 1, k), depth + 1, budget, ctx)
      i = k + 1
      return '\u0000'
    }
    if (src.startsWith('$((', i)) {
      const k = matching(i + 1)
      // A command substitution inside arithmetic runs too: not read here, so not run.
      if (RUNS_INSIDE.test(src.slice(i + 3, k))) unreadable('a command inside `$(( ))`')
      i = k + 1
      return '\u0000'
    }
    if (src.startsWith('$(', i)) {
      const k = matching(i + 1)
      judgeLine(src.slice(i + 2, k), depth + 1, budget, ctx)
      i = k + 1
      return '\u0000'
    }
    // `${…}`: a name, its length or a special parameter only. Its operators (`${x:-$(cmd)}`, a quoted `}` in a default)
    // and zsh's flags (`${(e)…}`) can run a command, which is not read here.
    if (src[i + 1] === '{' && !/^\$\{#?(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])\}/.test(src.slice(i, i + 256))) unreadable('a `${ }` with an operator or a flag')
    const m = /^\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(src.slice(i))
    // A `$` before anything else is literal in bash, but zsh's `$~x`, `$=x` and `$^x` glob or split a value, which may
    // run a glob qualifier: only a quote, a blank or the end may follow it here.
    if (!m && i + 1 < src.length && !/["'\s]/.test(src[i + 1])) unreadable(`\`$${src[i + 1]}\``)
    i += m ? m[0].length : 1
    return '\u0000'
  }

  let heredocs = []
  while (i < src.length) {
    step()
    const c = src[i]
    if (c === ' ' || c === '\t') { i++; continue }
    if (c === '\n' && heredocs.length) {
      // The bodies of the heredocs this line opened: up to each delimiter line.
      end()
      i++
      for (const h of heredocs) {
        for (;;) {
          if (i >= src.length) unreadable('an unclosed heredoc')
          const nl = src.indexOf('\n', i)
          const line = src.slice(i, nl < 0 ? src.length : nl)
          i = nl < 0 ? src.length : nl + 1
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        }
      }
      heredocs = []
      continue
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(src[i - 1]))) {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (c === '\n' || c === ';' || (c === '&' && src[i + 1] !== '>') || c === '|' || c === '(' || c === ')') {
      end()
      i += src.startsWith('&&', i) || src.startsWith('||', i) || src.startsWith('|&', i) || src.startsWith(';;', i) ? 2 : 1
      continue
    }
    // Redirections, with or without a descriptor number before them.
    const r = /^([0-9]*)(<<<|<<-|<<|<>|<&|<\(|>\(|>>|>\||>&|&>>|&>|<|>)/.exec(src.slice(i))
    if (r && (r[1] === '' || words.length === 0 || /[\s;&|()]/.test(src[i - 1] ?? ' '))) {
      const op = r[2]
      if (ctx.mode === 'read') {
        if (op === '<<' || op === '<<-') refuse('a heredoc (`<<`)')
        if (op === '<<<') refuse('a here-string (`<<<`)')
        if (op === '<>') refuse('`<>` (it opens a file for writing)')
        if (op === '>(') refuse('`>( )` (a process fed from the command)')
      }
      if (op === '<(' || op === '>(') {
        const k = matching(i + r[0].length - 1)
        judgeLine(src.slice(i + r[0].length, k), depth + 1, budget, ctx)
        i = k + 1
        continue
      }
      i += r[0].length
      while (src[i] === ' ' || src[i] === '\t') i++
      const target = readWord()
      if (!target) unreadable(`\`${op}\` with nothing after it`)
      if (op === '<<' || op === '<<-') { heredocs.push({ delim: target.text, strip: op === '<<-' }); continue }
      if (ctx.mode !== 'read' || op === '<') continue
      if (op === '<&' || op === '>&') {
        if (/^(?:[0-9]+|-)$/.test(target.text) && !target.expanded) continue
        refuse(`\`${op}${target.text}\` (it writes the output to a file)`)
      }
      if (target.text === '/dev/null' && !target.expanded) continue
      refuse(`\`${r[1]}${op} ${target.text}\` (it writes to a file)`)
    }
    const w = readWord()
    if (!w) { i++; continue }
    words.push(w)
  }
  end()
  if (heredocs.length) unreadable('an unclosed heredoc')
  for (const command of commands) (ctx.mode === 'read' ? judgeCommand : judgeFed)(command, depth, budget, ctx)
}

/** One simple command, past its prefixes. */
function judgeCommand(words, depth, budget, ctx) {
  let k = 0
  // Assignments and `time` before the command.
  while (k < words.length) {
    const w = words[k]
    if (!w.quoted && w.text === 'time') { k++; continue }
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) {
      if (!SAFE_ASSIGNMENT.test(w.text)) refuse(`the assignment \`${w.text.split('=')[0]}=\` (only locale settings may go before a command)`)
      k++
      continue
    }
    break
  }
  if (k >= words.length) {
    if (k > 0) refuse('an assignment with no command')
    return
  }
  const first = words[k]
  if (!first.quoted && (first.text === '{' || first.text === '}' || first.text === '!')) return judgeCommand(words.slice(k + 1), depth, budget, ctx)
  if (first.expanded || first.text.includes('\u0000')) refuse(`the command name \`${first.text.split('\u0000').join('$…')}\` (a variable, substitution or expansion)`)
  const name = first.text
  if (!first.quoted && KEYWORDS.has(name)) refuse(`\`${name}\` (a loop or branch: run each command on its own)`)
  if (name.includes('/')) refuse(`\`${name}\` (a command given by its path: use its name)`)
  const rest = words.slice(k + 1).map((w) => w.text)
  // Prefixes that run the command after them.
  if (name === 'env') {
    let j = 0
    while (j < rest.length && (rest[j].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[j]))) {
      if (rest[j].startsWith('-')) refuse(`\`env ${rest[j]}\``)
      if (!SAFE_ASSIGNMENT.test(rest[j])) refuse(`the assignment \`${rest[j].split('=')[0]}=\` (only locale settings may go before a command)`)
      j++
    }
    if (j >= rest.length) return
    return judgeCommand(words.slice(k + 1 + j), depth, budget, ctx)
  }
  if (name === 'timeout' || name === 'nice' || name === 'command' || name === 'stdbuf') {
    let j = 0
    if (name === 'command' && rest[0] === '-v') return
    while (j < rest.length && rest[j].startsWith('-')) j += /^-(?:n|o|e|i|s|k)$/.test(rest[j]) ? 2 : 1
    if (name === 'timeout' && /^\d/.test(rest[j] ?? '')) j++
    if (j >= rest.length) refuse(`\`${name}\` with no command`)
    return judgeCommand(words.slice(k + 1 + j), depth, budget, ctx)
  }
  if (name === 'xargs') {
    let j = 0
    while (j < rest.length && rest[j].startsWith('-')) j += /^-(?:I|d|L|n|P|s|E|a)$/.test(rest[j]) ? 2 : 1
    if (j >= rest.length) return
    return judgeCommand(words.slice(k + 1 + j), depth, budget, ctx)
  }
  if (name === 'eval') return judgeLine(rest.join(' '), depth + 1, budget, ctx)
  if (SHELLS.has(name)) {
    const flag = rest.findIndex((a) => /^-[abd-z]*c[a-z]*$/.test(a))
    if (flag < 0 || rest[flag + 1] === undefined) refuse(`\`${name}\` without \`-c\` (it runs a script or waits for input)`)
    return judgeLine(rest[flag + 1], depth + 1, budget, ctx)
  }
  if (rest.length === 1 && rest[0] === '--version' && !/[^\w.+-]/.test(name)) return
  const reader = READERS.get(name)
  if (!reader) refuse(`\`${name}\` (not a command that only reads)`)
  const why = reader(rest)
  if (why) refuse(why)
  // A reader whose options can write or run: an argument the shell expands may become one (`{-o,x}`, `*`, `$X`).
  const expands = PLAIN_READERS.has(name) ? undefined : words.slice(k + 1).find((w) => w.lead || w.splits)
  if (expands) refuse(`\`${expands.text.split('\u0000').join('$…')}\` (an argument the shell expands, which may become an option of \`${name}\`)`)
}

/** One simple command, for `runsLaterInput`: what runs input sent later is refused; the rest is noted for the whole line. */
function judgeFed(words, depth, budget, ctx) {
  let k = 0
  while (k < words.length) {
    const w = words[k]
    if (!w.quoted && (KEYWORDS.has(w.text) || w.text === '{' || w.text === '}' || w.text === '!' || w.text === 'time')) { k++; continue }
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { k++; continue }
    break
  }
  if (k >= words.length) return
  const first = words[k]
  if (first.expanded || first.text.includes('\u0000')) {
    ctx.variableCommand = true
    return
  }
  const name = first.text.slice(first.text.lastIndexOf('/') + 1)
  const rest = words.slice(k + 1).map((w) => w.text)
  const after = (j) => judgeFed(words.slice(k + 1 + j), depth, budget, ctx)
  if (name === 'env') {
    let j = 0
    while (j < rest.length && (rest[j].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[j]))) j += /^-(?:u|C|S)$/.test(rest[j]) ? 2 : 1
    return j < rest.length ? after(j) : undefined
  }
  if (['timeout', 'nice', 'command', 'stdbuf', 'nohup', 'sudo', 'exec', 'builtin', 'doas'].includes(name)) {
    if (name === 'command' && rest[0] === '-v') return
    let j = 0
    while (j < rest.length && rest[j].startsWith('-')) j += /^-(?:n|o|e|i|s|k|u|g)$/.test(rest[j]) ? 2 : 1
    if (name === 'timeout' && /^\d/.test(rest[j] ?? '')) j++
    return j < rest.length ? after(j) : undefined
  }
  if (name === 'read') {
    ctx.reads = true
    return
  }
  if (name === 'eval') {
    ctx.evals = true
    return judgeLine(rest.join(' '), depth + 1, budget, ctx)
  }
  if ((name === 'source' || name === '.') && STDIN_PATHS.has(rest[0] ?? '-')) refuse(`\`${name} ${rest[0] ?? ''}\` (it runs what is sent to it later)`.replace(' `', '`'))
  if (name === 'xargs') {
    let j = 0
    let replace
    while (j < rest.length && rest[j].startsWith('-')) {
      if (rest[j] === '-I') replace = rest[j + 1]
      j += /^-(?:I|d|L|n|P|s|E|a)$/.test(rest[j]) ? 2 : 1
    }
    const cmd = rest[j]
    if (cmd === undefined) return
    const base = cmd.slice(cmd.lastIndexOf('/') + 1)
    if (SHELLS.has(base) || INTERPRETERS.test(base) || base === 'eval' || cmd.includes('{}') || (replace !== undefined && cmd.includes(replace))) {
      refuse(`\`xargs … ${base}\` (it runs its input as commands)`)
    }
    return after(j)
  }
  if (SHELLS.has(name) || INTERPRETERS.test(name)) {
    if (rest.some((a) => /^-[a-rt-zA-Z]*s[a-zA-Z]*$/.test(a)) && SHELLS.has(name)) refuse(`\`${name} -s\` (it reads its script from input sent later)`)
    const script = rest.findIndex((a) => /^-[abdf-zA-Z]*[ce][a-zA-Z]*$/.test(a) || a === '--eval' || a === '--print' || a === '-p')
    if (script >= 0) {
      if (SHELLS.has(name) && rest[script + 1] !== undefined) return judgeLine(rest[script + 1], depth + 1, budget, ctx)
      return
    }
    const operand = rest.find((a) => !a.startsWith('-') || a === '-')
    if (operand === undefined) {
      if (rest.length && rest.every((a) => ABOUT_ONLY.test(a))) return
      refuse(`\`${name}\` with no script (it would run what is sent to it later): give it the script or file to run`)
    }
    if (STDIN_PATHS.has(operand)) refuse(`\`${name} ${operand}\` (it runs what is sent to it later)`)
  }
}

/** Why no caller may run this command line — it runs input sent to it later — or null. A line this check cannot read is left to the secret guard. */
export function runsLaterInput(command) {
  if (typeof command !== 'string' || command.trim() === '' || command.length > MAX_LENGTH) return null
  const ctx = { mode: 'fed', reads: false, evals: false, variableCommand: false }
  try {
    judgeLine(command.replace(/\\\r?\n/g, ''), 0, { steps: 0 }, ctx)
  } catch (e) {
    if (e instanceof Unreadable) return null
    if (e instanceof Refused) return e.message
    return null
  }
  if (ctx.reads && (ctx.evals || ctx.variableCommand)) return '`read` with `eval` or a variable as the command (it runs what is sent to it later)'
  return null
}

/** The command as text: a string, or Codex's argv form quoted back into one. */
export function commandText(v) {
  if (typeof v === 'string') return v || undefined
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) return undefined
  return v.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ')
}

/** Why a read-only agent may not run this command line, or null when every command in it only reads. */
export function notOnlyReading(command) {
  if (typeof command !== 'string' || command.trim() === '') return 'no command to check'
  if (command.length > MAX_LENGTH) return 'a command too long to check'
  try {
    judgeLine(command.replace(/\\\r?\n/g, ''), 0, { steps: 0 }, { mode: 'read' })
    return null
  } catch (e) {
    if (e instanceof Refused) return e.message
    return 'a command that could not be checked'
  }
}
