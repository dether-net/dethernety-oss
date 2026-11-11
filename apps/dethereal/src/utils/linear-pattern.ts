/**
 * A regular expression's `test`, in time linear in the text for a given pattern: the pattern runs as a set of states
 * stepped once per character (Thompson's construction), never by backtracking. A pattern the guards build from a
 * command's words (a glob read as a regular expression) can make JavaScript's own engine backtrack for longer than
 * any deadline, and a hook gives a call it cannot judge in time to the harness, which on some versions runs it.
 *
 * It reads the part of the syntax those patterns use, as JavaScript reads it without the `u` flag: literals and
 * escaped punctuation, `.`, `[…]` classes, `\s` `\S` `\d` `\D` `\w` `\W`, `\b` `\B`, `^` and `$` (no `m` flag),
 * groups `(…)` and `(?:…)`, `|`, and the quantifiers `*` `+` `?` (lazy or not, which a test does not tell apart).
 * Anything else throws, as does a pattern JavaScript would refuse. Each character test (a class, a literal under the
 * `i` flag) is JavaScript's own, made once per pattern, so a character matches exactly as it would in the whole.
 */

type Node =
  | { readonly kind: 'char'; readonly test: (c: string) => boolean }
  | { readonly kind: 'start' | 'end' | 'boundary' | 'inside' }
  | { readonly kind: 'repeat'; readonly node: Node; readonly min: 0 | 1; readonly max: number }
  | { readonly kind: 'alt'; readonly options: readonly (readonly Node[])[] }

type Op =
  | { readonly op: 'char'; readonly test: (c: string) => boolean }
  | { readonly op: 'split'; readonly to: readonly number[] }
  | { readonly op: 'jump'; readonly to: number }
  | { readonly op: 'start' | 'end' | 'boundary' | 'inside' | 'match' }

export interface LinearPattern {
  /**
   * Whether the pattern matches somewhere in `text`. The time is the text's length times the pattern's at worst; both can
   * come from a command, so `every`, when given, is called after each stretch of work, and may throw to stop it.
   */
  test(text: string, every?: () => void): boolean
}

/** How many state steps run between two calls of a test's `every`. */
const STEPS_BETWEEN_CHECKS = 1 << 16

/** The characters JavaScript's `.` does not take, without the `s` flag. */
export const LINE_ENDS: ReadonlySet<string> = new Set(['\n', '\r', '\u2028', '\u2029'])
const WORD = /^[A-Za-z0-9_]$/

/** One character's test, as JavaScript reads `source` (a class, an escape or a literal) under `flags`. */
function charTest(source: string, flags: string): (c: string) => boolean {
  const re = new RegExp(`^(?:${source})$`, flags)
  return (c) => re.test(c)
}

function parse(source: string, flags: string): Node[] {
  let i = 0
  const fail = (why: string): never => {
    throw new SyntaxError(`linear pattern: ${why} at ${i} in /${source}/`)
  }
  const sequence = (): Node[] => {
    const out: Node[] = []
    while (i < source.length && source[i] !== '|' && source[i] !== ')') {
      let node = atom()
      for (;;) {
        const q = source[i]
        if (q !== '*' && q !== '+' && q !== '?') break
        if (node.kind !== 'char' && node.kind !== 'alt' && node.kind !== 'repeat') fail('a quantified assertion')
        i++
        if (source[i] === '?') i++
        node = { kind: 'repeat', node, min: q === '+' ? 1 : 0, max: q === '?' ? 1 : Infinity }
      }
      if (source[i] === '{' && /^\{\d/.test(source.slice(i, i + 2))) fail('a counted quantifier')
      out.push(node)
    }
    return out
  }
  const alternatives = (): Node => {
    const options = [sequence()]
    while (source[i] === '|') {
      i++
      options.push(sequence())
    }
    return { kind: 'alt', options }
  }
  const atom = (): Node => {
    const c = source[i]!
    if (c === '(') {
      i++
      if (source[i] === '?') {
        if (source[i + 1] !== ':') fail('a lookaround or named group')
        i += 2
      }
      const group = alternatives()
      if (source[i] !== ')') fail('an unclosed group')
      i++
      return group
    }
    if (c === '[') {
      // A class runs to the first `]` not escaped, as JavaScript reads it (`[]` holds nothing, `[^]` anything).
      let j = i + 1
      if (source[j] === '^') j++
      while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1
      if (j >= source.length) fail('an unclosed class')
      const test = charTest(source.slice(i, j + 1), flags)
      i = j + 1
      return { kind: 'char', test }
    }
    if (c === '\\') {
      const e = source[i + 1]
      if (e === undefined) fail('a trailing backslash')
      i += 2
      if (e === 'b') return { kind: 'boundary' }
      if (e === 'B') return { kind: 'inside' }
      if (/[A-Za-z0-9]/.test(e!) && !'sSdDwW'.includes(e!)) fail(`the escape \\${e}`)
      return { kind: 'char', test: charTest(`\\${e}`, flags) }
    }
    i++
    if (c === '^') return { kind: 'start' }
    if (c === '$') return { kind: 'end' }
    if (c === '.') return { kind: 'char', test: (ch) => !LINE_ENDS.has(ch) }
    if (c === '*' || c === '+' || c === '?') fail('nothing to repeat')
    if (!flags.includes('i')) return { kind: 'char', test: (ch) => ch === c }
    return { kind: 'char', test: charTest(c.replace(/[\\^$.*+?()[\]{}|/]/, '\\$&'), flags) }
  }
  const top = alternatives()
  if (i < source.length) fail('an unmatched )')
  return [top]
}

/** The nodes as a program: a jump table the matcher steps through. */
function compile(nodes: readonly Node[]): Op[] {
  const ops: Op[] = []
  const emit = (node: Node): void => {
    if (node.kind === 'char') ops.push({ op: 'char', test: node.test })
    else if (node.kind === 'alt') {
      const split = ops.length
      ops.push({ op: 'split', to: [] })
      const starts: number[] = []
      const jumps: number[] = []
      for (const option of node.options) {
        starts.push(ops.length)
        for (const n of option) emit(n)
        jumps.push(ops.length)
        ops.push({ op: 'jump', to: -1 })
      }
      ops[split] = { op: 'split', to: starts }
      for (const j of jumps) ops[j] = { op: 'jump', to: ops.length }
    } else if (node.kind === 'repeat') {
      if (node.min === 1) emit(node.node)
      const loop = ops.length
      ops.push({ op: 'split', to: [] })
      const body = ops.length
      emit(node.node)
      if (node.max === Infinity) ops.push({ op: 'jump', to: loop })
      ops[loop] = { op: 'split', to: [body, ops.length] }
    } else ops.push({ op: node.kind })
  }
  for (const n of nodes) emit(n)
  ops.push({ op: 'match' })
  return ops
}

/**
 * `source` under `flags` (only `i` is read; others throw) as a pattern whose `test` takes time linear in the text.
 * Throws where `new RegExp(source, flags)` would, and for syntax outside the part it reads.
 */
export function linearPattern(source: string, flags = ''): LinearPattern {
  // JavaScript's own reading first: a pattern it refuses is refused here the same way.
  new RegExp(source, flags)
  if (/[^i]/.test(flags)) throw new SyntaxError(`linear pattern: the flags ${flags}`)
  const ops = compile(parse(source, flags))
  // The step each state was last reached in: a step number is never reused, across calls too.
  const seen = new Float64Array(ops.length).fill(-1)
  let step = 0
  return {
    test(text: string, every?: () => void): boolean {
      const word = (k: number) => k >= 0 && k < text.length && WORD.test(text[k]!)
      let matched = false
      // The states reachable from `from` without reading a character, at `at`; those that read one are kept. A stack,
      // not recursion: a long chain of `*` is a long chain of states.
      const add = (list: number[], from: number, at: number): void => {
        const stack = [from]
        while (stack.length) {
          const pc = stack.pop()!
          if (seen[pc] === step) continue
          seen[pc] = step
          const op = ops[pc]!
          if (op.op === 'char') list.push(pc)
          else if (op.op === 'match') matched = true
          else if (op.op === 'jump') stack.push(op.to)
          else if (op.op === 'split') for (const to of op.to) stack.push(to)
          else if (op.op === 'start') {
            if (at === 0) stack.push(pc + 1)
          } else if (op.op === 'end') {
            if (at === text.length) stack.push(pc + 1)
          } else if ((word(at - 1) !== word(at)) === (op.op === 'boundary')) stack.push(pc + 1)
        }
      }
      step++
      let states: number[] = []
      add(states, 0, 0)
      let work = 0
      for (let at = 0; !matched && at < text.length; at++) {
        work += states.length
        if (every && work >= STEPS_BETWEEN_CHECKS) {
          work = 0
          every()
        }
        step++
        const next: number[] = []
        const c = text[at]!
        for (const pc of states) if ((ops[pc] as { test: (c: string) => boolean }).test(c)) add(next, pc + 1, at + 1)
        // Not anchored: a match may start at any place.
        add(next, 0, at + 1)
        states = next
      }
      return matched
    },
  }
}
