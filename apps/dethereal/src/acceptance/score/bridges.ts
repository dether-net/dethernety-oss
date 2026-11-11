/**
 * Load balancers drawn as their own component. The key folds each load balancer the source declares into
 * the component behind it; a run that draws one (Customer → Load balancer → Edge gateway) still has the key
 * flow, as a bridge: a chain A → X → B standing for the key flow A → B, under the key's `pass_through` rule.
 *
 * X bridges only when nothing else can explain it: it matches no key component by alias (an alias decides
 * first, whatever the class), it is not a decoy, it has a pass-through class (or, unclassified, a
 * pass-through name), its class is not that of a key component the run left unmatched (that component may
 * be X in disguise), and it carries only the one bridge. One intermediate, both hops forward.
 */
import { mentions, type ExpectedKey } from '../key.js'
import { flowEndpoint, matchModel, type Matching, type RunComponent, type RunFlow, type RunModel } from './match.js'

type Bag = Record<string, unknown>

export interface Bridge {
  /** The key flow the chain stands for */
  keyId: string
  /** The two run flows: into X, and out of X */
  hops: [RunFlow, RunFlow]
  via: { id: string; name: string; classId?: string; className?: string }
  /** The chain as one run flow: the first hop's source, the second's target, the items both carry */
  flow: RunFlow
}

/** Transit keys and the values that state plaintext; every other key is read target first. */
const INSECURE_TRANSIT: Record<string, (v: unknown) => boolean> = {
  encryption_in_transit: (v) => typeof v === 'string' && ['none', 'plaintext', 'unencrypted', 'disabled', 'no tls', 'no encryption', 'http'].includes(v.trim().toLowerCase()),
  flow_tls_encrypted: (v) => v === false,
}
const present = (v: unknown) => v !== undefined && v !== null

/**
 * The attributes of a bridged flow. A transit key is judged per hop: plaintext on either hop is kept (an
 * insecure condition then holds), a value is kept only when both hops state one (a secure condition then
 * needs both), and nothing is kept otherwise. Every other key is the target hop's, or the source hop's
 * when the target hop does not state it.
 */
export function bridgedBag(source: Bag | undefined, target: Bag | undefined): Bag {
  const s = source ?? {}
  const t = target ?? {}
  const out: Bag = {}
  for (const k of new Set([...Object.keys(s), ...Object.keys(t)])) {
    const insecure = INSECURE_TRANSIT[k]
    if (insecure) {
      if (insecure(t[k])) out[k] = t[k]
      else if (insecure(s[k])) out[k] = s[k]
      else if (present(s[k]) && present(t[k])) out[k] = t[k]
      continue
    }
    if (present(t[k])) out[k] = t[k]
    else if (present(s[k])) out[k] = s[k]
  }
  return out
}

const texts = (c: { id: string; name: string }) => [c.name, c.id.replace(/[-_]+/g, ' ')]
const named = (c: { id: string; name: string }, aliases: string[]) => texts(c).some((t) => aliases.some((a) => mentions(t.replace(/[-_]+/g, ' '), a.replace(/[-_]+/g, ' '))))

/**
 * The bridges of a run model. `matching` is the matching the caller scores with (it decides which run
 * components stand for a key flow's ends); the alias decision is taken from the unfiltered matching, so a
 * component an alias names is that component whatever its class.
 */
export function findBridges(run: RunModel, matching: Matching, key: ExpectedKey): Bridge[] {
  const pass = key.pass_through
  if (!pass) return []
  const aliased = matchModel(run, key, { byClass: false })
  // Decoy components and flows: never X, never a hop.
  const decoys = new Set(aliased.decoys.map((d) => d.runId))
  const classIds = new Map(pass.classes.map((c) => [c.id, c.name]))
  // Key components the run left without any alias match: their classes may be what an X really is.
  const matchedKeys = new Set([...aliased.components.values()].map((id) => flowEndpoint(id)))
  const unmatchedKeyClasses = new Set(key.components.filter((k) => !matchedKeys.has(k.id))
    .flatMap((k) => [...k.class_ids, ...(((k as { class_alternates?: string[] }).class_alternates) ?? [])]))
  const qualifies = (c: RunComponent) =>
    !aliased.components.has(c.id) && !decoys.has(c.id) &&
    (c.classId ? classIds.has(c.classId) && !unmatchedKeyClasses.has(c.classId) : named(c, pass.aliases))
  const endsOf = (keyId: string) => new Set(run.components.filter((c) => flowEndpoint(matching.components.get(c.id)) === keyId).map((c) => c.id))
  const direct = (keyId: string) => run.flows.some((f) => matching.flows.get(f.id)?.keyId === keyId && !matching.flows.get(f.id)!.reversed)

  const candidates: Array<{ keyId: string; x: RunComponent; h1: RunFlow; h2: RunFlow; ends: Set<string> }> = []
  for (const { id: keyId } of pass.flows) {
    const k = key.flows.find((f) => f.id === keyId)
    if (!k || direct(keyId)) continue
    const from = endsOf(k.source)
    const to = endsOf(k.target)
    for (const x of run.components.filter(qualifies)) {
      for (const h1 of run.flows.filter((f) => from.has(f.source) && f.target === x.id && !decoys.has(f.id))) {
        for (const h2 of run.flows.filter((f) => f.source === x.id && to.has(f.target) && !decoys.has(f.id))) {
          candidates.push({ keyId, x, h1, h2, ends: new Set([...from, ...to]) })
        }
      }
    }
  }
  // X carries only its bridge: one key flow, and every flow on X connects it to that flow's ends.
  const keysOf = new Map<string, Set<string>>()
  for (const c of candidates) keysOf.set(c.x.id, new Set([...(keysOf.get(c.x.id) ?? []), c.keyId]))
  return candidates
    .filter((c) => keysOf.get(c.x.id)!.size === 1)
    .filter((c) => run.flows.filter((f) => f.source === c.x.id || f.target === c.x.id).every((f) => c.ends.has(f.source === c.x.id ? f.target : f.source)))
    .map(({ keyId, x, h1, h2 }) => ({
      keyId,
      hops: [h1, h2] as [RunFlow, RunFlow],
      via: { id: x.id, name: x.name, ...(x.classId ? { classId: x.classId } : {}), ...(x.classId && classIds.get(x.classId) ? { className: classIds.get(x.classId)! } : {}) },
      flow: {
        id: `bridge:${h1.id}+${h2.id}`, name: `${h1.name} / ${h2.name}`, source: h1.source, target: h2.target,
        ...(h2.classId ?? h1.classId ? { classId: (h2.classId ?? h1.classId)! } : {}),
        dataItemIds: h1.dataItemIds.filter((d) => h2.dataItemIds.includes(d)),
      },
    }))
}

/** A bridge as the report shows it: the key flow, the chain, and what the load balancer is. */
export const shownBridge = (b: Bridge) =>
  `${b.keyId} ← ${b.hops[0].source} → ${b.via.id} → ${b.hops[1].target} (${b.via.name}, ${b.via.className ?? 'unclassified'})`

/**
 * The run as the scored items read it: each bridge one more run flow standing for its key flow, with the
 * bridged attributes; the load balancers and their hops left out of the unmatched list (the report shows
 * them as bridges instead).
 */
export function withBridges(run: RunModel, matching: Matching, bags: Map<string, Bag>, bridges: Bridge[]): { run: RunModel; matching: Matching; bags: Map<string, Bag> } {
  if (!bridges.length) return { run, matching, bags }
  const flows = new Map(matching.flows)
  const nextBags = new Map(bags)
  for (const b of bridges) {
    flows.set(b.flow.id, { keyId: b.keyId, reversed: false })
    nextBags.set(b.flow.id, bridgedBag(bags.get(b.hops[0].id), bags.get(b.hops[1].id)))
  }
  const bridged = new Set(bridges.flatMap((b) => [b.via.id, b.hops[0].id, b.hops[1].id]))
  return {
    run: { ...run, flows: [...run.flows, ...bridges.map((b) => b.flow)] },
    matching: { ...matching, flows, unmatched: matching.unmatched.filter((u) => !bridged.has(u.runId)) },
    bags: nextBags,
  }
}
