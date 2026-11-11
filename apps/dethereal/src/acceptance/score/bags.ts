/**
 * A run's attribute bags under the key's element ids.
 *
 * Several run elements can match one key element; each assertion must then
 * hold on all of them, so every combination is a variant, and a check takes
 * the worst variant. A merged data item that stands for several key items
 * (the key's `data_item_merges`) is read for each of them.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ExpectedKey } from '../key.js'
import type { Matching } from './match.js'

type Bag = Record<string, unknown>

/** Attribute bags of a model directory, by element id; an unreadable file is left out (Gate 2 reports it). */
export function readBags(modelDir: string): Map<string, Bag> {
  const out = new Map<string, Bag>()
  for (const group of ['components', 'dataFlows', 'dataItems', 'boundaries']) {
    const dir = path.join(modelDir, 'attributes', group)
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { elementId?: unknown; attributes?: unknown } | null
        if (doc && typeof doc.elementId === 'string') out.set(doc.elementId, doc.attributes && typeof doc.attributes === 'object' ? (doc.attributes as Bag) : {})
      } catch {
        // unreadable: not scored here
      }
    }
  }
  return out
}

/** Most combinations enumerated; past it, the first run element per key id is used and `truncated` is set. */
export const MAX_VARIANTS = 256

export function keyedBagVariants(bags: Map<string, Bag>, matching: Matching, key: ExpectedKey): { variants: Array<Map<string, Bag>>; truncated: boolean } {
  const byKey = new Map<string, Bag[]>()
  const add = (keyId: string, bag: Bag) => byKey.set(keyId, [...(byKey.get(keyId) ?? []), bag])
  for (const [runId, bag] of bags) {
    const keyId = matching.components.get(runId) ?? matching.flows.get(runId)?.keyId ?? matching.dataItems.get(runId)
    if (keyId && !(matching.flows.get(runId)?.reversed)) add(keyId, bag)
  }
  const merges = (key.data_item_merges as Array<{ ids: string[] }> | undefined) ?? []
  for (const m of merges) {
    const present = m.ids.filter((id) => byKey.has(id))
    if (present.length === 1) for (const id of m.ids) if (!byKey.has(id)) byKey.set(id, byKey.get(present[0]!)!)
  }
  const entries = [...byKey.entries()]
  const count = entries.reduce((n, [, list]) => n * list.length, 1)
  if (count > MAX_VARIANTS) return { variants: [new Map(entries.map(([id, list]) => [id, list[0]!]))], truncated: true }
  let variants: Array<Map<string, Bag>> = [new Map()]
  for (const [id, list] of entries) variants = variants.flatMap((v) => list.map((bag) => new Map([...v, [id, bag]])))
  return { variants, truncated: false }
}
