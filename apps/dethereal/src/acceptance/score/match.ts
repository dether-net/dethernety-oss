/**
 * Matching a run's model elements to the answer key's ids.
 *
 * Components match by alias: the key alias found, as whole words, in the run
 * element's name or id (with `-` and `_` read as spaces), longest alias first.
 * A component standing for the orders API's admin listener alone takes the
 * key's reserved admin id. An alias match whose class the key does not allow
 * gives way to one whose class it does. When no match of a key component has an
 * allowed class, its matches (wrongly classed or unclassified) are weighed
 * against each other and one keeps the component's identity: the right kind of
 * element, taking part in at least one of the component's key flows (when it
 * has any) and in the most of them, with the fewest name words no alias
 * covers, then the longest alias; a tie keeps none. A flow counts drawn
 * directly, never through a load balancer.
 * A lone unclassified match stays. The class is scored apart from identity.
 * Dropped matches are listed in `classFiltered`, kept ones in `classKept`. Data
 * items are not filtered: their class is scored with them.
 * Boundaries match by the key components they hold;
 * flows by their matched endpoints and direction (a reversed flow is a miss);
 * data items by alias, then class, then the flows they are linked to. Names
 * that hit a decoy alias are decoys, never matches. Every pairing is reported,
 * so a hand review can check it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { mentions, type ExpectedKey } from '../key.js'

export interface RunComponent { id: string; name: string; type?: string; classId?: string; boundaryId: string; crownJewel?: unknown }
export interface RunBoundary { id: string; name: string; parentId: string | null; zone?: unknown; planes?: unknown; conduits?: unknown; classId?: string; componentIds: string[] }
export interface RunFlow { id: string; name: string; description?: string; source: string; target: string; classId?: string; dataItemIds: string[] }
export interface RunDataItem { id: string; name: string; classId?: string; className?: string; sensitivity?: unknown; flags?: unknown; origin?: unknown; isCredential?: unknown }
export interface RunModel { components: RunComponent[]; boundaries: RunBoundary[]; flows: RunFlow[]; dataItems: RunDataItem[] }

type Json = Record<string, any>
const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    // missing or unreadable: Gate 2 reports it; the model reads as empty here
    return undefined
  }
}

/** Model elements from the parsed split files (`structure.json`, `dataflows.json`, `data-items.json`); a missing file reads as empty. */
export function modelFromDocs(structure: unknown, dataflows: unknown, dataItems: unknown): RunModel {
  const out: RunModel = { components: [], boundaries: [], flows: [], dataItems: [] }
  const list = (v: unknown, key: string): Json[] => (Array.isArray(v) ? v : Array.isArray((v as Json | undefined)?.[key]) ? (v as Json)[key] : []) as Json[]
  const walk = (b: Json, parentId: string | null) => {
    out.boundaries.push({
      id: String(b.id), name: String(b.name ?? ''), parentId, zone: b.zone, planes: b.planes, conduits: b.conduits, classId: b.classData?.id,
      componentIds: (b.components ?? []).map((c: Json) => String(c.id)),
    })
    for (const c of b.components ?? []) out.components.push({ id: String(c.id), name: String(c.name ?? ''), type: c.type, classId: c.classData?.id, boundaryId: String(b.id), crownJewel: c.crownJewel })
    for (const n of b.boundaries ?? []) walk(n, String(b.id))
  }
  const root = (structure as Json | undefined)?.defaultBoundary
  if (root && typeof root === 'object') walk(root, null)
  for (const f of list(dataflows, 'dataFlows')) {
    out.flows.push({ id: String(f.id), name: String(f.name ?? ''), ...(typeof f.description === 'string' ? { description: f.description } : {}), source: String(f.source?.id ?? f.sourceId ?? ''), target: String(f.target?.id ?? f.targetId ?? ''), classId: f.classData?.id, dataItemIds: (f.dataItemIds ?? []).map(String) })
  }
  for (const d of list(dataItems, 'dataItems')) {
    out.dataItems.push({
      id: String(d.id), name: String(d.name ?? ''), classId: d.classData?.id, ...(typeof d.classData?.name === 'string' ? { className: d.classData.name } : {}),
      sensitivity: d.sensitivity, flags: d.regulatory_flags, origin: d.origin, isCredential: d.is_credential,
    })
  }
  return out
}

/** A run's model elements, from its model directory. */
export function readRunModel(modelDir: string): RunModel {
  return modelFromDocs(readJson(path.join(modelDir, 'structure.json')), readJson(path.join(modelDir, 'dataflows.json')), readJson(path.join(modelDir, 'data-items.json')))
}

export const ADMIN_LISTENER_ID = 'c-orders-api-admin'

export interface Matching {
  /** run component id → key component id (or the reserved admin id) */
  components: Map<string, string>
  boundaries: Map<string, string>
  /** run flow id → key flow id; `reversed` flows are misses */
  flows: Map<string, { keyId: string; reversed: boolean }>
  /** run data item id → key data item id */
  dataItems: Map<string, string>
  decoys: Array<{ kind: 'component' | 'flow' | 'data item'; runId: string; name: string }>
  unmatched: Array<{ kind: 'component' | 'boundary' | 'flow' | 'data item'; runId: string; name: string }>
  /** Component matches dropped for their class, with the key id they named; `sole` when the key element is left with no match */
  classFiltered: Array<{ runId: string; name: string; keyId: string; classId?: string; sole: boolean }>
  /** Matches kept for a key component none of whose matches has an allowed class, with what decided it and who lost */
  classKept: Array<{ runId: string; name: string; keyId: string; classId?: string; evidence: { role: number; uncovered: number; alias: number }; rejected: string[] }>
}

const text = (id: string, name: string) => [name, id.replace(/[-_]+/g, ' ')]
const hitAlias = (candidates: string[], aliases: string[]): string | null => {
  for (const a of [...aliases].sort((x, y) => y.length - x.length)) if (candidates.some((c) => mentions(c.replace(/[-_]+/g, ' '), a.replace(/[-_]+/g, ' ')))) return a
  return null
}
const isDecoy = (candidates: string[], key: ExpectedKey) => key.decoys.some((d) => hitAlias(candidates, d.aliases) !== null)

/** The key id for flow matching: the admin listener is part of the orders API there. */
export const flowEndpoint = (keyId: string | undefined) => (keyId === ADMIN_LISTENER_ID ? 'c-orders-api' : keyId)

/** Whether an element's class is one the key allows for a key element: its classes or their alternates; a key element with none constrains nothing. */
export function classAllowed(classId: string | undefined, k: { class_ids?: string[] } | undefined): boolean {
  const allowed = [...(k?.class_ids ?? []), ...(((k as { class_alternates?: string[] } | undefined)?.class_alternates) ?? [])]
  return !allowed.length || (!!classId && allowed.includes(classId))
}

type KeyComponent = ExpectedKey['components'][number]

/** Whether a run component is of the kind a key component allows: by class (never a pass-through class), else by type. */
function allowedKind(c: RunComponent, k: KeyComponent | undefined, key: ExpectedKey): boolean {
  if (!k) return true
  if (c.classId) return !key.pass_through?.classes.some((p) => p.id === c.classId) && classAllowed(c.classId, k)
  return !!c.type && c.type === k.type
}

/** Words of a name or id, lower case. */
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Filter the alias matches of each key component by class. A match of a class the key does not allow gives way to one
 * it allows. With none allowed, the matches weigh against each other (see the header) and one keeps the identity; a
 * lone unclassified match stays without a contest.
 */
function filterByClass(run: RunModel, matched: Map<string, string>, key: ExpectedKey, aliasLen: Map<string, number>, m: Matching): void {
  const byKey = new Map<string, RunComponent[]>()
  for (const c of run.components) {
    const keyId = matched.get(c.id)
    if (keyId !== undefined) byKey.set(keyId, [...(byKey.get(keyId) ?? []), c])
  }
  const drop = (c: RunComponent, keyId: string, sole: boolean) => {
    matched.delete(c.id)
    m.classFiltered.push({ runId: c.id, name: c.name, keyId, ...(c.classId ? { classId: c.classId } : {}), sole })
  }
  const contests: Array<[string, KeyComponent, RunComponent[]]> = []
  for (const [keyId, list] of byKey) {
    const k = key.components.find((x) => x.id === keyId)
    if (!k) continue
    if (list.some((c) => classAllowed(c.classId, k))) {
      for (const c of list.filter((c) => !classAllowed(c.classId, k))) drop(c, keyId, false)
      continue
    }
    if (list.length === 1 && !list[0]!.classId) continue
    contests.push([keyId, k, list])
  }
  // The other ends of each candidate's flows: the matches left once duplicates beside an allowed class are dropped.
  // Every contest reads the same ends, candidates of the other contests included, so the order of the contests never matters.
  const peers = new Map(matched)
  for (const [keyId, k, list] of contests) {
    const winner = contest(list, k, run, peers, aliasLen, key)
    for (const c of list) if (c !== winner?.c) drop(c, keyId, !winner)
    if (winner) {
      m.classKept.push({
        runId: winner.c.id, name: winner.c.name, keyId, ...(winner.c.classId ? { classId: winner.c.classId } : {}),
        evidence: winner.evidence, rejected: list.filter((c) => c !== winner.c).map((c) => c.id),
      })
    }
  }
}

/** The match that keeps a key component's identity when none has an allowed class; null on a tie or when none qualifies. */
function contest(list: RunComponent[], k: KeyComponent, run: RunModel, peers: Map<string, string>, aliasLen: Map<string, number>, key: ExpectedKey):
  { c: RunComponent; evidence: { role: number; uncovered: number; alias: number } } | null {
  const kFlows = key.flows.filter((f) => f.source === k.id || f.target === k.id)
  const role = (c: RunComponent) => kFlows.filter((f) => run.flows.some((r) =>
    f.source === k.id ? r.source === c.id && flowEndpoint(peers.get(r.target)) === f.target : r.target === c.id && flowEndpoint(peers.get(r.source)) === f.source)).length
  const covered = new Set(k.aliases.flatMap(words))
  const uncovered = (c: RunComponent) => Math.min(...[c.name, c.id].map((t) => words(t).filter((w) => !covered.has(w)).length))
  const kindOk = (c: RunComponent) => (k.external ? c.type === 'EXTERNAL_ENTITY' : c.type !== 'EXTERNAL_ENTITY' && (!k.type || c.type === k.type))
  const ranked = list.filter(kindOk).map((c) => ({ c, evidence: { role: role(c), uncovered: uncovered(c), alias: aliasLen.get(c.id) ?? 0 } }))
    .filter((x) => x.evidence.role > 0 || !kFlows.length)
    .sort((a, b) => b.evidence.role - a.evidence.role || a.evidence.uncovered - b.evidence.uncovered || b.evidence.alias - a.evidence.alias)
  const [first, second] = ranked
  if (!first) return null
  if (second && second.evidence.role === first.evidence.role && second.evidence.uncovered === first.evidence.uncovered && second.evidence.alias === first.evidence.alias) return null
  return first
}

/**
 * `byClass: false` keeps every alias match: the hard gates judge what a run did to an element whatever
 * class it gave it, so a misclassified element never escapes them. The scored items filter by class.
 */
export function matchModel(run: RunModel, key: ExpectedKey, options: { byClass?: boolean } = {}): Matching {
  const m: Matching = { components: new Map(), boundaries: new Map(), flows: new Map(), dataItems: new Map(), decoys: [], unmatched: [], classFiltered: [], classKept: [] }
  const aliasLen = new Map<string, number>()
  for (const c of run.components) {
    const cand = text(c.id, c.name)
    if (isDecoy(cand, key)) {
      m.decoys.push({ kind: 'component', runId: c.id, name: c.name })
      continue
    }
    let best: { id: string; alias: string } | null = null
    for (const k of key.components) {
      const a = hitAlias(cand, k.aliases)
      if (a && (!best || a.length > best.alias.length || (a.length === best.alias.length && c.classId && k.class_ids.includes(c.classId)))) best = { id: k.id, alias: a }
    }
    if (best?.id === 'c-orders-api' && cand.some((t) => mentions(t.replace(/[-_]+/g, ' '), 'admin'))) best = { id: ADMIN_LISTENER_ID, alias: best.alias }
    // A load balancer named after what it fronts ("frontend-external") names the pass-through better than the key
    // component: a longer pass-through alias leaves it unmatched, so it can stand as the bridge. Only when it is not
    // the kind the key component allows: a pass-through class or a class the key component does not allow; when
    // unclassified, a type other than the key component's.
    const fronting = key.pass_through ? hitAlias(cand, key.pass_through.aliases) : null
    if (best && fronting && fronting.length > best.alias.length && !allowedKind(c, key.components.find((k) => k.id === best!.id), key)) best = null
    if (best) {
      m.components.set(c.id, best.id)
      aliasLen.set(c.id, best.alias.length)
    } else m.unmatched.push({ kind: 'component', runId: c.id, name: c.name })
  }
  // The reserved admin id has no key entry: it constrains no class.
  if (options.byClass !== false) filterByClass(run, m.components, key, aliasLen, m)
  for (const b of run.boundaries) {
    const counts = new Map<string, number>()
    for (const kb of key.boundaries) {
      const n = b.componentIds.filter((id) => kb.members.includes(flowEndpoint(m.components.get(id)) ?? '')).length
      if (n) counts.set(kb.id, n)
    }
    const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1])
    if (ranked.length && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1])) m.boundaries.set(b.id, ranked[0]![0])
    else if (b.parentId !== null) m.unmatched.push({ kind: 'boundary', runId: b.id, name: b.name })
  }
  for (const f of run.flows) {
    if (isDecoy(text(f.id, f.name), key)) {
      m.decoys.push({ kind: 'flow', runId: f.id, name: f.name })
      continue
    }
    const s = flowEndpoint(m.components.get(f.source))
    const t = flowEndpoint(m.components.get(f.target))
    const same = key.flows.filter((k) => k.source === s && k.target === t)
    const rev = key.flows.filter((k) => k.source === t && k.target === s)
    const pick = (list: typeof key.flows) => list.find((k) => f.classId && k.class_ids.includes(f.classId)) ?? list[0]
    if (same.length) m.flows.set(f.id, { keyId: pick(same)!.id, reversed: false })
    else if (rev.length) m.flows.set(f.id, { keyId: pick(rev)!.id, reversed: true })
    else m.unmatched.push({ kind: 'flow', runId: f.id, name: f.name })
  }
  const keyItems = ((key as unknown as { data_items?: Array<{ id: string; aliases: string[]; class_ids: string[]; linked_flows?: string[] }> }).data_items) ?? []
  for (const d of run.dataItems) {
    const cand = text(d.id, d.name)
    if (isDecoy(cand, key)) {
      m.decoys.push({ kind: 'data item', runId: d.id, name: d.name })
      continue
    }
    const linked = new Set(run.flows.filter((f) => f.dataItemIds.includes(d.id)).map((f) => m.flows.get(f.id)?.keyId).filter(Boolean) as string[])
    const shared = (k: { linked_flows?: string[] }) => (k.linked_flows ?? []).filter((x) => linked.has(x)).length
    const byAlias = keyItems.filter((k) => hitAlias(cand, k.aliases))
    const byClass = keyItems.filter((k) => d.classId && k.class_ids.includes(d.classId))
    const byFlows = keyItems.filter((k) => shared(k) > 0)
    const aliasLen = (k: { aliases: string[] }) => hitAlias(cand, k.aliases)?.length ?? 0
    const tier = byAlias.length ? byAlias : byClass.length ? byClass : byFlows
    const ranked = [...tier].sort((x, y) => (tier === byAlias ? aliasLen(y) - aliasLen(x) : 0) || shared(y) - shared(x))
    const tied = ranked.length > 1 && (tier !== byAlias || aliasLen(ranked[0]!) === aliasLen(ranked[1]!)) && shared(ranked[0]!) === shared(ranked[1]!)
    if (ranked.length && !tied) m.dataItems.set(d.id, ranked[0]!.id)
    else m.unmatched.push({ kind: 'data item', runId: d.id, name: d.name })
  }
  return m
}
