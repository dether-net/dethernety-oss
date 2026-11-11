/**
 * Which write in an opaque window left a gate value, read back from the window's end.
 *
 * The replay knows the file again when the window closes (`text`, in the final model's ids). Each event of the
 * window, the latest first, either sets the final value, passes it by, or stops the reading back:
 * - a settle as `serverWriteReading` reads its echo;
 * - a file write by where its new text sits in the closing text: it sets the value when the field's key and value
 *   lie inside that text, in the element's own object, and its old text did not already hold them; it passes it by
 *   when the key and value lie outside it; anything else (its new text not found once, a key cut by its edge, a
 *   delete or a move) stops the reading, since it may have set the value;
 * - a file write the harness reports as failed passes it by; a shell command or any other event stops it.
 * The first event that sets the value is the writer, and every event after it in the window passed the value by.
 */
import type { FileOp, TranscriptEvent } from '../transcripts/types.js'
import { CROWN_JEWEL_MAPPING, type ElementChange } from './element-changes.js'
import { rewriteText, type Push } from './id-remap.js'
import { serverWriteReading } from './settled-at.js'

type Span = { start: number; end: number }
type Node =
  | { type: 'object'; start: number; end: number; entries: Array<{ key: string; keyStart: number; value: Node }> }
  | { type: 'array'; start: number; end: number; items: Node[] }
  | { type: 'scalar'; start: number; end: number; value: unknown }

/** JSON with the position of every value and key; undefined when the text is not JSON. */
export function parsePositioned(text: string): Node | undefined {
  let i = 0
  const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i++ }
  const str = (): string => {
    const start = i
    i++
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) throw new Error('unterminated string')
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const value = (): Node => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const entries: Array<{ key: string; keyStart: number; value: Node }> = []
      ws()
      if (text[i] === '}') { i++; return { type: 'object', start, end: i, entries } }
      for (;;) {
        ws()
        if (text[i] !== '"') throw new Error('expected a key')
        const keyStart = i
        const key = str()
        ws()
        if (text[i] !== ':') throw new Error('expected a colon')
        i++
        entries.push({ key, keyStart, value: value() })
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return { type: 'object', start, end: i, entries } }
        throw new Error('expected , or }')
      }
    }
    if (c === '[') {
      i++
      const items: Node[] = []
      ws()
      if (text[i] === ']') { i++; return { type: 'array', start, end: i, items } }
      for (;;) {
        items.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return { type: 'array', start, end: i, items } }
        throw new Error('expected , or ]')
      }
    }
    if (c === '"') return { type: 'scalar', start, end: (str(), i), value: JSON.parse(text.slice(start, i)) }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i))
    if (!m) throw new Error('unexpected token')
    i += m[0].length
    return { type: 'scalar', start, end: i, value: JSON.parse(m[0]) }
  }
  try {
    const root = value()
    ws()
    return i === text.length ? root : undefined
  } catch {
    return undefined
  }
}

/**
 * Where the closing text holds this element's field, key to value end: in `structure.json` the field of the one
 * object whose own `id` is the element and which has the field; in `scope.json` the whole crown-jewel mapping.
 */
export function fieldSpan(text: string, element: string, field: string): Span | undefined {
  const root = parsePositioned(text)
  if (!root) return undefined
  if (field === CROWN_JEWEL_MAPPING) {
    const entry = root.type === 'object' ? root.entries.find((e) => e.key === CROWN_JEWEL_MAPPING) : undefined
    return entry ? { start: entry.keyStart, end: entry.value.end } : undefined
  }
  const found: Span[] = []
  const walk = (n: Node) => {
    if (n.type === 'object') {
      const own = n.entries.find((e) => e.key === 'id')
      const hit = n.entries.find((e) => e.key === field)
      if (own?.value.type === 'scalar' && own.value.value === element && hit) found.push({ start: hit.keyStart, end: hit.value.end })
      n.entries.forEach((e) => walk(e.value))
    } else if (n.type === 'array') n.items.forEach(walk)
  }
  walk(root)
  return found.length === 1 ? found[0] : undefined
}

/** A file operation's sides, as old and new text pairs: an edit's strings, or each hunk's context with its - or + lines. */
function sidesOf(op: FileOp): Array<{ old: string; new: string }> | undefined {
  if (op.op === 'replace') return [{ old: op.oldString, new: op.newString }]
  if (op.op === 'write') return [{ old: '', new: op.content }]
  if (op.op === 'patch') {
    const out: Array<{ old: string; new: string }> = []
    for (const hunk of op.hunks.split(/^@@.*$/m).slice(1)) {
      const lines = hunk.replace(/^\n/, '').replace(/\n$/, '').split('\n')
      const side = (keep: string) => lines.filter((l) => l[0] === ' ' || l[0] === keep || l === '').map((l) => l.slice(1)).join('\n')
      out.push({ old: side('-'), new: side('+') })
    }
    return out.length ? out : undefined
  }
  return undefined
}

const collapse = (s: string) => s.replace(/\s+/g, '')

/** How one file write reads for the value: `sets` it, `passes` it by, or `stops` the reading back. */
export function fileWriteReading(op: FileOp | undefined, seq: number, text: string, element: string, field: string, list: Push[]): 'sets' | 'passes' | 'stops' {
  const span = fieldSpan(text, element, field)
  const sides = op ? sidesOf(op) : undefined
  if (!span || !sides) return 'stops'
  const kv = collapse(text.slice(span.start, span.end))
  let sets = false
  for (const s of sides) {
    const next = rewriteText(s.new, list, seq)!
    const at: number[] = []
    for (let k = next ? text.indexOf(next) : -1; k >= 0; k = text.indexOf(next, k + 1)) at.push(k)
    const inside = at.filter((k) => span.start >= k && span.end <= k + next.length)
    const cut = at.filter((k) => k < span.end && k + next.length > span.start && !inside.includes(k))
    if (cut.length) return 'stops'
    if (!inside.length) {
      // Not found at all: this text did not survive to the window's end as written, so where it went is unknown.
      if (!at.length) return 'stops'
      continue
    }
    // The text it wrote holds the value; found more than once, or written over every occurrence, which one is its own is unknown.
    if (at.length > 1 || (op!.op === 'replace' && op!.replaceAll)) return 'stops'
    // The same key and value already in its old text: carried through, not set.
    if (!collapse(rewriteText(s.old, list, seq)!).includes(kv)) sets = true
  }
  return sets ? 'sets' : 'passes'
}

/**
 * The event that left the final value of an opaque change, or undefined when it cannot be told. For a settle or a
 * file write it is the call's own event when the transcript has one.
 */
export function lastWriter(c: ElementChange, events: TranscriptEvent[], list: Push[]): number | undefined {
  const o = c.opaque
  if (!o || o.since < 0) return undefined
  const window = [...new Set([o.since, ...(o.alsoCovered ?? []), ...(o.alsoWritten ?? [])])].sort((a, b) => b - a)
  const callOf = (e: TranscriptEvent) => events.find((x) => x.kind === 'tool_call' && x.callId === e.callId)?.seq ?? e.seq
  for (const seq of window) {
    const e = events[seq]
    if (!e) return undefined
    if (e.kind === 'server_write') {
      const r = serverWriteReading(e, c, events, list)
      if (r === 'writes') return callOf(e)
      if (r === 'stops') return undefined
      continue
    }
    if (e.kind === 'file_write' && typeof c.text === 'string') {
      // A write the harness reports as failed changed nothing.
      if (e.isError) continue
      const r = fileWriteReading(e.fileOp, e.seq, c.text, c.element, c.field, list)
      if (r === 'sets') return callOf(e)
      if (r === 'stops') return undefined
      continue
    }
    return undefined
  }
  return undefined
}
