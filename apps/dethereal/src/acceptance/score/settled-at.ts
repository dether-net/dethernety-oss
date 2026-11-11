/**
 * Which settle wrote a change the replay could not see, read from the settle's own result echo.
 *
 * A settle's result echoes each decision with the value it registered and the value it replaced. A `set` or
 * `modify` of the change's value over a different (or absent) one is a write of it; an `accept` or `confirm` only
 * found the value on disk, and a value set over an equal one was written before, by whatever wrote it. Element ids,
 * and ids inside the echoed values (a conduit's peer, say), are carried through the pushes after the settle, so they
 * compare with the final model's.
 */
import { isObject } from '../json.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import type { ElementChange } from './element-changes.js'
import { finalId, rewriteText, type Push } from './id-remap.js'

const SETTLE = 'dethereal.model_state_settle'
/** It seeds null fields and keeps every value it finds: it never writes a value, though it may drop one it cannot read. */
const STUBS = 'dethereal.generate_attribute_stubs'

/** JSON with object keys in order, so two equal values compare equal. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))

type Echo = { kind: 'none' } | { kind: 'unreadable' } | { kind: 'entry'; entry: Record<string, unknown>; from: number }

/** The echo entry of this element and field in a settle's result, its ids carried from the call on. */
function echoOf(e: TranscriptEvent, c: ElementChange, events: TranscriptEvent[], list: Push[]): Echo {
  const result = events.find((x) => x.kind === 'tool_result' && x.callId === e.callId)
  let parsed: unknown
  try { parsed = JSON.parse(result?.text ?? '') } catch { return { kind: 'unreadable' } }
  if (!isObject(parsed) || !Array.isArray(parsed.echo)) return { kind: 'unreadable' }
  const from = (events.find((x) => x.kind === 'tool_call' && x.callId === e.callId)?.seq ?? e.seq) + 1
  const entry = parsed.echo.filter(isObject).find((x) => x.field === c.field && typeof x.element_id === 'string' && finalId(x.element_id, list, from) === c.element)
  return entry ? { kind: 'entry', entry, from } : { kind: 'none' }
}

/** A value as an echo shows it, carried into the final ids: `{ v }`, `absent`, or undefined when not shown. */
function shown(v: unknown, list: Push[], from: number): { v: unknown } | 'absent' | undefined {
  if (!isObject(v)) return undefined
  if (v.absent === true) return 'absent'
  if (!('value' in v)) return undefined
  return { v: JSON.parse(rewriteText(JSON.stringify(v.value), list, from)!) }
}

/** Whether an echo entry is a write of this value: a `set` or `modify` of it over a different or absent one. */
function writesIt(entry: Record<string, unknown>, after: string, list: Push[], from: number): boolean {
  if (entry.decision !== 'set' && entry.decision !== 'modify') return false
  const value = shown(entry.value, list, from)
  if (!value || value === 'absent' || canonical(value.v) !== after) return false
  const previous = shown(entry.previous, list, from)
  return previous === 'absent' || (previous !== undefined && canonical(previous.v) !== after)
}

/**
 * Whether a file write shows it left this field alone: an edit (or every edit of a multi-edit) whose lines naming
 * the field are the same before and after (a comma a following key added aside). A whole-file write, or an edit that cannot be read, may have changed it.
 */
function leavesField(e: TranscriptEvent, field: string, events: TranscriptEvent[]): boolean {
  const call = events.find((x) => x.kind === 'tool_call' && x.callId === e.callId)
  const input = isObject(call?.input) ? call!.input as Record<string, unknown> : undefined
  const edits = Array.isArray(input?.edits) ? input!.edits.filter(isObject) : input && 'old_string' in input ? [input] : []
  if (!edits.length) return false
  const key = JSON.stringify(field)
  const naming = (t: unknown) => (typeof t === 'string' ? t.split('\n').filter((l) => l.includes(key)).map((l) => l.trim().replace(/,$/, '')).sort().join('\n') : null)
  return edits.every((x) => naming(x.old_string) !== null && naming(x.old_string) === naming(x.new_string))
}

/** Whether an echo entry shows this value already there and left in place: registered as it was, or set over itself. */
function keepsIt(entry: Record<string, unknown>, after: string, list: Push[], from: number): boolean {
  const value = shown(entry.value, list, from)
  if (!value || value === 'absent' || canonical(value.v) !== after) return false
  if (entry.decision === 'confirm' || entry.decision === 'accept') return true
  const previous = shown(entry.previous, list, from)
  return (entry.decision === 'set' || entry.decision === 'modify') && previous !== undefined && previous !== 'absent' && canonical(previous.v) === after
}

const succeeded = (e: TranscriptEvent, events: TranscriptEvent[]) => {
  const result = events.find((x) => x.kind === 'tool_result' && x.callId === e.callId)
  return !!result && !result.isError
}

/**
 * How a server write in a window reads, looking back from the final value: `writes` it (a settle that set it),
 * `passes` it by (a failed call, the stubs tool, a settle that does not name the field or only found the value
 * there), or `stops` the reading back (another server tool's write, a settle it cannot read or of another value).
 */
export function serverWriteReading(e: TranscriptEvent, c: ElementChange, events: TranscriptEvent[], list: Push[]): 'writes' | 'passes' | 'stops' {
  if (!succeeded(e, events) || e.tool === STUBS) return 'passes'
  if (e.tool !== SETTLE) return 'stops'
  const echo = echoOf(e, c, events, list)
  if (echo.kind === 'unreadable') return 'stops'
  if (echo.kind === 'none') return 'passes'
  const after = canonical(c.after)
  if (writesIt(echo.entry, after, list, echo.from)) return 'writes'
  return keepsIt(echo.entry, after, list, echo.from) ? 'passes' : 'stops'
}

/**
 * The server write of the settle that wrote a change the replay could not see, or undefined when nothing shows it.
 *
 * `first` (when a value was written, as early as it can be told): the earliest settle among the window's server
 * writes that names the element and field decides. Anything before it that may have written the field leaves the
 * date at the window's opening: a successful write by another server tool, a settle whose echo cannot be read, and
 * the stubs tool only when a shell or a file write came before it in the window (it may have erased that write).
 *
 * `last` (which write left the final value): read back from the window's end, the last settle whose echo writes the
 * final value decides. A later settle that only found it there (a confirm, an accept, a set over it) is looked past,
 * and so is the stubs tool; a shell, a file write that may have changed the field, a settle it cannot read, a settle
 * of another value or another server tool's successful write after it leaves the change unexplained.
 */
export function settledAt(c: ElementChange, events: TranscriptEvent[], list: Push[], mode: 'first' | 'last' = 'first'): number | undefined {
  const o = c.opaque
  if (!o || o.since < 0) return undefined
  const after = canonical(c.after)
  const window = [...new Set([o.since, ...(o.alsoCovered ?? []), ...(mode === 'last' ? o.alsoWritten ?? [] : [])])].sort((a, b) => a - b)
  if (mode === 'last') window.reverse()
  for (const seq of window) {
    const e = events[seq]
    if (!e) continue
    if (e.kind !== 'server_write') {
      if (mode === 'last' && !(e.kind === 'file_write' && leavesField(e, c.field, events))) return undefined
      continue
    }
    if (!succeeded(e, events)) continue
    if (e.tool === STUBS) {
      const unseen = [o.since, ...(o.alsoCovered ?? []), ...(o.alsoWritten ?? [])].some((i) => i < seq && events[i] !== undefined && events[i]!.kind !== 'server_write')
      if (mode === 'first' && unseen) return undefined
      continue
    }
    if (e.tool !== SETTLE) return undefined
    const echo = echoOf(e, c, events, list)
    if (echo.kind === 'unreadable') return undefined
    if (echo.kind === 'none') continue
    if (writesIt(echo.entry, after, list, echo.from)) return seq
    // Looking back from the final value, a settle that only found it there (a confirm, an accept, a set over it)
    // did not write it: the write is earlier.
    if (mode === 'last' && keepsIt(echo.entry, after, list, echo.from)) continue
    return undefined
  }
  return undefined
}
