/**
 * A shell command line as the commands it runs, for telling which files a command names. POSIX-style words
 * (quotes, escapes, `$( )`, backticks, `<( )`, heredocs), split into commands on `; & && || | |& ( ) { }`,
 * newlines and `do then else elif`. A command substitution, a process substitution, `sh -c`, `eval` and
 * `xargs … sh -c` are read as commands too. Each word keeps whether any part of it was quoted, so an unquoted
 * glob can be told from a literal, and a variable reference outside single quotes is kept for substitution.
 */

export interface Word {
  /** The word's text, quotes removed; `\u0000name\u0000` stands for a variable reference */
  text: string
  /** Some part of it was quoted */
  quoted: boolean
  /** The command substitutions (by group) whose output is part of it */
  subs?: number[]
}

export interface Command {
  words: Word[]
  /** The command's own text, as written */
  raw: string
  /** Files read on standard input: `<file`, `<>file` */
  input: Word[]
  /** Heredoc and here-string bodies fed to it */
  stdin: string[]
  /** Its output feeds the next command */
  pipesTo: boolean
  /** The command substitutions (by group) it runs inside */
  groups?: number[]
}

const OPERATORS = ['&&', '||', '|&', ';;', ';', '&', '|', '(', ')', '\n']
const SEPARATOR_WORDS = new Set(['do', 'then', 'else', 'elif', 'done', 'fi', 'esac', '{', '}', '!'])
const LEADING_WORDS = new Set(['if', 'while', 'until', 'time'])
export const VAR = (name: string) => `\u0000${name}\u0000`
let nextGroup = 0

/** The commands a command line runs, sub-commands included, in the order written. */
export function parseShell(src: string, depth = 0): Command[] {
  const out: Command[] = []
  if (depth > 8) return out
  let i = 0
  let words: Word[] = []
  let input: Word[] = []
  let stdin: string[] = []
  let start = 0
  let pendingHeredocs: Array<{ delim: string; strip: boolean; into: string[] }> = []
  let subbed: number[] = []
  const sub = (body: string) => out.push(...parseShell(body, depth + 1))
  /** A command substitution: its commands, tagged with its group, which the word it stands in records. */
  const substitution = (body: string) => {
    const group = ++nextGroup
    const cmds = parseShell(body, depth + 1)
    for (const c of cmds) c.groups = [...(c.groups ?? []), group]
    out.push(...cmds)
    subbed.push(group)
  }

  const end = (pipes: boolean, at: number) => {
    const raw = src.slice(start, at).trim()
    while (words.length && LEADING_WORDS.has(words[0]!.text) && !words[0]!.quoted) words.shift()
    if (words.length || input.length) out.push({ words, raw, input, stdin, pipesTo: pipes })
    words = []
    input = []
    stdin = []
  }

  /** Reads one word starting at i; returns null at a separator. */
  const readWord = (): Word | null => {
    let text = ''
    let quoted = false
    let any = false
    subbed = []
    while (i < src.length) {
      const c = src[i]!
      if (c === ' ' || c === '\t') break
      if (OPERATORS.some((o) => src.startsWith(o, i)) || c === '<' || c === '>') break
      if (c === '\\') {
        if (src[i + 1] === '\n') { i += 2; continue }
        text += src[i + 1] ?? ''
        i += 2
        any = true
        quoted = true
        continue
      }
      if (c === "'") {
        const j = src.indexOf("'", i + 1)
        const k = j < 0 ? src.length : j
        text += src.slice(i + 1, k)
        i = k + 1
        quoted = true
        any = true
        continue
      }
      if (c === '"') {
        i++
        quoted = true
        any = true
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1] ?? '')) { text += src[i + 1] === '\n' ? '' : src[i + 1]; i += 2; continue }
          if (src[i] === '$' || src[i] === '`') { text += readDollar(); continue }
          text += src[i]
          i++
        }
        i++
        continue
      }
      if (c === '$' || c === '`') { text += readDollar(); any = true; continue }
      text += c
      i++
      any = true
    }
    return any ? { text, quoted, ...(subbed.length ? { subs: subbed } : {}) } : null
  }

  /** At `$` or a backtick: a substitution (read as commands, worth nothing in the word) or a variable reference. */
  const readDollar = (): string => {
    if (src[i] === '`') {
      const j = src.indexOf('`', i + 1)
      const k = j < 0 ? src.length : j
      substitution(src.slice(i + 1, k))
      i = k + 1
      return ''
    }
    if (src.startsWith('$((', i)) {
      const k = matching(i + 2)
      i = k + 1
      return ''
    }
    if (src.startsWith('$(', i)) {
      const k = matching(i + 1)
      const body = src.slice(i + 2, k)
      // `$(<file)` reads the file.
      const m = /^\s*<\s*(\S+)\s*$/.exec(body)
      if (m) out.push({ words: [{ text: 'cat', quoted: false }, ...parseShell(m[1]!, depth + 1)[0]?.words ?? []], raw: body, input: [], stdin: [], pipesTo: false })
      else substitution(body)
      i = k + 1
      return ''
    }
    const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(src.slice(i))
    if (m) {
      i += m[0].length
      return VAR(m[1] ?? m[2]!)
    }
    i++
    return '$'
  }

  /** The index of the `)` closing the `(` at `open`, quotes respected. */
  const matching = (open: number): number => {
    let d = 0
    for (let k = open; k < src.length; k++) {
      const c = src[k]
      if (c === "'") { k = src.indexOf("'", k + 1); if (k < 0) return src.length; continue }
      if (c === '"') { while (++k < src.length && src[k] !== '"') if (src[k] === '\\') k++; continue }
      if (c === '\\') { k++; continue }
      if (c === '(') d++
      else if (c === ')' && --d === 0) return k
    }
    return src.length
  }

  const readHeredocBodies = () => {
    // At the start of a line after the command: each pending heredoc's body, up to its delimiter line.
    for (const h of pendingHeredocs) {
      const lines: string[] = []
      while (i < src.length) {
        const nl = src.indexOf('\n', i)
        const line = src.slice(i, nl < 0 ? src.length : nl)
        i = nl < 0 ? src.length : nl + 1
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        lines.push(line)
      }
      h.into.push(lines.join('\n'))
    }
    pendingHeredocs = []
  }

  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t') { i++; continue }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(src[i - 1]!))) {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i))
    if (op) {
      end(op === '|' || op === '|&', i)
      i += op.length
      start = i
      if (op === '\n' && pendingHeredocs.length) { readHeredocBodies(); start = i }
      continue
    }
    if (c === '<' || c === '>' || (/[0-9&]/.test(c) && /^(?:[0-9]+|&)>/.test(src.slice(i)))) {
      if (src.startsWith('<<<', i)) {
        i += 3
        while (src[i] === ' ' || src[i] === '\t') i++
        const w = readWord()
        if (w) stdin.push(w.text)
        continue
      }
      if (src.startsWith('<<', i)) {
        i += 2
        const strip = src[i] === '-'
        if (strip) i++
        while (src[i] === ' ' || src[i] === '\t') i++
        const w = readWord()
        if (w) pendingHeredocs.push({ delim: w.text, strip, into: stdin })
        continue
      }
      if (src.startsWith('<(', i) || src.startsWith('>(', i)) {
        const k = matching(i + 1)
        sub(src.slice(i + 2, k))
        i = k + 1
        continue
      }
      const reading = c === '<'
      i += /^(?:[0-9]+|&)?(?:<>|>>|>\||>&|<&|>|<)/.exec(src.slice(i))![0].length
      while (src[i] === ' ' || src[i] === '\t') i++
      const w = readWord()
      if (w && reading && !/^[0-9-]+$/.test(w.text)) input.push(w)
      continue
    }
    const w = readWord()
    if (!w) { i++; continue }
    // A keyword only where a command starts: `echo done` keeps its word.
    if (!w.quoted && SEPARATOR_WORDS.has(w.text) && !words.length && !input.length) { start = i; continue }
    words.push(w)
  }
  end(false, src.length)
  return unwrap(out, depth)
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
export const baseName = (w: string) => w.slice(w.lastIndexOf('/') + 1)
/** Commands that run the command after them: their own options and numbers come first. */
export const PREFIXES = new Set(['env', 'sudo', 'command', 'nohup', 'time', 'nice', 'exec', 'builtin', 'stdbuf', 'timeout', 'xargs'])

/** Where the command a word list runs starts: past assignments, prefixes (`env`, `sudo`, `timeout 5`, `xargs -0`) and their options. */
export function commandStart(words: string[]): number {
  let k = 0
  while (k < words.length) {
    const w = words[k]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { k++; continue }
    const name = baseName(w)
    if (!PREFIXES.has(name)) break
    k++
    while (k < words.length && (words[k]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]!))) {
      // Options that take a value: `xargs -I {}`, `sudo -u x`, `nice -n 5`, `stdbuf -o L`.
      k += /^-(?:[IdLnPsEugo]|-?user|-?group)$/.test(words[k]!) ? 2 : 1
    }
    if ((name === 'timeout' || name === 'nice') && /^\d/.test(words[k] ?? '')) k++
  }
  return k
}

/** The script word of a shell run with `-c` (index into words), or -1. */
export function shellScriptAt(words: string[]): number {
  const k = commandStart(words)
  if (!SHELLS.has(baseName(words[k] ?? ''))) return -1
  const flag = words.slice(k + 1).findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w))
  return flag < 0 ? -1 : k + 1 + flag + 1
}

/** `sh -c`, `eval` and `xargs … sh -c` read as the commands they run, beside themselves. */
function unwrap(commands: Command[], depth: number): Command[] {
  const out: Command[] = []
  for (const c of commands) {
    out.push(c)
    const ws = c.words.map((w) => w.text)
    const k = commandStart(ws)
    if (SHELLS.has(baseName(ws[k] ?? ''))) {
      const at = shellScriptAt(ws)
      const script = at >= 0 ? ws[at] : undefined
      if (script !== undefined) out.push(...parseShell(script, depth + 1))
      else if (c.stdin.length) for (const body of c.stdin) out.push(...parseShell(body, depth + 1))
    } else if (ws[k] === 'eval') {
      out.push(...parseShell(ws.slice(k + 1).join(' '), depth + 1))
    }
  }
  return out
}
