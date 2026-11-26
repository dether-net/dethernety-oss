// A frozen copy of the file Dethereal 0.7.0 shipped, kept so the module's contract-1 answers are checked against
// the released client's own validator. Never edit it: only its type-only imports point at today's types.
/**
 * The module's answer, checked as untrusted input. The answer is refused whole when its envelope is wrong (its
 * contract, keys or caps, an id that is no string); a candidate is dropped, and counted, when a decision of this
 * machine already stands for it (whatever the module did with `excluded`), or when it does not hold:
 * its shape and caps, its kind one of the hidden-edge kinds, its class one of the hidden-edges module's classes on the
 * platform, its id its kind's and ends', its ends components of
 * this model that the platform and the local files both have, distinct and not both external, every cited exposure
 * in this run's read, not disposed and not on a hidden-edge flow, and every fact a locator of the module's grammar
 * (an `exposure:` fact naming an exposure of this run's read).
 */
import type { ExposureState, Lifecycle } from '../../../triage/exposures.js'
import {
  ATTACK_ID, BASE_FIELDS, CANDIDATE_ID, CAPABILITIES, CONTRACT, KG_ABSENT_REASONS, KINDS, PLATFORM_ID, PRIVILEGES, REFUSAL_CODES, RESERVED_FIELDS, ROW_ID, SHA256_HEX,
  TIERS, VERSION, candidateId, type BaseValues, type Regime, type Tier,
} from './contract.js'
import type { LocalModel } from '../../local.js'

/**
 * An exposure's lifecycle for hidden edges, as the module reads it: triage's, except that RISK_ACCEPTED is
 * confirmed and COMPENSATING_CONTROL pending, since the weakness is still there.
 */
export function edgeLifecycle(e: ExposureState): Lifecycle {
  if (e.disposition_kind === 'RISK_ACCEPTED') return 'confirmed'
  if (e.disposition_kind === 'COMPENSATING_CONTROL') return 'pending'
  return e.lifecycle
}

export const ANSWER_LIMITS = { candidates: 200, listEntries: 50, techniques: 10, rows: 30, fields: 10 } as const

/** A hidden-edge class as the platform holds it, with its module. */
export interface HiddenEdgeClass {
  id: string
  name: string
  module: { id: string; name: string }
}

export interface Candidate {
  id: string
  kind: string
  /** The class an accepted edge is written with: the one the module named, as the platform holds it */
  class: HiddenEdgeClass
  source: string
  target: string
  technique_ids: string[]
  cited_techniques: string[]
  exposure_ids: string[]
  tier: Tier
  defaults: BaseValues
  fields: Record<string, string>
  facts: string[]
  /** The knowledge graph lowered the tier */
  kg_lowered: boolean
  /** Every cited exposure is pending: never in accept-all */
  pending_only: boolean
}

export interface AnswerHeader {
  version: string
  table_hash: string
  regime: Regime
}

export type AnswerResult =
  | { status: 'refused'; code: string; detail: string }
  | { status: 'ok'; header: AnswerHeader; candidates: Candidate[]; dropped: number; excluded: number; counts: Record<string, number> }

export interface ValidationContext {
  local: LocalModel
  /** sync.json's synced component ids */
  components: ReadonlySet<string>
  exposures: ReadonlyMap<string, ExposureState>
  /** The candidate ids a standing decision keeps out */
  excluded: ReadonlySet<string>
  /** The hidden-edges module's data flow classes on the platform, by id */
  classes: ReadonlyMap<string, HiddenEdgeClass>
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const exactKeys = (o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every((k) => own(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k))
const strList = (v: unknown, re: RegExp, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && re.test(x))
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)

function regimeOf(v: unknown): Regime | null {
  const o = obj(v)
  if (o?.kg === 'kg_present' && exactKeys(o, ['kg'])) return { kg: 'kg_present' }
  if (o?.kg === 'kg_absent' && exactKeys(o, ['kg', 'reason']) && oneOf(KG_ABSENT_REASONS, o.reason)) return { kg: 'kg_absent', reason: o.reason as (typeof KG_ABSENT_REASONS)[number] }
  return null
}

function baseOf(v: unknown): BaseValues | null {
  const o = obj(v)
  if (!o || !exactKeys(o, BASE_FIELDS) || !oneOf(CAPABILITIES, o.required_capability) || !oneOf(PRIVILEGES, o.required_privilege) || !oneOf(PRIVILEGES, o.granted_privilege)) return null
  return { required_capability: o.required_capability, required_privilege: o.required_privilege, granted_privilege: o.granted_privilege } as BaseValues
}

const ANSWER_KEYS = ['contract', 'module', 'version', 'table_hash', 'regime', 'candidates', 'counts'] as const
const CANDIDATE_KEYS = ['id', 'kind', 'class', 'source', 'target', 'technique_ids', 'cited_techniques', 'exposure_ids', 'rows', 'tier', 'defaults', 'fields', 'facts', 'totals'] as const
/** The module's fact locators: an attribute of an element, a control, an exposure, a knowledge-graph rule or class. */
export const FACT = /^(attributes:[A-Za-z0-9_-]{1,128}#[A-Za-z0-9_.-]{1,128}|control:[A-Za-z0-9_-]{1,128}|exposure:[A-Za-z0-9_-]{1,128}|kg:[\w:.-]{1,128}|kg-class:[\w:.-]{1,128})$/
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/
const FIELD_VALUE = /^[a-z0-9_-]{1,64}$/

/** Parse and check the module's answer against the run's context. */
export function validateAnswer(raw: string, ctx: ValidationContext): AnswerResult {
  const refuse = (code: string, detail: string): AnswerResult => ({ status: 'refused', code, detail })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return refuse('answer_invalid', 'the answer is no JSON')
  }
  const a = obj(parsed)
  if (!a) return refuse('answer_invalid', 'the answer is no object')
  if (a.contract !== CONTRACT) return refuse('contract_mismatch', `the answer is not contract ${CONTRACT}: update Dethereal or the platform`)
  if (own(a, 'refusal')) {
    const r = obj(a.refusal)
    return r && oneOf(REFUSAL_CODES, r.code) ? refuse(`module_${r.code as string}`, 'the module refused the call') : refuse('answer_invalid', 'the refusal is malformed')
  }
  if (!exactKeys(a, ANSWER_KEYS)) return refuse('answer_invalid', 'the answer has missing or unknown keys')
  if (typeof a.version !== 'string' || !VERSION.test(a.version) || typeof a.table_hash !== 'string' || !SHA256_HEX.test(a.table_hash)) return refuse('answer_invalid', 'the version or table hash is malformed')
  const regime = regimeOf(a.regime)
  const counts = obj(a.counts)
  if (!regime || !counts) return refuse('answer_invalid', 'the regime or the counts are malformed')
  if (!Array.isArray(a.candidates) || a.candidates.length > ANSWER_LIMITS.candidates) return refuse('answer_invalid', `the answer holds no candidate list, or more than ${ANSWER_LIMITS.candidates}`)
  // An id that is no string is no candidate this answer can be held to: the answer is refused.
  if (a.candidates.some((c) => typeof obj(c)?.id !== 'string')) return refuse('answer_invalid', 'a candidate id is no string')
  const numbers: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts).slice(0, 64)) if (/^[a-z_]{1,64}$/.test(k) && isInt(v, 0, 1e9)) numbers[k] = v

  // Each kind names one class, and no class two kinds: an answer that mixes them up is refused.
  const classOfKind = new Map<string, string>()
  const kindOfClass = new Map<string, string>()
  for (const c of a.candidates) {
    const { kind, class: named } = obj(c)!
    const id = obj(named)?.id
    if (typeof kind !== 'string' || typeof id !== 'string') continue
    if ((classOfKind.get(kind) ?? id) !== id || (kindOfClass.get(id) ?? kind) !== kind) return refuse('answer_invalid', 'the answer names one class for two kinds, or two classes for one kind')
    classOfKind.set(kind, id)
    kindOfClass.set(id, kind)
  }

  const candidates: Candidate[] = []
  const seen = new Set<string>()
  let dropped = 0
  let excluded = 0
  for (const c of a.candidates) {
    if (ctx.excluded.has(obj(c)!.id as string)) {
      excluded++
      continue
    }
    const v = checkCandidate(obj(c)!, ctx)
    if (!v || seen.has(v.id)) dropped++
    else {
      seen.add(v.id)
      candidates.push(v)
    }
  }
  return { status: 'ok', header: { version: a.version, table_hash: a.table_hash, regime }, candidates, dropped, excluded, counts: numbers }
}

/** One candidate checked, or null when it is dropped. */
function checkCandidate(c: Record<string, unknown>, ctx: ValidationContext): Candidate | null {
  if (!exactKeys(c, CANDIDATE_KEYS, ['kg'])) return null
  const { id, kind, source, target } = c
  if (typeof id !== 'string' || !CANDIDATE_ID.test(id) || typeof kind !== 'string' || !KINDS.has(kind)) return null
  if (typeof source !== 'string' || !PLATFORM_ID.test(source) || typeof target !== 'string' || !PLATFORM_ID.test(target)) return null
  if (candidateId(kind, source, target) !== id) return null
  // The class: one the module named, and one of the module's classes on the platform.
  const named = obj(c.class)
  const cls = named && exactKeys(named, ['id', 'name']) && typeof named.id === 'string' && typeof named.name === 'string' ? ctx.classes.get(named.id) : undefined
  if (!cls) return null
  if (!strList(c.technique_ids, ATTACK_ID, ANSWER_LIMITS.techniques) || c.technique_ids.length === 0 || !strList(c.cited_techniques, ATTACK_ID, ANSWER_LIMITS.listEntries)) return null
  if (!strList(c.exposure_ids, PLATFORM_ID, ANSWER_LIMITS.listEntries) || c.exposure_ids.length === 0 || !strList(c.rows, ROW_ID, ANSWER_LIMITS.rows)) return null
  if (!oneOf(TIERS, c.tier) || !strList(c.facts, FACT, ANSWER_LIMITS.listEntries) || (own(c, 'kg') && c.kg !== 'lowered')) return null
  const totals = obj(c.totals)
  if (!totals || !exactKeys(totals, ['exposure_ids', 'facts', 'cited_techniques']) || !Object.values(totals).every((x) => isInt(x, 0, 1e6))) return null
  const defaults = baseOf(c.defaults)
  const fields = obj(c.fields)
  if (!defaults || !fields || Object.keys(fields).length > ANSWER_LIMITS.fields) return null
  for (const [k, v] of Object.entries(fields)) if (!FIELD_NAME.test(k) || RESERVED_FIELDS.has(k) || typeof v !== 'string' || !FIELD_VALUE.test(v)) return null

  // The ends: components the platform and the local files both have, distinct, not both external.
  const s = ctx.local.components.get(source)
  const t = ctx.local.components.get(target)
  if (!s || !t || !ctx.components.has(source) || !ctx.components.has(target) || source === target) return null
  if (s.type === 'EXTERNAL_ENTITY' && t.type === 'EXTERNAL_ENTITY') return null

  // A fact naming an exposure names one of this run's read.
  if (c.facts.some((f) => f.startsWith('exposure:') && !ctx.exposures.has(f.slice('exposure:'.length)))) return null

  // The cited exposures: in this run's read, not disposed for hidden edges, never on a hidden-edge flow (an inferred edge anchors nothing).
  const exposures = c.exposure_ids.map((e) => ctx.exposures.get(e))
  if (exposures.some((e) => !e || edgeLifecycle(e) === 'disposed')) return null
  if (exposures.some((e) => e!.element_kind === 'dataFlow' && ctx.classes.has(ctx.local.flows.get(e!.element_id)?.classId ?? e!.element_class?.id ?? ''))) return null
  return {
    id, kind, class: cls, source, target, technique_ids: [...new Set(c.technique_ids)], cited_techniques: [...c.cited_techniques], exposure_ids: [...new Set(c.exposure_ids)],
    tier: c.tier as Tier, defaults, fields: { ...(fields as Record<string, string>) }, facts: [...c.facts], kg_lowered: c.kg === 'lowered',
    pending_only: exposures.every((e) => edgeLifecycle(e!) === 'pending'),
  }
}
