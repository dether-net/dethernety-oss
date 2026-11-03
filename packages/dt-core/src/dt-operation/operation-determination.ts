/**
 * Pure operation determination: who runs an element's own software, and which boundary runs the
 * environment it is drawn in. No I/O, no Apollo, no Vue-Flow: a deterministic leaf module over the
 * attribute bags of an element's class edges.
 *
 * The platform serves three operation fields on component and boundary class templates (the keys
 * below). A component's operator says who builds or runs its own software. A boundary's operator says
 * who runs the execution environment of what is drawn directly in it, which makes that boundary the
 * hosting boundary of those elements. An element never takes its operator from a boundary.
 */
import type { Zone } from '../interfaces/core-types-interface.js'
import type { AttributeElementType } from '../schemas/attributes.schema.js'

// ── Keys and values ───────────────────────────────────────────────────────────────────────────

/** Who runs the element's own software (component) or the environment it draws (boundary). */
export const OPERATION_OPERATOR_KEY = 'dethernety_operated_by'
/** The vendor and product name. */
export const OPERATION_PRODUCT_KEY = 'dethernety_product'
/** The version the customer runs. Components only. */
export const OPERATION_VERSION_KEY = 'dethernety_product_version'

/** Every attribute key starting with this prefix (exact case) is reserved for platform-served fields. */
export const RESERVED_ATTRIBUTE_PREFIX = 'dethernety_'

export const OPERATOR_VALUES = Object.freeze(['CUSTOMER', 'VENDOR'] as const)
export type OperatorValue = (typeof OPERATOR_VALUES)[number]

/** The class types that carry operation fields, and which fields each carries. */
export const OPERATION_FIELD_KEYS = Object.freeze({
  component: Object.freeze([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY] as const),
  securityBoundary: Object.freeze([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY] as const),
})
export type OperatedClassType = keyof typeof OPERATION_FIELD_KEYS

/** The label of the category the fields are served under, per class type. */
export const OPERATION_CATEGORY_LABEL: Readonly<Record<OperatedClassType, string>> = Object.freeze({
  component: 'Operation & version',
  securityBoundary: 'Operation',
})

// ── Reading a value ───────────────────────────────────────────────────────────────────────────

export type OperationAttributeBag = Record<string, unknown> | null | undefined

export interface OperatorReading {
  party: OperatorValue
  /** `invalid`: a value outside `OPERATOR_VALUES`, a list or object, or edges that disagree. */
  source: 'declared' | 'invalid'
}

/** A value that answers nothing: absent, null, or an empty string. */
function isUnanswered(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/** Whether `key` stores the operator in a flattened list or object form (`…[0]`, `….x`). */
function isFlattenedOperatorKey(key: string): boolean {
  return key.startsWith(`${OPERATION_OPERATOR_KEY}[`) || key.startsWith(`${OPERATION_OPERATOR_KEY}.`)
}

/**
 * Read the operator from the attribute bags of an element's class edges. `null` when no bag answers
 * it. A valid value read the same on every edge that answers is `declared`; anything else, including
 * a list or object (stored flattened or not) or edges that disagree, is `CUSTOMER` with source `invalid`.
 */
export function readOperator(bags: readonly OperationAttributeBag[]): OperatorReading | null {
  const values: unknown[] = []
  let invalid = false
  for (const bag of bags) {
    if (!bag) continue
    for (const key of Object.keys(bag)) {
      if (isFlattenedOperatorKey(key) && !isUnanswered(bag[key])) invalid = true
    }
    if (!isUnanswered(bag[OPERATION_OPERATOR_KEY])) values.push(bag[OPERATION_OPERATOR_KEY])
  }
  if (!invalid && values.length === 0) return null
  const first = values[0]
  const valid =
    !invalid &&
    typeof first === 'string' &&
    (OPERATOR_VALUES as readonly string[]).includes(first) &&
    values.every((v) => v === first)
  return valid ? { party: first as OperatorValue, source: 'declared' } : { party: 'CUSTOMER', source: 'invalid' }
}

// ── Operator and hosting ──────────────────────────────────────────────────────────────────────

export type OperatorSource = 'declared' | 'invalid' | 'zone' | 'default'

export interface OperatorResolution {
  party: OperatorValue
  source: OperatorSource
}

/**
 * Who runs an element's own software: its own value, else `VENDOR` when its effective zone is
 * `VENDOR`, else `CUSTOMER`. Only the element's own class edges are read; a boundary's value never
 * becomes the operator of what is drawn in it.
 */
export function operatorOf(input: { bags: readonly OperationAttributeBag[]; effectiveZone: Zone }): OperatorResolution {
  const reading = readOperator(input.bags)
  if (reading) return reading
  return input.effectiveZone === 'VENDOR' ? { party: 'VENDOR', source: 'zone' } : { party: 'CUSTOMER', source: 'default' }
}

export interface HostingParent {
  id: string
  classed: boolean
  isDefaultBoundary: boolean
  bags: readonly OperationAttributeBag[]
}

export interface HostingResolution {
  party: OperatorValue
  /** `undeclared`: no parent, the default boundary, an unclassed parent, or a parent without a value. */
  source: 'declared' | 'invalid' | 'undeclared'
  /** The hosting boundary, when its value was read. */
  boundaryId?: string
}

/**
 * The hosting boundary: the element's direct parent boundary, when it is classed and carries a value.
 * The model's default boundary never hosts. Without a hosting boundary the environment counts as the
 * customer's (`undeclared`).
 */
export function hostingOf(parent: HostingParent | undefined): HostingResolution {
  if (!parent || parent.isDefaultBoundary || !parent.classed) return { party: 'CUSTOMER', source: 'undeclared' }
  const reading = readOperator(parent.bags)
  if (!reading) return { party: 'CUSTOMER', source: 'undeclared' }
  return { party: reading.party, source: reading.source, boundaryId: parent.id }
}

/** Weakest first: a flow is only as established as its least established end. */
const SOURCE_STRENGTH: Record<OperatorSource, number> = { invalid: 0, default: 1, zone: 2, declared: 3 }

/**
 * A flow's operator: `VENDOR` when it has ends and every end resolves `VENDOR`, else `CUSTOMER`.
 * Its source is the weakest of its ends' sources; a flow without ends is `CUSTOMER` by default.
 */
export function resolveFlowOperator(ends: readonly OperatorResolution[]): OperatorResolution {
  if (ends.length === 0) return { party: 'CUSTOMER', source: 'default' }
  const weakest = ends.reduce((a, b) => (SOURCE_STRENGTH[b.source] < SOURCE_STRENGTH[a.source] ? b : a)).source
  const party: OperatorValue = ends.every((e) => e.party === 'VENDOR') ? 'VENDOR' : 'CUSTOMER'
  return { party, source: weakest }
}

// ── Who holds each side ───────────────────────────────────────────────────────────────────────

/**
 * - `configuration`: a setting offered to whoever deploys or uses the element.
 * - `build`: the element's own software: how it is made, what it is given, its patch level.
 * - `runtime`: the execution environment the element runs in, below its own software.
 */
export type OperationSide = 'configuration' | 'build' | 'runtime'
export type OperationParty = 'customer' | 'vendor'

const partyOf = (operator: OperatorValue): OperationParty => (operator === 'VENDOR' ? 'vendor' : 'customer')

/**
 * Who holds one side of an element. Configuration is always the customer's, and so is everything of
 * a data item. A flow's build and runtime follow its operator. A component's or boundary's build
 * follows its operator; its runtime follows a declared hosting boundary, else its operator.
 */
export function sideHolder(input: {
  kind: AttributeElementType
  operator: OperatorValue
  hosting?: HostingResolution
  side: OperationSide
}): OperationParty {
  if (input.kind === 'dataItem' || input.side === 'configuration') return 'customer'
  if (input.kind === 'dataFlow' || input.side === 'build') return partyOf(input.operator)
  return input.hosting?.source === 'declared' ? partyOf(input.hosting.party) : partyOf(input.operator)
}
