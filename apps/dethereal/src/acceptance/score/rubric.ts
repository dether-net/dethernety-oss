/**
 * The scored items: absolute thresholds, the same for every harness.
 *
 * A graded item passes when its hits reach `ceil(threshold × n)`; it is
 * marginal when it passes but would fail with one fewer hit. A binary item
 * must hold in full and is never marginal. Where several run elements match
 * one key element, a condition must hold on each of them (the worst variant
 * of the keyed attribute bags counts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { evaluateAssertions, holds, mentions, type Assertion, type ExpectedKey } from '../key.js'
import type { PlatformExport } from '../platform-export.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { credentialClassHint } from '../../data/credential-classes.js'
import { SENSITIVITY_SCALE } from '../../utils/lints.js'
import { keyedBagVariants } from './bags.js'
import { changeSeq, CROWN_JEWEL_MAPPING, type ElementChange } from './element-changes.js'
import { REVIEWER_ROLE, agentRuns } from './h6.js'
import { ADMIN_LISTENER_ID, classAllowed, flowEndpoint, matchModel, modelFromDocs, type Matching, type RunFlow, type RunModel } from './match.js'
import type { ShownPrompt } from './prompts.js'
import type { ReplyMatch } from './replies.js'
import type { ReplyLine } from './run-dir.js'
import { findBridges, shownBridge, type Bridge } from './bridges.js'

export interface RubricItem {
  id: string
  /** `n/a`: the fixture has nothing for the item to score; it is never a pass and the verdict leaves it out */
  kind: 'graded' | 'binary' | 'n/a'
  pass: boolean
  marginal: boolean
  /** Reported, never part of the verdict: an item not yet held to the bar */
  informational?: true
  /** Graded: hits over n, against the threshold */
  hits?: number
  n?: number
  threshold?: number
  value?: number
  detail: string
  /** Binary: the key elements that meet the item, of those it covers */
  tally?: { ok: number; n: number }
  /** Key ids or run ids behind the verdict */
  refs?: string[]
  /**
   * A quick run's reading of the item: covered (held to the bar), relative (compared with the baseline only) or
   * informational; a scoped item was scored on the priority subset, with the full key's reading beside it
   */
  quick?: { role: 'covered' | 'relative' | 'informational'; scoped?: true; fullKey?: { pass: boolean; tally?: { ok: number; n: number }; hits?: number; n?: number } }
}

/** Hits a graded item needs out of n. */
export const needed = (threshold: number, n: number) => Math.ceil(threshold * n - 1e-9)

export function graded(id: string, hits: number, n: number, threshold: number, detail: string, refs?: string[]): RubricItem {
  const need = needed(threshold, n)
  const pass = n > 0 && hits >= need
  return { id, kind: 'graded', pass, marginal: pass && hits - 1 < need, hits, n, threshold, value: n ? hits / n : 0, detail, ...(refs ? { refs } : {}) }
}

export function binary(id: string, pass: boolean, detail: string, refs?: string[], tally?: { ok: number; n: number }): RubricItem {
  return { id, kind: 'binary', pass, marginal: false, detail, ...(tally ? { tally } : {}), ...(refs?.length ? { refs } : {}) }
}

/** An item whose subject the fixture does not have (no decoy, no shared credential, no ratified channel …). */
export function notOnFixture(id: string, what: string): RubricItem {
  return { id, kind: 'n/a', pass: false, marginal: false, detail: `n/a (not on this fixture): the key lists no ${what}` }
}

export interface RubricInput {
  key: ExpectedKey
  run: RunModel
  matching: Matching
  /** Final attribute bags, by run element id */
  bags: Map<string, Record<string, unknown>>
  modelDir: string
  modelRel: string
  events: TranscriptEvent[]
  changes: ElementChange[]
  shown: ShownPrompt[]
  replies: ReplyLine[]
  pairs: ReplyMatch['pairs']
  /** Zoning findings of the final model, by run boundary id */
  zoning: Array<{ kind: string; boundaryId: string; peerId?: string }>
  runExport: PlatformExport | null
  keyExport: PlatformExport | null
  /** Final text of files the run wrote, by project path */
  written: Map<string, string>
  /** Load balancers drawn on a key flow: each bridge is a run flow in `run`, reported with its chain */
  bridges?: Bridge[]
}

const squash = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '')
/**
 * Text and phrase as the phrase checks (red flags, decoy names) read them: '_' and '-' as spaces,
 * markdown emphasis and code marks read as spaces, any run of whitespace one space.
 */
export const spaced = (s: string) => s.replace(/[*`_-]+/g, ' ').replace(/\s+/g, ' ')
const sensitivityRank = (v: unknown) => (typeof v === 'string' ? SENSITIVITY_SCALE.indexOf(v.trim().toLowerCase() as never) : -1)

export function rubric(input: RubricInput): RubricItem[] {
  const { key, run, matching, events } = input
  const items: RubricItem[] = []
  const { variants } = keyedBagVariants(input.bags, matching, key)
  const inAll = (f: (bags: Map<string, Record<string, unknown>>) => boolean) => variants.length > 0 && variants.every(f)
  const runOf = <T extends { id: string }>(list: T[], keyId: string, map: Map<string, string>) => list.filter((e) => map.get(e.id) === keyId)
  const compsOf = (keyId: string) => run.components.filter((c) => flowEndpoint(matching.components.get(c.id)) === keyId)
  const flowsOf = (keyId: string) => run.flows.filter((f) => matching.flows.get(f.id)?.keyId === keyId && !matching.flows.get(f.id)!.reversed)
  const itemsOf = (keyId: string) => runOf(run.dataItems, keyId, matching.dataItems)

  // Discovery credit under the leak rule.
  const dir = input.modelRel === '.' ? '' : `${input.modelRel}/`
  const firstWriteOf = (runId: string, file: string) => Math.min(...input.changes.filter((c) => c.element === runId && c.path === `${dir}${file}`).map(changeSeq), Infinity)
  // A bridge exists once both its hops do.
  const hopsOf = new Map((input.bridges ?? []).map((b) => [b.flow.id, b.hops]))
  const firstWrite = (runId: string, file: string) => (hopsOf.has(runId) ? Math.max(...hopsOf.get(runId)!.map((h) => firstWriteOf(h.id, file))) : firstWriteOf(runId, file))
  const leakSeq = (keyId: string) => {
    let seq = Infinity
    for (const leak of key.leaks.filter((l) => l.elements.includes(keyId))) {
      for (const p of input.pairs) {
        const r = input.replies[p.line - 1]
        // The key numbers variants from 0, the reply log from 1; a leak without a variant is the base reply.
        if (r?.prompt === leak.prompt && r.variant === (leak.variant === undefined ? undefined : leak.variant + 1)) seq = Math.min(seq, p.event)
      }
    }
    return seq
  }
  const leakCredited: string[] = []
  const credited = (keyId: string, discovery: string, runIds: string[], file: string) => {
    if (!runIds.length) return false
    if (discovery !== 'leak_gated') return true
    const leak = leakSeq(keyId)
    const ok = runIds.some((id) => firstWrite(id, file) < leak)
    if (!ok) leakCredited.push(keyId)
    return ok
  }

  // Components. An optional one (the scope leaves it open) is credited neither way.
  const required = key.components.filter((k) => !k.optional)
  const optionalNote = key.components.length > required.length ? `; optional, not counted: ${key.components.filter((k) => k.optional).map((k) => `${k.id}${compsOf(k.id).length ? ' (modelled)' : ''}`).join(', ')}` : ''
  const compHits = required.filter((k) => credited(k.id, k.discovery, compsOf(k.id).map((c) => c.id), 'structure.json'))
  items.push(graded('components.recall', compHits.length, required.length, 0.9,
    `${compHits.length} of ${required.length} key components found${leakCredited.length ? `; written only after a reply named them: ${leakCredited.join(', ')}` : ''}${optionalNote}`,
    required.filter((k) => !compHits.includes(k)).map((k) => k.id)))
  const bearers = required.filter((k) => k.crown_jewel)
  const missingBearers = bearers.filter((k) => !compsOf(k.id).length).map((k) => k.id)
  items.push(binary('components.crown_jewel_bearers', !missingBearers.length, missingBearers.length ? 'a crown-jewel bearer is missing' : 'every crown-jewel bearer is modelled', missingBearers, { ok: bearers.length - missingBearers.length, n: bearers.length }))
  // Classes, apart from identity: every scored match of a key component carries a class the key allows (an unclassified
  // one does not). The admin listener stands apart from the orders API here.
  const classed = (k: (typeof key.components)[number]) => {
    const own = compsOf(k.id).filter((c) => matching.components.get(c.id) !== ADMIN_LISTENER_ID)
    return own.length > 0 && own.every((c) => !!c.classId && classAllowed(c.classId, k))
  }
  const present = required.filter((k) => compsOf(k.id).some((c) => matching.components.get(c.id) !== ADMIN_LISTENER_ID))
  const classHits = present.filter(classed)
  items.push(graded('components.classes', classHits.length, present.length, 0.9, `${classHits.length} of ${present.length} matched key components carry a class the key allows`,
    present.filter((k) => !classed(k)).map((k) => `${k.id}:${compsOf(k.id).filter((c) => matching.components.get(c.id) !== ADMIN_LISTENER_ID).map((c) => c.classId ?? 'unclassified').join(',')}`)))
  // The crown-jewel bearers and the internet entry points: their class decides the exposures and the zoning.
  const weighty = [...new Set([...bearers.map((k) => k.id), ...(((key.internet_facing as { components?: string[] } | undefined)?.components) ?? [])])]
    .map((id) => key.components.find((k) => k.id === id)!).filter(Boolean)
  const misclassed = weighty.filter((k) => !classed(k)).map((k) => k.id)
  items.push(binary('components.bearer_classes', !misclassed.length,
    misclassed.length ? 'a crown-jewel bearer or an internet entry point is missing or carries a class the key does not allow' : 'every crown-jewel bearer and internet entry point carries a class the key allows',
    misclassed, { ok: weighty.length - misclassed.length, n: weighty.length }))
  const decoyAliases = key.decoys.flatMap((d) => d.aliases)
  const credentialDecoys = [...input.bags].filter(([, bag]) => ['required_credentials', 'credential_scope'].some((k) =>
    Array.isArray(bag[k]) && (bag[k] as unknown[]).some((v) => typeof v === 'string' && decoyAliases.some((a) => mentions(spaced(v), spaced(a)))))).map(([id]) => id)
  const decoys = [...matching.decoys.map((d) => d.runId), ...credentialDecoys]
  const acceptedTexts = [...matching.decoys.map((d) => d.name), ...credentialDecoys.flatMap((id) => ['required_credentials', 'credential_scope'].flatMap((k) => (Array.isArray(input.bags.get(id)?.[k]) ? (input.bags.get(id)![k] as unknown[]).map(String) : [])))]
  const decoysHit = key.decoys.filter((d) => acceptedTexts.some((t) => d.aliases.some((a) => mentions(spaced(t), spaced(a))))).length
  if (!key.decoys.length) items.push(notOnFixture('components.no_decoys', 'decoy'))
  else items.push(binary('components.no_decoys', !decoys.length, decoys.length ? `${decoys.length} decoy element(s) or credential(s) accepted` : 'no decoy accepted', decoys,
    { ok: key.decoys.length - decoysHit, n: key.decoys.length }))

  // Flows
  leakCredited.length = 0
  const requiredFlows = key.flows.filter((k) => !k.optional)
  const flowHits = requiredFlows.filter((k) => credited(k.id, k.discovery, flowsOf(k.id).map((f) => f.id), 'dataflows.json'))
  const reversed = run.flows.filter((f) => matching.flows.get(f.id)?.reversed).map((f) => f.id)
  items.push(graded('flows.recall', flowHits.length, requiredFlows.length, 0.8,
    `${flowHits.length} of ${requiredFlows.length} key flows found in their direction${reversed.length ? `; ${reversed.length} reversed` : ''}${leakCredited.length ? `; written only after a reply named them: ${leakCredited.join(', ')}` : ''}` +
    `${input.bridges?.length ? `; through a load balancer drawn as its own component: ${input.bridges.map(shownBridge).join('; ')}` : ''}`,
    requiredFlows.filter((k) => !flowHits.includes(k)).map((k) => k.id)))
  const fixed = requiredFlows.filter((k) => k.fixed_source)
  const fixedMissing = fixed.filter((k) => !flowsOf(k.id).length).map((k) => k.id)
  if (!fixed.length) items.push(notOnFixture('flows.fixed_sources', 'flow with a fixed source'))
  else items.push(binary('flows.fixed_sources', !fixedMissing.length, fixedMissing.length ? 'a flow with a fixed source is missing or reversed' : 'every fixed-source flow starts at its source', fixedMissing, { ok: fixed.length - fixedMissing.length, n: fixed.length }))

  // Boundaries and zones
  const zoneOf = (boundaryId: string | undefined): string | undefined => {
    for (let b = run.boundaries.find((x) => x.id === boundaryId); b; b = run.boundaries.find((x) => x.id === b!.parentId)) if (typeof b.zone === 'string') return b.zone
    return undefined
  }
  // An optional external that is modelled must still be external.
  const externals = key.components.filter((k) => k.external && (!k.optional || compsOf(k.id).length))
  const notExternal = externals.filter((k) => !compsOf(k.id).length || compsOf(k.id).some((c) => c.type !== 'EXTERNAL_ENTITY')).map((k) => k.id)
  items.push(binary('zones.externals', !notExternal.length, notExternal.length ? 'an external actor is missing or not modelled as external' : 'every external actor is external', notExternal, { ok: externals.length - notExternal.length, n: externals.length }))
  const zoneHits = required.filter((k) => compsOf(k.id).length && compsOf(k.id).every((c) => k.zone_allowed.includes(zoneOf(c.boundaryId) ?? '')))
  items.push(graded('zones.leaf', zoneHits.length, required.length, 0.8, `${zoneHits.length} of ${required.length} components sit in an allowed zone`,
    required.filter((k) => !zoneHits.includes(k)).map((k) => k.id)))
  const facing = ((key.internet_facing as { components?: string[] } | undefined)?.components ?? [])
  const notFacing = facing.filter((id) => !compsOf(id).length || compsOf(id).some((c) => !['PUBLIC', 'EXPOSED'].includes(zoneOf(c.boundaryId) ?? '')))
  if (!facing.length) items.push(notOnFixture('zones.internet_facing', 'internet-facing component'))
  else items.push(binary('zones.internet_facing', !notFacing.length, notFacing.length ? 'an internet-facing component is not PUBLIC or EXPOSED' : 'internet-facing components are PUBLIC or EXPOSED', notFacing, { ok: facing.length - notFacing.length, n: facing.length }))
  const restricted = [...new Set([
    ...input.changes.filter((c) => c.path === `${dir}structure.json` && c.field === 'zone' && c.after === 'RESTRICTED').map((c) => c.element),
    ...run.boundaries.filter((b) => b.zone === 'RESTRICTED').map((b) => b.id),
  ])]
  const boundaryIds = new Set([...run.boundaries.map((b) => b.id), ...restricted])
  items.push(binary('zones.no_restricted', !restricted.length, restricted.length ? 'a boundary was RESTRICTED at some point' : 'no boundary was ever RESTRICTED', restricted,
    { ok: boundaryIds.size - restricted.length, n: boundaryIds.size }))

  // Crown jewels
  let mapping: Record<string, unknown> = {}
  try {
    mapping = JSON.parse(fs.readFileSync(path.join(input.modelDir, '.dethereal', 'scope.json'), 'utf8'))?.[CROWN_JEWEL_MAPPING] ?? {}
  } catch {
    mapping = {}
  }
  const cj = key.crown_jewels as { names: string[]; elements: Record<string, string[]> }
  const keyIdOf = (runId: string) => flowEndpoint(matching.components.get(runId)) ?? matching.dataItems.get(runId)
  const unresolved = cj.names.filter((name) => {
    const entry = Object.entries(mapping).find(([n]) => n.trim().toLowerCase() === name.trim().toLowerCase() || mentions(n, name) || mentions(name, n))
    const ids = new Set((Array.isArray(entry?.[1]) ? entry![1] : []).map((id: unknown) => keyIdOf(String(id))).filter(Boolean) as string[])
    const wanted = (cj.elements[name] ?? []).filter((id) => key.components.some((c) => c.id === id))
    return !entry || !wanted.every((id) => ids.has(id))
  })
  items.push(binary('crown_jewels.resolved', !unresolved.length, unresolved.length ? 'a declared crown jewel is not mapped to its elements' : 'every declared crown jewel maps to its elements', unresolved, { ok: cj.names.length - unresolved.length, n: cj.names.length }))

  // Credentials
  const pairsOf = Object.entries(key.fields.flows).flatMap(([flowId, tags]) => {
    const v = tags.required_credentials && 'value' in tags.required_credentials ? tags.required_credentials.value : undefined
    // A credential on an optional flow counts only where the run models that flow; one the key accepts as absent
    // (an empty list among its accepts) is an honest reading either way, so it is not required.
    const optional = key.flows.find((f) => f.id === flowId)?.optional && !flowsOf(flowId).length
    const mayBeAbsent = (tags.required_credentials?.accepts ?? []).some((a) => Array.isArray(a) && a.length === 0)
    return Array.isArray(v) && !optional && !mayBeAbsent ? v.map((cred) => ({ flowId, cred: String(cred) })) : []
  })
  const credMissing = pairsOf.filter(({ flowId, cred }) => !flowsOf(flowId).length || !inAll((b) => holds({ key: 'required_credentials', contains_alias_of: cred }, flowId, b, key)))
  if (!pairsOf.length) items.push(notOnFixture('credentials.flows', 'credential a flow must carry'))
  else items.push(binary('credentials.flows', !credMissing.length, `${pairsOf.length - credMissing.length} of ${pairsOf.length} key credentials are on their flows`, credMissing.map((p) => `${p.flowId}:${p.cred}`), { ok: pairsOf.length - credMissing.length, n: pairsOf.length }))
  const shared = key.credentials.shared
  if (!shared) items.push(notOnFixture('credentials.shared', 'credential shared between flows'))
  else {
    const sharedOk = inAll((b) => holds({ shared_credential: shared.credential, flows: shared.flows }, '', b, key))
    items.push(binary('credentials.shared', sharedOk, `the shared ${shared.credential} is${sharedOk ? '' : ' not'} one id on all its flows`, sharedOk ? [] : [shared.credential], { ok: sharedOk ? 1 : 0, n: 1 }))
  }
  const scoped = Object.entries(key.fields.components).filter(([, tags]) => tags.credential_scope && 'value' in tags.credential_scope && Array.isArray(tags.credential_scope.value) && tags.credential_scope.value.length)
  const scopeBad = scoped.filter(([compId, tags]) => !inAll((b) => {
    const scope = b.get(compId)?.credential_scope
    if (!Array.isArray(scope) || !scope.length) return false
    const first = String((tags.credential_scope as { value: unknown[] }).value[0])
    if (!holds({ key: 'credential_scope', contains_alias_of: first }, compId, b, key)) return false
    const inbound = key.flows.filter((f) => f.target === compId).flatMap((f) => (Array.isArray(b.get(f.id)?.required_credentials) ? (b.get(f.id)!.required_credentials as unknown[]) : []).map(squash))
    return scope.every((s) => inbound.includes(squash(s)))
  })).map(([id]) => id)
  if (!scoped.length) items.push(notOnFixture('credentials.scope', 'store with a credential scope'))
  else items.push(binary('credentials.scope', !scopeBad.length, scopeBad.length ? 'a credential_scope is empty, lacks its credential, or names one no inbound flow requires' : 'credential scopes hold their credentials and match the inbound flows', scopeBad, { ok: scoped.length - scopeBad.length, n: scoped.length }))

  // Data items
  const keyItems = (key.data_items as Array<{ id: string; class_ids: string[]; sensitivity_min: string; flags: string[]; linked_flows?: string[] }>) ?? []
  const merges = (key.data_item_merges as Array<{ ids: string[] }> | undefined) ?? []
  const itemProblems: string[] = []
  for (const k of keyItems) {
    const group = merges.find((m) => m.ids.includes(k.id))?.ids ?? [k.id]
    let candidates = itemsOf(k.id)
    let floor = sensitivityRank(k.sensitivity_min)
    let flags = k.flags
    if (!candidates.length && group.length > 1) {
      candidates = group.flatMap(itemsOf)
      const members = keyItems.filter((x) => group.includes(x.id))
      floor = Math.max(...members.map((x) => sensitivityRank(x.sensitivity_min)))
      flags = [...new Set(members.flatMap((x) => x.flags))]
    }
    if (!candidates.length) {
      itemProblems.push(`${k.id}:missing`)
      continue
    }
    for (const d of candidates) {
      if (!d.classId || !k.class_ids.includes(d.classId)) itemProblems.push(`${k.id}:class`)
      if (sensitivityRank(d.sensitivity) < floor) itemProblems.push(`${k.id}:sensitivity`)
      const have = (Array.isArray(d.flags) ? d.flags : []).map((f) => String(f).trim().toLowerCase())
      if (!flags.every((f) => have.includes(f.toLowerCase()))) itemProblems.push(`${k.id}:flags`)
    }
    const ids = new Set(candidates.map((d) => d.id))
    for (const flowId of k.linked_flows ?? []) {
      // A run flow from a sibling of the key flow's source carries only the items the key lists for that sibling.
      const siblings = key.flows.find((x) => x.id === flowId)?.sibling_items ?? []
      const owes = (f: RunFlow) => {
        const rule = siblings.find((r) => matching.components.get(f.source) === r.source)
        return !rule || rule.items.includes(k.id)
      }
      const mapped = flowsOf(flowId)
      const owing = mapped.filter(owes)
      // Every mapped flow owes the item, and at least one flow must: a sibling alone never stands in for the key flow.
      if (owing.some((f) => !f.dataItemIds.some((x) => ids.has(x))) || (mapped.length > 0 && owing.length === 0)) itemProblems.push(`${k.id}:link ${flowId}`)
    }
  }
  const uniqueItemProblems = [...new Set(itemProblems)]
  const badItems = new Set(uniqueItemProblems.map((x) => x.split(':')[0]))
  items.push(binary('data_items', !uniqueItemProblems.length,
    `${keyItems.length - badItems.size} of ${keyItems.length} data items have their class, sensitivity floor, flags and links`, uniqueItemProblems, { ok: keyItems.length - badItems.size, n: keyItems.length }))

  // Credential flags: a credential the workflow was told to propose (its class is credential-like) is flagged, and no
  // other item is. A credential under a class the hint does not read is left to data_items, which scores the class.
  const credentialProblems: string[] = []
  let credentialChecked = 0
  for (const k of keyItems as Array<{ id: string; credential?: boolean | 'either' }>) {
    if (k.credential === undefined || k.credential === 'either') continue
    for (const d of itemsOf(k.id)) {
      if (k.credential) {
        if (!credentialClassHint({ id: d.classId ?? null, name: d.className ?? null })) continue
        credentialChecked++
        if (d.isCredential !== true) credentialProblems.push(`${k.id}:${d.isCredential === undefined ? 'unanswered' : 'not flagged'}`)
      } else {
        credentialChecked++
        if (d.isCredential === true) credentialProblems.push(`${k.id}:flagged`)
      }
    }
  }
  const uniqueCredentialProblems = [...new Set(credentialProblems)]
  // Informational until the workflow proposes the flag for every credential class and an acceptance run has exercised it.
  items.push({ ...binary('data_items.credential_flags', !uniqueCredentialProblems.length,
    uniqueCredentialProblems.length ? 'a credential is not flagged, or another item is' : 'every credential the class names is flagged, and no other item',
    uniqueCredentialProblems, { ok: credentialChecked - credentialProblems.length, n: credentialChecked }), informational: true })

  // Approved channels
  const channels = (key.approved_channels as Array<{ from_boundary_of: string; to_boundary_of: string; direction: string }>) ?? []
  const holdsKey = (b: { componentIds: string[] } | undefined, keyId: string) => !!b && b.componentIds.some((id) => flowEndpoint(matching.components.get(id)) === keyId)
  const channelBad: string[] = []
  const extra: string[] = []
  for (const b of run.boundaries) {
    for (const c of Array.isArray(b.conduits) ? (b.conduits as Array<{ peerId?: string; direction?: string }>) : []) {
      const peer = run.boundaries.find((x) => x.id === c.peerId)
      if (!channels.some((ch) => holdsKey(b, ch.from_boundary_of) && holdsKey(peer, ch.to_boundary_of) && c.direction === ch.direction)) extra.push(`${b.id}->${c.peerId}`)
    }
  }
  for (const ch of channels) {
    const from = run.boundaries.find((b) => holdsKey(b, ch.from_boundary_of))
    const conduits = Array.isArray(from?.conduits) ? (from!.conduits as Array<{ peerId?: string; direction?: string }>) : []
    const toPeer = conduits.filter((c) => holdsKey(run.boundaries.find((x) => x.id === c.peerId), ch.to_boundary_of))
    if (!toPeer.length || toPeer.some((c) => c.direction !== ch.direction)) channelBad.push(`${ch.from_boundary_of}->${ch.to_boundary_of}`)
  }
  if (!channels.length) items.push(notOnFixture('approved_channels', 'ratified channel'))
  else items.push(binary('approved_channels', !channelBad.length, `${channelBad.length ? 'the ratified channel is missing or not in its direction only' : 'the ratified channel is present, in its direction only'}${extra.length ? `; other channels (reported, not scored): ${extra.length}` : ''}`, [...channelBad, ...extra],
    { ok: channels.length - channelBad.length, n: channels.length }))

  // Attribute assertions
  // A key element whose identity a match of a class the key does not allow keeps: an absent field there proves nothing.
  const strict = new Set(matching.classKept.filter((k) => k.classId).map((k) => k.keyId))
  const results = variants.map((v) => evaluateAssertions(v, key, strict))
  const worst = results.reduce((a, b) => (b.passed.length < a.passed.length ? b : a), results[0] ?? evaluateAssertions(new Map(), key, strict))
  items.push(graded('assertions.rate', worst.passed.length, key.attribute_assertions.length, key.assertion_threshold, `${worst.passed.length} of ${key.attribute_assertions.length} attribute assertions hold`, worst.failed))
  const insecureFailed = [...new Set(results.flatMap((r) => r.insecureFailed))]
  const insecureTotal = key.attribute_assertions.filter((a) => a.insecure).length
  items.push(binary('assertions.insecure', !insecureFailed.length && results.length > 0, insecureFailed.length ? 'an insecure fact is not recorded' : 'every insecure fact is recorded', insecureFailed,
    { ok: insecureTotal - insecureFailed.length, n: insecureTotal }))

  // Red flags
  const step9 = step9Text(events, input.shown, input.written)
  const relay = reviewRelay(events, input.shown)
  const flagProblems: string[] = []
  for (const f of key.red_flags) {
    const persisted = (f.assertions ?? []).every((a) => results.length > 0 && results.every((r) => r.passed.includes(a))) &&
      (!f.zoning || input.zoning.some((z) => z.kind === f.zoning!.kind && matching.boundaries.get(z.boundaryId) === f.zoning!.boundaryId))
    const named = f.step9_phrases.some((p) => mentions(spaced(step9), spaced(p))) || namedByFacts(f, relay, key, run, matching)
    if (!persisted) flagProblems.push(`${f.id}:not persisted`)
    if (!named) flagProblems.push(`${f.id}:not named in Step 9`)
  }
  const badFlags = new Set(flagProblems.map((x) => x.split(':')[0]))
  if (!key.red_flags.length) items.push(notOnFixture('red_flags', 'red flag'))
  else items.push(binary('red_flags', !flagProblems.length, `${key.red_flags.length - badFlags.size} of ${key.red_flags.length} red flags are persisted and named in Step 9`,
    flagProblems, { ok: key.red_flags.length - badFlags.size, n: key.red_flags.length }))

  items.push(...downstreamItems(input.runExport, input.keyExport, key))
  return items
}

/** The downstream items: the run's platform exposures and attack paths against the key model's. */
export function downstreamItems(runExport: PlatformExport | null, keyExport: PlatformExport | null, key: ExpectedKey): RubricItem[] {
  if (!runExport || !keyExport) {
    return [
      binary('downstream.exposures', false, 'no platform export of the run or of the key model'),
      binary('downstream.attack_paths', false, 'no platform export of the run or of the key model'),
    ]
  }
  // An element the run modelled under another class the key accepts has another class's exposures, and the key
  // export holds only its own class's: it is left out on both sides, and named.
  const other = alternateClassed(runExport, keyExport, key)
  const kept = (pair: string) => !other.includes(pair.slice(pair.indexOf('\u0000') + 1))
  const a = new Set([...exposureSet(runExport, key)].filter(kept))
  const b = new Set([...exposureSet(keyExport, key)].filter(kept))
  const inter = [...a].filter((x) => b.has(x)).length
  const union = new Set([...a, ...b]).size
  const left = other.length ? `; left out, modelled under another class the key accepts: ${other.join(', ')}` : ''
  const want = attackPaths(keyExport, key)
  const got = attackPaths(runExport, key)
  const missing = [...want].filter((p) => !got.has(p))
  return [
    graded('downstream.exposures', inter, union, 0.7, `exposure-set Jaccard ${union ? (inter / union).toFixed(3) : 'undefined (no exposures)'} (${inter} shared of ${union})${left}`),
    binary('downstream.attack_paths', want.size > 0 && !missing.length,
      want.size ? `${want.size - missing.length} of ${want.size} paths from an external actor to a crown-jewel bearer present` : 'the key model shows no path from an external actor to a crown-jewel bearer', missing,
      { ok: want.size - missing.length, n: want.size }),
  ]
}

/** What the main session said after each reviewer run returned, up to the next question it asked. */
export function reviewRelay(events: TranscriptEvent[], shown: ShownPrompt[]): string {
  const out: string[] = []
  for (const r of agentRuns(events).filter((x) => x.role === REVIEWER_ROLE && x.end !== undefined)) {
    const next = shown.find((s) => s.event > r.end!)?.event ?? Infinity
    out.push(...events.filter((e) => e.seq > r.end! && e.seq <= next && e.actor === 'main' && e.kind === 'assistant').map((e) => e.text ?? ''))
  }
  return out.join('\n')
}

/** Blocks of text: a top-level bullet with its nested lines, a table row, or any other non-empty line. */
export function textBlocks(text: string): string[] {
  const out: string[] = []
  let bullet: string[] | null = null
  for (const line of text.split('\n')) {
    if (bullet && /^\s{2,}[-*+]\s/.test(line)) { bullet.push(line); continue }
    if (bullet) out.push(bullet.join('\n'))
    bullet = /^[-*+]\s/.test(line) ? [line] : null
    if (!bullet && line.trim()) out.push(line)
  }
  if (bullet) out.push(bullet.join('\n'))
  return out
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A red flag named the way the plugin names it, by element and field: every fact the flag rests on (each of its
 * assertions) has a condition that one block of the review relay states, the element (its key aliases, or the
 * matched run element's name or id; a flow also by both of its ends) together with the field and its insecure value (`field value`, `field = value`, `field = "value"`, in code
 * or bold marks). A condition without a field and a value (a shared credential, an absence) is never named this way.
 */
export function namedByFacts(f: { assertions?: string[] }, relay: string, key: ExpectedKey, run: RunModel, matching: Matching): boolean {
  const facts = (f.assertions ?? []).map((id) => key.attribute_assertions.find((a) => a.id === id)).filter((a): a is Assertion => !!a)
  if (!facts.length) return false
  const blocks = textBlocks(relay).map((b) => b.toLowerCase())
  const runNames = [...run.components, ...run.flows, ...run.dataItems]
  const namesOf = (keyId: string): string[] => {
    const k = [...key.components, ...key.flows, ...((key.data_items ?? []) as Array<{ id: string; aliases?: string[] }>)].find((x) => x.id === keyId) as { aliases?: string[] } | undefined
    const ids = new Set([
      ...[...matching.components].filter(([, v]) => flowEndpoint(v) === keyId).map(([r]) => r),
      ...[...matching.flows].filter(([, v]) => v.keyId === keyId).map(([r]) => r),
      ...[...matching.dataItems].filter(([, v]) => v === keyId).map(([r]) => r),
    ])
    return [...(k?.aliases ?? []), ...runNames.filter((x) => ids.has(x.id)).flatMap((x) => [x.name, x.id])].map((n) => n.toLowerCase()).filter(Boolean)
  }
  // The element's name is read outside field names: `pii_excluded_from_logs` never names "logs".
  const named = (b: string, keyId: string): boolean => {
    const text = b.replace(/[a-z0-9]+(?:_[a-z0-9]+)+/g, ' ')
    if (namesOf(keyId).some((n) => mentions(text, n))) return true
    // A flow is also named by both of its ends, as the reviewer writes it (`a → b`).
    const flow = key.flows.find((x) => x.id === keyId)
    return !!flow && namesOf(flow.source).some((n) => mentions(text, n)) && namesOf(flow.target).some((n) => mentions(text, n))
  }
  const stated = (fact: Assertion): boolean => {
    const conditions: Array<Record<string, unknown>> = []
    const walk = (c: Record<string, unknown>) => {
      if (Array.isArray(c.any_of)) (c.any_of as Array<Record<string, unknown>>).forEach(walk)
      else if (Array.isArray(c.all_of)) (c.all_of as Array<Record<string, unknown>>).forEach(walk)
      else conditions.push(c)
    }
    ;((fact as unknown as { any_of?: Array<Record<string, unknown>> }).any_of ?? []).forEach(walk)
    return conditions.some((c) => {
      if (typeof c.key !== 'string') return false
      const values = 'equals' in c ? [Array.isArray(c.equals) ? '[]' : String(c.equals)] : Array.isArray(c.in) ? (c.in as unknown[]).map(String) : []
      if (!values.length) return false
      // A value may be quoted, as a JSON string is (`"none"`); a quoted one is the whole string.
      const v = `(?:${values.map(escapeRe).join('|')})`
      const re = new RegExp(`(?<![\\w-])${escapeRe(c.key)}(?![\\w-])[\\s\`*:=]{0,6}(?:"${v}"|'${v}'|${v}(?![\\w-]))`, 'i')
      return blocks.some((b) => re.test(b) && named(b, String(c.element ?? fact.element)))
    })
  }
  return facts.every(stated)
}

/** The Step 9 output: main-session text from the reviewer's start (else the first `review-record`) up to `push-consent`, and Markdown the run wrote meanwhile. */
export function step9Text(events: TranscriptEvent[], shown: ShownPrompt[], written: Map<string, string>): string {
  const reviewer = agentRuns(events).find((r) => r.role === REVIEWER_ROLE)
  const start = reviewer?.start ?? shown.find((s) => s.id === 'review-record')?.event ?? Infinity
  const end = shown.find((s) => s.id === 'push-consent' && s.event > start)?.event ?? Infinity
  const texts = events.filter((e) => e.seq >= start && e.seq < end && e.actor === 'main' && e.kind === 'assistant').map((e) => e.text ?? '')
  const files = new Set(events.filter((e) => e.seq >= start && e.seq < end && e.kind === 'file_write' && /\.md$/i.test(e.path ?? '')).map((e) => e.path!))
  for (const f of files) texts.push(written.get(f) ?? '')
  return texts.join('\n')
}

/** An export's model, matched to the key. */
function exportModel(exp: PlatformExport, key: ExpectedKey): { model: RunModel; m: Matching } {
  const model = modelFromDocs(exp.files['structure.json'], exp.files['dataflows.json'], exp.files['data-items.json'])
  return { model, m: matchModel(model, key) }
}

/**
 * Key flows and data items the run's export holds under another class than the key export's, every one of which
 * the key accepts for that element (its `class_ids`), by key id.
 */
export function alternateClassed(runExport: PlatformExport, keyExport: PlatformExport, key: ExpectedKey): string[] {
  const classes = (exp: PlatformExport) => {
    const { model, m } = exportModel(exp, key)
    const out = new Map<string, Set<string>>()
    const add = (keyId: string | undefined, cls: unknown) => { if (keyId && typeof cls === 'string') out.set(keyId, new Set([...(out.get(keyId) ?? []), cls])) }
    for (const f of model.flows) { const k = m.flows.get(f.id); if (k && !k.reversed) add(k.keyId, f.classId) }
    for (const d of model.dataItems) add(m.dataItems.get(d.id), d.classId)
    return out
  }
  const run = classes(runExport)
  const ref = classes(keyExport)
  const items = (key.data_items ?? []) as Array<{ id: string; class_ids: string[] }>
  const accepted = (keyId: string) => key.flows.find((f) => f.id === keyId)?.class_ids ?? items.find((d) => d.id === keyId)?.class_ids ?? []
  return [...run].filter(([keyId, cls]) => {
    const own = ref.get(keyId)
    return !!own && [...cls].every((c) => !own.has(c) && accepted(keyId).includes(c))
  }).map(([keyId]) => keyId).sort()
}

/** Exposures as (name, key element) pairs. */
export function exposureSet(exp: PlatformExport, key: ExpectedKey): Set<string> {
  const { model, m } = exportModel(exp, key)
  const out = new Set<string>()
  const add = (list: Array<{ name?: unknown }>, keyId: string) => { for (const x of list) out.add(`${String(x.name).trim().toLowerCase()}\u0000${keyId}`) }
  for (const [id, list] of Object.entries(exp.exposures ?? {})) {
    const keyId = flowEndpoint(m.components.get(id)) ?? (m.flows.get(id)?.reversed ? undefined : m.flows.get(id)?.keyId) ?? m.dataItems.get(id) ?? m.boundaries.get(id)
    if (keyId) add(list, keyId)
  }
  // A load balancer drawn on a key flow carries that flow, under the same rule as the scored items: the exposures
  // of either hop are the key flow's.
  for (const b of findBridges(model, m, key)) for (const hop of b.hops) add(exp.exposures?.[hop.id] ?? [], b.keyId)
  return out
}

/** Pairs (external actor, crown-jewel bearer) connected by flows in their direction, by key ids. */
export function attackPaths(exp: PlatformExport, key: ExpectedKey): Set<string> {
  const { model, m } = exportModel(exp, key)
  const next = new Map<string, Set<string>>()
  for (const f of model.flows) {
    const s = flowEndpoint(m.components.get(f.source))
    const t = flowEndpoint(m.components.get(f.target))
    if (s && t) next.set(s, new Set([...(next.get(s) ?? []), t]))
  }
  // A load balancer drawn on a key flow carries that flow, under the same rule as the scored items.
  for (const b of findBridges(model, m, key)) {
    const k = key.flows.find((f) => f.id === b.keyId)!
    next.set(k.source, new Set([...(next.get(k.source) ?? []), k.target]))
  }
  const out = new Set<string>()
  for (const ext of key.components.filter((c) => c.external)) {
    const seen = new Set([ext.id])
    const queue = [ext.id]
    while (queue.length) {
      for (const n of next.get(queue.shift()!) ?? []) {
        if (seen.has(n)) continue
        seen.add(n)
        queue.push(n)
      }
    }
    for (const cj of key.components.filter((c) => c.crown_jewel)) if (seen.has(cj.id)) out.add(`${ext.id}->${cj.id}`)
  }
  return out
}
