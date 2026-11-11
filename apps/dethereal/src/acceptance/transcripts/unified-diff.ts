/**
 * Apply unified-diff hunks to a known text, strictly: every context and removed
 * line must match at the position the hunk names. A diff that does not fit is
 * an error, never a best-effort apply, so the replay never invents content.
 */

export class PatchMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PatchMismatch'
  }
}

interface Hunk {
  oldStart: number
  oldLines: number
  newLines: number
  lines: string[]
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** The hunks of a diff; file headers (`Index:`, `---`, `+++`, `===`) before the first hunk are ignored. */
export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const line of diff.split('\n')) {
    const m = HEADER.exec(line)
    if (m) {
      current = { oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]), newLines: m[4] === undefined ? 1 : Number(m[4]), lines: [] }
      hunks.push(current)
    } else if (current && (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+') || line.startsWith('\\'))) {
      current.lines.push(line)
    } else if (current && line === '') {
      // A context line that was a blank line, written without its leading space.
      current.lines.push(' ')
    }
  }
  // A trailing blank "context" line beyond the counts is the diff's own final newline.
  for (const h of hunks) {
    const count = (p: string) => h.lines.filter((l) => l.startsWith(p) || l.startsWith(' ')).length
    while (h.lines.length && h.lines[h.lines.length - 1] === ' ' && (count('-') > h.oldLines || count('+') > h.newLines)) h.lines.pop()
  }
  return hunks
}

/** Claude's `structuredPatch` hunks, as diff text. */
export function structuredPatchText(patch: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>): string {
  return patch.map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')).join('\n')
}

/**
 * Apply `diff` to `text`. Throws PatchMismatch when a line does not match.
 *
 * `ignoreIndent` compares lines without their leading whitespace, for a diff
 * made for display with its indentation reduced. Its result has the diff's own
 * indentation on added lines, so it is only fit for a comparison that ignores
 * indentation too (`sameIgnoringIndent`).
 */
export function applyUnifiedDiff(text: string, diff: string, options: { ignoreIndent?: boolean } = {}): string {
  const eq = options.ignoreIndent ? (a: string | undefined, b: string) => a !== undefined && a.trimStart() === b.trimStart() : (a: string | undefined, b: string) => a === b
  const hunks = parseHunks(diff)
  if (hunks.length === 0) throw new PatchMismatch('no hunks')
  const endsWithNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (endsWithNewline) lines.pop()
  const out: string[] = []
  let cursor = 0
  let noNewlineAtEnd = !endsWithNewline
  for (const h of hunks) {
    // A hunk adding to an empty file names line 0.
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1
    if (start < cursor || start > lines.length) throw new PatchMismatch(`hunk at line ${h.oldStart} is out of order or past the end`)
    out.push(...lines.slice(cursor, start))
    cursor = start
    let prev = ''
    for (const l of h.lines) {
      const body = l.slice(1)
      if (l.startsWith('\\')) {
        // "\ No newline at end of file" qualifies the line before it.
        if (prev === '+') noNewlineAtEnd = true
        else if (prev === '-' || prev === ' ') noNewlineAtEnd = prev === ' ' ? true : noNewlineAtEnd
        continue
      }
      if (l.startsWith('+')) {
        out.push(body)
        if (noNewlineAtEnd && cursor >= lines.length) noNewlineAtEnd = false
      } else {
        if (!eq(lines[cursor], body)) throw new PatchMismatch(`line ${cursor + 1} does not match the hunk`)
        if (l.startsWith(' ')) out.push(options.ignoreIndent ? lines[cursor]! : body)
        cursor++
      }
      prev = l[0]!
    }
  }
  out.push(...lines.slice(cursor))
  return out.join('\n') + (noNewlineAtEnd || out.length === 0 ? '' : '\n')
}

/** Two texts equal line by line when leading whitespace and a final newline are ignored. */
export function sameIgnoringIndent(a: string, b: string): boolean {
  const norm = (t: string) => t.replace(/\n$/, '').split('\n').map((l) => l.trimStart())
  const x = norm(a)
  const y = norm(b)
  return x.length === y.length && x.every((l, i) => l === y[i])
}
