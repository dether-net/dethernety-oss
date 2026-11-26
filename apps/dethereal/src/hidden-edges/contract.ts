/**
 * The hidden-edges query's contract, as Dethereal reads it: the shapes it accepts from the platform's
 * hidden-edges module, and the fixed vocabulary every hidden-edge class carries. The module's answer is untrusted
 * input: these are what it is checked against (see answer.ts).
 */
import { createHash } from 'node:crypto'

/**
 * The answer contract a check defaults to: contract 1, which every module answers. A run asks for contract 2 and
 * falls back to this one when the module does not read the option (open.ts).
 */
export const CONTRACT = 1

/** The platform module that proposes hidden edges and holds their classes: a flow of one of its classes is a hidden-edge flow. */
export const HIDDEN_EDGES_MODULE = 'dethernety-hidden-edges'

/** The class category of every class of that module. */
export const HIDDEN_EDGE_CATEGORY = 'Hidden Edge'

/** The kinds of hidden edge, one class each in that module; the answer names each candidate's class. */
export const KINDS: ReadonlySet<string> = new Set(['remote-service', 'credential-reuse', 'credential-capture', 'host-escape'])

/** Whether an element's class is one of the hidden-edges module's, as the class reference the model files hold names its module. */
export const isHiddenEdgeClass = (classData: unknown): boolean =>
  (classData as { module?: { name?: unknown } | null } | null | undefined)?.module?.name === HIDDEN_EDGES_MODULE

/** The base fields every hidden-edge class carries, with their fixed values, in order. */
export const CAPABILITIES = ['opportunistic', 'targeted', 'advanced'] as const
export const PRIVILEGES = ['none', 'user', 'admin', 'system'] as const
export const TIERS = ['high', 'medium', 'low'] as const
export type Capability = (typeof CAPABILITIES)[number]
export type Privilege = (typeof PRIVILEGES)[number]
export type Tier = (typeof TIERS)[number]

export const BASE_FIELDS = ['required_capability', 'required_privilege', 'granted_privilege'] as const
/** The fields Dethereal writes on a hidden-edge flow, the same in every class. */
export const DETHEREAL_FIELDS = ['hidden_edge_kind', 'technique_ids', 'source_exposure_ids', 'proposed_by', 'tier', 'rationale'] as const
export const RESERVED_FIELDS: ReadonlySet<string> = new Set<string>([...BASE_FIELDS, ...DETHEREAL_FIELDS])
/** The fields a class of one kind declares beyond those, with the values each allows, as the module's class schemas hold them. */
export const KIND_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'remote-service': {},
  'credential-reuse': { credential_basis: ['shared_item', 'default_account', 'instance_role', 'kerberos_realm'] },
  'credential-capture': { transport_state: ['cleartext', 'tls_unverified', 'unstated'], capture_side: ['initiator_segment', 'responder_segment', 'both'] },
  'host-escape': { escape_vector: ['configuration', 'kernel_or_runtime', 'unstated'] },
}

export interface BaseValues {
  required_capability: Capability
  required_privilege: Privilege
  granted_privilege: Privilege
}

const TECHNIQUE_IN_TEXT = /\bT\d{4}(\.\d{3})?\b|\bTA\d{4}\b/
const ids = (v: unknown, re: RegExp, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && re.test(x))
/** Each shared field's check, as the classes' schemas allow its value. */
const RESERVED_CHECKS: Record<string, (v: unknown, kind: string | null) => boolean> = {
  required_capability: (v) => (CAPABILITIES as readonly unknown[]).includes(v),
  required_privilege: (v) => (PRIVILEGES as readonly unknown[]).includes(v),
  granted_privilege: (v) => (PRIVILEGES as readonly unknown[]).includes(v),
  hidden_edge_kind: (v, kind) => kind !== null && v === kind,
  technique_ids: (v) => ids(v, ATTACK_ID, 10),
  source_exposure_ids: (v) => ids(v, PLATFORM_ID, 50),
  proposed_by: (v) => v === 'rule' || v === 'operator',
  tier: (v) => (TIERS as readonly unknown[]).includes(v),
  rationale: (v) => typeof v === 'string' && v.length <= 1000 && !TECHNIQUE_IN_TEXT.test(v),
}

/**
 * The fields of a hidden-edge flow's attributes that are its class's own, as written: the shared ones and its kind's
 * (by its `hidden_edge_kind`), each only while its value is one its class allows (technique ids only in
 * `technique_ids`, as ATT&CK ids). A field out of shape is not its class's, and is checked as any other.
 */
export function classFieldsHeld(values: Record<string, unknown>): Set<string> {
  const k = values.hidden_edge_kind
  const kind = typeof k === 'string' && KINDS.has(k) ? k : null
  const out = new Set<string>()
  for (const [f, ok] of Object.entries(RESERVED_CHECKS)) if (Object.prototype.hasOwnProperty.call(values, f) && ok(values[f], kind)) out.add(f)
  for (const [f, allowed] of Object.entries(kind ? KIND_FIELDS[kind]! : {})) if (allowed.includes(values[f] as string)) out.add(f)
  return out
}

/** The knowledge graph's state in an answer. */
export const KG_ABSENT_REASONS = ['no_data', 'not_entitled', 'no_session', 'unavailable', 'failed'] as const
export type Regime = { kg: 'kg_present' } | { kg: 'kg_absent'; reason: (typeof KG_ABSENT_REASONS)[number] }

/** The refusals the module answers in-band. */
export const REFUSAL_CODES = ['model_not_found', 'model_too_large', 'options_invalid', 'busy', 'deadline'] as const

export const CANDIDATE_ID = /^he:[0-9a-f]{16}$/
export const ATTACK_ID = /^T\d{4}(\.\d{3})?$/
export const ROW_ID = /^[a-z0-9][a-z0-9/-]{0,104}$/
export const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.-]{1,32})?$/
export const SHA256_HEX = /^[0-9a-f]{64}$/
/** A platform id, as Dethereal's inputs accept one. */
export const PLATFORM_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A candidate's id: `he:` and the first 16 hex characters of sha256 over its kind, source and target joined by NUL. */
export function candidateId(kind: string, source: string, target: string): string {
  return `he:${createHash('sha256').update(`${kind}\u0000${source}\u0000${target}`, 'utf8').digest('hex').slice(0, 16)}`
}

/** A kind's label, for a flow's name: `remote-service` → `Remote service`. */
export function kindLabel(kind: string): string {
  const words = kind.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
