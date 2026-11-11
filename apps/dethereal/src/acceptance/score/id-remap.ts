/**
 * Element ids across a push.
 *
 * A push (`import_model`, `update_model`, `create_threat_model`) writes the
 * platform's ids back into the model files, and renames attribute files after
 * them. A change made before the push names the element by its old id, so it
 * would never meet the final model. Each push's id map is read from the model
 * files as the replay knew them just before it and as they were seen after it:
 * the push rewrites ids in place, so elements pair up by position, and a pair
 * counts only when name and kind agree (an element added or removed unseen at the
 * same moment leaves the other positions paired). Every text is then rewritten into the
 * final ids: each id is carried through the maps of the pushes after the text.
 */
import path from 'node:path'
import { parseJson } from '../transcripts/json-diff.js'
import type { TextChange } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { isObject } from '../json.js'

export const PUSH_TOOLS = new Set(['dethereal.import_model', 'dethereal.update_model', 'dethereal.create_threat_model'])

type Json = Record<string, any>
const listOf = (v: unknown, key: string): Json[] => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v[key]) ? v[key] : []).filter(isObject)

/** Elements of a model file in document order: [id, name, kind]. */
function elementsOf(rel: string, text: string | undefined): Array<[string, string, string]> {
  const doc = text === undefined ? undefined : parseJson(text)
  if (doc === undefined) return []
  const base = path.posix.basename(rel)
  const out: Array<[string, string, string]> = []
  if (base === 'structure.json') {
    const walk = (b: unknown) => {
      if (!isObject(b)) return
      if (typeof b.id === 'string') out.push([b.id, String(b.name ?? ''), 'boundary'])
      for (const c of Array.isArray(b.components) ? b.components : []) if (isObject(c) && typeof c.id === 'string') out.push([c.id, String(c.name ?? ''), 'component'])
      for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n)
    }
    if (isObject(doc)) walk(doc.defaultBoundary)
  } else if (base === 'dataflows.json') {
    for (const f of listOf(doc, 'dataFlows')) if (typeof f.id === 'string') out.push([f.id, String(f.name ?? ''), 'flow'])
  } else if (base === 'data-items.json') {
    for (const d of listOf(doc, 'dataItems')) if (typeof d.id === 'string') out.push([d.id, String(d.name ?? ''), 'item'])
  }
  return out
}

export interface Push {
  /** The server write that pushed */
  seq: number
  map: Map<string, string>
}

const isPush = (e: TranscriptEvent | undefined) => !!e && e.kind === 'server_write' && PUSH_TOOLS.has(e.tool ?? '')

/**
 * The push behind a change the replay could not see: the event its window opened at when that is a push, else
 * the one push among the later writers that also covered the file (a window an earlier write opened). Two or more
 * of those, and none at the opening, leave it unknown.
 */
function pushOf(events: TranscriptEvent[], c: TextChange): number | undefined {
  const o = c.opaque
  if (!o || o.since < 0) return undefined
  if (isPush(events[o.since])) return o.since
  const covered = (o.alsoCovered ?? []).filter((i) => isPush(events[i]))
  return covered.length === 1 ? covered[0] : undefined
}

/** The pushes of a run, in order, each with the ids it replaced. */
export function pushes(events: TranscriptEvent[], changes: TextChange[]): Push[] {
  const bySeq = new Map<number, Map<string, string>>()
  for (const c of changes) {
    const since = pushOf(events, c)
    if (since === undefined) continue
    const before = elementsOf(c.path, c.before)
    const after = elementsOf(c.path, c.after)
    if (!before.length || !after.length) continue
    const map = bySeq.get(since) ?? new Map<string, string>()
    // Positions pair only while name and kind agree: an element added or removed unseen at the same time
    // leaves the others paired.
    before.forEach(([id, name, kind], i) => {
      const hit = after[i]
      if (hit && id !== hit[0] && name === hit[1] && kind === hit[2]) map.set(id, hit[0])
    })
    bySeq.set(since, map)
  }
  return [...bySeq].filter(([, m]) => m.size).sort(([a], [b]) => a - b).map(([seq, map]) => ({ seq, map }))
}

/** The ids a push introduced, as the final model names them, each with the event of the first push that wrote it. */
export function introducedBy(list: Push[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of list) for (const id of p.map.values()) {
    const final = finalId(id, list, p.seq + 1)
    if (!out.has(final)) out.set(final, p.seq)
  }
  return out
}

/** An id as the final model names it, from a text of the run at `seq` (maps of pushes at or after `from` apply). */
export function finalId(id: string, list: Push[], from: number): string {
  let out = id
  for (const p of list) if (p.seq >= from) out = p.map.get(out) ?? out
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A text with its ids carried into the final model's. */
export function rewriteText(text: string | undefined, list: Push[], from: number): string | undefined {
  if (text === undefined) return undefined
  const ids = new Set(list.filter((p) => p.seq >= from).flatMap((p) => [...p.map.keys()]))
  if (!ids.size) return text
  return text.replace(new RegExp(`"(${[...ids].map(escapeRe).join('|')})"`, 'g'), (_, id: string) => JSON.stringify(finalId(id, list, from)))
}

function rewritePath(rel: string, list: Push[], from: number): string {
  const m = /^(.*attributes\/[^/]+\/)([^/]+)\.json$/.exec(rel)
  return m ? `${m[1]}${finalId(m[2]!, list, from)}.json` : rel
}

/**
 * Every change with its texts and path in the final model's ids. A push's own
 * change keeps only what it did besides replacing ids.
 */
export function remapChanges(events: TranscriptEvent[], changes: TextChange[]): TextChange[] {
  const list = pushes(events, changes)
  if (!list.length) return changes
  return changes.map((c) => {
    // A text written at an event is in the ids of the pushes before it. An opaque change's "before" is as of the
    // event its window opened at; its "after" is as of the window's end, so a push inside the window has already
    // renamed it (carried through that push's map again, an id it replaced no longer occurs).
    const at = c.event ?? c.opaque!.since
    const beforeFrom = c.opaque ? Math.max(c.opaque.since, 0) : at + 1
    const afterFrom = c.opaque ? c.opaque.since + 1 : at + 1
    return {
      ...c,
      path: rewritePath(c.path, list, beforeFrom),
      before: rewriteText(c.before, list, beforeFrom),
      after: rewriteText(c.after, list, afterFrom),
    }
  })
}
