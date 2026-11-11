/**
 * Adding and removing an owned table in a TOML file without touching anything else.
 *
 * TOML cannot be re-serialised without losing the user's formatting, so the owned
 * table is appended as a text block between two sentinel comments, and removed by
 * that byte span. The block always starts on a line of its own and holds only
 * tables under the owned name, so no key of it can land in the user's last table.
 * The owned name existing in any form (a table, dotted keys, an inline table, an
 * array of tables, or implied by a sub-table) is a conflict to ask about. Every
 * merge is guarded: the output is the input plus the block, parses, holds exactly
 * the block's content under the owned name, leaves every other key equal, and
 * gives back the input byte for byte when the block is removed.
 *
 * A harness that edits the file itself may insert its own tables above the last
 * comment of the file, which is the end sentinel. Removal therefore keeps every
 * table inside the block that is not under the owned name, and is accepted only
 * when the result equals the file without the owned table.
 */
import { parse } from 'smol-toml'
import { isDeepStrictEqual } from 'node:util'
import { InstallerError } from './errors.js'
import type { OwnedKey } from './manifest.js'
import { sha256 } from './safe-write.js'

export const TOML_BEGIN = '# >>> dethereal managed >>>'
export const TOML_END = '# <<< dethereal managed <<<'
/** The begin line records whether the merge added a final newline the file lacked. */
const NEWLINE_ADDED = ' (newline added)'
const BEGIN_LINE = new RegExp(`^${escape(TOML_BEGIN)}(${escape(NEWLINE_ADDED)})?\\r?$`)
const END_LINE = new RegExp(`^${escape(TOML_END)}\\r?$`)

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The bytes as text; anything that is not valid UTF-8 is refused rather than silently replaced. */
function decode(bytes: Buffer, label: string): string {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new InstallerError('parse_error', `${label} (not UTF-8)`)
  return text
}

/** Parse without ever echoing the parser's message (it quotes the source). */
function parseToml(text: string, label: string): Record<string, unknown> {
  try {
    return parse(text) as Record<string, unknown>
  } catch {
    throw new InstallerError('parse_error', label)
  }
}

function at(obj: Record<string, unknown>, path: readonly string[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function without(obj: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const copy = structuredClone(obj)
  let cur: Record<string, unknown> = copy
  for (const k of path.slice(0, -1)) {
    const next = cur[k]
    if (!next || typeof next !== 'object') return copy
    cur = next as Record<string, unknown>
  }
  delete cur[path[path.length - 1]!]
  // A parent table left empty only because the owned table sat in it was created by the block.
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = at(copy, path.slice(0, depth - 1)) as Record<string, unknown>
    const key = path[depth - 1]!
    const v = parent?.[key]
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete parent[key]
    else break
  }
  return copy
}

/** The dotted name of a table header line (`[a."b.c"]`, `[[a.b]]`), or null when the line is not one. */
function headerName(raw: string): string[] | null {
  const m = /^\s*\[\[?(.*?)\]\]?\s*(#.*)?$/.exec(raw.replace(/\r$/, ''))
  if (!m) return null
  const parts: string[] = []
  const body = m[1]!
  let i = 0
  for (;;) {
    while (body[i] === ' ' || body[i] === '\t') i++
    let part: string
    if (body[i] === '"' || body[i] === "'") {
      const q = body[i]!
      const end = body.indexOf(q, i + 1)
      if (end < 0) return null
      part = body.slice(i + 1, end)
      i = end + 1
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(body.slice(i))
      if (!bare) return null
      part = bare[0]
      i += part.length
    }
    parts.push(part)
    while (body[i] === ' ' || body[i] === '\t') i++
    if (i >= body.length) return parts
    if (body[i] !== '.') return null
    i++
  }
}

const under = (name: readonly string[], table: readonly string[]) => name.length >= table.length && table.every((t, i) => name[i] === t)

/** Header lines of the fragment must all sit under the owned table, and come before any key. */
function checkFragment(fragment: string, table: readonly string[], label: string): void {
  let seenHeader = false
  for (const raw of fragment.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const name = line.startsWith('[') ? headerName(line) : null
    if (line.startsWith('[') && !name) throw new InstallerError('guard_failed', `${label} (fragment table)`)
    if (name) {
      if (!under(name, table)) throw new InstallerError('guard_failed', `${label} (fragment table)`)
      seenHeader = true
    } else if (!seenHeader) {
      throw new InstallerError('guard_failed', `${label} (fragment key before a table)`)
    }
  }
  if (!seenHeader) throw new InstallerError('guard_failed', `${label} (fragment has no table)`)
}

export interface TomlMergeResult {
  bytes: Buffer
  owned: OwnedKey
}

/**
 * Append `fragment` (TOML text whose tables all sit under `table`) to the file.
 * `bytes` null creates it. Refuses a conflict, a parse problem, a sentinel already
 * present, or any merge that does not pass the guard.
 */
export function mergeToml(bytes: Buffer | null, table: readonly string[], fragment: string, label: string): TomlMergeResult {
  const input = bytes ? decode(bytes, label) : ''
  checkFragment(fragment, table, label)
  const before = parseToml(input, label)
  if (at(before, table) !== undefined) throw new InstallerError('conflict', `${label} (${table.join('.')})`)
  if (input.split('\n').some((l) => BEGIN_LINE.test(l) || END_LINE.test(l))) throw new InstallerError('conflict', `${label} (a managed block is already there)`)
  const ownedValue = at(parseToml(fragment, label), table)
  if (ownedValue === undefined) throw new InstallerError('guard_failed', `${label} (fragment)`)

  const eol = input.includes('\r\n') ? '\r\n' : '\n'
  const needsNewline = input.length > 0 && !input.endsWith('\n')
  const body = fragment.replace(/\r?\n$/, '').split(/\r?\n/).join(eol)
  const block = `${eol}${TOML_BEGIN}${needsNewline ? NEWLINE_ADDED : ''}${eol}${body}${eol}${TOML_END}${eol}`
  const out = input + (needsNewline ? eol : '') + block

  // The guard.
  const merged = parseToml(out, label)
  if (!isDeepStrictEqual(at(merged, table), ownedValue)) throw new InstallerError('guard_failed', label)
  if (!isDeepStrictEqual(without(merged, table), without(before, table))) throw new InstallerError('guard_failed', label)
  const reversed = unmergeToml(Buffer.from(out), table, label)
  if (!reversed || reversed.toString('utf8') !== input) throw new InstallerError('guard_failed', label)
  return { bytes: Buffer.from(out), owned: { path: [...table], valueSha256: sha256(JSON.stringify(ownedValue)) } }
}

/**
 * Remove the owned table from the managed block, restoring what the merge added
 * around it. Tables inside the block that are not under `table` (a harness may
 * insert its own there) stay, with the comments right above them. Returns null
 * when the sentinels are missing or ambiguous, the file does not parse, or the
 * result would not be exactly the file without the owned table: it must then be
 * edited by hand.
 *
 * With `outside`, every table under the owned name that sits outside the block
 * goes too (a harness may write a sub-table of its own there, such as a tool's
 * approval), under the same guard.
 */
export function unmergeToml(bytes: Buffer, table: readonly string[], label: string, opts: { outside?: boolean } = {}): Buffer | null {
  let text: string
  let before: Record<string, unknown>
  try {
    text = decode(bytes, label)
    before = parseToml(text, label)
  } catch {
    return null
  }
  const lines = text.split('\n')
  const begins = lines.flatMap((l, i) => (BEGIN_LINE.test(l) ? [i] : []))
  const ends = lines.flatMap((l, i) => (END_LINE.test(l) ? [i] : []))
  if (begins.length !== 1 || ends.length !== 1 || ends[0]! < begins[0]!) return null
  const b = begins[0]!
  const e = ends[0]!
  const newlineAdded = lines[b]!.replace(/\r$/, '').endsWith(NEWLINE_ADDED)

  // Lines inside the block that stay: each table not under the owned name, from
  // the comment and blank lines right above its header to the next header.
  const keep = new Set<number>()
  let owned = true
  for (let i = b + 1; i < e; i++) {
    const name = headerName(lines[i]!)
    if (name) {
      owned = under(name, table)
      if (!owned) {
        for (let j = i - 1; j > b && !keep.has(j) && /^\s*(#.*)?\r?$/.test(lines[j]!); j--) keep.add(j)
      }
    }
    if (!owned) keep.add(i)
  }
  const kept = [...keep].sort((x, y) => x - y).map((i) => lines[i]!)

  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const startOf = (i: number) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0)
  let from = startOf(b)
  const to = Math.min(text.length, startOf(e) + lines[e]!.length + 1)
  // The merge always puts exactly one line ending before the block.
  if (from >= eol.length && text.slice(from - eol.length, from) === eol) from -= eol.length
  const middle = kept.length ? eol + kept.map((l) => l.replace(/\r$/, '')).join(eol) + eol : ''
  let out = text.slice(0, from) + middle + text.slice(to)
  if (!kept.length && newlineAdded && out.endsWith(eol) && to >= text.length) out = out.slice(0, -eol.length)
  if (opts.outside) out = cutSpans(out, (name) => under(name, table))

  // Whatever the block held, only the owned table may leave.
  let after: Record<string, unknown>
  try {
    after = parseToml(out, label)
  } catch {
    return null
  }
  // Any part of the owned table left outside the block (a sub-table the user added below it) makes the
  // cut incomplete: leave the file to the user rather than leave half a server behind.
  if (at(after, table) !== undefined) return null
  // Parents left empty are pruned on both sides, so a user's own empty parent table survives the round trip.
  if (!isDeepStrictEqual(without(after, table), without(before, table))) return null
  return Buffer.from(out)
}

interface Span { name: string[]; array: boolean; start: number; end: number }

/**
 * Every table of the text by line: from its header to the line before the next
 * header or sentinel, leaving the comment and blank lines right above that next
 * header with it.
 */
function tableSpans(lines: readonly string[]): Span[] {
  const heads: Array<{ i: number; name: string[] | null; array: boolean }> = []
  lines.forEach((l, i) => {
    if (BEGIN_LINE.test(l) || END_LINE.test(l)) heads.push({ i, name: null, array: false })
    else if (/^\s*\[/.test(l)) heads.push({ i, name: headerName(l), array: /^\s*\[\[/.test(l) })
  })
  const spans: Span[] = []
  heads.forEach((h, k) => {
    if (!h.name) return
    let end = k + 1 < heads.length ? heads[k + 1]!.i : lines.length
    while (end - 1 > h.i && /^\s*(#.*)?\r?$/.test(lines[end - 1]!)) end--
    spans.push({ name: h.name, array: h.array, start: h.i, end })
  })
  return spans
}

/** The text without the tables `drop` picks. */
function cutSpans(text: string, drop: (name: string[], array: boolean) => boolean): string {
  const lines = text.split('\n')
  const gone = new Set<number>()
  for (const s of tableSpans(lines)) if (drop(s.name, s.array)) for (let i = s.start; i < s.end; i++) gone.add(i)
  return lines.filter((_, i) => !gone.has(i)).join('\n')
}

const samePath = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Delete exactly the named tables (each a full dotted path in header form),
 * inside or outside the managed block, keeping every other byte. Accepted only
 * when the output parses, each named table is absent, and the document without
 * the named tables (empty parents pruned on both sides) is unchanged. Returns
 * null otherwise: a named key defined inline or as dotted keys, an array of
 * tables, a sub-table left under one, a file that does not parse.
 */
export function deleteTomlTables(bytes: Buffer, tables: ReadonlyArray<readonly string[]>, label: string): Buffer | null {
  let text: string
  let before: Record<string, unknown>
  try {
    text = decode(bytes, label)
    before = parseToml(text, label)
  } catch {
    return null
  }
  // An array of tables is never cut; one that is named stays, and the proof below refuses it.
  const out = cutSpans(text, (name, array) => !array && tables.some((t) => samePath(name, t)))
  let after: Record<string, unknown>
  try {
    after = parseToml(out, label)
  } catch {
    return null
  }
  if (tables.some((t) => at(after, t) !== undefined)) return null
  const rest = (doc: Record<string, unknown>) => tables.reduce((d, t) => without(d, t), doc)
  if (!isDeepStrictEqual(rest(after), rest(before))) return null
  return Buffer.from(out)
}

/**
 * The leaf paths under `table` whose value differs from `expected`: changed,
 * added or removed (an array is one leaf). The whole table when the file does
 * not parse.
 */
export function tomlTreeDiff(bytes: Buffer, table: readonly string[], expected: unknown): string[][] {
  let actual: unknown
  try {
    actual = at(parseToml(decode(bytes, 'toml'), 'toml'), table)
  } catch {
    return [[...table]]
  }
  const isTable = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  const diffs: string[][] = []
  const walk = (a: unknown, e: unknown, p: string[]) => {
    if (isTable(a) && isTable(e)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(e)])) walk(a[k], e[k], [...p, k])
    } else if (!isDeepStrictEqual(a, e)) {
      diffs.push(p)
    }
  }
  walk(actual, expected, [...table])
  return diffs
}
