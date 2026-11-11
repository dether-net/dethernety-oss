/**
 * The quality gates, computed from the model files.
 *
 * - **Gate 1** (advisory) — shape problems worth fixing while modeling.
 * - **Gate 2** (blocking push) — the model is complete and consistent enough to sync.
 * - **Gate 3** (blocking REVIEWED) — criteria C1–C9 over the security answers.
 *   No quality-score threshold takes part: the score is reported elsewhere and
 *   never gates.
 *
 * Gate 3 certifies that the recorded answers are complete and consistent, not
 * that they are true. It refuses the cheap ways to look complete — a placeholder
 * such as `"unknown"` or `""` (a "stand-in"), a value its class template does
 * not allow, a missing template — and it reports, without gating, how many
 * answers are type defaults or template defaults, so a reviewer can see a
 * model that was answered without looking. An honest `"none"`, `false` or `[]`
 * is an answer.
 *
 * Every read of a committed `.dethereal/` file goes through the state store's
 * checked reader (confined, no symlinks, size-capped). `state.json` is not
 * read here: the one thing from it that can change a verdict is a waiver the
 * caller passes in, and only a waiver signed on this machine by the waive
 * tool counts (a legacy blanket waiver never does).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants as fsConstants, realpathSync } from 'node:fs'
import os from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { promises as fs } from 'fs'
import path from 'path'
import { buildZoningContext, flattenStructure, isStructuralContainer, normaliseControlName } from '@dethernety/dt-core'
import type {
  ConsolidatedAttributesFile,
  DataFlow,
  ElementAttributes,
  ModelManifest,
  ModelStructure,
  SchemaDataItem as DataItem,
  StructureBoundary,
  StructureComponent,
} from '@dethernety/dt-core'
import { type AttributeReadIssue, readAttributes } from './directory-utils.js'
import { StateFileError, readChecked, readRepoJson, retryTransient } from './state-store.js'
import { type FileLockHandle, withFileLock } from './file-lock.js'
import { classifyTiers, crossBoundaryComponentIds, proposedZoneTier, type Tier, type Tiering } from './tiers.js'
import { getProjectRoot, resolveProjectRoot } from './project-root.js'

// =============================================================================
// Values
// =============================================================================

import { TRANSIT_ALIASES, transitAliasesOnly,
  declaresNoAuthentication,
  isNotApplicable,
  ELEMENT_ID,
  isPlaceholderList,
  isPlaceholderText,
  isPlaceholderToken,
  isRealListEntry,
  isStandIn,
  normToken,
  isTypeDefault,
  isValidForSchema,
  regulatoryFlagFloor,
  SENSITIVITY_SCALE,
  sensitivityRank,
  computeLints,
  hasMixedScriptWord,
  type LintFinding,
} from './lints.js'
import { sha256Hex } from './hash.js'
import { canonicalJson } from './canonical-json.js'
import { deriveManifestModules, moduleRef, type DerivedModules, type ModuleGap, type ModuleRef } from './manifest-modules.js'
import { settlementOn, type SettlementMode } from './settlement-switch.js'

export {
  canonicalFlag,
  isNotApplicable,
  NOT_APPLICABLE_SPELLINGS,
  ELEMENT_ID,
  isPlaceholderList,
  isPlaceholderText,
  isPlaceholderToken,
  isRealListEntry,
  isStandIn,
  isTypeDefault,
  isValidForSchema,
  normToken,
  REGULATORY_FLAG_FLOORS,
  SENSITIVITY_SCALE,
  sensitivityRank,
  STAND_INS,
  type LintFinding,
} from './lints.js'

const own = (o: unknown, k: string): boolean =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const present = (o: Record<string, unknown>, k: string): boolean => own(o, k) && o[k] !== null && o[k] !== undefined

/** Sensitivity floors of the stock data classes, by class id. */
export const CLASS_FLOOR_IDS: Readonly<Record<string, number>> = {
  'a6406f69-a0ec-48c9-a9dd-27b3c03bbda8': 3, // User Credentials
  '2bc04479-7e0c-43f2-88b5-9fe788860642': 3, // Authentication Tokens
  '7d6f45d4-3b84-49f3-8085-7105b0448706': 2, // Customer & Personal Data
}

/** Whole-word class-name rules for classes outside the fixed table. */
const RESTRICTED_CLASS_WORDS =
  /\b(credentials?|tokens?|secrets?|passwords?|(private|signing|encryption|api)[ _-]?keys?|sessions?|cookies?|jwts?|payments?|cards?|cardholders?|health|medical|phi)\b/i
const CONFIDENTIAL_CLASS_WORDS = /\b(personal|customers?|pii)\b/i

export { TRANSIT_ALIASES, transitAliasesOnly } from './lints.js'

/**
 * `encryption_at_rest: "not_applicable"` is an honest answer for a component that
 * stores nothing. On a store it is a stand-in: a store always holds data at rest,
 * so the answer says nothing. Every spelling of it counts the same (any case,
 * surrounding spaces ignored, and n/a, "not applicable", not-applicable), so no
 * spelling slips past the store rule as an ordinary string. `none` is not one of
 * them: it is an honest "unencrypted".
 */
export const NOT_APPLICABLE = 'not_applicable'

/** The values a field's schema lists (`enum`, or `items.enum` for a list), or null. */
function enumMembers(schema: unknown): unknown[] | null {
  if (!schema || typeof schema !== 'object') return null
  const s = schema as { enum?: unknown; items?: { enum?: unknown } }
  if (Array.isArray(s.enum)) return s.enum
  if (s.items && typeof s.items === 'object' && Array.isArray(s.items.enum)) return s.items.enum
  return null
}

/**
 * A present value that stands in for an answer, as the gates judge it: a
 * stand-in, placeholder text ("TBD", "not specified", "?"), a not-applicable
 * spelling on any key but `encryption_at_rest` (there the process/store rule
 * decides), or a list with an entry that names nothing (`["None"]`, `[null]`).
 * A value the field's own schema lists is an answer ("PENDING" in a status
 * enum), except the stand-ins themselves. Honest negatives ("none", "not
 * encrypted", `false`, `[]`) are answers.
 */
export function isGateStandIn(value: unknown, key: string, schema?: unknown): boolean {
  if (value === null || value === undefined) return false
  if (isStandIn(value)) return true
  const members = enumMembers(schema)
  if (typeof value === 'string') {
    if (members?.includes(value)) return false
    return isPlaceholderText(value) || (key !== 'encryption_at_rest' && isNotApplicable(value))
  }
  if (Array.isArray(value)) return value.some((v) => !(members?.includes(v) || isRealListEntry(v)))
  return false
}

/** The answers `auth_failure_mode` takes: what happens when authentication fails. */
const AUTH_FAILURE_MODE = /^(deny|fallback|fail[ _-]?open)$/
export const isAuthFailureMode = (v: unknown): boolean => typeof v === 'string' && AUTH_FAILURE_MODE.test(normToken(v))

/** The failure detail naming missing and placeholder keys separately. */
function gapDetail(missing: string[], placeholder: string[]): string {
  return [...(placeholder.length ? [`placeholder: ${placeholder.join(', ')}`] : []), ...(missing.length ? [`missing: ${missing.join(', ')}`] : [])].join('; ')
}
/** Whether a failure is caused (at least in part) by a placeholder value. */
const hasPlaceholder = (f?: GateFailure): boolean => !!f?.detail && /(^|; )placeholder: /.test(f.detail)

/**
 * May this component answer "not applicable" for data at rest? Only one known
 * to be a process, whose class is not a store class; a store, or a component of
 * no or unknown type, may not.
 */
export function mayAnswerNotApplicable(c: { type?: unknown; classData?: { id?: string | null } | null }, templates: ReadonlyMap<string, { componentType?: string }>): boolean {
  if (String(c.type ?? '').trim().toUpperCase() !== 'PROCESS') return false
  const classType = c.classData?.id ? templates.get(c.classData.id)?.componentType : undefined
  return String(classType ?? '').trim().toUpperCase() !== 'STORE'
}

/** The six-attribute floor, literal keys and the type each must have. */
export const FLOOR_KEYS: Readonly<Record<string, 'string' | 'boolean' | 'string[]'>> = {
  authentication_type: 'string',
  encryption_in_transit: 'string',
  encryption_at_rest: 'string',
  implicit_deny_enabled: 'boolean',
  monitoring_tools: 'string[]',
}

/** A workflow key's type: a plain type, a list of strings, one of an enum's members, or an auth failure mode. */
export type WorkflowKeyType = 'string' | 'boolean' | 'string[]' | 'auth_failure_mode' | { readonly enum: readonly string[] }

/**
 * The attribute keys the gates read or the workflow asks the operator for, by element group, with the type
 * each takes: they may be registered on an element whose class template lacks them. The transit aliases are
 * not here: they count only as fields of a flow's own class.
 */
export const WORKFLOW_KEYS: Readonly<Record<'components' | 'boundaries' | 'dataFlows' | 'dataItems', Readonly<Record<string, WorkflowKeyType>>>> = {
  components: {
    ...FLOOR_KEYS,
    stores_credentials: 'boolean',
    credential_scope: 'string[]',
    asset_criticality: { enum: ['high', 'medium', 'low'] },
  },
  boundaries: {
    implicit_deny_enabled: 'boolean',
    allow_any_inbound: 'boolean',
    egress_filtering: { enum: ['deny_all', 'allow_list', 'allow_all'] },
    crown_jewel: 'boolean',
  },
  dataFlows: {
    auth_failure_mode: 'auth_failure_mode',
    encryption_in_transit: 'string',
    required_credentials: 'string[]',
    credential_type: 'string',
    credential_name: 'string',
    crown_jewel: 'boolean',
  },
  dataItems: {
    crown_jewel: 'boolean',
  },
}

// =============================================================================
// Class templates
// =============================================================================

export interface ClassTemplate {
  name: string
  fields: string[]
  /** Field schemas, by field name. */
  schema: Record<string, unknown>
  componentType?: string
}

export interface ClassTemplates {
  templates: Map<string, ClassTemplate>
  /** Each cached class's module, by class id: every well-formed entry, with or without fields. */
  modules?: Map<string, ModuleRef>
  /** Cache entries that were not used, and why. */
  refused: Array<{ file: string; reason: string }>
  /** Why the cache directory itself could not be listed (a missing one is simply empty). */
  listing?: string
}

const CLASS_CACHE = path.join('.dethereal', 'class-cache')

/**
 * Load the class templates cached under `.dethereal/class-cache/`, keyed by
 * class id.
 *
 * The cache is keyed by CLASS id, which survives the local-id → platform-id
 * remap on first push; the `.dethereal/template-fields/` manifests are keyed by
 * element id and are re-keyed only alongside it. It is also what the enricher
 * reads, so completion is measured against the enricher's own checklist.
 *
 * The cache is committed content: an entry is used only when it is a plain
 * file inside the model, its `classId` (if any) matches its file name, and it
 * declares at least one field. Anything else is refused and listed — a refused
 * entry must never shrink what a template-based measure counts.
 */
export async function readClassTemplates(dirPath: string): Promise<ClassTemplates> {
  const out: ClassTemplates = { templates: new Map(), refused: [], modules: new Map() }
  const cacheDir = path.join(dirPath, CLASS_CACHE)
  let entries: string[]
  try {
    const st = await fs.lstat(cacheDir)
    if (st.isSymbolicLink() || !st.isDirectory()) {
      out.listing = st.isSymbolicLink() ? 'symlink' : 'not_regular'
      return out
    }
    entries = await fs.readdir(cacheDir)
    // The directory listed must be the one checked: not swapped for a link in between.
    const again = await fs.lstat(cacheDir)
    if (again.isSymbolicLink() || again.dev !== st.dev || again.ino !== st.ino) {
      out.listing = 'changed'
      return out
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') out.listing = 'io'
    return out
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    const classId = entry.slice(0, -'.json'.length)
    const file = `${CLASS_CACHE}/${entry}`.split(path.sep).join('/')
    let raw: Record<string, unknown> | null
    try {
      raw = await readRepoJson(dirPath, file)
    } catch (err) {
      out.refused.push({ file, reason: err instanceof StateFileError ? err.code : 'unreadable' })
      continue
    }
    if (!raw) continue
    if (raw.classId !== undefined && raw.classId !== classId) {
      out.refused.push({ file, reason: 'class_id_mismatch' })
      continue
    }
    const module = moduleRef(raw.module)
    if (module) out.modules!.set(classId, module)
    const props = (raw.template as { schema?: { properties?: unknown } } | undefined)?.schema?.properties
    if (!props || typeof props !== 'object' || Array.isArray(props) || Object.keys(props).length === 0) {
      out.refused.push({ file, reason: 'no_fields' })
      continue
    }
    out.templates.set(classId, {
      name: typeof raw.className === 'string' ? raw.className : 'unknown',
      fields: Object.keys(props),
      schema: props as Record<string, unknown>,
      componentType: typeof raw.componentType === 'string' ? raw.componentType : undefined,
    })
  }
  return out
}

/** Caps that keep the residual worklist usable on a several-hundred-element model. */
const MAX_RESIDUAL_ELEMENTS = 25
const MAX_RESIDUAL_FIELDS_PER_ELEMENT = 12

export interface AttributeResidual {
  declared: number
  resolved: number
  unresolved: number
  /** Classified elements with a known template — the ones the ratio is computed over. */
  elements_scored: number
  /** Elements with no class binding — excluded from the ratio, not scored either way. */
  elements_unclassified: number
  /**
   * Of those, the ones still open to classification: every unclassified element but the root container and those
   * the operator left unclassified (`left_unclassified`): what the workflow reads to know nothing is left to classify.
   */
  unclassified_open: number
  /** Classified, but no usable cached template — excluded from the ratio. */
  elements_without_template: number
  /** Set when the ratio fell back to file-presence because no class cache exists. */
  basis: 'template' | 'file-presence'
  /**
   * Classified elements the ratio could NOT measure, by name. A bare count is
   * unactionable; the names point straight at the fix (usually: run
   * generate_attribute_stubs so the class template is cached).
   */
  blocked: Array<{ element: string; class_id: string }>
  top_unresolved: Array<{ element: string; class: string; unresolved: number; declared: number; fields: string[] }>
}

export interface ResidualElement {
  id: string
  name?: string
  group: string
  classData?: { id?: string } | null
}

/** True when `field` carries a real answer: present, not null, not a stand-in, valid for its schema. */
// Note: no store class template declares `encryption_at_rest` today. If one does, C2 would count
// "not_applicable" there as answered; apply `mayAnswerNotApplicable` here too.
export function isResolved(values: Record<string, unknown>, field: string, schema: unknown): boolean {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so a template
  // field named `toString` would score as resolved on every element.
  return present(values, field) && !isGateStandIn(values[field], field, schema) && isValidForSchema(values[field], schema)
}

/**
 * Measure how many class template fields carry a real answer, per element.
 *
 * A value counts only when it is present, non-null, not a stand-in and valid
 * for its schema, so a stub of nulls, a file of `"unknown"`s or a boolean field
 * answered `"n/a"` all read as unresolved.
 *
 * Elements with no class, or whose class has no usable cached template, are
 * counted in `elements_unclassified` / `elements_without_template` and left OUT
 * of the ratio: counting them as complete overstates readiness, and counting
 * them as incomplete punishes a model for a cache miss. The gate that needs
 * them (C2) refuses them itself. Of the unclassified, those not in
 * `notOpen` are also counted in `unclassified_open`.
 */
export function computeAttributeResidual(
  population: readonly ResidualElement[],
  attributes: ConsolidatedAttributesFile,
  templates: ReadonlyMap<string, ClassTemplate>,
  notOpen: ReadonlySet<string> = new Set(),
): AttributeResidual {
  let declared = 0
  let resolved = 0
  let withoutTemplate = 0
  let unclassified = 0
  let open = 0
  let scored = 0
  const blocked: Array<{ element: string; class_id: string }> = []
  const per: AttributeResidual['top_unresolved'] = []

  for (const el of population) {
    // The class binding comes from the STRUCTURE, never from the attribute
    // file's embedded `classData` — that is a copy written at stub time and is
    // the stale one after a reclassification.
    const classId = el.classData?.id
    if (!classId) {
      unclassified++
      if (!notOpen.has(el.id)) open++
      continue
    }

    const template = templates.get(classId)
    if (!template) {
      withoutTemplate++
      if (blocked.length < MAX_RESIDUAL_ELEMENTS) blocked.push({ element: el.name || el.id, class_id: classId })
      continue
    }

    // An element with no attribute entry at all is fully unresolved, not absent
    // from the denominator: an export omits the attribute entry for every
    // classified-but-unenriched element, so iterating the attribute tree instead
    // of the structure would drop exactly the elements carrying the largest
    // residual.
    const entry = attributeEntry(attributes, el.group, el.id)
    const values = (entry?.attributes ?? {}) as Record<string, unknown>
    const missing = template.fields.filter((f) => !isResolved(values, f, template.schema[f]))

    scored++
    declared += template.fields.length
    resolved += template.fields.length - missing.length

    if (missing.length > 0) {
      per.push({
        element: el.name || entry?.elementName || el.id,
        class: template.name,
        unresolved: missing.length,
        declared: template.fields.length,
        fields: missing.slice(0, MAX_RESIDUAL_FIELDS_PER_ELEMENT),
      })
    }
  }

  per.sort((a, b) => b.unresolved - a.unresolved)
  return {
    declared,
    resolved,
    unresolved: declared - resolved,
    elements_scored: scored,
    elements_unclassified: unclassified,
    unclassified_open: open,
    elements_without_template: withoutTemplate,
    basis: 'template',
    blocked,
    top_unresolved: per.slice(0, MAX_RESIDUAL_ELEMENTS),
  }
}

/**
 * The element ids `.dethereal/discovery.json` lists as `left_unclassified`: each entry an id, or an object naming
 * it as `id` or `element_id`. Anything else excludes nothing, so a misread file leaves more elements open, never fewer.
 */
export function leftUnclassifiedIds(discovery: unknown): Set<string> {
  const list = discovery && typeof discovery === 'object' ? (discovery as { left_unclassified?: unknown }).left_unclassified : undefined
  const out = new Set<string>()
  for (const entry of Array.isArray(list) ? list : []) {
    const id = typeof entry === 'string' ? entry
      : entry && typeof entry === 'object' ? ((entry as { id?: unknown }).id ?? (entry as { element_id?: unknown }).element_id) : undefined
    if (typeof id === 'string') out.add(id)
  }
  return out
}

export function attributeEntry(attributes: ConsolidatedAttributesFile, group: string, id: string): ElementAttributes | undefined {
  const bag = (attributes as Record<string, Record<string, ElementAttributes> | undefined>)[group]
  return bag && typeof bag === 'object' ? bag[id] : undefined
}

// =============================================================================
// Gate results
// =============================================================================

/** Longest `failing` list in a result; `failing_total` carries the full count. */
export const MAX_FAILING = 100

export type Verdict = 'PASS' | 'FAIL' | 'WARN'

export interface GateFailure {
  id: string
  name?: string
  detail?: string
  /** Gate 3 only: whether a waiver may be granted for this failure. */
  waivable?: boolean
  /** Gate 3 only, when `waivable` is false: why. */
  unwaivable_reason?: string
  /** Field gaps (C2, C3, C8): the fields not answered, and those holding a stand-in; `detail` says the same in words. */
  missing?: string[]
  placeholder?: string[]
  /** C8 only: transit fields of the flow's class that are set while the floor key `encryption_in_transit` is absent */
  alias_present?: string[]
}

/** How much waiver room a Gate 3 criterion has left. */
export interface WaiverHeadroom {
  /** False when no failure of the criterion can be waived now (never waived, too small, failing structurally). */
  waivable: boolean
  /** Waivers that currently apply. */
  in_use: number
  /** Most elements the criterion may have waived. */
  cap: number
  /** Waivers that may still be granted, within the criterion's cap and the model's total. */
  remaining: number
  /** Why `waivable` is false or `remaining` is 0. */
  reason?: string
}

export interface GateCheck {
  verdict: Verdict
  value: string
  failing: GateFailure[]
  failing_total: number
  remedy?: string
  /** Failures covered by a waiver in use (Gate 3 only). */
  waived?: GateFailure[]
  /** Gate 3 only. */
  waiver_headroom?: WaiverHeadroom
}

export type Criterion = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9'

export interface ValueShares {
  counted: number
  stand_ins: number
  stand_in_share: number
  type_defaults: number
  type_default_share: number
  template_defaults: number
  template_default_share: number
  invalid: number
  invalid_share: number
}

/** An element as the gates list it: its id and, from the structure, its name. */
export interface ListedElement { id: string; name?: string }

export interface TierMembers {
  /** Tier 1 and 2 members in structure order, at most `MAX_FAILING` each. */
  tier1: ListedElement[]
  tier1_total: number
  tier2: ListedElement[]
  tier2_total: number
  tier3_total: number
  /** Tier 3 components in no declared or inherited zone: Tier 3 means internal or unknown. */
  tier3_unzoned: number
  /**
   * Labels overlap the tiers; never add them to a tier count. `crown_jewels` are
   * the non-external components with `crownJewel: true`, whatever their tier;
   * `cross_boundary` the non-external components outside Tier 1 at one end of a
   * cross-boundary flow whose other end is a non-external component (east-west).
   */
  labels: {
    crown_jewels: ListedElement[]; crown_jewels_total: number; crown_jewel_externals: number
    cross_boundary: ListedElement[]; cross_boundary_total: number
  }
}

export interface Gate3Report {
  tiers: { tier1: number; tier2: number; tier3: number; externals: number; unzoned: number }
  tier_members: TierMembers
  /** Enrichment values still awaiting the operator; while they block, the model cannot be REVIEWED or pushed. Absent with the settlement off. */
  pending_enrichment?: { state: PendingRead['state']; blocking: number; blocks: boolean }
  /** Boundaries holding components whose declared or inherited zone differs from the zoning engine's proposal. */
  zone_disagreements: Array<{ boundary: string; name: string; zone: string | null; proposed: string }>
  /** Tier 3 components that hold a data item with a sensitivity floor. */
  floored_data_outside_tier12: Array<{ id: string; name: string }>
  values: {
    tier12_components: ValueShares
    cross_boundary_flows: ValueShares
    data_items: ValueShares
  }
  /** Data items whose sensitivity sits exactly at their floor, or at `public`. */
  data_items_at_floor_or_public: { count: number; of: number }
  /** Cross-boundary flows that declare no authentication (`required_credentials: []`, no credential type). */
  declared_unauthenticated: { n: number; of: number }
  /** Lowest per-component completion among the Tier 1–2 components C2 measured. */
  c2_min_element_rate: number | null
  /** Fields per template, and Tier 1–2 components whose template-fields manifest counts differently. */
  templates: {
    fields_per_class: Record<string, number>
    refused: Array<{ file: string; reason: string }>
    manifest_mismatches: Array<{ id: string; name: string; cache: number; manifest: number }>
  }
  /** Crown-jewel map entries worth a look that do not fail C6. */
  crown_jewel_map: { unmapped_keys: string[]; dangling_ids: string[] }
}

export interface GatesResult {
  /** Every lint finding: errors (also in Gate 2), warnings, info, and the Gate 3 criteria still open. */
  lints: LintFinding[]
  gate1: { verdict: 'PASS' | 'WARN'; checks: Record<string, GateCheck> }
  gate2: { verdict: 'PASS' | 'FAIL'; checks: Record<string, GateCheck> }
  gate3: {
    verdict: 'PASS' | 'FAIL'
    /** The verdict as it would be without any waiver. */
    verdict_without_waivers: 'PASS' | 'FAIL'
    criteria: Record<Criterion, GateCheck>
    /** Criterion–element pairs a waiver currently covers. */
    waived_total: number
    /** Every stored waiver, element by element, and whether it applies. */
    waivers: WaiverUse[]
    /** Stored waiver records that are malformed and ignored. */
    waivers_invalid: number
    report: Gate3Report
    /** What a loop back to enrichment has to answer, element by element; advisory. */
    loopback: Gate3Loopback
    limit: string
  }
}

/**
 * Gate 3's failures not covered by a waiver, element by element: those enrichment answers (`elements`, with the
 * fields it has to settle), and those it cannot (`not_enrichable`: classification, a missing template, the
 * structure or the crown-jewel map). Empty when Gate 3 passes.
 */
export interface Gate3Loopback {
  phase: 'enrich'
  elements: LoopbackElement[]
  elements_total: number
  not_enrichable: NotEnrichable[]
  not_enrichable_total: number
  /** With elements to work: how a loop-back starts, so the next gates call can hold it to them */
  arm?: string
}
export type LoopbackKind = 'component' | 'boundary' | 'flow' | 'data_item' | 'model'
export interface LoopbackElement { element_id: string; name?: string; kind: LoopbackKind; criteria: Criterion[]; fields: string[] }
export interface NotEnrichable { element_id: string; name?: string; kind: LoopbackKind; criteria: Criterion[]; reason: string }

export const GATE3_LIMIT =
  'Gate 3 certifies that the recorded answers are complete and consistent, not that they are true. ' +
  'A lazy but type-valid answer passes; the value shares in this report show how many answers are defaults.'

function check(ok: boolean, value: string, failing: GateFailure[], remedy?: string, failVerdict: Verdict = 'FAIL'): GateCheck {
  return {
    verdict: ok ? 'PASS' : failVerdict,
    value,
    failing: failing.slice(0, MAX_FAILING),
    failing_total: failing.length,
    ...(ok || !remedy ? {} : { remedy }),
  }
}

const pct = (n: number, d: number): string => (d ? `${Math.round((n / d) * 1000) / 10}%` : 'n/a')
const share = (n: number, d: number): number => (d ? Math.round((n / d) * 10000) / 10000 : 0)

// =============================================================================
// Input
// =============================================================================

export interface ScopeRead {
  scope: Record<string, unknown> | null
  /** Why `.dethereal/scope.json` could not be used (a state-store refusal code). */
  error?: string
}

export interface GateInput {
  manifest: ModelManifest
  structure: ModelStructure
  dataFlows: DataFlow[]
  dataItems: DataItem[]
  attributes: ConsolidatedAttributesFile
  attributeIssues: AttributeReadIssue[]
  classTemplates: ClassTemplates
  scope: ScopeRead
  /** `.dethereal/template-fields/<element id>.json` field counts, for the Tier 1–2 components that have one. */
  templateFieldManifests?: Map<string, { classId?: string; fields: number }>
  /** `.dethereal/enrichment-pending.json` as read; absent when the input was not read from a directory. */
  pending?: PendingRead
  /** What the derivation of `manifest.modules` could not settle (read from a directory; carried into a directory push). */
  moduleGaps?: ModuleGap[]
  /** manifest.json's own `modules`, before the derived list replaced it. */
  manifestModulesOnDisk?: unknown
  /** Template-field manifests the state store refused to read (read from a directory). */
  templateFieldsRefused?: Array<{ file: string; code: string }>
  /** The settlement mode the model was read with: both loaders resolve it once, the caller's or the environment's. */
  settlement?: SettlementMode
}

// =============================================================================
// Pending enrichment
// =============================================================================

/**
 * `.dethereal/enrichment-pending.json` lists values an enricher wrote into empty
 * fields from a cited source, which the operator has not confirmed yet. The
 * workflow writes an entry before the value it records and removes it only
 * after the operator's reply to that row. The server never writes the file.
 *
 * It is a cooperative checklist: the server fails closed on what it sees, but
 * cannot tell a cleared entry from a deleted one. While anything in it blocks,
 * the model cannot be REVIEWED or pushed.
 */
export const PENDING_ENRICHMENT_FILE = '.dethereal/enrichment-pending.json'
export const PENDING_LIMITS = { entries: 5000, rows: 100, sourceChars: 1000 } as const
export const PENDING_GROUPS = ['components', 'dataFlows', 'dataItems', 'boundaries'] as const
export type PendingGroup = typeof PENDING_GROUPS[number]
/** The settlement's groups: the element groups, and the model itself (its model-level controls). */
export const SETTLE_GROUPS = [...PENDING_GROUPS, 'model'] as const
export type SettleGroup = typeof SETTLE_GROUPS[number]
/** The model's own record in the settlement: one per model, never an element. */
export const MODEL_REF_ID = '@model'
export const PENDING_FIELD = /^[A-Za-z0-9_-]{1,128}$/
const PENDING_BATCH = /^[A-Za-z0-9._:-]{1,64}$/
const PENDING_KEYS = new Set(['batch', 'element_id', 'group', 'field', 'value', 'source', 'previous'])
/** Fields an entry may name on the element record itself rather than in its attribute bag. */
export const RECORD_FIELDS: ReadonlySet<string> = new Set(['name', 'description', 'sensitivity', 'regulatory_flags', 'origin', 'is_credential', 'zone', 'crownJewel', 'dataItemIds', 'classData', 'domains', 'planes'])

export interface PendingEntry {
  index: number
  group: PendingGroup
  element_id: string
  field: string
  /** The value the enricher wrote */
  value: unknown
  /** The field's state before it: null, or absent */
  previous: 'null' | 'absent'
  /** Where the value was read (model-written text, shown only on request) */
  source?: string
}

/** The pending file as read, before it is held against the model. */
export interface PendingRead {
  state: 'none' | 'present' | 'unreadable' | 'not_read'
  /** Why the file is unreadable: a store code, or a shape code. */
  code?: string
  /** Well-formed entries, one per (group, element, field), in file order. */
  entries: PendingEntry[]
  /** Every well-formed entry, duplicates included, in file order (settlement settles duplicates together). */
  all?: PendingEntry[]
  /** Positions of malformed entries. */
  invalid: number[]
  /** Keys the schema does not define, at either level. */
  unknownKeys: number
  /** sha256 of the file's entries as parsed: a page of rows read under another digest is out of date */
  digest?: string
}

const PENDING_NONE: PendingRead = { state: 'none', entries: [], invalid: [], unknownKeys: 0 }
export const PENDING_NOT_READ: PendingRead = { state: 'not_read', entries: [], invalid: [], unknownKeys: 0 }

/** Check one entry against the frozen schema; `null` when it is malformed. */
function pendingEntry(raw: unknown, index: number): { entry: PendingEntry | null; unknown: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entry: null, unknown: 0 }
  const e = raw as Record<string, unknown>
  const unknown = Object.keys(e).filter((k) => !PENDING_KEYS.has(k)).length
  const ok = typeof e.element_id === 'string' && ELEMENT_ID.test(e.element_id) &&
    typeof e.group === 'string' && (PENDING_GROUPS as readonly string[]).includes(e.group) &&
    typeof e.field === 'string' && PENDING_FIELD.test(e.field) &&
    Object.prototype.hasOwnProperty.call(e, 'value') && e.value !== null && e.value !== undefined &&
    typeof e.source === 'string' && e.source.length <= PENDING_LIMITS.sourceChars &&
    (e.previous === 'null' || e.previous === 'absent') &&
    typeof e.batch === 'string' && PENDING_BATCH.test(e.batch)
  return {
    entry: ok ? { index, group: e.group as PendingGroup, element_id: e.element_id as string, field: e.field as string, value: e.value, previous: e.previous as 'null' | 'absent', source: e.source as string } : null,
    unknown,
  }
}

/** Read the pending file with the store's checks. Anything unexpected reads as unreadable, which blocks. */
export async function readPendingEnrichment(dirPath: string): Promise<PendingRead> {
  let raw: Record<string, unknown> | null
  try {
    raw = await readRepoJson(dirPath, PENDING_ENRICHMENT_FILE)
  } catch (err) {
    return { ...PENDING_NONE, state: 'unreadable', code: err instanceof StateFileError ? err.code : 'unreadable' }
  }
  return pendingFromRaw(raw)
}

/** The pending file's parsed JSON, checked against the frozen schema (null: no file). */
export function pendingFromRaw(raw: Record<string, unknown> | null): PendingRead {
  if (raw === null) return PENDING_NONE
  if (raw.version !== 1) return { ...PENDING_NONE, state: 'unreadable', code: 'unsupported_version' }
  if (!Array.isArray(raw.entries)) return { ...PENDING_NONE, state: 'unreadable', code: 'entries_not_a_list' }
  if (raw.entries.length > PENDING_LIMITS.entries) return { ...PENDING_NONE, state: 'unreadable', code: 'too_many_entries' }
  let unknownKeys = Object.keys(raw).filter((k) => k !== 'version' && k !== 'entries').length
  const seen = new Set<string>()
  const entries: PendingEntry[] = []
  const all: PendingEntry[] = []
  const invalid: number[] = []
  raw.entries.forEach((item, index) => {
    const { entry, unknown } = pendingEntry(item, index)
    unknownKeys += unknown
    if (!entry) { invalid.push(index); return }
    all.push(entry)
    const k = JSON.stringify([entry.group, entry.element_id, entry.field])
    if (seen.has(k)) return
    seen.add(k)
    entries.push(entry)
  })
  return {
    state: entries.length || invalid.length ? 'present' : 'none', entries, all, invalid, unknownKeys,
    digest: createHash('sha256').update(canonicalJson(raw.entries)).digest('hex'),
  }
}

/** The pending file held against the model: what blocks, and the rows an operator confirms. */
export interface PendingEnrichment {
  state: PendingRead['state']
  code?: string
  /** True when the model cannot be REVIEWED or pushed because of this file. */
  blocks: boolean
  /** Entries that block: well-formed ones plus malformed ones (an unreadable file blocks as a whole). */
  blocking: number
  entries: number
  invalid: number
  /** Positions of malformed entries, counted from 1 as the operator's tables number rows. */
  invalid_rows: number[]
  /** Well-formed entries whose element no longer exists; they still block. */
  unresolved: number
  unknown_keys: number
  /** At most `PENDING_LIMITS.rows`; names and ids only for elements the model has. */
  /** `row` is the entry's position in the file, counted from 1 as the operator's tables number rows. */
  rows: Array<{ row: number; element_id?: string; name?: string; field: string }>
  rows_total: number
  /** The pending file's digest (see PendingRead) */
  digest?: string
}

/** Why a pending row cannot be accepted as it is shown. */
export type PendingRowProblem = 'element_gone' | 'conflicting_values' | 'unknown_field' | 'not_settleable' | 'on_disk_differs'

/**
 * Judges pending rows as an accept would take them: whether each can be accepted as it is shown, and whether it
 * names the element's record or an attribute (the record unless the attribute file holds the name). One judge for
 * the table that shows the rows and for the range that accepts them, so the two never disagree. A record row's
 * value is compared with the file by `recordDiffers`, which knows how the settlement reads records; without it,
 * record rows are not compared.
 */
export function pendingRowJudge(input: GateInput, options: { recordDiffers?: (e: PendingEntry) => boolean } = {}):
  (e: PendingEntry) => { problem: PendingRowProblem | null; record: boolean } {
  const { boundaries, components } = flattenStructure(input.structure)
  const classes: Record<PendingGroup, Map<string, string | undefined>> = {
    components: new Map(components.map((c) => [c.id, c.classData?.id ?? undefined])),
    boundaries: new Map(boundaries.map((b) => [b.id, b.classData?.id ?? undefined])),
    dataFlows: new Map(input.dataFlows.map((f) => [f.id, f.classData?.id ?? undefined])),
    dataItems: new Map(input.dataItems.map((d) => [d.id, d.classData?.id ?? undefined])),
  }
  const values = new Map<string, Set<string>>()
  for (const o of input.pending?.all ?? input.pending?.entries ?? []) {
    const k = JSON.stringify([o.group, o.element_id, o.field])
    values.set(k, (values.get(k) ?? new Set<string>()).add(canonicalJson(o.value)))
  }
  return (e) => {
    const bag = (attributeEntry(input.attributes, e.group, e.element_id)?.attributes ?? {}) as Record<string, unknown>
    const bagHas = Object.hasOwn(bag, e.field)
    const record = RECORD_FIELDS.has(e.field) && !bagHas
    const judged = (problem: PendingRowProblem | null) => ({ problem, record })
    if (!classes[e.group].has(e.element_id)) return judged('element_gone')
    if ((values.get(JSON.stringify([e.group, e.element_id, e.field]))?.size ?? 0) > 1) return judged('conflicting_values')
    const classId = classes[e.group].get(e.element_id)
    const known = RECORD_FIELDS.has(e.field) || Object.hasOwn(FLOOR_KEYS, e.field) || bagHas ||
      (!!classId && !!input.classTemplates.templates.get(classId)?.fields.includes(e.field))
    if (!known) return judged('unknown_field')
    // A record row settles only where the settlement keeps that record (not name or description); an attribute row on a
    // record's name only where the attribute file holds the name.
    const settled = (SETTLED_RECORD_FIELDS as readonly string[]).includes(e.field)
    if (record ? !settled : settled && !bagHas) return judged('not_settleable')
    const differs = record ? options.recordDiffers?.(e) === true : canonicalJson(bag[e.field]) !== canonicalJson(e.value)
    return judged(differs ? 'on_disk_differs' : null)
  }
}

/**
 * The pending file's well-formed entries held against the model, in file order: each with its element when the model
 * has it, and whether the field is one the element lists (a class field, a floor or record key, or one its attributes
 * hold). A field it does not list is never shown by name: the file is model-written. An id found only in another
 * group is malformed.
 */
export function pendingRowBase(input: GateInput): { valid: Array<{ entry: PendingEntry; name?: string; known: boolean; found: boolean }>; invalid: number[] } {
  const read = input.pending ?? PENDING_NOT_READ
  const { boundaries, components } = flattenStructure(input.structure)
  const byGroup: Record<PendingGroup, Map<string, { name?: string; classId?: string }>> = {
    components: new Map(components.map((c) => [c.id, { name: c.name, classId: c.classData?.id ?? undefined }])),
    boundaries: new Map(boundaries.map((b) => [b.id, { name: b.name, classId: b.classData?.id ?? undefined }])),
    dataFlows: new Map(input.dataFlows.map((f) => [f.id, { name: f.name, classId: f.classData?.id ?? undefined }])),
    dataItems: new Map(input.dataItems.map((i) => [i.id, { name: i.name, classId: i.classData?.id ?? undefined }])),
  }
  const invalid = [...read.invalid]
  const valid: PendingEntry[] = []
  for (const e of read.entries) {
    const elsewhere = !byGroup[e.group].has(e.element_id) && PENDING_GROUPS.some((g) => g !== e.group && byGroup[g].has(e.element_id))
    if (elsewhere) invalid.push(e.index)
    else valid.push(e)
  }
  invalid.sort((a, b) => a - b)
  const templates = input.classTemplates.templates
  const known = (e: PendingEntry, classId: string | undefined): boolean => {
    if (RECORD_FIELDS.has(e.field) || Object.prototype.hasOwnProperty.call(FLOOR_KEYS, e.field)) return true
    if (classId && templates.get(classId)?.fields.includes(e.field)) return true
    const values = attributeEntry(input.attributes, e.group, e.element_id)?.attributes
    return !!values && typeof values === 'object' && Object.prototype.hasOwnProperty.call(values, e.field)
  }
  return {
    valid: valid.map((e) => {
      const el = byGroup[e.group].get(e.element_id)
      return { entry: e, ...(el?.name ? { name: el.name } : {}), found: !!el, known: !!el && known(e, el.classId) }
    }),
    invalid,
  }
}

/** Hold the pending file against the model: what blocks, and the first rows. */
export function pendingEnrichment(input: GateInput): PendingEnrichment {
  const read = input.pending ?? PENDING_NOT_READ
  const { valid: based, invalid } = pendingRowBase(input)
  const valid = based.map((b) => b.entry)
  const rows = based.slice(0, PENDING_LIMITS.rows).map((b) => ({
    row: b.entry.index + 1,
    ...(b.found ? { element_id: b.entry.element_id, ...(b.name ? { name: b.name } : {}) } : {}),
    field: b.known ? b.entry.field : '(unlisted field)',
  }))
  const blocking = valid.length + invalid.length
  return {
    state: read.state,
    ...(read.code ? { code: read.code } : {}),
    blocks: read.state === 'unreadable' || blocking > 0,
    blocking,
    entries: valid.length,
    invalid: invalid.length,
    invalid_rows: invalid.slice(0, PENDING_LIMITS.rows).map((i) => i + 1),
    unresolved: based.filter((b) => !b.found).length,
    unknown_keys: read.unknownKeys,
    rows,
    rows_total: valid.length,
    ...(read.digest ? { digest: read.digest } : {}),
  }
}

/** The push refusal pending enrichment causes, or null. */
export function pendingPushRefusal(input: GateInput): string | null {
  const p = pendingEnrichment(input)
  if (!p.blocks) return null
  if (p.state === 'unreadable') {
    return `Push refused: the pending-enrichment file cannot be read (pending_enrichment_unreadable: ${p.code}). ` +
      'Repair or remove it only after the operator has confirmed or reverted every value it lists.'
  }
  return `Push refused: ${p.blocking} enrichment value${p.blocking === 1 ? '' : 's'} await${p.blocking === 1 ? 's' : ''} the operator's ` +
    'confirmation (pending_enrichment). Show the operator each pending row; only their reply to a row clears it. ' +
    "model_state get with include ['pending_rows'] lists the rows."
}

async function readScopeFile(dirPath: string): Promise<ScopeRead> {
  try {
    return { scope: await readRepoJson(dirPath, '.dethereal/scope.json') }
  } catch (err) {
    return { scope: null, error: err instanceof StateFileError ? err.code : 'unreadable' }
  }
}

/** Largest model file the gates read. */
const MAX_MODEL_FILE_BYTES = 32 * 1024 * 1024

export type GateInputErrorCode = 'missing' | 'symlink' | 'not_regular' | 'hardlinked' | 'changed' | 'too_large' | 'invalid_json' | 'unreadable'

/**
 * A model file the gates could not use. The message names the file and a code
 * only: never a path, and never parser text, which quotes the file's content.
 */
export class GateInputError extends Error {
  constructor(readonly code: GateInputErrorCode, readonly file: string) {
    super(`${file}: ${code.replaceAll('_', ' ')}`)
    this.name = 'GateInputError'
  }
}

/**
 * Read one JSON model file through the checked reader: no symlink, a single
 * link, the same file from inspection to read, at most 32 MiB. `undefined`
 * when the file is absent and not required.
 */
async function readModelJson(dirPath: string, file: string, required: boolean): Promise<unknown> {
  let bytes: Buffer | null
  try {
    bytes = await retryTransient(() => readChecked(path.join(dirPath, file), file, MAX_MODEL_FILE_BYTES))
  } catch (err) {
    const code = err instanceof StateFileError ? err.code : 'io'
    throw new GateInputError(
      code === 'symlink' || code === 'not_regular' || code === 'hardlinked' || code === 'changed' || code === 'too_large' ? code : 'unreadable', file)
  }
  if (bytes === null) {
    if (required) throw new GateInputError('missing', file)
    return undefined
  }
  try {
    return JSON.parse(bytes.toString('utf-8'))
  } catch {
    throw new GateInputError('invalid_json', file)
  }
}

const listOf = (raw: unknown, key: string): any[] => {
  if (Array.isArray(raw)) return raw
  const inner = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined
  return Array.isArray(inner) ? inner : []
}

/** Attribute files that are symlinks, special files or hard-linked, as `attributes/<group>/<file>`. */
async function unsafeAttributeFiles(dirPath: string): Promise<string[]> {
  const out: string[] = []
  const root = path.join(dirPath, 'attributes')
  let rootStat
  try {
    rootStat = await fs.lstat(root)
  } catch {
    return out
  }
  if (rootStat.isSymbolicLink()) return ['attributes']
  if (!rootStat.isDirectory()) return out // a consolidated attributes.json file is read as it is
  for (const group of ['boundaries', 'components', 'dataFlows', 'dataItems']) {
    const dir = path.join(root, group)
    let st
    try {
      st = await fs.lstat(dir)
    } catch {
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) { out.push(`attributes/${group}`); continue }
    for (const entry of await fs.readdir(dir)) {
      if (!entry.endsWith('.json')) continue
      const est = await fs.lstat(path.join(dir, entry)).catch(() => null)
      if (!est || est.isSymbolicLink() || !est.isFile() || est.nlink !== 1) out.push(`attributes/${group}/${entry}`)
    }
  }
  return out
}

/**
 * Read everything the gates look at from a model directory. The caller
 * confines the path first.
 *
 * Model files are committed content: a symlinked model file is refused, and a
 * failure is a {@link GateInputError} naming the file and a code. When any
 * attribute file is a symlink or special file, no attribute is read at all —
 * the gates then fail closed and Gate 2 names the files.
 */
export async function loadGateInput(dirPath: string, options: { settlement?: SettlementMode } = {}): Promise<GateInput> {
  const manifest = await readModelJson(dirPath, 'manifest.json', true) as ModelManifest
  const structure = await readModelJson(dirPath, 'structure.json', true) as ModelStructure
  if (!structure || typeof structure !== 'object' || !(structure as { defaultBoundary?: unknown }).defaultBoundary) {
    throw new GateInputError('invalid_json', 'structure.json')
  }
  const dataFlows = listOf(await readModelJson(dirPath, 'dataflows.json', false), 'dataFlows') as DataFlow[]
  const dataItems = listOf(await readModelJson(dirPath, 'data-items.json', false), 'dataItems') as DataItem[]
  const attributeIssues: AttributeReadIssue[] = []
  const unsafe = await unsafeAttributeFiles(dirPath)
  let attributes: ConsolidatedAttributesFile
  if (unsafe.length > 0) {
    attributes = { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} }
    for (const file of unsafe) attributeIssues.push({ file, reason: 'symlink or special file', preserve: true })
  } else {
    attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems }, attributeIssues)
  }
  const classTemplates = await readClassTemplates(dirPath)
  const scope = await readScopeFile(dirPath)

  const templateFieldManifests = new Map<string, { classId?: string; fields: number }>()
  const templateFieldsRefused: Array<{ file: string; code: string }> = []
  const tiers = classifyTiers({ structure, dataFlows, dataItems, crownJewelIds: crownJewelIds(scope.scope) })
  for (const [id, tier] of tiers.tierOf) {
    if (tier > 2 || !ELEMENT_ID.test(id)) continue
    try {
      const raw = await readRepoJson(dirPath, `.dethereal/template-fields/${id}.json`)
      if (raw && Array.isArray(raw.templateFields)) {
        templateFieldManifests.set(id, {
          classId: typeof raw.classId === 'string' ? raw.classId : undefined,
          fields: raw.templateFields.length,
        })
      }
    } catch (err) {
      // A manifest is only a cross-check; an unreadable one is not compared, and is named as refused.
      templateFieldsRefused.push({ file: `.dethereal/template-fields/${id}.json`, code: err instanceof StateFileError ? err.code : 'unreadable' })
    }
  }

  const pending = await readPendingEnrichment(dirPath)
  // manifest.json's modules are derived: every gate, and the review hash, see the derived list.
  const manifestModulesOnDisk = manifest?.modules
  const derived = deriveManifestModules({ manifestModules: manifestModulesOnDisk, scope, structure, dataFlows, dataItems, classModules: classTemplates.modules ?? new Map() })
  const withModules = manifest && typeof manifest === 'object' ? { ...manifest, modules: derived.modules } : manifest
  return { manifest: withModules, structure, dataFlows, dataItems, attributes, attributeIssues, classTemplates, scope, templateFieldManifests, pending,
    moduleGaps: derived.gaps, manifestModulesOnDisk, templateFieldsRefused, settlement: settlementOn(options.settlement) ? 'on' : 'off' }
}

/**
 * The derived module list for a model a push holds in memory, read against its directory's class
 * cache and scope: what the push gates and sends.
 */
export async function modulesForPush(dirPath: string, model: { manifest: ModelManifest; structure: ModelStructure; dataFlows?: unknown; dataItems?: unknown }): Promise<DerivedModules> {
  const [classTemplates, scope] = await Promise.all([readClassTemplates(dirPath), readScopeFile(dirPath)])
  return deriveManifestModules({
    manifestModules: model.manifest?.modules, scope, structure: model.structure,
    dataFlows: listOf(model.dataFlows, 'dataFlows') as DataFlow[], dataItems: listOf(model.dataItems, 'dataItems') as DataItem[],
    classModules: classTemplates.modules ?? new Map(),
  })
}

/** The crown-jewel map (`crown_jewel_elements`) when it is a plain object. */
function crownJewelMap(scope: Record<string, unknown> | null): Record<string, unknown> | null {
  const map = scope?.crown_jewel_elements
  return map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>) : null
}

/** Every string id named by the crown-jewel map. */
export function crownJewelIds(scope: Record<string, unknown> | null): Set<string> {
  const ids = new Set<string>()
  for (const v of Object.values(crownJewelMap(scope) ?? {})) {
    if (Array.isArray(v)) for (const id of v) if (typeof id === 'string') ids.add(id)
  }
  return ids
}

// =============================================================================
// Computation
// =============================================================================

interface Model {
  input: GateInput
  tiers: Tiering
  boundaries: StructureBoundary[]
  components: StructureComponent[]
  internal: StructureComponent[]
  tier12: StructureComponent[]
  flowById: Map<string, DataFlow>
  itemById: Map<string, DataItem>
  boundaryById: Map<string, StructureBoundary>
  cross: DataFlow[]
  mappedIds: Set<string>
  attrs(group: 'boundaries' | 'components' | 'dataFlows' | 'dataItems', id: string): Record<string, unknown>
  nameOf(id: string): string | undefined
}

/** C2's floor: the share of template fields answered over the Tier 1–2 components. */
export const C2_FLOOR = 0.8

/** One Tier 1–2 component as C2 counts it: its template fields answered, or why it cannot be counted. */
function c2Count(m: Model, templates: ReadonlyMap<string, ClassTemplate>, c: StructureComponent):
  { blocked: string } | { template: ClassTemplate; values: Record<string, unknown>; resolved: number } {
  const classId = c.classData?.id
  const template = classId ? templates.get(classId) : undefined
  if (!classId) return { blocked: 'unclassified' }
  if (!template) return { blocked: 'no usable cached class template' }
  const values = m.attrs('components', c.id)
  return { template, values, resolved: template.fields.filter((f) => isResolved(values, f, template.schema[f])).length }
}

/** What a quick model still lacks on Tier 1–2 when it records Step 8: C2's unanswered fields and C8's floor keys. */
export interface PriorityGaps {
  c2?: { rate: number; floor: number; elements: Array<{ id: string; name?: string; null_fields: string[]; no_template?: true }> }
  c8?: { elements: Array<{ id: string; name?: string; missing: string[]; alias_present?: string[] }> }
}

/**
 * The gaps Gate 3's C2 and C8 find on Tier 1–2, by element: field names only, never values. C2 lists every Tier 1–2
 * component with a field unanswered (a stand-in counts as unanswered: the rate is over all of them), C8 its failures.
 * Undefined when both pass; 'not_computed' when Gate 3 is not computed, so nothing can be said either way.
 */
export function priorityGaps(input: GateInput): PriorityGaps | 'not_computed' | undefined {
  const g3 = computeGates(input).gate3
  if (!('criteria' in g3)) return 'not_computed'
  const m = buildModel(input)
  const templates = input.classTemplates.templates
  const out: PriorityGaps = {}
  const c2 = g3.criteria.C2
  if (c2.verdict !== 'PASS') {
    let declared = 0
    let resolved = 0
    const elements: NonNullable<PriorityGaps['c2']>['elements'] = []
    for (const c of m.tier12) {
      const counted = c2Count(m, templates, c)
      const name = m.nameOf(c.id)
      if ('blocked' in counted) { elements.push({ id: c.id, ...(name ? { name } : {}), null_fields: [], no_template: true }); continue }
      declared += counted.template.fields.length
      resolved += counted.resolved
      const open = counted.template.fields.filter((f) => !isResolved(counted.values, f, counted.template.schema[f]))
      if (open.length) elements.push({ id: c.id, ...(name ? { name } : {}), null_fields: open })
    }
    out.c2 = { rate: declared ? Math.round((resolved / declared) * 1000) / 1000 : 0, floor: C2_FLOOR, elements }
  }
  const c8 = g3.criteria.C8
  if (c8.verdict !== 'PASS') {
    out.c8 = {
      elements: c8.failing.map((f) => ({
        id: f.id, ...(f.name ? { name: f.name } : {}), missing: [...(f.missing ?? []), ...(f.placeholder ?? [])],
        ...(f.alias_present?.length ? { alias_present: f.alias_present } : {}),
      })),
    }
  }
  return out.c2 || out.c8 ? out : undefined
}

function buildModel(input: GateInput): Model {
  const mappedIds = crownJewelIds(input.scope.scope)
  const tiers = classifyTiers({ structure: input.structure, dataFlows: input.dataFlows, dataItems: input.dataItems, crownJewelIds: mappedIds })
  const { boundaries, components } = flattenStructure(input.structure)
  const internal = components.filter((c) => !tiers.externals.has(c.id))
  const names = new Map<string, string>()
  for (const e of [...boundaries, ...components, ...input.dataFlows, ...input.dataItems]) if (e?.id) names.set(e.id, e.name)
  return {
    input,
    tiers,
    boundaries,
    components,
    internal,
    tier12: internal.filter((c) => (tiers.tierOf.get(c.id) ?? 3) <= 2),
    flowById: new Map(input.dataFlows.map((f) => [f.id, f])),
    itemById: new Map(input.dataItems.map((i) => [i.id, i])),
    boundaryById: new Map(boundaries.map((b) => [b.id, b])),
    cross: input.dataFlows.filter((f) => tiers.crossBoundaryFlowIds.has(f.id)),
    mappedIds,
    attrs: (group, id) => {
      const values = attributeEntry(input.attributes, group, id)?.attributes
      return values && typeof values === 'object' ? (values as Record<string, unknown>) : {}
    },
    nameOf: (id) => names.get(id),
  }
}

const failure = (m: Model, id: string, detail?: string, gaps?: { missing?: string[]; placeholder?: string[] }): GateFailure => {
  const name = m.nameOf(id)
  return {
    id, ...(name ? { name } : {}), ...(detail ? { detail } : {}),
    ...(gaps?.missing?.length ? { missing: gaps.missing } : {}), ...(gaps?.placeholder?.length ? { placeholder: gaps.placeholder } : {}),
  }
}

/** Sensitivity floor of a data item's class: the fixed table, then the class-name rule. */
export function classFloor(classData: { id?: string; name?: string } | null | undefined, templates: ReadonlyMap<string, ClassTemplate>): number {
  if (!classData?.id) return -1
  const fixed = CLASS_FLOOR_IDS[classData.id]
  if (fixed !== undefined) return fixed
  const name = templates.get(classData.id)?.name ?? classData.name ?? ''
  if (RESTRICTED_CLASS_WORDS.test(name)) return 3
  if (CONFIDENTIAL_CLASS_WORDS.test(name)) return 2
  return -1
}

/** Sensitivity floor of a data item: the maximum of its class floor and its canonical flags' floors. */
export function dataItemFloor(item: DataItem, templates: ReadonlyMap<string, ClassTemplate>): number {
  const flags = Array.isArray(item.regulatory_flags) ? item.regulatory_flags : []
  // Case and common aliases resolve to the canonical flag's floor; the lints still ask for the exact spelling.
  return Math.max(classFloor(item.classData, templates), ...flags.map((f) => regulatoryFlagFloor(f)))
}

type Waived = ReadonlyMap<Criterion, ReadonlySet<string>>

function gate3(m: Model, waived: Waived = new Map()): {
  criteria: Record<Criterion, GateCheck>
  minRate: number | null
  /** Every failure, uncapped and before waivers apply. */
  full: Record<Criterion, GateFailure[]>
  /** How many elements each criterion assesses (the base of the waived share). */
  population: Record<Criterion, number>
  /** Criteria failing structurally, which no waiver can pass, with the fix. */
  structural: Partial<Record<Criterion, string>>
} {
  const structural: Partial<Record<Criterion, string>> = {}
  const { templates } = m.input.classTemplates
  const criteria = {} as Record<Criterion, GateCheck>
  const full = {} as Record<Criterion, GateFailure[]>
  const population = {} as Record<Criterion, number>
  // How a remedy has an agent record what a source shows, and what it does with a field nothing settles: with the
  // settlement on, a pending-enrichment entry the operator confirms, and a question; with it off, the value as the source
  // shows it, and the field left null as an Open fields question for the operator.
  const settlementIsOn = settlementOn(m.input.settlement)
  const fromSource = settlementIsOn ? 'from what a source shows, with a pending-enrichment entry the operator confirms' : 'from what a source shows'
  const leaveNull = (ask: string) => (settlementIsOn ? `leave it null and ${ask}` : 'leave it null as an Open fields question for the operator')
  /**
   * Record a criterion's result. A waiver in use takes its element out of the
   * failures; the criterion passes only when nothing else fails and the failure
   * was about elements (`structural` failures are never waived).
   */
  const finish = (c: Criterion, ok: boolean, value: string, failing: GateFailure[], remedy: string, structural = false, waivedHits: GateFailure[] = []) => {
    full[c] = failing
    const w = structural ? new Set<string>() : (waived.get(c) ?? new Set<string>())
    const hits = [...waivedHits, ...failing.filter((f) => w.has(f.id))]
    const rest = failing.filter((f) => !w.has(f.id))
    const pass = ok || (!structural && rest.length === 0 && hits.length > 0)
    const result = check(pass, value, pass ? [] : rest, remedy)
    if (hits.length) result.waived = hits.slice(0, MAX_FAILING)
    criteria[c] = result
  }

  // C1 — every non-external component is classified.
  {
    const missing = m.internal.filter((c) => !c.classData?.id)
    finish('C1', missing.length === 0,
      `${m.internal.length - missing.length}/${m.internal.length} non-external components classified`,
      missing.map((c) => failure(m, c.id)),
      'Propose a class for each listed component from the class catalog and assign it only after the operator confirms; ' +
      'when no class matches, leave it unclassified and ask. Never assign a class without a match.')
  }

  // C2 — ≥ 80 % of template fields answered on Tier 1–2.
  let minRate: number | null = null
  {
    let declared = 0
    let resolved = 0
    const blocked: GateFailure[] = []
    const partial: GateFailure[] = []
    const waivedC2: GateFailure[] = []
    const w2 = waived.get('C2') ?? new Set<string>()
    for (const c of m.tier12) {
      // A waived component leaves the population the rate is measured over.
      if (w2.has(c.id)) { waivedC2.push(failure(m, c.id, 'waived')); continue }
      const counted = c2Count(m, templates, c)
      if ('blocked' in counted) { blocked.push(failure(m, c.id, counted.blocked)); continue }
      const { template, values, resolved: r } = counted
      declared += template.fields.length
      resolved += r
      const rate = r / template.fields.length
      minRate = minRate === null ? rate : Math.min(minRate, rate)
      const placeholders = template.fields.filter((f) => present(values, f) && isGateStandIn(values[f], f, template.schema[f]))
      if (r < template.fields.length) {
        const unanswered = template.fields.filter((f) => !isResolved(values, f, template.schema[f]) && !placeholders.includes(f))
        partial.push(failure(m, c.id, `${r}/${template.fields.length} fields answered${placeholders.length ? `; placeholder: ${placeholders.join(', ')}` : ''}`, { missing: unanswered, placeholder: placeholders }))
      }
    }
    const ok = declared > 0 && blocked.length === 0 && resolved / declared >= C2_FLOOR
    if (declared === 0 || blocked.length > 0) {
      structural.C2 = 'C2 fails structurally: classify the Tier 1–2 components without a class, or run generate_attribute_stubs for those without a cached template, first'
    }
    const basis = declared === 0 ? ' — no template basis' : ''
    finish('C2', ok,
      `${pct(resolved, declared)} (${resolved}/${declared} template fields) over ${m.tier12.length - waivedC2.length} Tier 1–2 components; ` +
      `${blocked.length} without a class or usable template${basis}${waivedC2.length ? `; ${waivedC2.length} waived` : ''}`,
      ok ? [] : [...blocked, ...partial],
      `Record each unanswered field ${fromSource}, or ${leaveNull('ask the operator')}; ` +
      'a gap that cannot be answered needs a per-element waiver at Gate 3\'s waiver questions ' +
      '(Step 9). Components without a usable ' +
      'template need generate_attribute_stubs. Never write a placeholder in any spelling; replace one with null.',
      declared === 0 || blocked.length > 0, waivedC2)
  }

  // C3 — every cross-boundary flow is reviewed.
  {
    const bad: GateFailure[] = []
    for (const f of m.cross) {
      const a = m.attrs('dataFlows', f.id)
      const template = f.classData?.id ? templates.get(f.classData.id) : undefined
      const missing: string[] = []
      const placeholder: string[] = []
      const gap = (k: string) => (present(a, k) ? placeholder : missing).push(k)
      // A flow that declares no authentication (no credentials, no credential type) has no failure mode to record.
      const declaresNoAuth = declaresNoAuthentication(a)
      if (!declaresNoAuth && !isAuthFailureMode(a.auth_failure_mode)) gap('auth_failure_mode')
      const literal = present(a, 'encryption_in_transit') && !isGateStandIn(a.encryption_in_transit, 'encryption_in_transit', template?.schema.encryption_in_transit)
      const alias = !!template && TRANSIT_ALIASES.some((k) => template.fields.includes(k) && isResolved(a, k, template.schema[k]))
      if (!literal && !alias) gap('encryption_in_transit')
      if (!Array.isArray(a.required_credentials)) missing.push('required_credentials')
      else if (isGateStandIn(a.required_credentials, 'required_credentials', template?.schema.required_credentials)) placeholder.push('required_credentials')
      if (missing.length || placeholder.length) bad.push(failure(m, f.id, gapDetail(missing, placeholder), { missing, placeholder }))
    }
    finish('C3', bad.length === 0, `${m.cross.length - bad.length}/${m.cross.length} cross-boundary flows reviewed`, bad,
      `For each listed flow, record encryption_in_transit (or the flow class's own transit field) ${fromSource}. ` +
      (settlementIsOn
        ? 'auth_failure_mode (deny, fallback or fail_open, only for a flow ' +
          'that authenticates) and required_credentials are the operator\'s: propose them from a source and write them only after ' +
          'the operator confirms. '
        : 'Write auth_failure_mode (deny, fallback or fail_open, only for a flow that authenticates) and required_credentials ' +
          'from what a source shows, with its citation. ') +
      'Propose [] for required_credentials when a cited source shows the flow is unauthenticated; write ' +
      `it only after the operator confirms. Insecure values are fine. When nothing settles a value, ${leaveNull('ask')}; ` +
      'never write a placeholder in any spelling.')
  }

  // C4 — sensitive flows carry a classified data item with a sensitivity.
  {
    const sensitive = m.input.dataFlows.filter((f) => {
      const s = f.source?.id
      const t = f.target?.id
      if (m.tiers.locationOf(s) === undefined || m.tiers.locationOf(t) === undefined) return false
      for (const id of [s, t]) {
        const c = id ? m.tiers.components.get(id) : undefined
        if (c && (c.crownJewel === true || c.type === 'STORE')) return true
      }
      if ((f.dataItemIds ?? []).some((d) => m.mappedIds.has(d))) return true
      const zs = m.tiers.endpointZone(s)
      const zt = m.tiers.endpointZone(t)
      if (zt === 'RESTRICTED' && zs !== 'RESTRICTED') return true
      // The zones open to the outside: external ones, and the internet-facing PUBLIC and EXPOSED (the DMZ), as tiers
      // count them.
      const exposed = (z: string | null) => z === 'VENDOR' || z === 'UNTRUSTED' || z === 'PUBLIC' || z === 'EXPOSED'
      // Data leaving an exposed zone, or entering one: the trip crosses from an open zone into another zone.
      return zt !== zs && (exposed(zs) || exposed(zt))
    })
    const carries = (f: DataFlow): boolean => (f.dataItemIds ?? []).some((id) => {
      const item = m.itemById.get(id)
      return !!item && !!item.classData?.id && sensitivityRank(item.sensitivity) >= 0
    })
    const bad = sensitive.filter((f) => !carries(f))
    const none = m.input.dataItems.length === 0
    if (none) structural.C4 = 'C4 fails structurally: the model has no data items'
    const withSensitivity = m.input.dataItems.filter((i) => sensitivityRank(i.sensitivity) >= 0).length
    population.C4 = sensitive.length
    finish('C4', !none && bad.length === 0,
      `${sensitive.length - bad.length}/${sensitive.length} sensitive flows carry a classified data item with a sensitivity; ` +
      `${m.input.dataItems.length} data items, ${withSensitivity} with a sensitivity${none ? ' — no data items' : ''}`,
      bad.map((f) => failure(m, f.id)),
      'Propose the data item each listed flow carries, with its class and sensitivity (public, internal, confidential, ' +
      'restricted), from what a source shows, and link it only after the operator confirms.', none)
  }

  // C5 — at least one cross-boundary flow.
  finish('C5', m.cross.length >= 1, `${m.cross.length} cross-boundary flows`, [],
    'Model the trust boundaries the system crosses; if it truly crosses none, ask the operator.', true)

  // C6 — crown jewels resolve through the persisted map.
  {
    const { scope, error } = m.input.scope
    const jewels = scope?.crown_jewels
    const map = crownJewelMap(scope)
    const bad: GateFailure[] = []
    let ok = true
    let value: string
    if (error) {
      ok = false
      value = `.dethereal/scope.json refused (${error})`
    } else if (!Array.isArray(jewels) || !jewels.every((j) => typeof j === 'string')) {
      ok = false
      value = 'scope names no crown jewels (crown_jewels is missing or not a list of names)'
    } else if (jewels.length === 0) {
      ok = false
      value = 'scope names no crown jewels'
    } else if (!map) {
      ok = false
      value = `${jewels.length} crown jewels; no crown-jewel map (crown_jewel_elements) in scope.json`
      for (const j of jewels) bad.push({ id: j, name: j, detail: 'not mapped to any element' })
    } else {
      let anyInternal = false
      for (const j of jewels) {
        const ids = own(map, j) && Array.isArray(map[j]) ? (map[j] as unknown[]).filter((x): x is string => typeof x === 'string') : []
        const resolving = ids.filter((id) => m.tiers.components.has(id) || m.boundaryById.has(id) || m.flowById.has(id) || m.itemById.has(id))
        if (resolving.length === 0) {
          bad.push({ id: j, name: j, detail: own(map, j) ? 'maps to no existing element' : 'not in the crown-jewel map' })
          continue
        }
        for (const id of resolving) {
          const c = m.tiers.components.get(id)
          if (!c) continue
          if (!m.tiers.externals.has(id)) anyInternal = true
          if (c.crownJewel !== true) bad.push(failure(m, id, `mapped to "${j}" but crownJewel is not true`))
        }
      }
      if (!anyInternal) ok = false
      value = `${jewels.length - bad.filter((b) => jewels.includes(b.id)).length}/${jewels.length} crown jewels resolve` +
        (anyInternal ? '' : '; none maps to a non-external component')
    }
    finish('C6', ok && bad.length === 0, value, bad,
      'After operator confirmation, map each crown jewel in scope.json crown_jewel_elements to the elements that hold it, ' +
      'and set crownJewel: true on every mapped component. At least one must be a non-external component.', true)
  }

  // C7 — sensitivity at or above its floor.
  {
    const bad: GateFailure[] = []
    let floored = 0
    for (const item of m.input.dataItems) {
      const floor = dataItemFloor(item, templates)
      if (floor < 0) continue
      floored++
      const rank = sensitivityRank(item.sensitivity)
      if (rank < floor) {
        bad.push(failure(m, item.id, `sensitivity ${rank < 0 ? 'missing or off the scale' : SENSITIVITY_SCALE[rank]}; floor ${SENSITIVITY_SCALE[floor]}`))
      }
    }
    population.C7 = floored
    finish('C7', bad.length === 0, `${floored - bad.length}/${floored} data items with a sensitivity floor meet it`, bad,
      'Propose raising each listed data item\'s sensitivity to its floor and write it only after the operator confirms. Where ' +
      'a failure is waivable, the operator may instead say why the sensitivity should be lower, at Gate 3\'s waiver ' +
      'questions (Step 9).')
  }

  // C8 — the literal six-attribute floor on Tier 1–2.
  {
    const typed = (v: unknown, t: string): boolean =>
      t === 'string' ? typeof v === 'string' : t === 'boolean' ? typeof v === 'boolean' : Array.isArray(v)
    /** 'ok', 'missing' (absent or of the wrong type) or 'placeholder'. */
    const floorState = (c: StructureComponent, k: string, a: Record<string, unknown>, t: string): 'ok' | 'missing' | 'placeholder' => {
      if (!present(a, k) || !typed(a[k], t)) return 'missing'
      if (k === 'encryption_at_rest' && isNotApplicable(a[k])) return mayAnswerNotApplicable(c, templates) ? 'ok' : 'placeholder'
      const schema = c.classData?.id ? templates.get(c.classData.id)?.schema[k] : undefined
      return isGateStandIn(a[k], k, schema) ? 'placeholder' : 'ok'
    }
    const badComponents = m.tier12.flatMap((c) => {
      const a = m.attrs('components', c.id)
      const states = Object.entries(FLOOR_KEYS).map(([k, t]) => [k, floorState(c, k, a, t)] as const)
      const missing = states.filter(([, st]) => st === 'missing').map(([k]) => k)
      const placeholder = states.filter(([, st]) => st === 'placeholder').map(([k]) => k)
      return missing.length || placeholder.length ? [failure(m, c.id, gapDetail(missing, placeholder), { missing, placeholder })] : []
    })
    const tier12Ids = new Set(m.tier12.map((c) => c.id))
    const flows = m.input.dataFlows.filter((f) => tier12Ids.has(f.source?.id) || tier12Ids.has(f.target?.id))
    const badFlows = flows.flatMap((f) => {
      const a = m.attrs('dataFlows', f.id)
      const v = a.encryption_in_transit
      const schema = f.classData?.id ? templates.get(f.classData.id)?.schema.encryption_in_transit : undefined
      if (typeof v !== 'string') {
        // C3 reads the class's own transit field; C8's floor key is literal, so a flow with only the alias fails here.
        const aliases = transitAliasesOnly(a)
        return [{
          ...failure(m, f.id, `${gapDetail(['encryption_in_transit'], [])}${aliases.length ? ` (set under ${aliases.join(', ')}: write encryption_in_transit beside it)` : ''}`, { missing: ['encryption_in_transit'] }),
          ...(aliases.length ? { alias_present: aliases } : {}),
        }]
      }
      return isGateStandIn(v, 'encryption_in_transit', schema) ? [failure(m, f.id, gapDetail([], ['encryption_in_transit']), { placeholder: ['encryption_in_transit'] })] : []
    })
    population.C8 = m.tier12.length + flows.length
    finish('C8', badComponents.length === 0 && badFlows.length === 0,
      `${m.tier12.length - badComponents.length}/${m.tier12.length} Tier 1–2 components and ` +
      `${flows.length - badFlows.length}/${flows.length} of their flows carry the floor keys`,
      [...badComponents, ...badFlows],
      'Record authentication_type, encryption_in_transit, encryption_at_rest (strings), implicit_deny_enabled (boolean) and ' +
      `monitoring_tools (list) under exactly these keys, ${fromSource} — "none", false and [] are valid answers when a ` +
      'source says so. encryption_at_rest may be ' +
      '"not_applicable" on a component that stores nothing (never on a store); a not-applicable spelling on any other key is ' +
      `a placeholder (use none). When nothing settles a value, ${leaveNull('ask')}; never write a placeholder in any spelling. ` +
      'A flow listed with alias_present records its transit under its class\'s own field: write encryption_in_transit beside ' +
      'it from the same source.')
  }

  // C9 — no dangling credential_scope id.
  {
    const required = new Set<string>()
    for (const f of m.input.dataFlows) {
      const r = m.attrs('dataFlows', f.id).required_credentials
      if (Array.isArray(r)) for (const x of r) if (isRealListEntry(x)) required.add(x as string)
    }
    const bad: GateFailure[] = []
    let total = 0
    let scoped = 0
    for (const c of m.components) {
      const a = m.attrs('components', c.id)
      if (!present(a, 'credential_scope')) continue
      scoped++
      const scope = a.credential_scope
      if (!Array.isArray(scope)) { bad.push(failure(m, c.id, 'credential_scope is not a list')); continue }
      const ids = scope.filter((x): x is string => isRealListEntry(x))
      total += ids.length
      const dangling = ids.filter((x) => !required.has(x))
      if (dangling.length) bad.push(failure(m, c.id, `not required by any flow: ${dangling.join(', ')}`))
    }
    population.C9 = scoped
    finish('C9', bad.length === 0, `${bad.length} components with credential_scope ids no flow requires (${total} ids)`, bad,
      'Propose adding each listed id to required_credentials on the flow that presents that credential, and write it only ' +
      'after the operator confirms. Remove a credential_scope entry only after the operator confirms it is wrong.')
  }

  population.C1 = m.internal.length
  population.C2 = m.tier12.length
  population.C3 = m.cross.length
  population.C5 = m.cross.length
  population.C6 = m.tier12.length
  return { criteria, minRate, full, population, structural }
}

function valueShares(bags: Array<{ values: Record<string, unknown>; keys: Iterable<string>; schema?: Record<string, unknown> }>): ValueShares {
  let counted = 0
  let standIns = 0
  let typeDefaults = 0
  let templateDefaults = 0
  let invalid = 0
  for (const { values, keys, schema } of bags) {
    for (const k of new Set(keys)) {
      if (!present(values, k)) continue
      const v = values[k]
      const fieldSchema = schema?.[k] as { default?: unknown } | undefined
      counted++
      if (isGateStandIn(v, k, fieldSchema)) standIns++
      if (isTypeDefault(v)) typeDefaults++
      if (fieldSchema && own(fieldSchema, 'default') && isDeepStrictEqual(fieldSchema.default, v)) templateDefaults++
      if (fieldSchema && !isValidForSchema(v, fieldSchema)) invalid++
    }
  }
  return {
    counted,
    stand_ins: standIns,
    stand_in_share: share(standIns, counted),
    type_defaults: typeDefaults,
    type_default_share: share(typeDefaults, counted),
    template_defaults: templateDefaults,
    template_default_share: share(templateDefaults, counted),
    invalid,
    invalid_share: share(invalid, counted),
  }
}

/** Tier membership as the gates see it, for reports that group by tier. */
export function tierMembers(m: Pick<Model, 'internal' | 'tiers' | 'nameOf'> & { externalCrownJewels: number; dataFlows: ReadonlyArray<DataFlow> }): TierMembers {
  const listed = (c: { id: string }): ListedElement => {
    const name = m.nameOf(c.id)
    return { id: c.id, ...(name ? { name } : {}) }
  }
  const of = (t: Tier) => m.internal.filter((c) => m.tiers.tierOf.get(c.id) === t)
  const [t1, t2, t3] = [of(1), of(2), of(3)]
  const unzoned = new Set(m.tiers.unzoned)
  const jewels = m.internal.filter((c) => c.crownJewel === true)
  const crossIds = crossBoundaryComponentIds(m.tiers, m.dataFlows)
  const cross = m.internal.filter((c) => crossIds.has(c.id))
  return {
    tier1: t1.slice(0, MAX_FAILING).map(listed), tier1_total: t1.length,
    tier2: t2.slice(0, MAX_FAILING).map(listed), tier2_total: t2.length,
    tier3_total: t3.length,
    tier3_unzoned: t3.filter((c) => unzoned.has(c.id)).length,
    labels: {
      crown_jewels: jewels.slice(0, MAX_FAILING).map(listed), crown_jewels_total: jewels.length, crown_jewel_externals: m.externalCrownJewels,
      cross_boundary: cross.slice(0, MAX_FAILING).map(listed), cross_boundary_total: cross.length,
    },
  }
}

function report(m: Model, minRate: number | null): Gate3Report {
  const { templates, refused } = m.input.classTemplates
  const templateOf = (classId: string | undefined) => (classId ? templates.get(classId) : undefined)

  const count = (t: number) => m.internal.filter((c) => m.tiers.tierOf.get(c.id) === t).length

  // Declared or inherited zone against the engine's proposal, on boundaries that hold components.
  const zoning = buildZoningContext(m.input.structure, m.input.dataFlows, m.input.dataItems)
  const zone_disagreements: Gate3Report['zone_disagreements'] = []
  for (const b of m.boundaries) {
    if (b.id === zoning.defaultBoundaryId || !(b.components ?? []).length) continue
    const boundary = zoning.boundariesById.get(b.id)
    if (!boundary || isStructuralContainer(boundary)) continue
    const proposed = proposedZoneTier(boundary, zoning, m.attrs('boundaries', b.id).allow_any_inbound).tier
    const zone = m.tiers.boundaryZone(b.id)
    if (zone !== proposed) zone_disagreements.push({ boundary: b.id, name: b.name, zone, proposed })
  }

  const floored = new Set(m.input.dataItems.filter((i) => dataItemFloor(i, templates) >= 0).map((i) => i.id))
  const floored_data_outside_tier12 = m.internal
    .filter((c) => m.tiers.tierOf.get(c.id) === 3 && (c.dataItemIds ?? []).some((id) => floored.has(id)))
    .map((c) => ({ id: c.id, name: c.name }))

  const tier12_components = valueShares(m.tier12.map((c) => {
    const t = templateOf(c.classData?.id ?? undefined)
    const values = m.attrs('components', c.id)
    // "Not applicable" on a component that may not say it is a stand-in, and is counted as one.
    const counted = isNotApplicable(values.encryption_at_rest) && !mayAnswerNotApplicable(c, templates) ? { ...values, encryption_at_rest: 'unknown' } : values
    return { values: counted, keys: [...(t?.fields ?? []), ...Object.keys(FLOOR_KEYS)], schema: t?.schema }
  }))
  const flowKeys = ['auth_failure_mode', 'encryption_in_transit', 'required_credentials', ...TRANSIT_ALIASES]
  const cross_boundary_flows = valueShares(m.cross.map((f) => {
    const t = templateOf(f.classData?.id ?? undefined)
    return { values: m.attrs('dataFlows', f.id), keys: [...(t?.fields ?? []), ...flowKeys], schema: t?.schema }
  }))
  const data_items = valueShares(m.input.dataItems.map((i) => {
    const t = templateOf(i.classData?.id ?? undefined)
    return { values: { ...m.attrs('dataItems', i.id), sensitivity: i.sensitivity }, keys: [...(t?.fields ?? []), 'sensitivity'], schema: t?.schema }
  }))

  let atFloor = 0
  for (const i of m.input.dataItems) {
    const rank = sensitivityRank(i.sensitivity)
    if (rank === 0 || (rank >= 0 && rank === dataItemFloor(i, templates))) atFloor++
  }

  const fields_per_class: Record<string, number> = {}
  for (const [id, t] of templates) fields_per_class[id] = t.fields.length
  const manifest_mismatches: Gate3Report['templates']['manifest_mismatches'] = []
  for (const c of m.tier12) {
    const man = m.input.templateFieldManifests?.get(c.id)
    const t = templateOf(c.classData?.id ?? undefined)
    if (!man || !t || (man.classId && man.classId !== c.classData?.id)) continue
    if (man.fields !== t.fields.length) manifest_mismatches.push({ id: c.id, name: c.name, cache: t.fields.length, manifest: man.fields })
  }

  const map = crownJewelMap(m.input.scope.scope)
  const jewels = Array.isArray(m.input.scope.scope?.crown_jewels) ? (m.input.scope.scope!.crown_jewels as unknown[]) : []
  const known = (id: string) => m.tiers.components.has(id) || m.boundaryById.has(id) || m.flowById.has(id) || m.itemById.has(id)

  return {
    tiers: { tier1: count(1), tier2: count(2), tier3: count(3), externals: m.tiers.externals.size, unzoned: m.tiers.unzoned.length },
    tier_members: tierMembers({ ...m, dataFlows: m.input.dataFlows, externalCrownJewels: [...m.tiers.externals].filter((id) => m.tiers.components.get(id)?.crownJewel === true).length }),
    ...(settlementOn(m.input.settlement) ? { pending_enrichment: (({ state, blocking, blocks }) => ({ state, blocking, blocks }))(pendingEnrichment(m.input)) } : {}),
    zone_disagreements,
    floored_data_outside_tier12,
    values: { tier12_components, cross_boundary_flows, data_items },
    data_items_at_floor_or_public: { count: atFloor, of: m.input.dataItems.length },
    declared_unauthenticated: {
      n: m.cross.filter((f) => declaresNoAuthentication(m.attrs('dataFlows', f.id))).length,
      of: m.cross.length,
    },
    c2_min_element_rate: minRate === null ? null : share(minRate, 1),
    templates: { fields_per_class, refused, manifest_mismatches },
    crown_jewel_map: {
      unmapped_keys: map ? Object.keys(map).filter((k) => !jewels.includes(k)) : [],
      dangling_ids: [...crownJewelIds(m.input.scope.scope)].filter((id) => !known(id)),
    },
  }
}

function gate1(m: Model): Record<string, GateCheck> {
  const warn = (ok: boolean, value: string, failing: GateFailure[], remedy: string) => check(ok, value, failing, remedy, 'WARN')
  const unclassified = m.internal.filter((c) => !c.classData?.id)
  const unnamed = m.input.dataFlows.filter((f) =>
    !(typeof f.name === 'string' && f.name.trim()) || !(typeof f.description === 'string' && f.description.trim()))
  const single = m.boundaries.filter((b) =>
    b.id !== m.input.structure.defaultBoundary.id && (b.components ?? []).length + (b.boundaries ?? []).length === 1)
  const mixed = m.boundaries.filter((b) => {
    const cs = b.components ?? []
    return cs.some((c) => m.tiers.externals.has(c.id)) && cs.some((c) => !m.tiers.externals.has(c.id))
  })
  const securityKeys = ['encryption_in_transit', 'auth_failure_mode', 'required_credentials', ...TRANSIT_ALIASES]
  const unprotected = m.cross.filter((f) => {
    if (Array.isArray(f.controls) && f.controls.length > 0) return false
    const a = m.attrs('dataFlows', f.id)
    return !securityKeys.some((k) => present(a, k) && !isStandIn(a[k]) && !isTypeDefault(a[k]))
  })
  return {
    unclassified_components: warn(unclassified.length === 0, `${unclassified.length} non-external components without a class`,
      unclassified.map((c) => failure(m, c.id)), 'Classify the listed components.'),
    unnamed_flows: warn(unnamed.length === 0, `${unnamed.length} flows without a name or description`,
      unnamed.map((f) => failure(m, f.id)), 'Name and describe the listed flows.'),
    single_child_boundaries: warn(single.length === 0, `${single.length} boundaries with a single child`,
      single.map((b) => failure(m, b.id)), 'Check whether each listed boundary needs refining or merging.'),
    mixed_external_boundaries: warn(mixed.length === 0, `${mixed.length} boundaries mixing external entities with internal components`,
      mixed.map((b) => failure(m, b.id)), 'Move external entities into their own boundary outside the internal zone.'),
    unprotected_cross_boundary_flows: warn(unprotected.length === 0, `${unprotected.length} cross-boundary flows without a recorded security control`,
      unprotected.map((f) => failure(m, f.id)), 'Record the controls or security attributes the listed flows have, as observed.'),
    unzoned_components: warn(m.tiers.unzoned.length === 0, `${m.tiers.unzoned.length} non-external components in no declared or inherited zone`,
      m.tiers.unzoned.map((id) => failure(m, id)), 'Confirm a trust zone for the boundaries holding the listed components.'),
  }
}

const MODULES_REMEDY =
  'manifest.json modules are derived: the modules it lists, the scope\'s activeModules, and the module of every class the model uses, ' +
  'read from the class cache (or a pulled element\'s classData.module). For a class listed here, run generate_attribute_stubs with platform ' +
  'access for its elements to refresh its cache entry; fix or remove an entry listed as not {id, name}. With nothing to derive from, confirm ' +
  'the model\'s modules into the scope\'s activeModules. Fill in the model name and description in manifest.json.'

function moduleGapFailure(g: ModuleGap): GateFailure {
  const on = g.elements.length ? ` (${g.elements.length} element(s): ${g.elements.slice(0, 5).join(', ')}${g.elements.length > 5 ? ', …' : ''})` : ''
  const detail = {
    module_unknown: `no module is known for this class${on}`,
    module_conflict: `the class cache and the elements name different modules for this class${on}`,
    scope_unreadable: '.dethereal/scope.json could not be read, so its activeModules are unknown',
    scope_module_invalid: 'an activeModules entry in .dethereal/scope.json is not {id, name}',
    manifest_module_invalid: 'a modules entry in manifest.json is not {id, name}',
  }[g.reason]
  return { id: g.id, ...(g.className ? { name: g.className } : {}), detail: `${g.reason}: ${detail}` }
}

function gate2(m: Model, extraErrors: readonly GateFailure[]): Record<string, GateCheck> {
  const moduleGaps = m.input.moduleGaps ?? []
  const model = m.input.manifest?.model as { name?: unknown; description?: unknown } | undefined
  const manifestGaps = [
    ...(typeof model?.name === 'string' && model.name.trim() ? [] : ['name']),
    ...(typeof model?.description === 'string' && model.description.trim() ? [] : ['description']),
    ...(Array.isArray(m.input.manifest?.modules) && m.input.manifest.modules.length > 0 ? [] : ['modules']),
  ]
  const minimum = [
    ...(m.boundaries.length > 1 ? [] : ['boundary']),
    ...(m.components.length > 0 ? [] : ['component']),
    ...(m.input.dataFlows.length > 0 ? [] : ['flow']),
  ]
  const dangling = m.input.dataFlows.filter((f) =>
    m.tiers.locationOf(f.source?.id) === undefined || m.tiers.locationOf(f.target?.id) === undefined)
  const ids: Record<string, Set<string>> = {
    boundaries: new Set(m.boundaries.map((b) => b.id)),
    components: new Set(m.components.map((c) => c.id)),
    dataFlows: new Set(m.input.dataFlows.map((f) => f.id)),
    dataItems: new Set(m.input.dataItems.map((i) => i.id)),
  }
  const orphans: GateFailure[] = []
  const withControls: GateFailure[] = []
  for (const [group, known] of Object.entries(ids)) {
    const bag = (m.input.attributes as Record<string, Record<string, ElementAttributes> | undefined>)[group]
    for (const [id, entry] of Object.entries(bag && typeof bag === 'object' ? bag : {})) {
      if (!known.has(id)) orphans.push({ id, detail: `attributes/${group}` })
      if (own(entry, 'controls') || own((entry as { attributes?: unknown })?.attributes, 'controls')) withControls.push(failure(m, id))
    }
  }
  // The reason text can quote the file (parser messages do): name the file only.
  const unreadable = m.input.attributeIssues.map((i) => ({ id: i.file, detail: 'could not be read' }))
  return {
    manifest_complete: check(manifestGaps.length === 0 && moduleGaps.length === 0,
      [manifestGaps.length ? `manifest lacks ${manifestGaps.join(', ')}` : '', moduleGaps.length ? `${moduleGaps.length} module reference(s) cannot be derived` : '']
        .filter(Boolean).join('; ') || 'manifest complete',
      [...manifestGaps.map((g) => ({ id: g })), ...moduleGaps.map(moduleGapFailure)], MODULES_REMEDY),
    minimum_structure: check(minimum.length === 0, minimum.length ? `model has no ${minimum.join(', ')}` : 'at least one boundary, component and flow',
      minimum.map((g) => ({ id: g })), 'Model at least one boundary, one component and one data flow.'),
    flow_endpoints_exist: check(dangling.length === 0, `${dangling.length} flows with an endpoint missing from the structure`,
      dangling.map((f) => failure(m, f.id)), 'Point each listed flow at existing elements, or remove it.'),
    no_orphan_attribute_files: check(orphans.length === 0, `${orphans.length} attribute files for elements that no longer exist`,
      orphans, 'Remove the listed attribute files with model_state_prune (it lists them and asks the operator first), or restore the elements they describe.'),
    attribute_files_readable: check(unreadable.length === 0, `${unreadable.length} attribute files could not be read`,
      unreadable, 'Fix or restore the listed attribute files; a push may otherwise overwrite them.'),
    no_controls_in_attribute_files: check(withControls.length === 0, `${withControls.length} attribute files carry a controls key`,
      withControls, 'Move controls out of attribute files; manage them with the controls tools.'),
    ...(extraErrors.length ? { lint_errors: check(false, `${extraErrors.length} validation errors`, [...extraErrors]) } : {}),
  }
}

export interface GateOptions {
  /** Further blocking errors for Gate 2 (validation lints). */
  gate2Errors?: readonly GateFailure[]
  /** The `waivers` value from `state.json`, as stored; malformed records are ignored. */
  waivers?: unknown
  /** Whether a waiver record was written by the waive tool; unverified records are listed, never applied. */
  verifyWaiver?: (record: WaiverRecord) => boolean
}

/** Criteria the lints report as warnings while the model is in progress. */
const IN_PROGRESS_CRITERIA: readonly Criterion[] = ['C6', 'C7', 'C8', 'C9']

/**
 * Compute Gates 1–3 for a loaded model, with the lints: lint errors block
 * Gate 2, so every caller gets the same Gate 2.
 */
export function computeGates(input: GateInput, options: GateOptions = {}): GatesResult {
  return computeGatesWithView(input, options).result
}

/** The gates, and what the loop-back guard reads of the same computation. */
export function computeGatesWithView(input: GateInput, options: GateOptions = {}): { result: GatesResult; view: LoopbackView } {
  const m = buildModel(input)
  const lints = computeLints(input)
  // Gate 2 checks controls in attribute files itself.
  const lintErrors: GateFailure[] = lints
    .filter((f) => f.severity === 'error' && f.rule !== 'controls_in_attributes')
    .map((f) => ({ id: f.element?.id ?? f.file ?? f.rule, ...(f.element?.name ? { name: f.element.name } : {}), detail: `${f.rule}: ${f.message}` }))
  const g1 = gate1(m)
  const g2 = gate2(m, [...lintErrors, ...(options.gate2Errors ?? [])])
  const raw = gate3(m)
  const { records, invalid } = parseWaivers(options.waivers)
  const ctx: WaiverContext = { m, p: records.length ? project(input) : ({} as Projection), full: raw.full, population: raw.population, structural: raw.structural }
  const resolved: ResolvedWaivers = records.length
    ? resolveWaivers(ctx, records, options.verifyWaiver ?? (() => false))
    : { applied: new Map(), uses: [], candidates: new Map() }
  const { applied, uses } = resolved
  const waivedAny = [...applied.values()].some((s) => s.size > 0)
  const { criteria, minRate, full } = waivedAny ? gate3(m, applied) : raw
  const room = waiverRoom(ctx, resolved)
  for (const c of Object.keys(criteria) as Criterion[]) {
    const r = criteria[c]
    r.waiver_headroom = room.headroom(c)
    r.failing = r.failing.map((f) => ({ ...f, ...room.failure(c, f) }))
  }
  const verdictOf = (c: Record<Criterion, GateCheck>): 'PASS' | 'FAIL' => (Object.values(c).every((x) => x.verdict === 'PASS') ? 'PASS' : 'FAIL')
  for (const c of IN_PROGRESS_CRITERIA) {
    const r = criteria[c]
    if (r.verdict === 'PASS') continue
    const listed = r.failing.slice(0, 10).map((f) => f.name ?? f.id)
    lints.push({
      rule: 'gate3_in_progress',
      severity: 'warning',
      message: `Gate 3 ${c} is not met yet: ${r.value}${listed.length ? ` (${listed.join(', ')}${r.failing_total > listed.length ? ', …' : ''})` : ''}. ${r.remedy ?? ''}`.trim(),
    })
  }
  // A Tier 1–2 flow C8 fails that records its transit only under its class's own field: C3 reads that field, C8 does not.
  for (const f of criteria.C8.failing) {
    if (!f.alias_present?.length) continue
    lints.push({
      rule: 'floor_key_alias_only',
      severity: 'warning',
      element: { id: f.id, ...(f.name ? { name: f.name } : {}) },
      file: `attributes/dataFlows/${f.id}.json`,
      message: `Flow "${f.name ?? f.id}" records its transit encryption under ${f.alias_present.join(', ')} but not under ` +
        'encryption_in_transit, the key Gate 3\'s C8 floor reads: write encryption_in_transit beside it, from the same source.',
    })
  }
  const pending = settlementOn(input.settlement) ? pendingEnrichment(input) : null
  if (pending?.blocks) {
    lints.push({
      rule: 'pending_enrichment',
      severity: 'warning',
      message: pending.state === 'unreadable'
        ? `The pending-enrichment file cannot be read (${pending.code}); the model cannot be REVIEWED or pushed until it can.`
        : `${pending.blocking} enrichment value${pending.blocking === 1 ? '' : 's'} await the operator's confirmation; ` +
          'the model cannot be REVIEWED or pushed until the operator has replied to each row.',
    })
  }
  const result: GatesResult = {
    lints,
    gate1: { verdict: Object.values(g1).every((c) => c.verdict === 'PASS') ? 'PASS' : 'WARN', checks: g1 },
    gate2: { verdict: Object.values(g2).every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL', checks: g2 },
    gate3: {
      verdict: verdictOf(criteria),
      verdict_without_waivers: verdictOf(raw.criteria),
      criteria,
      waived_total: uses.filter((u) => u.status === 'in_use').length,
      waivers: uses,
      waivers_invalid: invalid,
      report: report(m, minRate),
      loopback: loopbackOf(m, criteria, full, applied),
      limit: GATE3_LIMIT,
    },
  }
  return { result, view: loopbackView(m, criteria, full, applied) }
}

/** Which kind of element an id names, from the model. */
function kindOf(m: Model, id: string): LoopbackKind {
  if (m.boundaryById.has(id)) return 'boundary'
  if (m.flowById.has(id)) return 'flow'
  if (m.itemById.has(id)) return 'data_item'
  return m.components.some((c) => c.id === id) ? 'component' : 'model'
}

/** Criteria enrichment cannot answer, and why, for a failure of that criterion. */
function notEnrichableReason(c: Criterion, f: GateFailure): string | null {
  if (c === 'C1') return 'unclassified'
  if (c === 'C2' && (f.detail === 'unclassified' || f.detail === 'no usable cached class template')) return f.detail === 'unclassified' ? 'unclassified' : 'no usable class template'
  if (c === 'C5') return 'no cross-boundary flow'
  if (c === 'C6') return f.detail ? `crown-jewel map: ${f.detail}` : 'crown-jewel map'
  return null
}

/** The fields enrichment settles for a failure: its gaps, or the one field the criterion reads. */
function loopbackFields(c: Criterion, f: GateFailure): string[] {
  if (c === 'C7') return ['sensitivity']
  if (c === 'C9') return ['credential_scope']
  return [...(f.missing ?? []), ...(f.placeholder ?? [])]
}

/**
 * Gate 3's failures not covered by a waiver, grouped by element (see `Gate3Loopback`). It reads the full failure
 * lists, so the totals hold when a criterion lists more than `MAX_FAILING`.
 */
function loopbackOf(m: Model, criteria: Record<Criterion, GateCheck>, full: Record<Criterion, GateFailure[]>, applied: Map<Criterion, Set<string>>): Gate3Loopback {
  const { elements, notEnrichable } = loopbackLists(m, criteria, full, applied)
  return {
    phase: 'enrich',
    elements: elements.slice(0, MAX_FAILING), elements_total: elements.length,
    not_enrichable: notEnrichable.slice(0, MAX_FAILING), not_enrichable_total: notEnrichable.length,
    ...(elements.length ? { arm: LOOP_BACK_ARM } : {}),
  }
}

/** What a failing gates report says about starting a loop-back. */
export const LOOP_BACK_ARM =
  "When the operator chooses to loop back, call model_state action 'loop_back' first, before any write; " +
  'the next gates call then holds the loop to these elements.'

/** The loop-back lists in full, uncapped. */
function loopbackLists(m: Model, criteria: Record<Criterion, GateCheck>, full: Record<Criterion, GateFailure[]>, applied: Map<Criterion, Set<string>>): { elements: LoopbackElement[]; notEnrichable: NotEnrichable[] } {
  const enrich = new Map<string, LoopbackElement>()
  const other = new Map<string, NotEnrichable>()
  for (const c of Object.keys(criteria).sort() as Criterion[]) {
    const r = criteria[c]
    if (r.verdict === 'PASS') continue
    const waivedIds = applied.get(c) ?? new Set<string>()
    const rest = (full[c] ?? []).filter((f) => !waivedIds.has(f.id))
    // A criterion that fails with no element to name (C5, C6 with no crown jewel) is the model's.
    const failing: GateFailure[] = rest.length ? rest : [{ id: '', detail: r.value }]
    for (const f of failing) {
      const id = f.id
      const name = id ? m.nameOf(id) : undefined
      const kind = id ? kindOf(m, id) : 'model'
      const reason = notEnrichableReason(c, f)
      if (reason !== null || !id) {
        const e = other.get(id) ?? { element_id: id, ...(name ? { name } : {}), kind, criteria: [], reason: reason ?? (f.detail ?? r.value) }
        if (!e.criteria.includes(c)) e.criteria.push(c)
        other.set(id, e)
        continue
      }
      const e = enrich.get(id) ?? { element_id: id, ...(name ? { name } : {}), kind, criteria: [], fields: [] }
      if (!e.criteria.includes(c)) e.criteria.push(c)
      e.fields = [...new Set([...e.fields, ...loopbackFields(c, f)])].sort()
      enrich.set(id, e)
    }
  }
  return { elements: [...enrich.values()], notEnrichable: [...other.values()] }
}

/**
 * What the loop-back guard reads of one gates computation: the full loop-back list, and each listed field as its
 * criterion reads it.
 */
export interface LoopbackView {
  /** Every element on the loop-back list, uncapped */
  elements: LoopbackElement[]
  /** Whether the model holds an element with this id */
  exists(id: string): boolean
  /** Whether a waiver in use covers this element on one of these criteria */
  waived(id: string, criteria: readonly Criterion[]): boolean
  /** A field as its criterion reads it: the hash of its value (null when empty), and whether the value is a stand-in */
  field(kind: LoopbackKind, id: string, field: string): { hash: string | null; standIn: boolean }
  /** The hash of the element's data-item links, sorted; null when it has none */
  links(kind: LoopbackKind, id: string): string | null
}

const GROUP_OF: Partial<Record<LoopbackKind, 'boundaries' | 'components' | 'dataFlows' | 'dataItems'>> = {
  boundary: 'boundaries', component: 'components', flow: 'dataFlows', data_item: 'dataItems',
}
const valueHash = (v: unknown): string | null => (v === null || v === undefined ? null : createHash('sha256').update(canonicalJson(v)).digest('hex'))

function loopbackView(m: Model, criteria: Record<Criterion, GateCheck>, full: Record<Criterion, GateFailure[]>, applied: Map<Criterion, Set<string>>): LoopbackView {
  const objectOf = (kind: LoopbackKind, id: string): { classData?: { id?: string } | null; dataItemIds?: string[] } | undefined => {
    if (kind === 'flow') return m.flowById.get(id) as never
    if (kind === 'data_item') return m.itemById.get(id) as never
    if (kind === 'boundary') return m.boundaryById.get(id) as never
    if (kind === 'component') return m.components.find((c) => c.id === id) as never
    return undefined
  }
  const ids = new Set<string>([...m.boundaryById.keys(), ...m.components.map((c) => c.id), ...m.flowById.keys(), ...m.itemById.keys()])
  return {
    elements: loopbackLists(m, criteria, full, applied).elements,
    exists: (id) => ids.has(id),
    waived: (id, cs) => cs.some((c) => applied.get(c)?.has(id) ?? false),
    field: (kind, id, field) => {
      // The criterion's own reader: a data item's sensitivity is on the item, every other field in its attribute file.
      const value = kind === 'data_item' && field === 'sensitivity' ? m.itemById.get(id)?.sensitivity : GROUP_OF[kind] ? m.attrs(GROUP_OF[kind]!, id)[field] : undefined
      const classId = objectOf(kind, id)?.classData?.id ?? undefined
      const schema = classId ? m.input.classTemplates.templates.get(classId)?.schema?.[field] : undefined
      return { hash: valueHash(value), standIn: value !== null && value !== undefined && isGateStandIn(value, field, schema) }
    },
    links: (kind, id) => {
      const links = objectOf(kind, id)?.dataItemIds
      return Array.isArray(links) && links.length ? valueHash([...links].sort()) : null
    },
  }
}

/**
 * An error message fit for a tool result: a model-file failure names the file
 * and a code, never an absolute path or parser text (V8's JSON errors quote the
 * input, so a symlinked secret would come back in the message).
 */
export function safeErrorMessage(err: unknown, fallback = 'the model could not be read'): string {
  if (err instanceof GateInputError || err instanceof StateFileError) return err.message
  const e = err as NodeJS.ErrnoException | undefined
  const message = e instanceof Error ? e.message : ''
  const invalid = /^Invalid JSON in (\w[\w-]*) at /.exec(message)
  if (invalid) return `${invalid[1] === 'structure' || invalid[1] === 'manifest' ? `${invalid[1]}.json` : invalid[1]}: invalid json`
  if (e?.code && typeof e.path === 'string') return `${path.basename(e.path)}: ${e.code}`
  if (e?.code) return `${fallback} (${e.code})`
  // A message with no path separator and no quote is our own wording.
  return message && !/[/\\"']/.test(message) ? message : fallback
}

// =============================================================================
// Review hash: an id-free, order-free projection of the model
// =============================================================================

/**
 * The model as a review sees it, without ids, order or layout: each element
 * becomes a label (kind, name, and its parent's or endpoints' labels) with its
 * canonical content. Absent, null, "" and [] read the same, strings are
 * trimmed, lists are compared as sets of values, and sensitivity is its rank —
 * the forms a platform round trip is known to rewrite. Anything else that
 * changes — a name, a description, a class, a zone, an attribute value, a
 * control, a conduit, the crown-jewel map, the scope, a template's fields —
 * changes the hash.
 */
function canon(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return null
  if (key === 'sensitivity') {
    const rank = sensitivityRank(value)
    return rank >= 0 ? rank : canon(String(value))
  }
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (Array.isArray(value)) {
    const items = value.map((v) => canon(v)).filter((v) => v !== null)
    if (items.length === 0) return null
    return items.map((v) => JSON.stringify(v)).sort().map((v) => JSON.parse(v))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      const v = canon((value as Record<string, unknown>)[k], k)
      if (v !== null && !(v === false && (k === 'crownJewel'))) out[k] = v
    }
    return Object.keys(out).length ? out : null
  }
  return value
}

/**
 * Controls as the review hash reads them: each control's name as a push matches it, case kept, once (its id may change
 * on a push, and the platform's spelling of a name comes back with it). Anything that is not a control entry, or a
 * value that is not a list at all, is kept as it is, marked, so that writing one moves the hash.
 */
const controlNames = (controls: unknown): unknown => {
  if (controls === undefined || controls === null) return null
  // As JSON text, which no value canonicalises away (a null entry included).
  if (!Array.isArray(controls)) return { not_a_list: JSON.stringify(controls) }
  const names = new Set<string>()
  const others: unknown[] = []
  for (const c of controls) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      others.push({ not_a_control: JSON.stringify(c ?? null) })
      continue
    }
    const name = normaliseControlName((c as { name?: unknown }).name)
    // A blank name would canonicalise away. Each unnamed entry counts: two of them may be two controls.
    if (name !== null) names.add(name)
    else others.push({ unnamed_control: true })
  }
  return [...names, ...others]
}

/**
 * Whether a data item holds controls. A data item's controls are registered only once it has any: a model from before
 * data items carried controls keeps its registrations, with no new row for an empty list. (The review hash needs no such
 * guard: an absent and an empty list both canonicalise to nothing.)
 */
const dataItemHasControls = (item: { controls?: unknown }): boolean =>
  item.controls !== undefined && item.controls !== null && !(Array.isArray(item.controls) && item.controls.length === 0)

interface Projection {
  /** Canonical record of each element, by element id. */
  records: Map<string, string>
  /** Label of each element, by element id. */
  labels: Map<string, string>
  /** Every entry of the model (element records plus model-wide parts), each as `label\tcontent`. */
  entries: string[]
}

/** Each element's id-free label: its name path (`ROOT/B:…/C:…`), a flow's endpoints and name, a data item's name and class. */
function labelsOf(input: Pick<GateInput, 'structure' | 'dataFlows' | 'dataItems'>): Map<string, string> {
  const { boundaries, components, parentMap } = flattenStructure(input.structure)
  const rootId = input.structure.defaultBoundary.id
  const labels = new Map<string, string>()
  const name = (e: { name?: unknown }) => (typeof e.name === 'string' ? e.name.trim() : '')
  const labelOf = (id: string | undefined | null): string => (id && labels.get(id)) || 'DANGLING'
  // Boundaries and components, parents first (flattenStructure walks top-down).
  for (const b of boundaries) {
    const parent = parentMap.get(b.id)
    labels.set(b.id, b.id === rootId ? 'ROOT' : `${labelOf(parent)}/B:${name(b)}`)
  }
  for (const c of components) labels.set(c.id, `${labelOf(parentMap.get(c.id))}/C:${name(c)}`)
  for (const i of input.dataItems) labels.set(i.id, `D:${name(i)}#${i.classData?.id ?? ''}`)
  for (const f of input.dataFlows) labels.set(f.id, `F:${labelOf(f.source?.id)}->${labelOf(f.target?.id)}:${name(f)}`)
  return labels
}

/** An element as the settlement baseline knows it: never by id, which a push rewrites. */
export interface ElementRef {
  id: string
  group: SettleGroup
  label: string
  classId: string
  type: string
  name?: string
}

/** Every element of a model, by group and id, with its id-free label, class and type; and the model's own record. */
export function elementRefs(input: Pick<GateInput, 'structure' | 'dataFlows' | 'dataItems'>): Record<SettleGroup, Map<string, ElementRef>> {
  const labels = labelsOf(input)
  const { boundaries, components } = flattenStructure(input.structure)
  const out: Record<SettleGroup, Map<string, ElementRef>> = {
    components: new Map(), dataFlows: new Map(), dataItems: new Map(), boundaries: new Map(),
    model: new Map([[MODEL_REF_ID, { id: MODEL_REF_ID, group: 'model', label: 'MODEL', classId: '', type: 'model', name: 'the model' }]]),
  }
  const put = (group: PendingGroup, e: { id: string; name?: unknown; classData?: { id?: string | null } | null; type?: unknown }) => {
    out[group].set(e.id, {
      id: e.id, group, label: labels.get(e.id) ?? 'DANGLING', classId: e.classData?.id ?? '', type: typeof e.type === 'string' ? e.type : '',
      ...(typeof e.name === 'string' ? { name: e.name } : {}),
    })
  }
  for (const b of boundaries) put('boundaries', b)
  for (const c of components) put('components', c)
  for (const f of input.dataFlows) put('dataFlows', f)
  for (const i of input.dataItems) put('dataItems', i)
  return out
}

/**
 * The record fields the settlement registers besides attribute values:
 * `placement` is an element's place in the model (its boundary path, or a
 * flow's endpoints), the others are fields of the element records.
 */
export const SETTLED_RECORD_FIELDS = [
  'placement', 'classData', 'crownJewel', 'zone', 'domains', 'planes', 'conduits', 'controls', 'dataItemIds', 'sensitivity', 'regulatory_flags',
  'origin', 'is_credential',
] as const
export type SettledRecordField = (typeof SETTLED_RECORD_FIELDS)[number]

/** One record value, as the file holds it and as the settlement hashes it. */
export interface RecordValue {
  group: SettleGroup
  id: string
  field: SettledRecordField
  /** As the model file holds it; for `placement`, its shown form */
  raw: unknown
  /** Id-free and normalised; null when the element has no value */
  projected: unknown
  /** `placement` only: the form shown to the operator and confirmed verbatim */
  shown?: string
  /** `dataItemIds` only: a linked item another item cannot be told from, so the links cannot be registered */
  code?: 'label_collision'
}

/** The projection of record values, bound to one model's labels: the same for a file's value and a value in a settle call. */
export interface RecordProjector {
  values: RecordValue[]
  project(group: SettleGroup, id: string, field: SettledRecordField, raw: unknown): unknown
}

/**
 * Controls as the settlement registers them: each entry's id and name, so a
 * changed id is a change. (The review hash keeps names only.)
 */
const controlRefs = (controls: unknown): unknown =>
  Array.isArray(controls)
    ? controls.map((c) => (c && typeof c === 'object' && !Array.isArray(c)
      ? { id: (c as { id?: unknown }).id ?? null, name: (c as { name?: unknown }).name ?? null }
      // Anything else is kept, marked: it must never read like the names-only lists registered before ids were.
      : { not_a_control: c ?? null }))
    : controls

/** The settled record values of a model (the root boundary carries none), and the model's own controls. */
export function recordProjector(input: Pick<GateInput, 'structure' | 'dataFlows' | 'dataItems'> & { manifest?: { model?: { controls?: unknown } } }): RecordProjector {
  const { boundaries, components, parentMap } = flattenStructure(input.structure)
  const rootId = input.structure.defaultBoundary.id
  const labels = labelsOf(input)
  const labelOf = (id: unknown): string => (typeof id === 'string' && labels.get(id)) || 'DANGLING'
  const nameOf = (e: { name?: unknown }) => (typeof e.name === 'string' ? e.name.trim() : '')
  const byId = new Map<string, { name?: unknown }>([...boundaries, ...components].map((e) => [e.id, e]))
  const pathOf = (id: string): string => {
    const names: string[] = []
    for (let p = parentMap.get(id); p && p !== rootId; p = parentMap.get(p)) names.unshift(nameOf(byId.get(p) ?? {}))
    return [...names, nameOf(byId.get(id) ?? {})].join(' / ')
  }
  const componentType = new Map(components.map((c) => [c.id, typeof c.type === 'string' ? c.type : '']))
  // A linked data item is registered by its name, and by its class only where another item has the same name: its class
  // is registered on the item itself, so a first class or a reclassification does not change the links. Names are
  // JSON-quoted after a prefix no element label has, so no name reads as another name with a class.
  const itemName = new Map<string, string>()
  const itemClass = new Map<string, string>()
  const byName = new Map<string, number>()
  const byLabel = new Map<string, number>()
  for (const i of input.dataItems) {
    const n = nameOf(i)
    const c = i.classData?.id ?? ''
    itemName.set(i.id, n)
    itemClass.set(i.id, c)
    byName.set(n, (byName.get(n) ?? 0) + 1)
    byLabel.set(JSON.stringify([n, c]), (byLabel.get(JSON.stringify([n, c])) ?? 0) + 1)
  }
  /** Two items with the same name and class: a link to either cannot be told from a link to the other. */
  const ambiguous = (id: string) => itemName.has(id) && (byLabel.get(JSON.stringify([itemName.get(id), itemClass.get(id)])) ?? 0) > 1
  const linkOf = (id: string): string => {
    if (!itemName.has(id)) return labelOf(id)
    const n = JSON.stringify(itemName.get(id))
    const c = JSON.stringify(itemClass.get(id))
    if (ambiguous(id)) return `C:${n}#${c}`
    return (byName.get(itemName.get(id)!) ?? 0) > 1 ? `I:${n}#${c}` : `I:${n}`
  }
  const project = (_group: SettleGroup, _id: string, field: SettledRecordField, raw: unknown): unknown => {
    if (raw === null || raw === undefined) return null
    switch (field) {
      case 'placement': return typeof raw === 'string' && raw.trim() ? raw : null
      case 'classData': {
        const id = typeof raw === 'object' && !Array.isArray(raw) ? (raw as { id?: unknown }).id : undefined
        return typeof id === 'string' && id.trim() ? id.trim() : null
      }
      case 'crownJewel': return raw === true ? true : null
      case 'conduits': return Array.isArray(raw)
        ? canon(raw.map((c) => (c && typeof c === 'object' ? {
          peer: labelOf((c as { peerId?: unknown }).peerId), direction: (c as { direction?: unknown }).direction,
          justification: (c as { justification?: unknown }).justification, controlRefs: (c as { controlRefs?: unknown }).controlRefs,
        } : c)))
        : canon(raw)
      case 'controls': return canon(controlRefs(raw))
      case 'dataItemIds': return Array.isArray(raw) ? canon(raw.map((id) => linkOf(String(id)))) : canon(raw)
      case 'sensitivity': return canon(raw, 'sensitivity')
      default: return canon(raw)
    }
  }
  const values: RecordValue[] = []
  const add = (group: SettleGroup, id: string, field: SettledRecordField, raw: unknown) => {
    const shown = field === 'placement' && typeof raw === 'string' ? { shown: raw } : {}
    const code = field === 'dataItemIds' && Array.isArray(raw) && raw.some((d) => ambiguous(String(d))) ? { code: 'label_collision' as const } : {}
    values.push({ group, id, field, raw, projected: project(group, id, field, raw), ...shown, ...code })
  }
  for (const b of boundaries) {
    if (b.id === rootId) continue
    add('boundaries', b.id, 'placement', `${pathOf(b.id)} (boundary)`)
    for (const f of ['classData', 'zone', 'domains', 'planes', 'conduits', 'controls', 'dataItemIds'] as const) add('boundaries', b.id, f, (b as unknown as Record<string, unknown>)[f])
  }
  for (const c of components) {
    add('components', c.id, 'placement', `${pathOf(c.id)} (${componentType.get(c.id) ?? ''})`)
    for (const f of ['classData', 'crownJewel', 'controls', 'dataItemIds'] as const) add('components', c.id, f, (c as unknown as Record<string, unknown>)[f])
  }
  for (const f of input.dataFlows) {
    const end = (e: unknown) => {
      const id = (e as { id?: unknown } | undefined)?.id
      return typeof id === 'string' && byId.has(id) ? pathOf(id) : 'DANGLING'
    }
    add('dataFlows', f.id, 'placement', `${end(f.source)} → ${end(f.target)}: ${nameOf(f)}`)
    for (const k of ['classData', 'controls', 'dataItemIds'] as const) add('dataFlows', f.id, k, (f as unknown as Record<string, unknown>)[k])
  }
  for (const i of input.dataItems) {
    add('dataItems', i.id, 'placement', nameOf(i))
    for (const k of ['classData', 'sensitivity', 'regulatory_flags', 'origin', 'is_credential'] as const) add('dataItems', i.id, k, (i as unknown as Record<string, unknown>)[k])
    if (dataItemHasControls(i)) add('dataItems', i.id, 'controls', i.controls)
  }
  if (input.manifest) add('model', MODEL_REF_ID, 'controls', input.manifest.model?.controls)
  return { values, project }
}

function project(input: GateInput): Projection {
  const { boundaries, components } = flattenStructure(input.structure)
  const rootId = input.structure.defaultBoundary.id
  const labels = labelsOf(input)
  const labelOf = (id: string | undefined | null): string => (id && labels.get(id)) || 'DANGLING'

  const records = new Map<string, string>()
  const itemLabels = (ids: unknown) => (Array.isArray(ids) ? ids.map((id) => labelOf(String(id))) : null)
  const attrsOf = (group: string, id: string) => {
    const bag = (input.attributes as Record<string, Record<string, ElementAttributes> | undefined>)[group]
    return bag?.[id]?.attributes ?? null
  }
  const put = (id: string, record: Record<string, unknown>) => records.set(id, JSON.stringify(canon(record)))
  for (const b of boundaries) {
    if (b.id === rootId) continue
    put(b.id, { name: b.name, description: b.description, classId: b.classData?.id, zone: b.zone, domains: b.domains, planes: b.planes,
      dataItems: itemLabels(b.dataItemIds), controls: controlNames(b.controls), attributes: attrsOf('boundaries', b.id) })
  }
  for (const c of components) {
    put(c.id, { name: c.name, description: c.description, type: c.type, classId: c.classData?.id, crownJewel: c.crownJewel === true,
      dataItems: itemLabels(c.dataItemIds), controls: controlNames(c.controls), attributes: attrsOf('components', c.id) })
  }
  for (const f of input.dataFlows) {
    put(f.id, { name: f.name, description: f.description, classId: f.classData?.id, dataItems: itemLabels(f.dataItemIds),
      controls: controlNames((f as { controls?: unknown }).controls), attributes: attrsOf('dataFlows', f.id) })
  }
  for (const i of input.dataItems) {
    put(i.id, { name: i.name, description: i.description, classId: i.classData?.id, sensitivity: i.sensitivity,
      regulatory_flags: i.regulatory_flags, origin: i.origin, is_credential: i.is_credential, attributes: attrsOf('dataItems', i.id),
      // No list and an empty one both drop out: a data item without controls reads as before data items carried them.
      controls: controlNames(i.controls) })
  }

  const entries: string[] = []
  for (const [id, record] of records) entries.push(`${labelOf(id)}\t${record}`)
  // Attribute bags whose element is gone still count.
  for (const [group, bag] of Object.entries(input.attributes ?? {})) {
    for (const [id, entry] of Object.entries((bag ?? {}) as Record<string, ElementAttributes>)) {
      if (!labels.has(id)) entries.push(`ORPHAN:${group}\t${JSON.stringify(canon(entry?.attributes))}`)
    }
  }
  // Conduits: one directed edge each, however many boundaries mirror it.
  const edges = new Set<string>()
  for (const b of boundaries) {
    for (const c of b.conduits ?? []) {
      const [from, to] = c.direction === 'INBOUND' ? [c.peerId, b.id] : [b.id, c.peerId]
      edges.add(`E:${labelOf(from)}->${labelOf(to)}\t${JSON.stringify(canon({ justification: c.justification, controlRefs: c.controlRefs }))}`)
    }
  }
  entries.push(...edges)
  const manifestModel = (input.manifest?.model ?? {}) as { name?: unknown; description?: unknown; controls?: unknown }
  entries.push(`MANIFEST\t${JSON.stringify(canon({ name: manifestModel.name, description: manifestModel.description,
    // The modules as a set of ids: the platform's order and names on a pull never make a review stale.
    modules: [...new Set((input.manifest?.modules ?? []).map((m) => m.id))].sort(),
    // Controls linked to the model and to its root boundary, which has no record of its own. None reads as before.
    controls: controlNames(manifestModel.controls), root_controls: controlNames(input.structure.defaultBoundary.controls) }))}`)
  const scope = input.scope.scope ?? {}
  const map = crownJewelMap(input.scope.scope)
  entries.push(`SCOPE\t${JSON.stringify(canon({
    crown_jewels: scope.crown_jewels,
    crown_jewel_elements: map ? Object.fromEntries(Object.entries(map).map(([j, ids]) => [j, itemLabels(ids)])) : null,
    depth: scope.depth, modeling_intent: scope.modeling_intent, compliance_drivers: scope.compliance_drivers,
    exclusions: scope.exclusions, trust_assumptions: scope.trust_assumptions,
  }))}`)
  const used = new Set([...boundaries, ...components, ...input.dataFlows, ...input.dataItems].map((e) => e.classData?.id).filter(Boolean) as string[])
  entries.push(`TEMPLATES\t${JSON.stringify(canon(Object.fromEntries([...used].map((id) => [id, input.classTemplates.templates.get(id)?.fields ?? null]))))}`)
  entries.sort()
  return { records, labels, entries }
}

const sha256 = sha256Hex

/** Reasons a read gave that describe the file's content, not a read the store refused. */
const CONTENT_CODES = new Set(['class_id_mismatch', 'no_fields', 'unsupported_version', 'entries_not_a_list', 'too_many_entries'])

/**
 * Every `.dethereal` read the store refused, by file: anything but a content reason, the fallback for an unexpected
 * error included. Deny by default: a refusal a reader did not foresee still counts.
 */
export function refusedReads(input: GateInput): Array<{ file: string; code: string }> {
  return [
    ...(input.classTemplates.listing ? [{ file: CLASS_CACHE.split(path.sep).join('/'), code: input.classTemplates.listing }] : []),
    ...input.classTemplates.refused.filter((r) => !CONTENT_CODES.has(r.reason)).map((r) => ({ file: r.file, code: r.reason })),
    ...(input.scope.error ? [{ file: '.dethereal/scope.json', code: input.scope.error }] : []),
    ...(input.templateFieldsRefused ?? []),
    ...(input.pending?.code && !CONTENT_CODES.has(input.pending.code) ? [{ file: PENDING_ENRICHMENT_FILE, code: input.pending.code }] : []),
  ]
}

export type ReviewHashUnavailable = { code: 'state_files_refused' | 'attribute_files_unreadable' | 'not_read_from_directory'; files: string[]; files_total: number }

/** At most 20 file names, each shaped like a model-relative path; the rest only counted. */
const shownFiles = (files: string[]) => {
  const shown = files.filter((f) => /^[A-Za-z0-9._/-]{1,200}$/.test(f))
  return { files: shown.slice(0, 20), files_total: files.length }
}

/**
 * The review hash of a loaded model, unchanged by ids, order, layout and the platform's known rewrites; or why there is
 * none. It is never taken over less than the model: a refused read of anything the
 * projection reads (the scope, the class-cache listing, the cache entry of a class the model uses) or an attribute
 * file that could not be read makes it unavailable; so does a model not read from its directory.
 */
export function reviewHash(input: GateInput): { hash: string } | { unavailable: ReviewHashUnavailable } {
  if (!input.pending || input.pending === PENDING_NOT_READ) return { unavailable: { code: 'not_read_from_directory', ...shownFiles([]) } }
  if (input.attributeIssues.length) return { unavailable: { code: 'attribute_files_unreadable', ...shownFiles(input.attributeIssues.map((i) => i.file)) } }
  const { boundaries, components } = flattenStructure(input.structure)
  const used = new Set([...boundaries, ...components, ...input.dataFlows, ...input.dataItems].map((e) => e.classData?.id).filter(Boolean) as string[])
  const cacheDir = CLASS_CACHE.split(path.sep).join('/')
  const classOf = (file: string) => (file.startsWith(`${cacheDir}/`) && file.endsWith('.json') ? file.slice(cacheDir.length + 1, -'.json'.length) : null)
  const blocking = refusedReads(input).filter((r) => r.file === '.dethereal/scope.json' || r.file === cacheDir || used.has(classOf(r.file) ?? ''))
  if (blocking.length) return { unavailable: { code: 'state_files_refused', ...shownFiles(blocking.map((r) => r.file)) } }
  return { hash: sha256(project(input).entries.join('\n')) }
}

/** The review hash; throws when a read it needs was refused (see `reviewHash`). */
export function reviewContentHash(input: GateInput): string {
  const h = reviewHash(input)
  if ('unavailable' in h) throw new Error(`the review hash is unavailable (${h.unavailable.code}: ${h.unavailable.files.join(', ')})`)
  return h.hash
}

// =============================================================================
// Waivers
// =============================================================================

export const WAIVER_BASES = ['not_applicable', 'not_observable', 'accepted_risk', 'platform_limitation'] as const
export type WaiverBasis = (typeof WAIVER_BASES)[number]

/** Criteria whose element failures may be waived at all (then per element, see unwaivableReason). */
export const WAIVABLE_CRITERIA: readonly Criterion[] = ['C1', 'C2', 'C3', 'C4', 'C7', 'C8', 'C9']

/**
 * How far waivers may go. A criterion passes through waivers only while the
 * waived share of what it assesses stays within `share`; one call names at most
 * `perCall` elements; a model holds at most `total` waived pairs; and C2 keeps
 * at least one crown-jewel component that is measured, not waived.
 */
export const WAIVER_LIMITS = { perCall: 5, share: 0.25, total: 200, keepCrownJewelInC2: true } as const

/** A waiver's reason: a sentence, stored in a committed file and read back later. */
export const WAIVER_REASON = /^[^\p{C}\p{Zl}\p{Zp}]{10,500}$/u

export interface WaiverRecord {
  criterion: Criterion
  element_ids: string[]
  reason: string
  basis?: WaiverBasis
  waived_at?: string
  revision?: number
  /** Element fingerprint at grant time, by element id: the waiver applies only while it matches. */
  fingerprints: Record<string, string>
  mac?: string
}

export type WaiverStatus = 'in_use' | 'lapsed' | 'resolved' | 'unwaivable' | 'unverified'

export interface WaiverUse {
  criterion: Criterion
  id: string
  name?: string
  status: WaiverStatus
  /** Why the waiver does not apply, for any status but in_use. */
  why?: string
  /** The record's basis, when it is one of the four. */
  basis?: WaiverBasis
  /** When the waiver was granted (ISO-8601 UTC), when well-formed. */
  waived_at?: string
  /**
   * The operator's reason, only for a waiver in use (verified against this
   * machine's key), and only when it still passes the grant rule. It is
   * committed text: never shown in state summaries, hooks or status lines.
   */
  reason?: string
  /**
   * An inherited (unverified) waiver's reason as the record holds it, for the
   * operator to read before granting it again; never the operator's reason, and
   * never used by a grant. A reason that cannot be shown safely is its hash.
   */
  recorded_reason?: string | { undisplayable: true; sha256: string }
}

const WAIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/** Characters no reason may carry: default-ignorable ones render as nothing and can hide text. */
const HIDDEN_CHARACTERS = /\p{Default_Ignorable_Code_Point}/u

/** A waiver reason fit to show: the grant rule, and nothing invisible in it. */
export function isShowableReason(reason: unknown): reason is string {
  return typeof reason === 'string' && WAIVER_REASON.test(reason) && !HIDDEN_CHARACTERS.test(reason)
}

const CRITERIA = new Set(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'])

/** The well-formed waiver records in a `state.json` `waivers` value; everything else is counted and ignored. */
export function parseWaivers(raw: unknown): { records: WaiverRecord[]; invalid: number } {
  if (!Array.isArray(raw)) return { records: [], invalid: raw === undefined ? 0 : 1 }
  const records: WaiverRecord[] = []
  let invalid = 0
  for (const r of raw) {
    const ok = r && typeof r === 'object' && CRITERIA.has((r as WaiverRecord).criterion) &&
      Array.isArray((r as WaiverRecord).element_ids) && (r as WaiverRecord).element_ids.every((id) => typeof id === 'string' && ELEMENT_ID.test(id)) &&
      typeof (r as WaiverRecord).reason === 'string' && WAIVER_REASON.test((r as WaiverRecord).reason) &&
      ((r as WaiverRecord).basis === undefined || (WAIVER_BASES as readonly string[]).includes((r as WaiverRecord).basis as string)) &&
      (r as WaiverRecord).fingerprints && typeof (r as WaiverRecord).fingerprints === 'object'
    if (ok) records.push(r as WaiverRecord)
    else invalid++
  }
  return { records, invalid }
}

/**
 * Why a failure of `criterion` on element `id` can never be waived, or null.
 * The remedies these name are always available to an honest model.
 */
export function unwaivableReason(m: Model, criterion: Criterion, id: string, failing?: GateFailure): string | null {
  if (!WAIVABLE_CRITERIA.includes(criterion)) return `${criterion} is never waived`
  if ((criterion === 'C2' || criterion === 'C3' || criterion === 'C8') && hasPlaceholder(failing)) {
    return 'replace the placeholder with null first; a placeholder is never waived'
  }
  if (criterion === 'C1' && (m.tiers.tierOf.get(id) ?? 3) <= 2) return 'a Tier 1–2 component must be classified'
  if (criterion === 'C2' && (failing?.detail === 'unclassified' || failing?.detail === 'no usable cached class template')) {
    return 'classify the component, or run generate_attribute_stubs so its template is cached'
  }
  if (criterion === 'C7') {
    const item = m.itemById.get(id)
    if (item) {
      const flags = Array.isArray(item.regulatory_flags) ? item.regulatory_flags : []
      const flagFloor = Math.max(-1, ...flags.map((f) => regulatoryFlagFloor(f)))
      const fixed = item.classData?.id ? CLASS_FLOOR_IDS[item.classData.id] !== undefined : false
      if (fixed || flagFloor >= dataItemFloor(item, m.input.classTemplates.templates)) {
        return 'the floor is fixed by the data item\'s class or reached by one of its regulatory flags'
      }
    }
  }
  return null
}

/** Fingerprint of element `id` failing `criterion` with `detail`, id-free (it survives the push remap). */
function fingerprintOf(p: Projection, criterion: Criterion, id: string, detail: string | undefined): string {
  return sha256(`${criterion}|${p.labels.get(id) ?? 'DANGLING'}|${p.records.get(id) ?? ''}|${detail ?? ''}`)
}

interface WaiverContext {
  m: Model
  p: Projection
  full: Record<Criterion, GateFailure[]>
  population: Record<Criterion, number>
  structural: Partial<Record<Criterion, string>>
}

/** Most elements a criterion may have waived before its waivers stop applying. */
const shareCap = (population: number): number => Math.floor(population * WAIVER_LIMITS.share)

/** Crown-jewel components C2 measures. */
const crownJewelBearers = (m: Model): string[] => m.tier12.filter((c) => c.crownJewel === true).map((c) => c.id)

/** Waivers resolved against the model: what applies, every record's status, and the candidates before any demotion. */
interface ResolvedWaivers {
  applied: Map<Criterion, Set<string>>
  uses: WaiverUse[]
  /** Verified, still failing, fingerprint matching: counted against the caps whether or not they end up applying. */
  candidates: Map<Criterion, Set<string>>
}

function resolveWaivers(ctx: WaiverContext, records: WaiverRecord[], verify: (r: WaiverRecord) => boolean): ResolvedWaivers {
  const uses: WaiverUse[] = []
  const candidate = new Map<Criterion, Set<string>>()
  for (const r of records) {
    const verified = verify(r)
    for (const id of new Set(r.element_ids)) {
      const name = ctx.m.nameOf(id)
      const base = {
        criterion: r.criterion, id, ...(name ? { name } : {}),
        ...(r.basis && (WAIVER_BASES as readonly string[]).includes(r.basis) ? { basis: r.basis } : {}),
        ...(typeof r.waived_at === 'string' && WAIVED_AT.test(r.waived_at) ? { waived_at: r.waived_at } : {}),
      }
      if (!verified) {
        const recorded = isShowableReason(r.reason) && !hasMixedScriptWord(r.reason) ? r.reason : { undisplayable: true as const, sha256: sha256(String(r.reason)) }
        uses.push({ ...base, status: 'unverified', recorded_reason: recorded, why: 'not granted on this machine for this directory (a teammate\'s, a copy, or granted before waivers were bound to one): re-grant it with model_state_waive to use it' })
        continue
      }
      const failing = (ctx.full[r.criterion] ?? []).find((f) => f.id === id)
      const never = ctx.structural[r.criterion] ?? unwaivableReason(ctx.m, r.criterion, id, failing)
      if (never) { uses.push({ ...base, status: 'unwaivable', why: never }); continue }
      if (!failing) { uses.push({ ...base, status: 'resolved', why: 'the element no longer fails this criterion' }); continue }
      if (r.fingerprints[id] !== fingerprintOf(ctx.p, r.criterion, id, failing.detail)) {
        uses.push({ ...base, status: 'lapsed', why: 'the element or its failure changed since the waiver' })
        continue
      }
      uses.push({ ...base, status: 'in_use', ...(isShowableReason(r.reason) ? { reason: r.reason } : {}) })
      const set = candidate.get(r.criterion) ?? new Set<string>()
      set.add(id)
      candidate.set(r.criterion, set)
    }
  }
  const candidates = new Map([...candidate].map(([c, ids]) => [c, new Set(ids)]))
  // A Tier 1–2 element may not have both its template completion and its floor keys waived.
  for (const id of candidate.get('C2') ?? []) {
    if (candidate.get('C8')?.has(id)) {
      candidate.get('C2')!.delete(id)
      candidate.get('C8')!.delete(id)
      for (const u of uses) if (u.id === id && (u.criterion === 'C2' || u.criterion === 'C8') && u.status === 'in_use') {
        u.status = 'unwaivable'
        u.why = 'C2 and C8 cannot both be waived on one element'
      }
    }
  }
  const demote = (criterion: Criterion, ids: Iterable<string>, why: string) => {
    for (const id of ids) {
      candidate.get(criterion)?.delete(id)
      for (const u of uses) if (u.id === id && u.criterion === criterion && u.status === 'in_use') { u.status = 'unwaivable'; u.why = why }
    }
  }
  // Too large a waived share: the criterion's waivers stop applying, all of them.
  for (const [criterion, ids] of candidate) {
    if (ids.size > shareCap(ctx.population[criterion] ?? 0)) {
      demote(criterion, [...ids], `more than ${Math.round(WAIVER_LIMITS.share * 100)}% of what ${criterion} assesses is waived`)
    }
  }
  // C2 keeps measuring at least one crown-jewel component.
  const bearers = crownJewelBearers(ctx.m)
  if (WAIVER_LIMITS.keepCrownJewelInC2 && bearers.length && bearers.every((id) => candidate.get('C2')?.has(id))) {
    demote('C2', bearers, 'C2 must measure at least one crown-jewel component')
  }
  // One use per criterion and element.
  const seen = new Set<string>()
  const unique = uses.filter((u) => { const k = `${u.criterion}|${u.id}|${u.status}`; if (seen.has(k)) return false; seen.add(k); return true })
  return { applied: candidate, uses: unique, candidates }
}

const countAll = (sets: Map<Criterion, Set<string>>): number => [...sets.values()].reduce((n, s) => n + s.size, 0)

/**
 * The waiver room of every Gate 3 criterion, and whether each failure may be
 * waived. Computed from the candidates before demotion, so waivers stored past
 * a cap still count against it; the same numbers bound `prepareWaiver`.
 */
function waiverRoom(ctx: WaiverContext, resolved: ResolvedWaivers): {
  headroom: (c: Criterion) => WaiverHeadroom
  failure: (c: Criterion, f: GateFailure) => { waivable: boolean; unwaivable_reason?: string }
} {
  const total = countAll(resolved.candidates)
  const bearers = crownJewelBearers(ctx.m)
  const headroom = (c: Criterion): WaiverHeadroom => {
    const inUse = resolved.applied.get(c)?.size ?? 0
    if (!WAIVABLE_CRITERIA.includes(c)) return { waivable: false, in_use: inUse, cap: 0, remaining: 0, reason: `${c} is never waived` }
    const cap = shareCap(ctx.population[c] ?? 0)
    if (ctx.structural[c]) return { waivable: false, in_use: inUse, cap, remaining: 0, reason: ctx.structural[c] }
    if (cap === 0) return { waivable: false, in_use: inUse, cap, remaining: 0, reason: `${c} assesses too few elements for a waiver` }
    const held = resolved.candidates.get(c)?.size ?? 0
    const remaining = Math.max(0, Math.min(cap - held, WAIVER_LIMITS.total - total))
    const reason = remaining > 0 ? undefined
      : held > cap ? `more waivers are stored than the ${cap} ${c} allows, so none of them applies; withdraw some first`
      : total >= WAIVER_LIMITS.total ? `the model holds the most waivers it may (${WAIVER_LIMITS.total})`
      : `the ${cap} waivers ${c} allows are all used`
    return { waivable: true, in_use: inUse, cap, remaining, ...(reason ? { reason } : {}) }
  }
  const failure = (c: Criterion, f: GateFailure): { waivable: boolean; unwaivable_reason?: string } => {
    const room = headroom(c)
    const no = (why: string) => ({ waivable: false, unwaivable_reason: why })
    if (!room.waivable) return no(room.reason!)
    const never = unwaivableReason(ctx.m, c, f.id, f)
    if (never) return no(never)
    const other = c === 'C2' ? 'C8' : c === 'C8' ? 'C2' : null
    if (other && resolved.candidates.get(other)?.has(f.id)) return no('C2 and C8 cannot both be waived on one element')
    if (c === 'C2' && WAIVER_LIMITS.keepCrownJewelInC2 && bearers.includes(f.id) &&
      bearers.every((id) => id === f.id || resolved.candidates.get('C2')?.has(id))) {
      return no('C2 must measure at least one crown-jewel component')
    }
    return { waivable: true }
  }
  return { headroom, failure }
}

/**
 * Check a waiver request against the model as it stands: every id must fail
 * `criterion` right now with an element failure that may be waived. Returns
 * the fingerprints to store, and the refusals.
 */
export function prepareWaiver(input: GateInput, criterion: Criterion, ids: readonly string[], existing: unknown = undefined,
  verify: (r: WaiverRecord) => boolean = () => true): {
  fingerprints: Record<string, string>
  refused: Array<{ id: string; why: string }>
} {
  const m = buildModel(input)
  const p = project(input)
  const { full, population, structural } = gate3(m)
  const fingerprints: Record<string, string> = {}
  const refused: Array<{ id: string; why: string }> = []
  const unique = [...new Set(ids)]
  if (structural[criterion]) return { fingerprints, refused: unique.map((id) => ({ id, why: structural[criterion]! })) }
  if (unique.length > WAIVER_LIMITS.perCall) {
    return { fingerprints, refused: unique.map((id) => ({ id, why: `at most ${WAIVER_LIMITS.perCall} elements per waiver` })) }
  }
  for (const id of unique) {
    if (refused.some((r) => r.id === id)) continue
    const failing = (full[criterion] ?? []).find((f) => f.id === id)
    const never = unwaivableReason(m, criterion, id, failing)
    if (never) { refused.push({ id, why: never }); continue }
    if (!failing) { refused.push({ id, why: `does not fail ${criterion}` }); continue }
    fingerprints[id] = fingerprintOf(p, criterion, id, failing.detail)
  }
  if (refused.length) return { fingerprints: {}, refused }
  const { records } = parseWaivers(existing)
  // Stored waivers count by their candidates before demotion: one stored past a cap still takes room.
  const { candidates } = resolveWaivers({ m, p, full, population, structural }, records, verify)
  const already = new Set(candidates.get(criterion) ?? [])
  const fresh = unique.filter((id) => !already.has(id))
  if (countAll(candidates) + fresh.length > WAIVER_LIMITS.total) {
    return { fingerprints, refused: fresh.map((id) => ({ id, why: `a model holds at most ${WAIVER_LIMITS.total} waived elements` })) }
  }
  if (already.size + fresh.length > shareCap(population[criterion] ?? 0)) {
    return {
      fingerprints,
      refused: fresh.map((id) => ({ id, why: `at most ${shareCap(population[criterion] ?? 0)} of the ${population[criterion] ?? 0} elements ${criterion} assesses may be waived` })),
    }
  }
  if (criterion === 'C2' && WAIVER_LIMITS.keepCrownJewelInC2) {
    const bearers = crownJewelBearers(m)
    const after = new Set([...already, ...fresh])
    if (bearers.length && bearers.every((id) => after.has(id))) {
      return { fingerprints, refused: fresh.filter((id) => bearers.includes(id)).map((id) => ({ id, why: 'C2 must measure at least one crown-jewel component' })) }
    }
  }
  if (criterion === 'C8' || criterion === 'C2') {
    const other = criterion === 'C8' ? 'C2' : 'C8'
    for (const id of fresh) if (candidates.get(other)?.has(id)) refused.push({ id, why: 'C2 and C8 cannot both be waived on one element' })
  }
  return { fingerprints, refused }
}

// =============================================================================
// Push gate
// =============================================================================

/** A gate input for a model held in memory (a push payload), with the parts it lacks left empty. */
export function gateInputFromModel(model: {
  manifest: ModelManifest
  structure: ModelStructure
  dataFlows?: unknown
  dataItems?: unknown
  attributes?: ConsolidatedAttributesFile
}, settlement?: SettlementMode): GateInput {
  const scope = (model.manifest?.model as { scope?: unknown } | undefined)?.scope
  return {
    manifest: model.manifest,
    structure: model.structure,
    dataFlows: listOf(model.dataFlows, 'dataFlows') as DataFlow[],
    dataItems: listOf(model.dataItems, 'dataItems') as DataItem[],
    attributes: model.attributes ?? { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} },
    attributeIssues: [],
    classTemplates: { templates: new Map(), refused: [] },
    scope: { scope: scope && typeof scope === 'object' && !Array.isArray(scope) ? (scope as Record<string, unknown>) : null },
    pending: PENDING_NOT_READ,
    settlement: settlementOn(settlement) ? 'on' : 'off',
  }
}

/**
 * Why a push must not happen, or null. Gate 2 blocks a push: the model must be
 * complete and consistent enough to sync. The message names the failing
 * checks and counts, never a path or file content.
 */
export function pushRefusal(input: GateInput): string | null {
  const gate2 = computeGates(input).gate2
  if (gate2.verdict === 'PASS') return null
  const failing = Object.entries(gate2.checks).filter(([, c]) => c.verdict !== 'PASS')
  return `Push refused: Gate 2 fails (${failing.map(([name, c]) => `${name}: ${c.failing_total || 1}`).join('; ')}). ` +
    'Run validate_model_json with action "gates" for the failing elements, fix them, and push again.'
}

/**
 * Why a push must not go ahead, or null. One order for every push: Gate 2 on
 * what is pushed, then unconfirmed enrichment, then the settlement (the values
 * pushed must be the operator's); with the settlement off, Gate 2 alone.
 * `dirPath` is the model directory the push reads or writes, when there is one:
 * it supplies what the payload lacks (class templates, scope, the pending file,
 * the baseline). With none, the payload is judged alone and every value in it
 * is unregistered.
 */
export async function payloadPushRefusal(
  dirPath: string | null,
  payload?: Parameters<typeof gateInputFromModel>[0],
  options: { modelId?: string; carryModuleGaps?: boolean; settlement?: SettlementMode } = {},
): Promise<string | null> {
  let onDisk: GateInput | null = null
  if (dirPath) {
    try {
      onDisk = await loadGateInput(dirPath, { settlement: options.settlement })
    } catch (err) {
      return `Push refused: the model could not be read (${safeErrorMessage(err)}).`
    }
  }
  const fromPayload = payload ? gateInputFromModel(payload, options.settlement) : null
  const input: GateInput | null = fromPayload && onDisk
    ? { ...fromPayload, classTemplates: onDisk.classTemplates, scope: fromPayload.scope.scope ? fromPayload.scope : onDisk.scope, attributeIssues: onDisk.attributeIssues, pending: onDisk.pending,
      // A push of its own directory: the module list it sends was derived there, and what could not be derived blocks it.
      ...(options.carryModuleGaps ? { moduleGaps: onDisk.moduleGaps } : {}) }
    : fromPayload ?? onDisk
  if (!input) return 'Push refused: there is no model to push.'
  const gate2 = pushRefusal(input)
  if (gate2) return gate2
  if (!settlementOn(options.settlement)) return null
  if (onDisk) {
    const pending = pendingPushRefusal(onDisk)
    if (pending) return pending
  }
  const { settlementPushRefusal } = await import('./settlement-state.js')
  return settlementPushRefusal(dirPath, input, options.modelId ?? null)
}

/**
 * The push refusal for a push that reads its model directory (the payload read from it, when the caller has it).
 * `modelId`: the platform model the push writes, so that a pull's registrations count for it.
 */
export const directoryPushRefusal = (dirPath: string, payload?: Parameters<typeof gateInputFromModel>[0], options: { modelId?: string; settlement?: SettlementMode } = {}): Promise<string | null> =>
  payloadPushRefusal(dirPath, payload, { ...options, carryModuleGaps: true })

/**
 * The part of a waiver record its MAC covers: everything but the element ids,
 * which a push re-keys. The ids are bound anyway, through the id-free
 * fingerprints: moving a fingerprint to another element makes it lapse.
 */
export function waiverMacPayload(r: WaiverRecord): string {
  return JSON.stringify({
    v: 1, criterion: r.criterion, reason: r.reason, basis: r.basis ?? null, waived_at: r.waived_at ?? null,
    revision: r.revision ?? null, fingerprints: Object.values(r.fingerprints ?? {}).sort(),
  })
}

// =============================================================================
// The signing key
// =============================================================================

const KEY_DIR = '.dethernety'
const KEY_FILE = 'waiver.key'

const canonicalOrNull = (p: string): string | null => {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}
const insideOf = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

export type WaiverKeyRefusal = 'home_not_absolute' | 'no_project_root' | 'key_in_project' | 'key_in_model'

/**
 * Why this machine's waiver key may not be used for a model, or null. The key
 * must live outside the project and the model directory, where an agent that
 * edits the project cannot read it: a HOME inside the tree (a sandbox), or a
 * `~/.dethernety` that resolves into it, is refused. With no project root to
 * compare against, it is refused too. Returns a code, never a path.
 */
export function waiverKeyRefusal(modelDir?: string): WaiverKeyRefusal | null {
  const home = os.homedir()
  if (!path.isAbsolute(home)) return 'home_not_absolute'
  const keyDir = canonicalOrNull(path.join(home, KEY_DIR)) ?? path.join(canonicalOrNull(home) ?? path.resolve(home), KEY_DIR)
  const root = (getProjectRoot() ?? resolveProjectRoot()).root
  if (!root) return 'no_project_root'
  if (insideOf(keyDir, canonicalOrNull(root) ?? path.resolve(root))) return 'key_in_project'
  if (modelDir && insideOf(keyDir, canonicalOrNull(modelDir) ?? path.resolve(modelDir))) return 'key_in_model'
  return null
}

/**
 * This machine's waiver key, created on first use when `create` is set. The
 * key lives outside every repository, is owner-only, and is refused when it is
 * a symlink or readable by anyone else. `null` when there is none (or it is
 * refused, see `waiverKeyRefusal`, checked before anything is read or
 * created): nothing verifies then, and a waiver cannot be granted.
 */
export async function loadWaiverKey(create: boolean, modelDir?: string): Promise<Buffer | null> {
  const state = await waiverKeyState(create, modelDir)
  return state.key
}

/** Why this machine's key cannot be used: a refusal (see `waiverKeyRefusal`), or what is wrong with the key file. */
export type WaiverKeyCode = WaiverKeyRefusal | 'key_absent' | 'key_symlink' | 'key_mode' | 'key_malformed'

/**
 * This machine's key, or why there is none. `key_absent` means no key file
 * yet (created when `create` is set); every other code means a key cannot be
 * used until the operator fixes it, and names what to fix.
 */
export async function waiverKeyState(create: boolean, modelDir?: string): Promise<{ key: Buffer; code?: undefined } | { key: null; code: WaiverKeyCode }> {
  const refused = waiverKeyRefusal(modelDir)
  if (refused) return { key: null, code: refused }
  const dir = path.join(os.homedir(), KEY_DIR)
  const file = path.join(dir, KEY_FILE)
  const readKey = async (): Promise<{ key: Buffer } | { key: null; code: WaiverKeyCode }> => {
    let st
    try {
      st = await fs.lstat(file)
    } catch {
      return { key: null, code: 'key_absent' }
    }
    if (st.isSymbolicLink()) return { key: null, code: 'key_symlink' }
    if (!st.isFile() || (st.mode & 0o077) !== 0) return { key: null, code: 'key_mode' }
    if (st.size !== 64) return { key: null, code: 'key_malformed' }
    try {
      const fh = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      try {
        const hex = (await fh.readFile('utf8')).trim()
        return /^[0-9a-f]{64}$/.test(hex) ? { key: Buffer.from(hex, 'hex') } : { key: null, code: 'key_malformed' }
      } finally {
        await fh.close()
      }
    } catch {
      return { key: null, code: 'key_symlink' }
    }
  }
  const existing = await readKey()
  if (existing.key || !create || existing.code !== 'key_absent') return existing
  try {
    const dst = await fs.lstat(dir).catch(() => null)
    if (dst && (dst.isSymbolicLink() || !dst.isDirectory())) return { key: null, code: 'key_symlink' }
    // Two first uses may race: neither may see the directory or the key half made. The key is written whole to
    // a file of its own, then linked into place, which never replaces a key another caller linked first.
    if (!dst) await fs.mkdir(dir, { mode: 0o700, recursive: true })
    const tmp = `${file}.tmp.${randomBytes(8).toString('hex')}`
    const fh = await fs.open(tmp, 'wx', 0o600)
    try {
      await fh.writeFile(randomBytes(32).toString('hex'), 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await fs.link(tmp, file)
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  } catch {
    // Another caller created it first; read whatever is there.
  }
  return readKey()
}

// =============================================================================
// The baseline rollback pointer
// =============================================================================

const POINTER_FILE = 'baseline-pointers.json'
const POINTER_LOCK = 'baseline-pointers.lock'
const POINTER_MAX = 50000

/**
 * This machine's pointer file: the last settlement-baseline revision it wrote
 * per model hash, kept next to the key (outside every repository), so a
 * baseline restored from an older revision, grafted, or copied back is caught.
 * Hashes and numbers only. A file that cannot be trusted (a link, other
 * owners' access, not the format) is unusable, and a settlement then refuses
 * to count anything: without it no rollback can be seen.
 */
export type BaselinePointers = { usable: true; revisions: Record<string, number> } | { usable: false }

const pointerDir = () => path.join(os.homedir(), KEY_DIR)

/** Read this machine's pointer file. With no key directory or no file yet, it is usable and empty. */
export async function readBaselinePointers(modelDir?: string): Promise<BaselinePointers> {
  if (waiverKeyRefusal(modelDir)) return { usable: true, revisions: {} }
  const dst = await fs.lstat(pointerDir()).catch(() => null)
  if (!dst) return { usable: true, revisions: {} }
  if (dst.isSymbolicLink() || !dst.isDirectory()) return { usable: false }
  const file = path.join(pointerDir(), POINTER_FILE)
  const st = await fs.lstat(file).catch(() => null)
  if (!st) return { usable: true, revisions: {} }
  if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o077) !== 0 || st.size > 4 * 1024 * 1024) return { usable: false }
  try {
    const fh = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
      const doc = JSON.parse(await fh.readFile('utf8'))
      const models = doc?.models
      if ((doc?.version !== 1 && doc?.version !== 2) || !models || typeof models !== 'object' || Array.isArray(models)) return { usable: false }
      const revisions: Record<string, number> = {}
      for (const [k, v] of Object.entries(models as Record<string, any>)) {
        if (!/^[0-9a-f]{64}$/.test(k)) continue
        // A revision that is not a count cannot be trusted, and dropping it would let an older baseline verify again.
        if (!Number.isSafeInteger(v?.revision) || v.revision < 0) return { usable: false }
        revisions[k] = v.revision
      }
      return { usable: true, revisions }
    } finally {
      await fh.close()
    }
  } catch {
    return { usable: false }
  }
}

/**
 * Run `fn` holding this machine's pointer lock (beside the key). Every
 * settlement write takes it before the model's own state lock, so two
 * settlements never interleave their pointer updates.
 */
export async function withPointerLock<T>(fn: (handle: FileLockHandle) => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  return withFileLock(path.join(pointerDir(), POINTER_LOCK), fn, { label: POINTER_LOCK, ...options })
}

/**
 * Record revisions just written (each only ever raised), atomically, 0600,
 * under the pointer lock `handle`. Refuses (throws) rather than overwrite a
 * pointer file that cannot be read: the other models' entries must survive.
 */
export async function updateBaselinePointers(updates: Record<string, number>, handle: FileLockHandle, modelDir?: string, options: { max?: number } = {}): Promise<void> {
  if (waiverKeyRefusal(modelDir)) throw new StateFileError('pointer_unavailable', POINTER_FILE)
  const dst = await fs.lstat(pointerDir()).catch(() => null)
  if (!dst || dst.isSymbolicLink() || !dst.isDirectory()) throw new StateFileError('pointer_unavailable', POINTER_FILE)
  const current = await readBaselinePointers(modelDir)
  if (!current.usable) throw new StateFileError('pointer_unavailable', POINTER_FILE)
  const models: Record<string, { revision: number }> = {}
  for (const [k, r] of Object.entries(current.revisions)) models[k] = { revision: r }
  for (const [k, r] of Object.entries(updates)) {
    if (!Number.isSafeInteger(r) || r < 0) throw new StateFileError('pointer_unavailable', POINTER_FILE)
    models[k] = { revision: Math.max(r, models[k]?.revision ?? 0) }
  }
  const keys = Object.keys(models)
  // Never evict: a dropped entry would let an older baseline of that model verify again.
  if (Object.keys(models).length > (options.max ?? POINTER_MAX)) throw new StateFileError('pointer_unavailable', POINTER_FILE)
  const file = path.join(pointerDir(), POINTER_FILE)
  const tmp = `${file}.tmp.${randomBytes(8).toString('hex')}`
  const fh = await fs.open(tmp, 'wx', 0o600)
  try {
    await fh.writeFile(JSON.stringify({ version: 2, models }), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await handle.assertHeld()
  await fs.rename(tmp, file)
}

// =============================================================================
// Keyed MACs
// =============================================================================

/**
 * The purposes this machine's key signs for, each through its own subkey. A
 * tag never starts with `{`, so no subkey equals the key's own MAC over a
 * waiver record (JSON).
 */
export const MAC_TAGS = {
  journal: 'dethereal-journal-v1',
  platformBaseline: 'dethereal-platform-baseline-v1',
  attributeBaseline: 'dethereal/attribute-baseline/v2',
  modelPath: 'dethereal/model-path/v1',
  auditValue: 'dethereal/audit-value/v1',
  waiver: 'dethereal/waiver/v2',
} as const

/** A key derived from this machine's key for one purpose. */
export const subkey = (key: Buffer, tag: string): Buffer => createHmac('sha256', key).update(tag).digest()

/** The MAC of a payload, as lower-case hex. */
export const macHex = (key: Buffer, payload: string): string => createHmac('sha256', key).update(payload).digest('hex')

/** Whether `mac` is the payload's MAC: false for anything but 64 lower-case hex characters, never a throw. */
export function verifyMacHex(key: Buffer, payload: string, mac: unknown): boolean {
  if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return false
  return timingSafeEqual(Buffer.from(mac, 'hex'), createHmac('sha256', key).update(payload).digest())
}

// =============================================================================
// Waiver grants: this machine's, per model directory
// =============================================================================

const WAIVER_GRANTS_FILE = 'waiver-grants.json'
const WAIVER_GRANTS_PER_MODEL = 1000
const WAIVER_GRANTS_MAX_BYTES = 8 * 1024 * 1024
const HEX64 = /^[0-9a-f]{64}$/

/** A model directory as this machine's key names it (the settlement's model hash). */
const modelHashFor = (key: Buffer, realPath: string): string => macHex(subkey(key, MAC_TAGS.modelPath), realPath)

/**
 * The MAC of a waiver record granted for one model directory. It binds the
 * record (all but the element ids, which a push re-keys) to the directory, so a
 * record copied to another directory, or granted on another machine, never
 * matches a grant made here; a record whose grant was withdrawn (revoked here)
 * never counts again, wherever it comes back from.
 */
export const waiverMac = (key: Buffer, modelHash: string, r: WaiverRecord): string =>
  macHex(subkey(key, MAC_TAGS.waiver), `${modelHash}\u0000${waiverMacPayload(r)}`)

/**
 * This machine's waiver grants: the MACs it signed, by model hash, kept beside
 * the key (never in the repository, where they would be shared and fought
 * over). A file that cannot be trusted (a link, others' access, not the
 * format) is unusable: nothing verifies, and no waiver is granted.
 */
export type WaiverGrants = { usable: true; models: Record<string, string[]> } | { usable: false }

export async function readWaiverGrants(modelDir?: string): Promise<WaiverGrants> {
  if (waiverKeyRefusal(modelDir)) return { usable: false }
  const dst = await fs.lstat(pointerDir()).catch(() => null)
  if (!dst) return { usable: true, models: {} }
  if (dst.isSymbolicLink() || !dst.isDirectory()) return { usable: false }
  const file = path.join(pointerDir(), WAIVER_GRANTS_FILE)
  const st = await fs.lstat(file).catch(() => null)
  if (!st) return { usable: true, models: {} }
  if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o077) !== 0 || st.size > WAIVER_GRANTS_MAX_BYTES) return { usable: false }
  try {
    const fh = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
    try {
      // The file opened is the one inspected, and a regular file within the cap.
      const opened = await fh.stat()
      if (!opened.isFile() || opened.ino !== st.ino || opened.dev !== st.dev || opened.size > WAIVER_GRANTS_MAX_BYTES) return { usable: false }
      const doc = JSON.parse(await fh.readFile('utf8'))
      const models = doc?.models
      if (doc?.version !== 1 || !models || typeof models !== 'object' || Array.isArray(models)) return { usable: false }
      const out: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(models as Record<string, unknown>)) {
        if (!/^[0-9a-f]{64}$/.test(k) || !Array.isArray(v) || v.some((m) => typeof m !== 'string' || !/^[0-9a-f]{64}$/.test(m))) return { usable: false }
        out[k] = v as string[]
      }
      return { usable: true, models: out }
    } finally {
      await fh.close()
    }
  } catch {
    return { usable: false }
  }
}

/**
 * Record grants made and withdrawn for one model directory, atomically, 0600,
 * under this machine's pointer lock `handle`. Refuses (throws) rather than
 * overwrite a grants file that cannot be read.
 */
export async function updateWaiverGrants(modelDir: string, change: { add?: string[]; remove?: string[] }, handle: FileLockHandle): Promise<void> {
  const key = await loadWaiverKey(false, modelDir)
  if (!key) throw new StateFileError('pointer_unavailable', WAIVER_GRANTS_FILE)
  const hash = modelHashFor(key, await fs.realpath(modelDir))
  const current = await readWaiverGrants(modelDir)
  if (!current.usable) throw new StateFileError('pointer_unavailable', WAIVER_GRANTS_FILE)
  if ([...(change.add ?? []), ...(change.remove ?? [])].some((m) => typeof m !== 'string' || !HEX64.test(m))) throw new StateFileError('io', WAIVER_GRANTS_FILE)
  const remove = new Set(change.remove ?? [])
  const macs = [...new Set([...(current.models[hash] ?? []).filter((m) => !remove.has(m)), ...(change.add ?? [])])]
  if (macs.length > WAIVER_GRANTS_PER_MODEL) throw new StateFileError('too_large', WAIVER_GRANTS_FILE)
  const models = { ...current.models, [hash]: macs }
  if (!macs.length) delete models[hash]
  // Never written past what the reader accepts: that would make every grant on this machine unreadable.
  if (Buffer.byteLength(JSON.stringify({ version: 1, models })) > WAIVER_GRANTS_MAX_BYTES) throw new StateFileError('too_large', WAIVER_GRANTS_FILE)
  const file = path.join(pointerDir(), WAIVER_GRANTS_FILE)
  const tmp = `${file}.tmp.${randomBytes(8).toString('hex')}`
  const fh = await fs.open(tmp, 'wx', 0o600)
  try {
    await fh.writeFile(JSON.stringify({ version: 1, models }), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await handle.assertHeld()
  await fs.rename(tmp, file)
}

/** The MAC a grant of `r` for this directory records, with this machine's key; null when there is no usable key. */
export async function grantMacFor(modelDir: string, r: WaiverRecord): Promise<string | null> {
  const key = await loadWaiverKey(false, modelDir)
  return key ? waiverMac(key, modelHashFor(key, await fs.realpath(modelDir)), r) : null
}

/**
 * A verifier for waiver records: a record counts only when this machine
 * granted exactly it for this directory. With no key, a refused key, or a
 * grants file that cannot be trusted, nothing verifies.
 */
export async function waiverVerifier(modelDir?: string): Promise<(r: WaiverRecord) => boolean> {
  const key = await loadWaiverKey(false, modelDir)
  if (!key || !modelDir) return () => false
  const grants = await readWaiverGrants(modelDir)
  const real = await fs.realpath(modelDir).catch(() => null)
  if (!grants.usable || !real) return () => false
  const granted = new Set(grants.models[modelHashFor(key, real)] ?? [])
  return (r) => granted.has(waiverMac(key, modelHashFor(key, real), r))
}

