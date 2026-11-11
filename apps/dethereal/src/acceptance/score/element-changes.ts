/**
 * Model changes keyed by element, not by JSON pointer.
 *
 * The replay attributes values by pointer, and a pointer into an array moves
 * when an element is inserted before it. The scorer asks "which event set this
 * element's zone", so every change to a model file is read again as fields of
 * elements: a boundary's or a component's own keys in `structure.json`, a
 * flow's or a data item's in their lists, an element's attributes in its
 * attribute file, and each element mapped as a crown jewel in `scope.json`.
 */
import path from 'node:path'
import { parseJson } from '../transcripts/json-diff.js'
import type { OpaqueChange } from '../transcripts/types.js'
import type { TextChange } from '../transcripts/replay.js'
import { isObject } from '../json.js'

export interface ElementChange {
  /** Project-relative model file */
  path: string
  element: string
  field: string
  before: unknown
  after: unknown
  /** The write that made the change; absent for an opaque change */
  event?: number
  actor?: string
  tool?: string
  opaque?: Pick<OpaqueChange, 'since' | 'resyncedAt' | 'alsoWritten' | 'alsoCovered'>
  /** For an opaque change: the file's text when the replay knew it again */
  text?: string
}

type Fields = Map<string, Record<string, unknown>>
const listOf = (v: unknown, key: string): unknown[] => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v[key]) ? v[key] : [])

/** Fields crown-jewel mapping gives an element in scope.json. */
export const CROWN_JEWEL_MAPPING = 'crown_jewel_elements'

/** The elements a model file describes, with their own fields. */
export function elementFields(rel: string, text: string | undefined): Fields {
  const out: Fields = new Map()
  if (text === undefined) return out
  const doc = parseJson(text)
  if (doc === undefined) return out
  const base = path.posix.basename(rel)
  if (base === 'structure.json') {
    const walk = (b: unknown, parentId: string | null) => {
      if (!isObject(b) || typeof b.id !== 'string') return
      const own: Record<string, unknown> = { parentId }
      for (const [k, v] of Object.entries(b)) if (k !== 'components' && k !== 'boundaries') own[k] = v
      out.set(b.id, own)
      for (const c of Array.isArray(b.components) ? b.components : []) {
        if (isObject(c) && typeof c.id === 'string') out.set(c.id, { ...c, boundaryId: b.id })
      }
      for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n, b.id)
    }
    if (isObject(doc)) walk(doc.defaultBoundary, null)
  } else if (base === 'dataflows.json' || base === 'data-items.json') {
    for (const e of listOf(doc, base === 'dataflows.json' ? 'dataFlows' : 'dataItems')) if (isObject(e) && typeof e.id === 'string') out.set(e.id, { ...e })
  } else if (/(^|\/)attributes\/[^/]+\/[^/]+\.json$/.test(rel)) {
    const id = isObject(doc) && typeof doc.elementId === 'string' ? doc.elementId : base.slice(0, -'.json'.length)
    const attrs = isObject(doc) && isObject(doc.attributes) ? doc.attributes : {}
    out.set(id, { ...attrs })
  } else if (base === 'scope.json' && isObject(doc) && isObject(doc[CROWN_JEWEL_MAPPING])) {
    for (const [name, ids] of Object.entries(doc[CROWN_JEWEL_MAPPING] as Record<string, unknown>)) {
      for (const id of Array.isArray(ids) ? ids : []) {
        if (typeof id !== 'string') continue
        const prev = out.get(id) ?? {}
        out.set(id, { [CROWN_JEWEL_MAPPING]: [...((prev[CROWN_JEWEL_MAPPING] as string[]) ?? []), name].sort() })
      }
    }
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The field changes one text change makes. */
export function elementChanges(c: TextChange): ElementChange[] {
  const before = elementFields(c.path, c.before)
  const after = elementFields(c.path, c.after)
  const out: ElementChange[] = []
  const meta = {
    ...(c.event !== undefined ? { event: c.event } : {}), ...(c.actor ? { actor: c.actor } : {}), ...(c.tool ? { tool: c.tool } : {}),
    ...(c.opaque ? { opaque: c.opaque, ...(c.after !== undefined ? { text: c.after } : {}) } : {}),
  }
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(id) ?? {}
    const a = after.get(id) ?? {}
    for (const field of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
      if (!same(b[field], a[field])) out.push({ path: c.path, element: id, field, before: b[field], after: a[field], ...meta })
    }
  }
  return out
}

/** The position of a change in the run: its write, or the event where an opaque change was seen. */
export const changeSeq = (c: ElementChange): number => c.event ?? c.opaque!.resyncedAt
