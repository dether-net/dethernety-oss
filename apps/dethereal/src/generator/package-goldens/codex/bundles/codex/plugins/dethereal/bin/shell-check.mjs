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

/** A sed script that only prints, deletes from the output, counts or quits: addresses, then p d = q l n, or s/…/…/ with g p i I or a number. */
const SED_SAFE = /^(?:\s*(?:(?:\d+|\$|\/(?:[^/\\]|\\.)*\/)(?:\s*,\s*(?:\d+|\$|\/(?:[^/\\]|\\.)*\/|[+~]\d+))?\s*!?\s*)?(?:[pdq=ln]|s(.)(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[gpiI0-9]*|\{|\})\s*[;\n]?)*\s*$/
function sedArgs(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-i' || a.startsWith('-i') || a.startsWith('--in-place') || (/^-[A-Za-z]+$/.test(a) && a.includes('i'))) return `\`${a}\` (it edits a file in place)`
    if (a === '-f' || a.startsWith('--file')) return `\`${a}\` (a sed script from a file)`
    if (a === '-e' || a === '--expression') {
      const s = args[++i] ?? ''
      if (!SED_SAFE.test(s)) return `the sed script \`${s}\` (only printing scripts such as \`sed -n '1,40p'\`)`
    }
  }
  const operands = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-e' && args[i - 1] !== '--expression')
  const scripted = args.some((a) => a === '-e' || a === '--expression')
  if (!scripted) {
    const s = operands[0] ?? ''
    if (!SED_SAFE.test(s)) return `the sed script \`${s}\` (only printing scripts such as \`sed -n '1,40p'\`)`
  }
  return null
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
const READERS = new Map([
  ...plain('cat', 'head', 'tail', 'wc', 'nl', 'cut', 'tr', 'comm', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'file', 'du', 'pwd', 'true', 'false', 'echo', 'printf', 'test', '[', 'which', 'whoami', 'uname', 'id', 'diff', 'cmp', 'grep', 'egrep', 'fgrep', 'ls', 'jq', 'cd', 'column', 'fold', 'rev', 'strings', 'od', 'xxd', 'hexdump', 'md5', 'md5sum', 'sha1sum', 'sha256sum', 'shasum'),
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
          if (src[i] === '$' || src[i] === '`') { expanded = true; text += readDollar(); continue }
          text += src[i]
          i++
        }
        if (i >= src.length) unreadable('an unclosed quote')
        i++
        continue
      }
      if (c === '$' || c === '`') { expanded = true; text += readDollar(); any = true; continue }
      if (c === '{' || c === '}' || c === '*' || c === '?' || c === '[' || c === '~') expanded = expanded || c === '{' || c === '~'
      text += c
      i++
      any = true
    }
    return any ? { text, quoted, expanded } : null
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
      i = k + 1
      return '\u0000'
    }
    if (src.startsWith('$(', i)) {
      const k = matching(i + 1)
      judgeLine(src.slice(i + 2, k), depth + 1, budget, ctx)
      i = k + 1
      return '\u0000'
    }
    const m = /^\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(src.slice(i))
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
    const flag = rest.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
    if (flag < 0 || rest[flag + 1] === undefined) refuse(`\`${name}\` without \`-c\` (it runs a script or waits for input)`)
    return judgeLine(rest[flag + 1], depth + 1, budget, ctx)
  }
  if (rest.length === 1 && rest[0] === '--version' && !/[^\w.+-]/.test(name)) return
  const reader = READERS.get(name)
  if (!reader) refuse(`\`${name}\` (not a command that only reads)`)
  const why = reader(rest)
  if (why) refuse(why)
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
    if (rest.some((a) => /^-[a-zA-Z]*s[a-zA-Z]*$/.test(a)) && SHELLS.has(name)) refuse(`\`${name} -s\` (it reads its script from input sent later)`)
    const script = rest.findIndex((a) => /^-[a-zA-Z]*[ce][a-zA-Z]*$/.test(a) || a === '--eval' || a === '--print' || a === '-p')
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
