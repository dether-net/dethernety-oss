/**
 * Contract 2's additions to the module's answer, checked as untrusted input: each candidate's explanation (its
 * parts, their facts and the reasons beside their tier, the remedies), and the envelope's rationale and limits.
 *
 * A candidate whose explanation fails any check is dropped; a malformed `mode` or `limits` refuses the answer; a
 * bad rationale entry is dropped and the answer stands. Every id must name an element this run read, every
 * vocabulary is closed, every list keeps its cap, and every text the module wrote goes through `shown()`.
 */
import type { ExposureState } from '../triage/exposures.js'
import { shown } from '../triage/text.js'
import { ATTACK_ID, KINDS, PLATFORM_ID, ROW_ID, TIERS, type Tier } from './contract.js'
import type { LocalModel } from './local.js'

export const ROLES = ['target', 'source', 'capture', 'credential'] as const
export const RELATIONS = [
  'same-segment', 'in-zone', 'segment-outside-anchor', 'landing-segment', 'zone-egress', 'instance-role-reach', 'kerberos-realm',
  'same-host-outside-container', 'capture-footholds', 'shared-credential',
] as const
export const FACT_EFFECTS = ['meets_gate', 'gate_unanswered', 'context', 'misses_gate', 'lowers', 'raises', 'own_target_finding', 'kg_lowered'] as const
export const BASIS_CAPS = ['pending', 'row_cap', 'technique_cap', 'low_relation', 'zone_without_own_finding', 'no_gate'] as const
export const LOW_REASONS = ['perimeter_only', 'managed_runtime', 'generic_item'] as const
export const REMEDY_OUTCOMES = ['removes', 'lowers_to:low', 'lowers_to:medium', 'this_path_only'] as const

export const EXPLAIN_LIMITS = { parts: 3, facts: 12, at: 8, value: 64, remedies: 5, set: 8, classes: 8, rationale: 200, rationaleChars: 500, gates: 24 } as const

export interface ExplainFact { at: string[]; value: boolean | number | string | null; effect: (typeof FACT_EFFECTS)[number]; gate?: number }
export interface Basis { confirmed: boolean; gates: number; gates_stated: number; raises: number; lowers: number; high_reachable: boolean; caps: string[] }
export interface ExplainPart {
  row: string; role: string; relation: string; exposure: string; anchor: string; matched: string[]; path: string; foothold: string; reached: string
  anchored_end: string | null; shared: string | null; flow: string | null; item: string | null; low: string | null; tier: Tier; basis: Basis
  facts: ExplainFact[]; facts_total: number
}
export type Remedy =
  | { set: Array<{ at: string }>; outcome: (typeof REMEDY_OUTCOMES)[number]; clears_finding?: string }
  | { control_classes: string[]; attributes_true: string[]; item_classes: string[]; on: string; outcome: (typeof REMEDY_OUTCOMES)[number] }
export type Explain =
  | { parts: ExplainPart[]; parts_total: number; crown_jewel: { source: boolean; target: boolean }; remedies: Remedy[] | null; remedies_total: number }
  | { omitted: 'size' }

export interface Limits {
  per_kind_budget: number
  max_peers: number
  by_kind: Record<string, { listed: number; not_listed: number; pairs_capped: number; anchors_over_budget: number }>
  explain_trimmed: number
  remedies_skipped: number
}

/** What a candidate's explanation is checked against: the candidate itself, and what this run read. */
export interface ExplainContext {
  local: LocalModel
  exposures: ReadonlyMap<string, ExposureState>
  /** Whether a finding on a flow sits on one of the hidden-edges module's flows (an inferred edge anchors nothing) */
  isHiddenEdgeFlow: (flowId: string, e?: ExposureState) => boolean
  /** Whether a finding is confirmed for hidden edges */
  isConfirmed: (e: ExposureState) => boolean
  /** Whether an exposure is disposed for hidden edges */
  isDisposed: (e: ExposureState) => boolean
}
export interface ExplainedCandidate { id: string; source: string; target: string; rows: string[]; technique_ids: string[]; exposure_ids: string[]; exposure_total: number; tier: Tier; kg_lowered: boolean }

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const exactKeys = (o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every((k) => own(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k))
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const strList = (v: unknown, re: RegExp, min: number, max: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => typeof x === 'string' && re.test(x))
const CLASS_NAME = /^[A-Za-z0-9][A-Za-z0-9 &/.()-]{0,63}$/
const ATTRIBUTE = /^[A-Za-z0-9_.-]{1,128}$/
/** A printable string: no control, format or separator characters. */
const PRINTABLE = /^[^\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Cs}]*$/u
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

/** Whether an id names an element this run read: a component, a boundary, a flow or a data item. */
const isElement = (local: LocalModel, id: string) => local.components.has(id) || local.boundaries.has(id) || local.flows.has(id) || local.dataItems.has(id)

/** A fact locator of the module's grammar, naming what this run read. */
function locatorOk(l: unknown, ctx: ExplainContext): l is string {
  if (typeof l !== 'string') return false
  const attr = /^attributes:([A-Za-z0-9_-]{1,128})#([A-Za-z0-9_.-]{1,128})$/.exec(l)
  if (attr) return isElement(ctx.local, attr[1]!)
  const exposure = /^exposure:([A-Za-z0-9_-]{1,128})$/.exec(l)
  if (exposure) return ctx.exposures.has(exposure[1]!)
  return /^(control:[A-Za-z0-9_-]{1,128}|kg:[\w:.-]{1,128}|kg-class:[\w:.-]{1,128})$/.test(l)
}

/** The effects whose fact may name several locators: a group's open condition, and one step for a group. */
const GROUP_EFFECTS: ReadonlySet<string> = new Set(['gate_unanswered', 'lowers', 'raises'])
const ATTRIBUTE_EFFECTS: ReadonlySet<string> = new Set(['meets_gate', 'gate_unanswered', 'context', 'misses_gate', 'lowers', 'raises'])

function factOf(v: unknown, c: ExplainedCandidate, ctx: ExplainContext, primary: boolean, gates: number): ExplainFact | null {
  const f = obj(v)
  if (!f || !exactKeys(f, ['at', 'value', 'effect'], ['gate'])) return null
  if (!Array.isArray(f.at) || f.at.length < 1 || f.at.length > EXPLAIN_LIMITS.at || !f.at.every((l) => locatorOk(l, ctx))) return null
  if (!oneOf(FACT_EFFECTS, f.effect)) return null
  if (own(f, 'gate') && !isInt(f.gate, 0, gates - 1)) return null
  const at = f.at as string[]
  // each effect names what it is about: attributes (or, for a lowering, one control), the target's own finding,
  // or the knowledge graph's evidence; only a group's fact names several
  if (at.length > 1 && !GROUP_EFFECTS.has(f.effect)) return null
  if (ATTRIBUTE_EFFECTS.has(f.effect) && !at.every((l) => l.startsWith('attributes:') || (f.effect === 'lowers' && at.length === 1 && l.startsWith('control:')))) return null
  // the knowledge graph's step is the lowered candidate's, said on its primary part only
  if (f.effect === 'kg_lowered' && (!c.kg_lowered || !primary || !at.every((l) => l.startsWith('kg:') || l.startsWith('kg-class:')))) return null
  if (f.effect === 'own_target_finding') {
    const own = at.length === 1 && at[0]!.startsWith('exposure:') ? ctx.exposures.get(at[0]!.slice('exposure:'.length)) : undefined
    if (!own || own.element_id !== c.target || !ctx.isConfirmed(own)) return null
  }
  // a value is stated for one attribute only
  const single = at.length === 1 && at[0]!.startsWith('attributes:')
  let value: ExplainFact['value']
  if (f.value === null) value = null
  else if (!single) return null
  else if (typeof f.value === 'boolean') value = f.value
  else if (typeof f.value === 'number' && Number.isFinite(f.value)) value = f.value
  else if (typeof f.value === 'string' && [...f.value].length <= EXPLAIN_LIMITS.value && PRINTABLE.test(f.value)) value = shown(f.value)
  else return null
  return { at: [...at], value, effect: f.effect, ...(own(f, 'gate') ? { gate: f.gate as number } : {}) }
}

function basisOf(v: unknown): Basis | null {
  const b = obj(v)
  if (!b || !exactKeys(b, ['confirmed', 'gates', 'gates_stated', 'raises', 'lowers', 'high_reachable', 'caps'])) return null
  if (typeof b.confirmed !== 'boolean' || typeof b.high_reachable !== 'boolean') return null
  if (!isInt(b.gates, 0, EXPLAIN_LIMITS.gates) || !isInt(b.gates_stated, 0, b.gates as number) || !isInt(b.raises, 0, 64) || !isInt(b.lowers, 0, 64)) return null
  if (!Array.isArray(b.caps) || b.caps.length > BASIS_CAPS.length || !b.caps.every((c) => oneOf(BASIS_CAPS, c)) || new Set(b.caps).size !== b.caps.length) return null
  return { confirmed: b.confirmed, gates: b.gates, gates_stated: b.gates_stated, raises: b.raises, lowers: b.lowers, high_reachable: b.high_reachable, caps: [...(b.caps as string[])] }
}

const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 }

function partOf(v: unknown, c: ExplainedCandidate, ctx: ExplainContext, primary: boolean): ExplainPart | null {
  const p = obj(v)
  const keys = ['row', 'role', 'relation', 'exposure', 'anchor', 'matched', 'path', 'foothold', 'reached', 'anchored_end', 'shared', 'flow', 'item', 'low', 'tier', 'basis', 'facts', 'facts_total']
  if (!p || !exactKeys(p, keys)) return null
  if (typeof p.row !== 'string' || !ROW_ID.test(p.row) || !c.rows.includes(p.row) || !oneOf(ROLES, p.role) || !oneOf(RELATIONS, p.relation)) return null
  // the finding the part rests on: of this run's read, not disposed and not on an inferred edge; one of the
  // candidate's own when its list was not cut
  if (typeof p.exposure !== 'string' || !PLATFORM_ID.test(p.exposure)) return null
  const e = ctx.exposures.get(p.exposure)
  if (!e || ctx.isDisposed(e) || (e.element_kind === 'dataFlow' && ctx.isHiddenEdgeFlow(e.element_id, e))) return null
  if (c.exposure_total <= 50 && !c.exposure_ids.includes(p.exposure)) return null
  // the anchor is that finding's element, and the techniques that chose the row are its own
  if (p.anchor !== e.element_id) return null
  if (!strList(p.matched, ATTACK_ID, 1, 32) || !p.matched.every((t) => e.attack_ids.includes(t))) return null
  if (typeof p.path !== 'string' || !c.technique_ids.includes(p.path)) return null
  if (p.foothold !== c.source || p.reached !== c.target) return null
  const flow = p.flow === null ? null : typeof p.flow === 'string' ? ctx.local.flows.get(p.flow) : undefined
  if (flow === undefined) return null
  // an inferred edge is no flow a credential crosses or an anchor sits on
  if (flow && ctx.isHiddenEdgeFlow(flow.id)) return null
  if (p.anchored_end !== null && (!flow || (p.anchored_end !== flow.source && p.anchored_end !== flow.target))) return null
  if (p.shared !== null && !(typeof p.shared === 'string' && ctx.local.boundaries.has(p.shared))) return null
  if (p.item !== null && !(typeof p.item === 'string' && ctx.local.dataItems.has(p.item))) return null
  if (p.low !== null && !oneOf(LOW_REASONS, p.low)) return null
  // a part's tier is the candidate's, or one step above when the knowledge graph lowered the candidate
  if (!oneOf(TIERS, p.tier) || TIER_RANK[p.tier] !== TIER_RANK[c.tier] + (c.kg_lowered ? 1 : 0)) return null
  const basis = basisOf(p.basis)
  if (!basis) return null
  // the basis agrees with the finding read and with the part: its lifecycle, a low relation, no condition to state,
  // and the tiers those allow
  const confirmed = ctx.isConfirmed(e)
  if (basis.confirmed !== confirmed || basis.caps.includes('pending') === confirmed) return null
  if (basis.caps.includes('low_relation') !== (p.low !== null) || basis.caps.includes('no_gate') !== (basis.gates === 0)) return null
  if ((!confirmed && p.tier === 'high') || (p.low !== null && p.tier !== 'low')) return null
  if (!Array.isArray(p.facts) || p.facts.length > EXPLAIN_LIMITS.facts || !isInt(p.facts_total, p.facts.length, 1e6)) return null
  const facts = p.facts.map((f) => factOf(f, c, ctx, primary, basis.gates))
  if (facts.some((f) => !f)) return null
  return {
    row: p.row, role: p.role, relation: p.relation, exposure: p.exposure, anchor: p.anchor as string, matched: [...p.matched], path: p.path,
    foothold: c.source, reached: c.target, anchored_end: p.anchored_end as string | null, shared: p.shared as string | null, flow: p.flow as string | null,
    item: p.item as string | null, low: p.low as string | null, tier: p.tier, basis, facts: facts as ExplainFact[], facts_total: p.facts_total,
  }
}

/** A remedy, checked; `partsRank` is the parts' own tier (before the knowledge graph), which a lowering is below. */
function remedyOf(v: unknown, partsRank: number, ctx: ExplainContext): Remedy | null {
  const r = obj(v)
  if (!r || !oneOf(REMEDY_OUTCOMES, r.outcome)) return null
  if (r.outcome.startsWith('lowers_to:') && TIER_RANK[r.outcome.slice('lowers_to:'.length) as Tier] >= partsRank) return null
  if (own(r, 'set')) {
    if (!exactKeys(r, ['set', 'outcome'], ['clears_finding'])) return null
    if (!Array.isArray(r.set) || r.set.length < 1 || r.set.length > EXPLAIN_LIMITS.set) return null
    const set = r.set.map((x) => obj(x))
    if (!set.every((x) => x && exactKeys(x, ['at']) && typeof x.at === 'string' && x.at.startsWith('attributes:') && locatorOk(x.at, ctx))) return null
    // one change on one element: every attribute on it, and the finding it clears sits on it
    const elements = new Set(set.map((x) => (x!.at as string).slice('attributes:'.length).split('#')[0]))
    if (elements.size !== 1) return null
    const [el] = elements
    if (own(r, 'clears_finding') && !(typeof r.clears_finding === 'string' && ctx.exposures.get(r.clears_finding)?.element_id === el)) return null
    return { set: set.map((x) => ({ at: x!.at as string })), outcome: r.outcome, ...(own(r, 'clears_finding') ? { clears_finding: r.clears_finding as string } : {}) }
  }
  if (!exactKeys(r, ['control_classes', 'attributes_true', 'item_classes', 'on', 'outcome'])) return null
  if (!strList(r.control_classes, CLASS_NAME, 1, EXPLAIN_LIMITS.classes) || !strList(r.attributes_true, ATTRIBUTE, 0, EXPLAIN_LIMITS.classes) || !strList(r.item_classes, CLASS_NAME, 0, EXPLAIN_LIMITS.classes)) return null
  if (typeof r.on !== 'string' || !isElement(ctx.local, r.on)) return null
  return { control_classes: r.control_classes.map((x) => shown(x)), attributes_true: [...r.attributes_true], item_classes: r.item_classes.map((x) => shown(x)), on: r.on, outcome: r.outcome }
}

/** A candidate's explanation, checked; null when any part of it fails (the candidate is then dropped). */
export function explainOf(v: unknown, c: ExplainedCandidate, ctx: ExplainContext): Explain | null {
  const x = obj(v)
  if (!x) return null
  if (own(x, 'omitted')) return exactKeys(x, ['omitted']) && x.omitted === 'size' ? { omitted: 'size' } : null
  if (!exactKeys(x, ['parts', 'parts_total', 'crown_jewel', 'remedies', 'remedies_total'])) return null
  if (!Array.isArray(x.parts) || x.parts.length < 1 || x.parts.length > EXPLAIN_LIMITS.parts || !isInt(x.parts_total, x.parts.length, 1e6)) return null
  const parts = x.parts.map((p, i) => partOf(p, c, ctx, i === 0))
  if (parts.some((p) => !p)) return null
  const cj = obj(x.crown_jewel)
  if (!cj || !exactKeys(cj, ['source', 'target']) || typeof cj.source !== 'boolean' || typeof cj.target !== 'boolean') return null
  let remedies: Remedy[] | null = null
  if (x.remedies !== null) {
    if (!Array.isArray(x.remedies) || x.remedies.length > EXPLAIN_LIMITS.remedies) return null
    const list = x.remedies.map((r) => remedyOf(r, TIER_RANK[c.tier] + (c.kg_lowered ? 1 : 0), ctx))
    if (list.some((r) => !r)) return null
    remedies = list as Remedy[]
  }
  if (!isInt(x.remedies_total, remedies?.length ?? 0, 1e6)) return null
  return { parts: parts as ExplainPart[], parts_total: x.parts_total, crown_jewel: { source: cj.source, target: cj.target }, remedies, remedies_total: x.remedies_total }
}

/** The envelope's limits, or null when malformed (the answer is then refused). */
export function limitsOf(v: unknown): Limits | null {
  const l = obj(v)
  if (!l || !exactKeys(l, ['per_kind_budget', 'max_peers', 'by_kind', 'explain_trimmed', 'remedies_skipped'])) return null
  if (![l.per_kind_budget, l.max_peers, l.explain_trimmed, l.remedies_skipped].every((n) => isInt(n, 0, 1e9))) return null
  const byKind = obj(l.by_kind)
  if (!byKind) return null
  const out: Limits['by_kind'] = {}
  for (const [kind, raw] of Object.entries(byKind)) {
    // a kind this Dethereal does not know: its candidates are dropped, so its limits say nothing here
    if (!KINDS.has(kind)) continue
    const k = obj(raw)
    if (!k || !exactKeys(k, ['listed', 'not_listed', 'pairs_capped', 'anchors_over_budget']) || !Object.values(k).every((n) => isInt(n, 0, 1e9))) return null
    out[kind] = { listed: k.listed as number, not_listed: k.not_listed as number, pairs_capped: k.pairs_capped as number, anchors_over_budget: k.anchors_over_budget as number }
  }
  return { per_kind_budget: l.per_kind_budget as number, max_peers: l.max_peers as number, by_kind: out, explain_trimmed: l.explain_trimmed as number, remedies_skipped: l.remedies_skipped as number }
}

/**
 * The rules' rationale, row by row: a malformed entry is dropped; null when it is no object (the answer is then
 * refused). The caller keeps only the rows its candidates use.
 */
export function rationaleOf(v: unknown): Record<string, string> | null {
  const r = obj(v)
  if (!r) return null
  const out: Record<string, string> = {}
  for (const [row, text] of Object.entries(r).slice(0, EXPLAIN_LIMITS.rationale)) {
    if (ROW_ID.test(row) && typeof text === 'string' && text.length <= EXPLAIN_LIMITS.rationaleChars && PRINTABLE_ASCII.test(text)) out[row] = shown(text, EXPLAIN_LIMITS.rationaleChars + 1)
  }
  return out
}
