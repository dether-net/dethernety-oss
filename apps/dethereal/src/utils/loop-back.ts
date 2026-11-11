/**
 * The loop-back guard: once the operator chooses to loop back, Gate 3 is computed again only when every element the
 * loop-back listed has been touched or dropped.
 *
 * `model_state` action `loop_back` arms it: the record (`.dethereal/loop-back.json`) keeps the full loop-back list
 * of that moment, with the hash of each listed field's value (or, for an element that lists no field, of its
 * data-item links). An element is touched when it is gone from the model, when it is no longer on the loop-back list
 * (fixed or waived), or when one of its listed fields holds a value other than the armed one that is neither empty
 * nor a gate stand-in; for an element with no listed field, when its data-item links changed. An element the run
 * cannot fix is dropped, with a reason, and stays failing Gate 3: a drop is not a waiver.
 *
 * Reading never changes the record. A re-arm replaces a record with nothing left untouched; the REVIEWED transition
 * removes it. A backward transition keeps it as it is, nothing re-hashed: an element it removed from the model counts
 * as touched, every other one stays armed with its armed hashes. An unreadable record is removed by a re-arm or by
 * `drop_remaining`, so every way the guard holds has a way out, and nothing ever arms it but the action.
 */
import type { Criterion, LoopbackElement, LoopbackKind, LoopbackView } from './gates.js'
import { replyProblem } from './settlement.js'
import { StateFileError, deleteDetherealFile, readRepoJson, updateDetherealJson } from './state-store.js'

export const LOOP_BACK_FILE = 'loop-back.json'
const REL = `.dethereal/${LOOP_BACK_FILE}`
export const LOOP_BACK_LIMITS = { drop: 50, reason: 500, untouchedShown: 100, named: 20, elements: 20000 } as const

const KINDS: readonly LoopbackKind[] = ['component', 'boundary', 'flow', 'data_item', 'model']
const HASH = /^[0-9a-f]{64}$/

export interface ArmedElement extends LoopbackElement {
  /** Each listed field's value hash at the arm; null when it was empty */
  values: Record<string, string | null>
  /** The data-item links' hash at the arm, for an element that lists no field */
  links: string | null
  dropped?: { reason: string; at: string }
}
export interface LoopBackRecord { version: 1; armed_at: string; elements: ArmedElement[] }
export type RecordRead = { state: 'none' } | { state: 'armed'; record: LoopBackRecord } | { state: 'unreadable' }

export type Outcome = 'untouched' | 'changed' | 'removed' | 'not_listed' | 'waived' | 'dropped'
export interface ElementOutcome extends LoopbackElement { status: Outcome; changed?: string[]; reason?: string }

/** The record, checked field by field: anything off is unreadable, never half-read. */
export function parseRecord(doc: unknown): LoopBackRecord | null {
  const d = doc as Record<string, unknown> | null
  if (!d || d.version !== 1 || typeof d.armed_at !== 'string' || !Array.isArray(d.elements) || d.elements.length > LOOP_BACK_LIMITS.elements) return null
  const out: ArmedElement[] = []
  for (const raw of d.elements as unknown[]) {
    const e = raw as Record<string, unknown> | null
    if (!e || typeof e.element_id !== 'string' || !e.element_id || e.element_id.length > 256) return null
    if (!KINDS.includes(e.kind as LoopbackKind)) return null
    if (!Array.isArray(e.criteria) || !e.criteria.every((c) => typeof c === 'string' && /^C[1-9]$/.test(c))) return null
    if (!Array.isArray(e.fields) || e.fields.length > 64 || !e.fields.every((f) => typeof f === 'string' && f.length > 0 && f.length <= 128)) return null
    const values = e.values as Record<string, unknown> | null
    if (!values || typeof values !== 'object' || Array.isArray(values)) return null
    if (Object.keys(values).sort().join('\n') !== [...(e.fields as string[])].sort().join('\n')) return null
    if (!Object.values(values).every((v) => v === null || (typeof v === 'string' && HASH.test(v)))) return null
    if (!(e.links === null || (typeof e.links === 'string' && HASH.test(e.links)))) return null
    if (e.name !== undefined && (typeof e.name !== 'string' || e.name.length > 1024)) return null
    const dropped = e.dropped as Record<string, unknown> | undefined
    if (dropped !== undefined && (!dropped || typeof dropped.at !== 'string' || typeof dropped.reason !== 'string' || reasonProblem(dropped.reason))) return null
    out.push({
      element_id: e.element_id, ...(typeof e.name === 'string' ? { name: e.name } : {}), kind: e.kind as LoopbackKind,
      criteria: e.criteria as Criterion[], fields: e.fields as string[], values: values as Record<string, string | null>, links: e.links as string | null,
      ...(dropped ? { dropped: { reason: dropped.reason as string, at: dropped.at as string } } : {}),
    })
  }
  return { version: 1, armed_at: d.armed_at, elements: out }
}

/** The record on disk: none, armed, or unreadable (corrupt, too large, a link, not a file). */
export async function readLoopBack(dir: string): Promise<RecordRead> {
  let doc: Record<string, unknown> | null
  try {
    doc = await readRepoJson(dir, REL)
  } catch (err) {
    if (err instanceof StateFileError) return { state: 'unreadable' }
    throw err
  }
  if (doc === null) return { state: 'none' }
  const record = parseRecord(doc)
  if (!record) return { state: 'unreadable' }
  return record.elements.length ? { state: 'armed', record } : { state: 'none' }
}

/** A reason is the run's own words for the operator: 1–500 visible characters, newlines allowed. */
export function reasonProblem(reason: string): string | null {
  const t = reason.trim()
  if (!t || t.length > LOOP_BACK_LIMITS.reason || replyProblem(t)) return 'reason_invalid'
  return null
}

/** What became of each armed element, read against the gates computed now. */
export function evaluate(record: LoopBackRecord, view: LoopbackView): ElementOutcome[] {
  const listed = new Set(view.elements.map((e) => e.element_id))
  return record.elements.map((e): ElementOutcome => {
    const base: LoopbackElement = { element_id: e.element_id, ...(e.name ? { name: e.name } : {}), kind: e.kind, criteria: e.criteria, fields: e.fields }
    if (e.dropped) return { ...base, status: 'dropped', reason: e.dropped.reason }
    if (!view.exists(e.element_id)) return { ...base, status: 'removed' }
    if (!listed.has(e.element_id)) return { ...base, status: view.waived(e.element_id, e.criteria) ? 'waived' : 'not_listed' }
    const changed = e.fields.length
      ? e.fields.filter((f) => {
          const now = view.field(e.kind, e.element_id, f)
          return now.hash !== null && !now.standIn && now.hash !== e.values[f]
        })
      : view.links(e.kind, e.element_id) !== e.links ? ['data item links'] : []
    return changed.length ? { ...base, status: 'changed', changed } : { ...base, status: 'untouched' }
  })
}

const TOUCHED: readonly Outcome[] = ['changed', 'removed', 'not_listed', 'waived']

/** The counts a gates report carries, and the elements still untouched (the enricher's worklist). */
export function tally(outcomes: ElementOutcome[]): { untouched: LoopbackElement[]; untouched_total: number; touched_total: number; dropped_total: number } {
  const untouched = outcomes.filter((o) => o.status === 'untouched')
  return {
    untouched: untouched.slice(0, LOOP_BACK_LIMITS.untouchedShown).map(({ status: _s, changed: _c, reason: _r, ...e }) => e),
    untouched_total: untouched.length,
    touched_total: outcomes.filter((o) => TOUCHED.includes(o.status)).length,
    dropped_total: outcomes.filter((o) => o.status === 'dropped').length,
  }
}

/** How the round went, once nothing is left untouched: each element and how it left the list. */
export function roundOf(outcomes: ElementOutcome[]): { elements: ElementOutcome[]; nothing_changed: boolean } {
  return { elements: outcomes, nothing_changed: !outcomes.some((o) => TOUCHED.includes(o.status)) }
}

const named = (e: LoopbackElement) => `${e.kind} ${e.name ?? e.element_id} (${e.element_id}): ${e.criteria.join(', ')}${e.fields.length ? ` — ${e.fields.join(', ')}` : ''}`

/** The text a gates report carries in place of Gate 3 while elements are untouched. */
export function untouchedMessage(untouched: LoopbackElement[], total: number): string {
  const shown = untouched.slice(0, LOOP_BACK_LIMITS.named).map(named).join('; ')
  const more = total > LOOP_BACK_LIMITS.named ? ` (+${total - LOOP_BACK_LIMITS.named} more)` : ''
  return `Gate 3 is not computed yet: ${total} loop-back element(s) are untouched since the loop-back started: ${shown}${more}. ` +
    'For each one, fix its listed fields from the source or the operator\'s answers, or drop it with model_state action \'loop_back\' ' +
    'and drop: [{ element_id, reason }] (drop_remaining: { reason } for all of them), saying why it cannot be fixed now. ' +
    'A value of \'unknown\' does not count as fixed. Gates 1 and 2 are computed; Gate 3 is not.'
}

export const UNREADABLE_MESSAGE =
  'The loop-back record (.dethereal/loop-back.json) cannot be read: arm again with model_state action \'loop_back\', ' +
  'or end the loop with drop_remaining: { reason }. Gates 1 and 2 are computed; Gate 3 is not.'

/** The record an arm writes: the full list now, each element with its fields' value hashes or its links' hash. */
export function armedRecord(view: LoopbackView, now: Date = new Date()): LoopBackRecord {
  return {
    version: 1,
    armed_at: now.toISOString(),
    elements: view.elements.map((e) => ({
      ...e,
      values: Object.fromEntries(e.fields.map((f) => [f, view.field(e.kind, e.element_id, f).hash])),
      links: e.fields.length ? null : view.links(e.kind, e.element_id),
    })),
  }
}

export async function writeLoopBack(dir: string, record: LoopBackRecord): Promise<void> {
  await updateDetherealJson(dir, LOOP_BACK_FILE, () => record as unknown as Record<string, unknown>, { createIfMissing: true })
}

/** Remove the record (a link or an unreadable file included); false when there was none. */
export async function clearLoopBack(dir: string): Promise<boolean> {
  return deleteDetherealFile(dir, LOOP_BACK_FILE)
}
