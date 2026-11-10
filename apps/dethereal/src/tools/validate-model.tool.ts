/**
 * Validate Model Tool
 *
 * Validates split-file model directory structure and cross-validates references.
 * Can validate entire directory or individual JSON data.
 */

import { z } from 'zod'
import {
  DtControl,
  validateControlFile,
  listControlFiles,
  readControlFile,
  flattenStructure,
  buildZoningContext,
  resolveEffectiveZone,
  computeZoningFindings,
  isStructuralContainer,
  computeContainerSummary,
  ORIGIN_LEVELS,
} from '@dethernety/dt-core'
import type { Zone, ZoneTierResult, EffectiveZone, ZoningFinding, ContainerSummary } from '@dethernety/dt-core'
import type { ConsolidatedAttributesFile, ElementAttributes, StructureBoundary } from '@dethernety/dt-core'
import type { AttributeReadIssue } from '../utils/directory-utils.js'
import { promises as fs } from 'fs'
import path from 'path'
import { ClientFreeTool, ToolContext, ToolResult } from './base-tool.js'
import {
  readModelDirectory,
  isModelDirectory,
  readManifest,
  readStructure,
  readDataFlows,
  readDataItems,
  readAttributes,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { credentialClassHint, type CredentialHintReason } from '../data/credential-classes.js'
import { evaluate, readLoopBack, roundOf, tally, untouchedMessage, UNREADABLE_MESSAGE } from '../utils/loop-back.js'
import { classifyTiers, crossBoundaryComponentIds, proposedZoneTier, type Tier } from '../utils/tiers.js'
import {
  type AttributeResidual,
  computeAttributeResidual,
  computeGates,
  computeGatesWithView,
  crownJewelIds,
  GateInputError,
  type GateCheck,
  type GateFailure,
  type GatesResult,
  MAX_FAILING,
  isPlaceholderList,
  isNotApplicable,
  isStandIn,
  leftUnclassifiedIds,
  loadGateInput,
  mayAnswerNotApplicable,
  readClassTemplates,
  safeErrorMessage,
  TRANSIT_ALIASES,
  waiverVerifier,
} from '../utils/gates.js'
import { authenticationClaimed, encryptionClaim, flowAuthentication, normToken } from '../utils/lints.js'
import { readRepoJson, readState, StateFileError, updateDetherealJson } from '../utils/state-store.js'
import type { SettlementMode } from '../utils/settlement-switch.js'

/**
 * The waivers recorded in the model's state, with this machine's verifier.
 * Only the `waivers` key is read; a state file the store refuses means no
 * waiver applies.
 */
/**
 * The gates, held by the loop-back guard: while an armed loop-back has an element neither touched nor dropped, or
 * its record cannot be read, Gates 1 and 2 are computed as usual and Gate 3 is not; its place holds why, and the
 * untouched elements as the loop's worklist. Reading never changes the record.
 */
async function guardedGates(dirPath: string, settlement?: SettlementMode): Promise<GuardedGates> {
  const { result, view } = computeGatesWithView(await loadGateInput(dirPath, { settlement }), await storedWaivers(dirPath))
  const read = await readLoopBack(dirPath)
  if (read.state === 'none') return result
  if (read.state === 'unreadable') {
    return { ...result, gate3: { verdict: 'NOT_COMPUTED', code: 'loop_back_unreadable', message: UNREADABLE_MESSAGE } }
  }
  const outcomes = evaluate(read.record, view)
  const counts = tally(outcomes)
  if (counts.untouched_total) {
    return {
      ...result,
      gate3: { verdict: 'NOT_COMPUTED', code: 'loopback_untouched', message: untouchedMessage(counts.untouched, counts.untouched_total), loop_back: counts },
    }
  }
  return { ...result, loop_back_round: roundOf(outcomes) }
}

/** A gates report as the loop-back guard leaves it: Gate 3 held back, or computed with the round's outcome. */
type GuardedGates =
  | (GatesResult & { loop_back_round?: ReturnType<typeof roundOf> })
  | (Omit<GatesResult, 'gate3'> & {
      gate3: { verdict: 'NOT_COMPUTED'; code: 'loopback_untouched' | 'loop_back_unreadable'; message: string; loop_back?: ReturnType<typeof tally> }
    })

/**
 * A gates report without what it repeats: a passing check keeps its verdict and value, and a failure with field gaps
 * keeps the fields (`missing`, `placeholder`) without `detail`, which says the same in words.
 */
export function trimGates(r: GuardedGates): GuardedGates {
  const check = (c: GateCheck): GateCheck | Pick<GateCheck, 'verdict' | 'value'> => {
    if (c.verdict === 'PASS' && !c.failing.length && !c.waived?.length) return { verdict: c.verdict, value: c.value }
    return { ...c, failing: c.failing.map((f: GateFailure) => (f.missing || f.placeholder) ? (({ detail: _detail, ...rest }) => rest)(f) : f) }
  }
  const checks = (cs: Record<string, GateCheck>) => Object.fromEntries(Object.entries(cs).map(([k, c]) => [k, check(c)]))
  const out = { ...r, gate1: { ...r.gate1, checks: checks(r.gate1.checks) }, gate2: { ...r.gate2, checks: checks(r.gate2.checks) } } as GuardedGates
  if ('criteria' in r.gate3) (out.gate3 as { criteria: unknown }).criteria = checks(r.gate3.criteria)
  return out
}

/** How many ids a warning Gate 1 check lists in a summary: a warning is advisory, `failing_total` says the rest. */
export const SUMMARY_GATE1_IDS = 3

/**
 * A gates report for a progress check: verdicts, totals and failing ids, the Gate 3 report, no field lists. A Gate 1
 * check that only warns lists its first `SUMMARY_GATE1_IDS` ids; a failing one, and Gates 2 and 3, list every failing id.
 */
export function summariseGates(r: GuardedGates): Record<string, unknown> {
  const brief = (c: GateCheck | Pick<GateCheck, 'verdict' | 'value'>, warnMax = Infinity) =>
    'failing' in c && c.failing.length
      ? { verdict: c.verdict, failing_total: c.failing_total, failing: c.failing.slice(0, c.verdict === 'WARN' ? warnMax : Infinity).map((f: GateFailure) => f.id) }
      : c.verdict
  const checks = (cs: Record<string, GateCheck>, max?: number) => Object.fromEntries(Object.entries(cs).map(([k, c]) => [k, brief(c, max)]))
  const g3 = r.gate3
  const gate3 = 'criteria' in g3
    ? {
      verdict: g3.verdict, verdict_without_waivers: g3.verdict_without_waivers, criteria: checks(g3.criteria), waived_total: g3.waived_total,
      report: g3.report, loopback: { elements_total: g3.loopback.elements.length },
      ...('loop_back_round' in r && r.loop_back_round ? { loop_back_round: r.loop_back_round } : {}),
    }
    : g3
  return {
    detail: 'summary', lints_total: r.lints.length,
    gate1: { verdict: r.gate1.verdict, checks: checks(r.gate1.checks, SUMMARY_GATE1_IDS) }, gate2: { verdict: r.gate2.verdict, checks: checks(r.gate2.checks) }, gate3,
  }
}

/** A quality result for a progress check: the score and factors, and the five elements with the most unresolved fields. */
export function summariseQuality(q: QualityOutput): Record<string, unknown> {
  const { top_unresolved: top, ...residual } = q.attribute_residual
  return {
    ...q, detail: 'summary',
    attribute_residual: { ...residual, top_unresolved: top.slice(0, 5).map((e) => ({ element: e.element, class: e.class, unresolved: e.unresolved, declared: e.declared })) },
  }
}

/**
 * The elements the operator left unclassified, from `.dethereal/discovery.json`. A missing or unreadable file
 * excludes nothing.
 */
async function leftUnclassified(dirPath: string): Promise<Set<string>> {
  try {
    return leftUnclassifiedIds(await readRepoJson(dirPath, '.dethereal/discovery.json', { baseDir: dirPath, maxBytes: 32 * 1024 * 1024 }))
  } catch {
    return new Set()
  }
}

async function storedWaivers(dirPath: string): Promise<{ waivers?: unknown; verifyWaiver?: Awaited<ReturnType<typeof waiverVerifier>> }> {
  let waivers: unknown
  try {
    waivers = (await readState(dirPath))?.waivers
  } catch {
    return {}
  }
  // The key is read only when there is something to verify.
  return Array.isArray(waivers) && waivers.length ? { waivers, verifyWaiver: await waiverVerifier(dirPath) } : {}
}

// Define validation schemas for individual files
const ManifestSchema = z.object({
  schemaVersion: z.string(),
  format: z.enum(['split', 'monolithic']),
  model: z.object({
    id: z.string().nullable().optional(),
    name: z.string(),
    description: z.string().optional(),
    defaultBoundaryId: z.string()
  }),
  files: z.object({
    structure: z.string(),
    dataFlows: z.string(),
    dataItems: z.string(),
    attributes: z.string()
  }).optional(),
  modules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional()
  })).optional(),
  exportedAt: z.string().optional()
})

// Recursive so nested-boundary zoning is validated too (z.array(z.any()) would skip it).
// Permissive (no .strict()): unknown keys pass through, so no currently-valid model is newly rejected —
// only malformed zone/plane enums get flagged. Components carry no zoning, so they stay z.any().
const BoundarySchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    dimensionsWidth: z.number().optional(),
    dimensionsHeight: z.number().optional(),
    zone: z.enum(['UNTRUSTED', 'PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'VENDOR']).nullable().optional(),
    domains: z.array(z.string()).optional(),
    planes: z.array(z.enum(['WORKLOAD', 'MANAGEMENT'])).optional(),
    conduits: z.array(z.object({
      peerId: z.string(),
      peerName: z.string().optional(),
      direction: z.enum(['OUTBOUND', 'INBOUND']),
      justification: z.string().optional(),
      controlRefs: z.array(z.string()).optional()
    })).optional(),
    boundaries: z.array(BoundarySchema).optional(),
    components: z.array(z.any()).optional()
  })
)

const StructureSchema = z.object({
  defaultBoundary: BoundarySchema
})

const DataFlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  source: z.object({ id: z.string() }),
  target: z.object({ id: z.string() })
})

const DataItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Explicit null = unassign the class on the next update push (absent = leave untouched).
  classData: z.object({
    id: z.string(),
    name: z.string()
  }).nullable().optional(),
  // Asset-context fields (snake_case local). Flag *values* are free-text — not enumed.
  sensitivity: z.enum(['restricted', 'confidential', 'internal', 'public']).optional(),
  regulatory_flags: z.array(z.string()).optional(),
  // Who can write the content: one of dt-core's ORIGIN_LEVELS (snake_case local tokens, most to least trusted).
  origin: z.enum(ORIGIN_LEVELS).optional(),
  // Author-asserted: the item is a credential. Absent means unknown.
  is_credential: z.boolean().optional(),
  // Controls applied to the item. A present list (incl. []) replaces them on push; an absent key leaves them.
  controls: z.array(z.object({ id: z.string().nullable().optional(), name: z.string().optional() })).optional()
})

const AttributesSchema = z.object({
  boundaries: z.record(z.string(), z.any()).optional(),
  components: z.record(z.string(), z.any()).optional(),
  dataFlows: z.record(z.string(), z.any()).optional(),
  dataItems: z.record(z.string(), z.any()).optional()
})

const FileTypeEnum = z.enum(['manifest', 'structure', 'dataflows', 'data-items', 'attributes'])
type FileType = z.infer<typeof FileTypeEnum>

const ActionEnum = z.enum(['validate', 'quality', 'coverage', 'zoning', 'gates']).optional().default('validate')

const InputSchema = z.object({
  action: ActionEnum.describe("Action: 'validate' checks schema/references, 'quality' computes quality score (0-100), 'coverage' analyzes control coverage, 'zoning' computes per-boundary trust determination (zone/tier/findings) offline, 'gates' computes Gates 1–3 (Gate 3 criteria C1–C9) with per-element failures"),
  assets: z.enum(['full', 'skeleton']).optional().default('full').describe("For action 'zoning', and validate's include zoning: 'skeleton' omits the asset join so RESTRICTED is never proposed (the Step-4 trust skeleton — external + exposure + INTERNAL); 'full' (default) is the close-of-Step-7 / Step-9 determination where qualifying internal boundaries can promote to RESTRICTED"),
  directory_path: z.string().optional().describe('Path to model directory to validate (validates entire directory)'),
  model_id: z.string().optional().describe('Model ID for online coverage analysis (requires authentication)'),
  data: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('JSON data to validate (string or object)'),
  file_type: FileTypeEnum.optional().describe('Type of file to validate when using data parameter'),
  include: z.array(z.enum(['gates', 'zoning'])).min(1).max(2).optional().describe(
    "For 'validate' with directory_path: also return the gates and/or the zoning, each exactly as its own action returns it " +
    '(detail applies to gates, assets to zoning); a part that cannot be computed comes back as gates_unavailable or zoning_unavailable'),
  detail: z.enum(['summary', 'full']).optional().default('full').describe(
    "For 'gates' (and validate's include gates) and 'quality' only. 'full' (default): every failing element with its fields, the loop-back worklist, and " +
    "attribute_residual.top_unresolved with its fields — what Step 9's gap list, a loop back and the enrichment worklist " +
    "read. 'summary': per criterion its verdict, failing_total and the failing ids (a Gate 1 warning: its first 3); the Gate 3 report; for quality the " +
    "score, its factors and the five elements with the most unresolved fields, without field lists. Use summary for a progress check.")
})

type ValidateInput = z.infer<typeof InputSchema>

interface ValidationError {
  file: string
  path?: string
  message: string
}

interface ValidationWarning {
  file: string
  path?: string
  message: string
  /** How many identical warnings this one stands for, when more than one */
  count?: number
}

/** The warnings with each identical one listed once, with how many it stands for. */
export function collapseWarnings(warnings: ValidationWarning[]): ValidationWarning[] {
  const seen = new Map<string, ValidationWarning>()
  for (const w of warnings) {
    const k = JSON.stringify([w.file, w.path ?? null, w.message])
    const prior = seen.get(k)
    if (prior) prior.count = (prior.count ?? 1) + 1
    else seen.set(k, { ...w })
  }
  return [...seen.values()]
}

interface ValidateOutput {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

interface QualityFactor {
  value: number
  weight: number
  note?: string
}

interface QualityOutput {
  quality_score: number
  label: string
  factors: Record<string, QualityFactor>
  element_counts: {
    boundaries: number
    components: number
    data_flows: number
    data_items: number
  }
  /**
   * Which class template fields are still unresolved, and where. This is the
   * enrichment worklist: `attribute_completion_rate` compresses it to one
   * number, and a number cannot tell an operator what to go and answer.
   */
  attribute_residual: AttributeResidual
  model_name: string
  warnings?: string[]
  /**
   * Data items bound to a class that suggests a credential while `is_credential` is unanswered. A hint for the
   * enrichment workflow to propose; it never sets the field and does not change the score.
   */
  credential_hints?: Array<{ id: string; name: string; class: string; reason: CredentialHintReason }>
  /** The result was recorded in `.dethereal/quality.json`, which status and help read */
  quality_recorded?: boolean
}

/**
 * Record a quality result in the model's `.dethereal/quality.json`, exactly as
 * returned, through the state store (its lock, an atomic write, no links). The
 * result then says whether it was recorded; a failure is a warning, never an error.
 */
async function recordQuality(dir: string, data: QualityOutput): Promise<void> {
  try {
    const payload = structuredClone(data) as unknown as Record<string, unknown>
    await updateDetherealJson(dir, 'quality.json', () => payload, { createIfMissing: true })
    data.quality_recorded = true
  } catch (error) {
    const code = error instanceof StateFileError ? error.code : 'io'
    data.quality_recorded = false
    data.warnings = [...(data.warnings ?? []), `.dethereal/quality.json could not be recorded (${code}).`]
  }
}

interface CategoryCoverage {
  covered: number
  total: number
  missing: string[]
}

interface InferredCategoryBreakdown {
  authentication: CategoryCoverage
  encryption_transit: CategoryCoverage
  encryption_at_rest: CategoryCoverage
  monitoring: CategoryCoverage
}

interface TierCoverage {
  /** Classified non-external components in the tier. */
  total: number
  with_controls: number
  /** Components without a formal control, at most `MAX_FAILING`. */
  gaps: Array<{ id: string; name?: string }>
  gaps_total: number
  /** Non-external components in the tier with no class, left out of `total`. */
  unclassified: number
}

/**
 * Formal control coverage by the gates' tiers (the same `classifyTiers` read of
 * the same model). Labels overlap the tiers: never add them to a tier.
 */
interface FormalTierBreakdown {
  tier_1_internet_facing: TierCoverage
  tier_2_crown_jewel_or_restricted: TierCoverage
  tier_3_internal: TierCoverage
  labels: { crown_jewels: TierCoverage; cross_boundary: TierCoverage }
  /** The cross-boundary flows (capped) and what their attributes say about authentication. */
  cross_boundary_flows: Array<{ id: string; name?: string; authentication: 'declared' | 'declared_none' | 'undeclared' }>
  cross_boundary_flows_total: number
  externals_excluded: number
  /** Tier 3 components in no declared or inherited zone. */
  tier_3_unzoned: number
}

interface SourceBreakdown {
  discovered: number
  declared: number
  both: number
}

interface CoverageOutput {
  mode: 'online' | 'offline'
  /** Offline only: coverage counts control assignment, not mitigation. The online path sets none. */
  coverage_kind?: 'assignment-heuristic'
  coverage_summary: {
    total_exposures: number
    mitigated: number
    unmitigated: number
    unaddressable: number
    configured_coverage?: number
    no_mitre_chain?: number
    coverage_pct: number
  }
  inferred_coverage?: InferredCategoryBreakdown
  formal_coverage?: FormalTierBreakdown
  source_breakdown?: SourceBreakdown
  details?: any
}

// Per-boundary trust determination for the `zoning` action. Superset of the offline zoning payload:
// {id, declaredZone, resolvedZone, proposedTier, reason, confidence, provenance} plus the
// resolution columns (resolvedSource/from), blockedBy for finding remediation, and `structural`
// (a boundary that nests child boundaries — it abstains, so the caller proposes no zone for it).
interface ZoningBoundary {
  id: string
  name: string
  declaredZone: Zone | null
  resolvedZone: Zone
  resolvedSource: EffectiveZone['source']
  resolvedFrom?: string
  proposedTier: Zone
  reason: string
  blockedBy?: NonNullable<ZoneTierResult['blockedBy']>
  confidence: 'high' | 'medium' | 'low'
  provenance: string
  /** True when the boundary nests child boundaries — a structural container that abstains (propose no zone). */
  structural: boolean
  /**
   * Display-only roll-up of the trust tiers inside a structural container (range/maxExposure/presence flags
   * + unclassified-descendant coverage count). Present only on structural containers in the FULL phase; never
   * persisted, never a declared zone. See dt-core `ContainerSummary`.
   */
  summary?: ContainerSummary
}

interface ZoningOutput {
  boundaries: ZoningBoundary[]
  findings: ZoningFinding[]
}

/** A gates or quality reply at `detail: 'summary'`. */
type SummaryOutput = Record<string, unknown>

export class ValidateModelTool extends ClientFreeTool<ValidateInput, ValidateOutput | QualityOutput | CoverageOutput | ZoningOutput | GuardedGates | SummaryOutput> {
  readonly name = 'validate_model_json'
  readonly description = 'Validate a threat model JSON structure, compute a quality score (0-100), analyze control coverage, compute boundary trust zoning, or compute the quality gates. Use action "validate" for schema checks, "quality" for enrichment progress, "coverage" for control gap analysis, "zoning" for per-boundary trust determination, or "gates" for Gates 1–3 (Gate 3 criteria C1–C9 decide whether the model can be REVIEWED).'
  readonly inputSchema = InputSchema

  async execute(input: ValidateInput, context: ToolContext): Promise<ToolResult<ValidateOutput | QualityOutput | CoverageOutput | ZoningOutput | GuardedGates | SummaryOutput>> {
    try {
      if (input.include !== undefined && (input.action !== 'validate' || !input.directory_path)) {
        return {
          success: false,
          error: "include adds the gates or the zoning to a model directory's validate: give it with action 'validate' and directory_path",
          data: { codes: ['include_scope'] } as never,
        }
      }

      // Coverage action
      if (input.action === 'coverage') {
        return await this.computeCoverage(input, context)
      }

      // Zoning action — offline per-boundary trust determination
      if (input.action === 'zoning') {
        if (!input.directory_path) {
          return { success: false, error: 'directory_path is required for zoning action' }
        }
        input.directory_path = await validatePathConfinement(input.directory_path)
        return await this.computeZoning(input.directory_path, input.assets)
      }

      // Gates action — Gates 1–3 from the model files
      if (input.action === 'gates') {
        if (!input.directory_path) {
          return { success: false, error: 'directory_path is required for gates action' }
        }
        return await this.gates(await validatePathConfinement(input.directory_path), input.directory_path, input.detail, context.settlement)
      }

      // Quality score action
      if (input.action === 'quality') {
        if (!input.directory_path) {
          return { success: false, error: 'directory_path is required for quality action' }
        }
        input.directory_path = await validatePathConfinement(input.directory_path)
        const result = await this.computeQuality(input.directory_path)
        // The whole result is recorded, whatever the reply's detail.
        if (result.success && result.data) await recordQuality(input.directory_path, result.data)
        return input.detail === 'summary' && result.success && result.data ? { ...result, data: summariseQuality(result.data) } : result
      }

      // Validate path confinement if directory path provided
      if (input.directory_path) {
        input.directory_path = await validatePathConfinement(input.directory_path)
        const validated = await this.validateDirectory(input.directory_path, context.settlement)
        if (!input.include?.length || !validated.success || !validated.data) return validated
        return { success: true, data: { ...validated.data, ...(await this.included(input.directory_path, input, context)) } }
      }

      // Validate inline data if provided
      if (input.data) {
        return await this.validateInlineData(input.data, input.file_type)
      }

      return {
        success: false,
        error: 'Either directory_path or data must be provided'
      }

    } catch (error) {
      return { success: false, error: safeErrorMessage(error, 'Validation failed') }
    }
  }

  /** The gates of a model directory, as action 'gates' returns them; `shown` is the path as the caller gave it. */
  private async gates(dirPath: string, shown: string, detail: ValidateInput['detail'], settlement: SettlementMode | undefined): Promise<ToolResult<GuardedGates | SummaryOutput>> {
    if (!await pathExists(dirPath)) return { success: false, error: `Directory not found: ${shown}` }
    if (!await isModelDirectory(dirPath)) return { success: false, error: `Not a valid model directory: ${shown}` }
    const gates = trimGates(await guardedGates(dirPath, settlement))
    return { success: true, data: detail === 'summary' ? summariseGates(gates) : gates }
  }

  /**
   * The parts validate's include asks for, each as its own action returns it: one that cannot be computed is
   * `<part>_unavailable` with why, and the others still come.
   */
  private async included(dirPath: string, input: ValidateInput, context: ToolContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    const part = async (name: 'gates' | 'zoning', run: () => Promise<ToolResult<unknown>>) => {
      try {
        const r = await run()
        if (r.success) out[name] = r.data
        else out[`${name}_unavailable`] = { code: `${name}_failed`, message: r.error ?? 'failed' }
      } catch (err) {
        out[`${name}_unavailable`] = { code: err instanceof GateInputError ? err.code : `${name}_failed`, message: safeErrorMessage(err, `${name} failed`) }
      }
    }
    if (input.include!.includes('gates')) await part('gates', () => this.gates(dirPath, dirPath, input.detail, context.settlement))
    if (input.include!.includes('zoning')) await part('zoning', () => this.computeZoning(dirPath, input.assets))
    return out
  }

  /**
   * Offline boundary trust determination. Reads the local split files, runs the dt-core
   * determination engine (cascade + context builder), and returns the per-boundary zone/tier + coherence findings.
   * The asset signals (crownJewel / sensitivity / regulatory_flags) are first-class on the
   * structure + data items, so no attribute read is needed.
   *
   * `assets` selects the determination phase: 'skeleton' blanks `ctx.assetIds` so rule 3
   * (RESTRICTED) is structurally unreachable — the Step-4 trust skeleton sets external + exposure +
   * INTERNAL only, with RESTRICTED deferred to the close-of-Step-7 promotion. The blanked context is
   * fed to BOTH the per-boundary cascade and `computeZoningFindings`, so asset-dependent findings
   * (under-protected/misplaced) also defer — only `unclassified`/`mgmt-plane` surface at Step 4.
   * 'full' (default) is the complete determination (Step 9 / model-reviewer, where assets are known).
   */
  private async computeZoning(
    dirPath: string,
    assets: 'full' | 'skeleton' = 'full',
  ): Promise<ToolResult<ZoningOutput>> {
    if (!await pathExists(dirPath)) {
      return { success: false, error: `Directory not found: ${dirPath}` }
    }
    if (!await isModelDirectory(dirPath)) {
      return { success: false, error: `Not a valid model directory: ${dirPath}` }
    }

    const structure = await readStructure(dirPath)
    const dataFlows = await readDataFlows(dirPath) // normalizes [] and { dataFlows: [] }
    const dataItems = await readDataItems(dirPath)
    const ctx = buildZoningContext(structure, dataFlows, dataItems)
    // A boundary's own enforcement attributes: one that allows any inbound traffic is proposed PUBLIC.
    const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems })
    const allowAnyInbound = (id: string): unknown => {
      const entry = (attributes.boundaries as Record<string, { attributes?: Record<string, unknown> } | undefined>)[id]
      return entry?.attributes?.allow_any_inbound
    }
    // Skeleton phase: empty BOTH asset sets once and use them for the cascade AND the findings, so no
    // boundary can reach rule 3 (RESTRICTED) and no asset-dependent finding fires at Step 4. (The RESTRICTED
    // gate reads directAssetIds, so blanking assetIds alone would let the skeleton wrongly promote.)
    const effCtx =
      assets === 'skeleton'
        ? { ...ctx, assetIds: new Set<string>(), directAssetIds: new Set<string>() }
        : ctx

    const boundaries: ZoningBoundary[] = []
    for (const [id, boundary] of effCtx.boundariesById) {
      if (id === effCtx.defaultBoundaryId) continue // the root container is not a classified segment
      const resolved = resolveEffectiveZone(id, effCtx.boundariesById, effCtx.defaultBoundaryId)
      const tier = proposedZoneTier(boundary, effCtx, allowAnyInbound(id))
      // Display roll-up: structural containers only, and never at skeleton (both asset sets are blanked
      // there, so containsAssets/RESTRICTED would silently understate — the roll-up is a full-phase artifact).
      const summary =
        assets !== 'skeleton' && isStructuralContainer(boundary)
          ? computeContainerSummary(boundary, effCtx)
          : null
      boundaries.push({
        id,
        name: boundary.name,
        declaredZone: boundary.zone ?? null,
        resolvedZone: resolved.zone,
        resolvedSource: resolved.source,
        ...(resolved.from !== undefined && { resolvedFrom: resolved.from }),
        proposedTier: tier.tier,
        reason: tier.reason,
        ...(tier.blockedBy !== undefined && { blockedBy: tier.blockedBy }),
        confidence: this.zoningConfidence(tier),
        provenance: this.zoningProvenance(resolved, effCtx.boundariesById),
        structural: isStructuralContainer(boundary),
        ...(summary != null && { summary }),
      })
    }

    return { success: true, data: { boundaries, findings: computeZoningFindings(effCtx) } }
  }

  /**
   * Deterministic cascade-certainty confidence for the OFFLINE payload (the post-hoc / Step-9
   * model-reviewer audience, where no scout output is in context). A firm tier with no block is high;
   * an asset blocked from Restricted by exposure/vendor ingress is medium; an unprovable residual
   * (no ingress / no asset) is low.
   *
   * This is intentionally distinct from the scout's discovery-time `classificationConfidence` on a
   * `suggestedZone` — that confidence is rendered agent-side in the Step-4 trust table. The
   * two coexist by design: structure.json carries no per-boundary confidence to join them on, so the
   * offline determination derives its own certainty rather than depending on a discovery artifact.
   */
  private zoningConfidence(tier: ZoneTierResult): 'high' | 'medium' | 'low' {
    if (tier.blockedBy === 'no-ingress' || tier.blockedBy === 'no-asset') return 'low'
    if (tier.blockedBy === 'exposure' || tier.blockedBy === 'vendor') return 'medium'
    return 'high'
  }

  /** One-line resolution story for the "Resolved" column (distinct from the cascade `reason`). */
  private zoningProvenance(
    resolved: EffectiveZone,
    boundariesById: Map<string, { name: string }>,
  ): string {
    if (resolved.source === 'declared') return `operator-declared ${resolved.zone}`
    if (resolved.source === 'inherited') {
      const fromName = (resolved.from && boundariesById.get(resolved.from)?.name) || resolved.from
      return `inherited from ${fromName}`
    }
    return `unclassified — defaults to ${resolved.zone}`
  }

  /**
   * True when any single boundary directly contains BOTH an EXTERNAL_ENTITY and
   * a non-external component.
   *
   * An external entity is by definition outside the trust boundary; placing it
   * in the same zone as the internal components it talks to erases the crossing
   * the whole model exists to describe. Only DIRECT children are compared — a
   * nested boundary is its own zone, which is exactly the shape
   * guidelines-core.md recommends.
   */
  private hasMixedTrustBoundary(boundary: StructureBoundary): boolean {
    const direct = boundary.components ?? []
    const hasExternal = direct.some((c) => c.type === 'EXTERNAL_ENTITY')
    const hasInternal = direct.some((c) => c.type && c.type !== 'EXTERNAL_ENTITY')
    if (hasExternal && hasInternal) return true
    return (boundary.boundaries ?? []).some((b) => this.hasMixedTrustBoundary(b))
  }

  private async computeQuality(dirPath: string): Promise<ToolResult<QualityOutput>> {
    if (!await pathExists(dirPath)) {
      return { success: false, error: `Directory not found: ${dirPath}` }
    }
    if (!await isModelDirectory(dirPath)) {
      return { success: false, error: `Not a valid model directory: ${dirPath}` }
    }

    const manifest = await readManifest(dirPath)
    const structure = await readStructure(dirPath)
    const dataFlows = await readDataFlows(dirPath)
    const dataItems = await readDataItems(dirPath)
    const attributeIssues: AttributeReadIssue[] = []
    const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems }, attributeIssues)

    const allComponentIds = this.collectComponentIds(structure.defaultBoundary)
    const allBoundaryIds = this.collectBoundaryIds(structure.defaultBoundary)
    const totalComponents = allComponentIds.size
    const totalBoundaries = allBoundaryIds.size

    // Factor 1: component_classification_rate (weight 25)
    let classifiedComponents = 0
    for (const compId of allComponentIds) {
      const compAttrs = attributes.components?.[compId]
      if (compAttrs && (compAttrs as any).classData?.id) {
        classifiedComponents++
      }
    }
    // Also check inline classData in structure
    classifiedComponents = Math.max(classifiedComponents,
      this.countClassifiedComponents(structure.defaultBoundary))
    const componentClassificationRate = totalComponents > 0
      ? Math.min(classifiedComponents / totalComponents, 1.0) : 0

    // Factor 2: attribute_completion_rate (weight 20)
    // Measures template fields that carry a VALUE, across all four element
    // groups — see computeAttributeResidual for why file presence was wrong.
    const { templates: classTemplates } = await readClassTemplates(dirPath)

    // Population = every element in the model, from the structural files. Not
    // the attribute tree — see computeAttributeResidual.
    const flat = flattenStructure(structure)
    const residualPopulation = [
      ...flat.boundaries.map((b) => ({ id: b.id, name: b.name, group: 'boundaries', classData: b.classData })),
      ...flat.components.map((c) => ({ id: c.id, name: c.name, group: 'components', classData: c.classData })),
      ...dataFlows.map((f) => ({ id: f.id, name: f.name, group: 'dataFlows', classData: f.classData })),
      ...dataItems.map((d) => ({ id: d.id, name: d.name, group: 'dataItems', classData: d.classData })),
    ]
    // Not open to classification: the elements the operator left unclassified, and the root container, which is not a
    // classified segment.
    const notOpen = await leftUnclassified(dirPath)
    if (structure.defaultBoundary?.id) notOpen.add(structure.defaultBoundary.id)
    const attributeResidual = computeAttributeResidual(residualPopulation, attributes, classTemplates, notOpen)

    let attributeCompletionRate: number
    let attributeCompletionNote: string | undefined
    if (attributeResidual.declared > 0) {
      attributeCompletionRate = attributeResidual.resolved / attributeResidual.declared
      const excluded: string[] = []
      if (attributeResidual.elements_unclassified > 0) {
        excluded.push(`${attributeResidual.elements_unclassified} unclassified`)
      }
      if (attributeResidual.elements_without_template > 0) {
        excluded.push(`${attributeResidual.elements_without_template} classified but with no cached template`)
      }
      if (excluded.length > 0) {
        attributeCompletionNote =
          `Measured over ${attributeResidual.elements_scored} element(s); excluded ${excluded.join(' and ')}`
      }
    } else {
      // No cached template for anything: fall back to the old file-presence
      // heuristic rather than scoring a legitimately enriched model at zero,
      // and label the basis so the number is not mistaken for a field measure.
      const componentAttrCount = Object.keys(attributes.components || {}).length
      const dataItemAttrCount = Object.keys(attributes.dataItems || {}).length
      const attributeDenominator = totalComponents + dataItems.length
      attributeCompletionRate = attributeDenominator > 0
        ? Math.min((componentAttrCount + dataItemAttrCount) / attributeDenominator, 1.0) : 0
      attributeResidual.basis = 'file-presence'
      // The per-element counters describe a template-basis pass that did not
      // happen; zero them rather than leave a partial tally that reads as fact.
      attributeResidual.elements_scored = 0
      attributeResidual.blocked = []
      attributeCompletionNote =
        'No cached class templates — measuring attribute-file presence, not resolved fields. Run generate_attribute_stubs.'
    }

    // Factor 3: boundary_hierarchy_quality (weight 15)
    // Three conditions, each +0.33:
    // (a) Hierarchy depth >= 2
    // (b) No boundary contains only one child
    // (c) No external entities share boundary with internal components
    let bhq = 0
    const maxDepth = this.getBoundaryDepth(structure.defaultBoundary)
    if (maxDepth >= 2) bhq += 0.33
    if (totalBoundaries === 0 || !this.hasSingleChildBoundary(structure.defaultBoundary)) bhq += 0.33
    // Condition (c): no boundary mixes an EXTERNAL_ENTITY with internal components.
    //
    // This was awarded unconditionally, justified as "we can't distinguish
    // external entities" — but the same file does exactly that in
    // computeCoverage's collectExternals walk, and guidelines-core.md teaches
    // the rule this checks (the GOOD example puts the external actor in its own
    // Internet Zone; the BAD one flattens it in beside the web server). A free
    // 0.34 made the factor unable to report the modelling error it names.
    if (!this.hasMixedTrustBoundary(structure.defaultBoundary)) bhq += 0.34
    const boundaryHierarchyQuality = Math.min(bhq, 1.0)

    // Factor 4: data_flow_coverage (weight 15)
    const componentsWithFlows = new Set<string>()
    for (const flow of dataFlows) {
      if (flow.source?.id && allComponentIds.has(flow.source.id)) {
        componentsWithFlows.add(flow.source.id)
      }
      if (flow.target?.id && allComponentIds.has(flow.target.id)) {
        componentsWithFlows.add(flow.target.id)
      }
    }
    const dataFlowCoverage = totalComponents > 0
      ? componentsWithFlows.size / totalComponents : 0

    // Factor 5: data_classification_rate (weight 10)
    const totalDataItems = dataItems.length
    const classifiedDataItems = dataItems.filter(di => di.classData?.id).length
    const dataClassificationRate = totalDataItems > 0
      ? classifiedDataItems / totalDataItems : 0

    // Factor 6: control_coverage_rate (weight 10)
    // Two-tier: attribute-inferred (Tier 1) + formal controls[] (Tier 2), max per element
    const classifiedComponentIds = this.collectClassifiedComponentIds(
      structure.defaultBoundary, attributes)

    const controlCoveredIds = this.buildControlCoverageSet(
      structure.defaultBoundary, dataFlows)

    let coveredCount = 0
    for (const compId of classifiedComponentIds) {
      const hasTier1 = attributes.components?.[compId] &&
        this.hasPositiveSecurityAttribute(attributes.components[compId])
      const hasTier2 = controlCoveredIds.has(compId)
      if (hasTier1 || hasTier2) coveredCount++
    }

    const totalClassified = classifiedComponentIds.size
    const controlCoverageRate = totalClassified > 0
      ? Math.min(coveredCount / totalClassified, 1.0) : 0

    const anyFormalControls = controlCoveredIds.size > 0
    let controlCoverageNote: string | undefined
    if (totalClassified === 0) {
      controlCoverageNote = undefined
    } else if (coveredCount > 0 && !anyFormalControls) {
      controlCoverageNote = 'Inferred from attributes; no formal controls assigned'
    } else if (coveredCount === 0) {
      // Deliberately hedged. The attribute-inferred tier recognises only a
      // small fixed set of legacy key names (see getAttributeCategories), which
      // modern class templates do not use — so a zero here routinely means "the
      // heuristic did not recognise anything", not "nothing is protected". Do
      // not let it read as a finding about the model.
      controlCoverageNote =
        'No formal controls assigned, and no attribute matched the inferred-coverage heuristic ' +
        '(it recognises only a small fixed set of legacy attribute names — a zero here is not ' +
        'evidence that the elements are unprotected)'
    }

    // Factor 7: credential_coverage_rate (weight 5)
    // Cross-boundary flows (the set Gate 3's C3 uses) whose credential question is
    // answered: required_credentials recorded as a list, [] for "none", never a
    // placeholder. It measures that the question was answered, not how strong the
    // credential is; the note gives the share answered with [].
    const crossIds = classifyTiers({ structure, dataFlows, dataItems }).crossBoundaryFlowIds
    let crossBoundaryFlows = 0
    let crossBoundaryWithCreds = 0
    let crossBoundaryEmpty = 0
    for (const flow of dataFlows) {
      if (!crossIds.has(flow.id)) continue
      crossBoundaryFlows++
      const values = ((attributes.dataFlows?.[flow.id] as any)?.attributes ?? {}) as Record<string, unknown>
      const rc = values.required_credentials
      if (Object.prototype.hasOwnProperty.call(values, 'required_credentials') && Array.isArray(rc) &&
        !isStandIn(rc) && !isPlaceholderList(rc)) {
        crossBoundaryWithCreds++
        if (rc.length === 0) crossBoundaryEmpty++
      }
    }
    const credentialCoverageRate = crossBoundaryFlows > 0
      ? crossBoundaryWithCreds / crossBoundaryFlows : 0
    const credentialCoverageNote = crossBoundaryWithCreds > 0
      ? `${crossBoundaryEmpty} of ${crossBoundaryWithCreds} answered flows record no credential ([])`
      : undefined

    // Credential hints: items whose class suggests a credential while is_credential is unanswered. A hint only;
    // an answered false is respected, and the score does not depend on it.
    const credentialHints = dataItems.flatMap(di => {
      if (di.is_credential !== undefined) return []
      const reason = credentialClassHint(di.classData)
      return reason ? [{ id: di.id, name: di.name, class: di.classData?.name ?? di.classData?.id ?? '', reason }] : []
    })

    // Scan for expired compensating controls
    const warnings: string[] = []

    // An unreadable attribute file silently lowers every factor that reads it.
    // Say so, or the score drop looks like unfinished enrichment.
    for (const issue of attributeIssues) {
      warnings.push(
        `${issue.file} could not be read — it is counted as unenriched, ` +
        `which lowers the score. Fix or restore the file; the next push may overwrite it.`,
      )
    }
    const today = new Date().toISOString().slice(0, 10)

    const scanControls = (controls: any[] | undefined): void => {
      if (!controls) return
      for (const ctrl of controls) {
        const comp = (ctrl as any).compensating
        if (comp?.expires && comp.expires < today) {
          const name = ctrl.name || 'Unnamed control'
          const origReq = comp.original_requirement
            ? ` (original requirement: ${comp.original_requirement})` : ''
          warnings.push(
            `Compensating control '${name}' expired on ${comp.expires}${origReq}. Review or remove.`
          )
        }
      }
    }

    const scanBoundary = (b: any): void => {
      scanControls(b.controls)
      if (b.components) for (const c of b.components) scanControls(c.controls)
      if (b.boundaries) for (const nested of b.boundaries) scanBoundary(nested)
    }
    scanBoundary(structure.defaultBoundary)
    for (const flow of dataFlows) scanControls(flow.controls)
    for (const item of dataItems) scanControls(item.controls)

    // Compute total score (0-100)
    const score =
      componentClassificationRate * 25 +
      attributeCompletionRate * 20 +
      boundaryHierarchyQuality * 15 +
      dataFlowCoverage * 15 +
      dataClassificationRate * 10 +
      controlCoverageRate * 10 +
      credentialCoverageRate * 5

    const roundedScore = Math.round(score * 100) / 100

    let label: string
    if (roundedScore >= 90) label = 'Comprehensive'
    else if (roundedScore >= 70) label = 'Good'
    else if (roundedScore >= 40) label = 'In Progress'
    else label = 'Starting'

    return {
      success: true,
      data: {
        quality_score: roundedScore,
        label,
        factors: {
          component_classification_rate: { value: componentClassificationRate, weight: 25 },
          attribute_completion_rate: {
            value: attributeCompletionRate, weight: 20,
            ...(attributeCompletionNote ? { note: attributeCompletionNote } : {}),
          },
          boundary_hierarchy_quality: { value: boundaryHierarchyQuality, weight: 15 },
          data_flow_coverage: { value: dataFlowCoverage, weight: 15 },
          data_classification_rate: { value: dataClassificationRate, weight: 10 },
          control_coverage_rate: { value: controlCoverageRate, weight: 10, ...(controlCoverageNote ? { note: controlCoverageNote } : {}) },
          credential_coverage_rate: { value: credentialCoverageRate, weight: 5, ...(credentialCoverageNote ? { note: credentialCoverageNote } : {}) }
        },
        element_counts: {
          boundaries: totalBoundaries,
          components: totalComponents,
          data_flows: dataFlows.length,
          data_items: totalDataItems
        },
        attribute_residual: attributeResidual,
        model_name: manifest.model.name,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(credentialHints.length > 0 ? { credential_hints: credentialHints } : {})
      }
    }
  }

  private async computeCoverage(
    input: ValidateInput,
    context: ToolContext
  ): Promise<ToolResult<CoverageOutput>> {
    // Online mode: model_id + apolloClient available
    if (input.model_id && context.apolloClient) {
      try {
        const dtControl = new DtControl(context.apolloClient)
        const result = await dtControl.controlGaps({
          modelId: input.model_id,
          topN: 3,
          limit: 50,
        })

        // Also read local files for inferred coverage and source breakdown
        let inferred_coverage: InferredCategoryBreakdown | undefined
        let formal_coverage: FormalTierBreakdown | undefined
        let source_breakdown: SourceBreakdown | undefined
        let readWarnings: string[] = []
        const localDir = input.directory_path ? await validatePathConfinement(input.directory_path).catch(() => null) : null
        if (localDir && await pathExists(localDir) && await isModelDirectory(localDir)) {
          input.directory_path = localDir
          try {
            const localData = await this.computeLocalCoverageBreakdown(input.directory_path)
            inferred_coverage = localData.inferred_coverage
            formal_coverage = localData.formal_coverage
            source_breakdown = localData.source_breakdown
            readWarnings = this.coverageReadWarnings(localData.attribute_issues)
          } catch (err) {
            // The platform result stands; only the local breakdown is lost.
            readWarnings = [`The local model could not be read, so the per-tier breakdown is omitted (${safeErrorMessage(err)}).`]
          }
        }

        return {
          success: true,
          data: {
            mode: 'online',
            coverage_summary: {
              total_exposures: result.coverageSummary.totalExposures,
              mitigated: result.coverageSummary.mitigated,
              unmitigated: result.coverageSummary.unmitigated,
              unaddressable: result.coverageSummary.unaddressable,
              configured_coverage: result.coverageSummary.configuredCoverage,
              no_mitre_chain: result.coverageSummary.noMitreChain,
              coverage_pct: result.coverageSummary.coveragePct,
            },
            ...(inferred_coverage ? { inferred_coverage } : {}),
            ...(formal_coverage ? { formal_coverage } : {}),
            ...(source_breakdown ? { source_breakdown } : {}),
            details: result,
          },
          ...(readWarnings.length > 0 ? { warnings: readWarnings } : {}),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch control gaps',
        }
      }
    }

    // Offline mode: directory_path only
    if (input.directory_path) {
      input.directory_path = await validatePathConfinement(input.directory_path)
      if (!await pathExists(input.directory_path)) {
        return { success: false, error: `Directory not found: ${input.directory_path}` }
      }
      if (!await isModelDirectory(input.directory_path)) {
        return { success: false, error: `Not a valid model directory: ${input.directory_path}` }
      }

      let localData: Awaited<ReturnType<ValidateModelTool['computeLocalCoverageBreakdown']>>
      try {
        localData = await this.computeLocalCoverageBreakdown(input.directory_path)
      } catch (err) {
        return { success: false, error: `Coverage needs a readable model (${safeErrorMessage(err)}).` }
      }
      const classifiedCount = localData.classified_count
      const coveredCount = localData.covered_count

      return {
        success: true,
        data: {
          mode: 'offline',
          // Offline coverage measures ASSIGNMENT — which exposures have a
          // control assigned to their element — not mitigation. A control with
          // zero countermeasures still counts here, so an "X/X, 100%" offline
          // result must never be reported as "X exposures mitigated". The
          // coverage_kind label makes that explicit to every consumer.
          // Value space (closed set): 'assignment-heuristic' here; the
          // authenticated/online path reports authoritative MITRE-chain
          // coverage and does not set this field.
          coverage_kind: 'assignment-heuristic',
          coverage_summary: {
            total_exposures: classifiedCount,
            mitigated: coveredCount,
            unmitigated: classifiedCount - coveredCount,
            unaddressable: 0,
            coverage_pct: classifiedCount > 0 ? Math.round((coveredCount / classifiedCount) * 10000) / 100 : 0,
          },
          inferred_coverage: localData.inferred_coverage,
          formal_coverage: localData.formal_coverage,
          ...(localData.source_breakdown ? { source_breakdown: localData.source_breakdown } : {}),
        },
        warnings: [
          ...this.coverageReadWarnings(localData.attribute_issues),
          'Offline mode reports ASSIGNMENT coverage (which exposures have a control assigned to their element), NOT mitigation. A control with zero countermeasures still counts as assigned, so do not report this as "exposures mitigated". Use model_id with authentication for authoritative MITRE-chain mitigation coverage.',
        ],
      }
    }

    return {
      success: false,
      error: 'Coverage requires either model_id (online, with authentication) or directory_path (offline estimate)',
    }
  }

  /**
   * Compute per-category inferred coverage, per-tier formal coverage, and source breakdown
   * from local model files.
   */
  private async computeLocalCoverageBreakdown(dirPath: string): Promise<{
    classified_count: number
    covered_count: number
    inferred_coverage: InferredCategoryBreakdown
    formal_coverage: FormalTierBreakdown
    source_breakdown: SourceBreakdown | undefined
    attribute_issues: AttributeReadIssue[]
  }> {
    // The gates' own read of the model, so coverage and the gates can never disagree on a tier.
    const input = await loadGateInput(dirPath)
    const { structure, dataFlows, dataItems, attributes } = input
    // An attribute file that cannot be read contributes nothing to coverage,
    // which is indistinguishable from an element that genuinely has no security
    // attributes — it drags the percentage down and names no cause. Coverage is
    // read-only so nothing is destroyed here, but the number is wrong and the
    // operator has to be told why.
    const attributeIssues: AttributeReadIssue[] = input.attributeIssues
    const tiering = classifyTiers({ structure, dataFlows, dataItems, crownJewelIds: crownJewelIds(input.scope.scope) })
    const { components } = flattenStructure(structure)
    const internal = components.filter((c) => !tiering.externals.has(c.id))
    // The population: non-external components classified in the structure, the gates' rule.
    const classified = internal.filter((c) => !!c.classData?.id)
    const classifiedIds = new Set(classified.map((c) => c.id))
    const controlCoverageSet = this.buildControlCoverageSet(structure.defaultBoundary, dataFlows)

    // Per-category inferred coverage
    const auth: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const encTransit: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const encRest: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const monitoring: CategoryCoverage = { covered: 0, total: 0, missing: [] }

    const bucket = (): TierCoverage => ({ total: 0, with_controls: 0, gaps: [], gaps_total: 0, unclassified: 0 })
    const byTier = { 1: bucket(), 2: bucket(), 3: bucket() }
    const tierBucket = (id: string): TierCoverage => byTier[(tiering.tierOf.get(id) ?? 3) as Tier]
    const crownJewels = bucket()
    const crossBoundary = bucket()
    const crossIds = crossBoundaryComponentIds(tiering, dataFlows)
    const add = (b: TierCoverage, id: string, name: string, hasControl: boolean) => {
      b.total++
      if (hasControl) { b.with_controls++; return }
      b.gaps_total++
      if (b.gaps.length < MAX_FAILING) b.gaps.push({ id, ...(name ? { name } : {}) })
    }
    for (const c of internal) {
      if (!classifiedIds.has(c.id)) {
        tierBucket(c.id).unclassified++
        if (c.crownJewel === true) crownJewels.unclassified++
        if (crossIds.has(c.id)) crossBoundary.unclassified++
      }
    }

    let coveredCount = 0
    for (const c of classified) {
      const compId = c.id
      const compAttrs = attributes.components?.[compId] as any
      const compName = c.name || compId

      // Per-category inferred coverage
      const categories = this.getAttributeCategories(compAttrs)
      auth.total++
      monitoring.total++
      if (categories.authentication) { auth.covered++ } else { auth.missing.push(compName) }
      // A component that stores nothing, and may say so, has no data at rest to cover.
      const restValue = compAttrs?.attributes?.encryption_at_rest ?? compAttrs?.encryption_at_rest
      if (!(isNotApplicable(restValue) && mayAnswerNotApplicable(c, input.classTemplates.templates))) {
        encRest.total++
        if (categories.encryption_at_rest) { encRest.covered++ } else { encRest.missing.push(compName) }
      }
      if (categories.monitoring) { monitoring.covered++ } else { monitoring.missing.push(compName) }

      // Check if component has any positive attribute or formal control
      const hasPositive = this.hasPositiveSecurityAttribute(compAttrs)
      const hasFormalControl = controlCoverageSet.has(compId)
      if (hasPositive || hasFormalControl) coveredCount++

      add(tierBucket(compId), compId, c.name, hasFormalControl)
      if (c.crownJewel === true) add(crownJewels, compId, c.name, hasFormalControl)
      if (crossIds.has(compId)) add(crossBoundary, compId, c.name, hasFormalControl)
    }

    // The cross-boundary flows, with what each declares about its authentication.
    const crossFlows = dataFlows.filter((f) => tiering.crossBoundaryFlowIds.has(f.id))
    const cross_boundary_flows = crossFlows.slice(0, MAX_FAILING).map((f) => {
      const fa = attributes.dataFlows?.[f.id] as any
      const values = (fa?.attributes ?? fa ?? {}) as Record<string, unknown>
      return { id: f.id, ...(f.name ? { name: f.name } : {}), authentication: flowAuthentication(values) }
    })

    // Encryption in transit: per cross-boundary flow, the gates' own set. A transit alias the flow's class
    // declares counts as C3 counts it; the literal answer must name encryption.
    for (const flow of dataFlows) {
      if (!tiering.crossBoundaryFlowIds.has(flow.id)) continue
      encTransit.total++
      const flowAttrs = attributes.dataFlows?.[flow.id] as any
      const values = (flowAttrs?.attributes ?? flowAttrs ?? {}) as Record<string, unknown>
      const template = flow.classData?.id ? input.classTemplates.templates.get(flow.classData.id) : undefined
      const alias = !!template && TRANSIT_ALIASES.some((k) => template.fields.includes(k) && values[k] === true)
      if (encryptionClaim(values.encryption_in_transit, 'transit') === 'affirms' || alias) {
        encTransit.covered++
      } else {
        encTransit.missing.push(flow.name || flow.id)
      }
    }

    // Source breakdown from control references
    const source_breakdown = this.computeSourceBreakdown(structure.defaultBoundary, dataFlows, dataItems)

    return {
      classified_count: classifiedIds.size,
      covered_count: coveredCount,
      inferred_coverage: {
        authentication: auth,
        encryption_transit: encTransit,
        encryption_at_rest: encRest,
        monitoring,
      },
      formal_coverage: {
        tier_1_internet_facing: byTier[1],
        tier_2_crown_jewel_or_restricted: byTier[2],
        tier_3_internal: byTier[3],
        labels: { crown_jewels: crownJewels, cross_boundary: crossBoundary },
        cross_boundary_flows,
        cross_boundary_flows_total: crossFlows.length,
        externals_excluded: tiering.externals.size,
        tier_3_unzoned: internal.filter((c) => tiering.tierOf.get(c.id) === 3 && tiering.unzoned.includes(c.id)).length,
      },
      source_breakdown: source_breakdown.discovered + source_breakdown.declared + source_breakdown.both > 0
        ? source_breakdown : undefined,
      attribute_issues: attributeIssues,
    }
  }

  /** Coverage is computed over what could be read; say so when that is not everything. */
  private coverageReadWarnings(issues: readonly AttributeReadIssue[] | undefined): string[] {
    // A warning helper is never allowed to be the reason a report fails.
    return (issues ?? []).map(
      (i) =>
        `${i.file} could not be read. Its security attributes are absent from this ` +
        `coverage calculation, so the figures below understate coverage by an unknown amount.`,
    )
  }

  /**
   * True only if `monitoring_tools` lists at least one real tool.
   *
   * The "no monitoring" sentinel `["None"]` (prescribed historically, now
   * discouraged) is a non-empty array, so a naive `length > 0` check counts a
   * blind component as monitored and masks a zero-detection environment.
   * Filter out the case-insensitive `none` / `n/a` / empty placeholders before
   * deciding.
   */
  private hasRealMonitoring(monTools: unknown): boolean {
    if (!Array.isArray(monTools)) return false
    const sentinels = new Set(['none', 'n/a', 'na', ''])
    return monTools.some(
      t => typeof t === 'string' && !sentinels.has(t.trim().toLowerCase()),
    )
  }

  /**
   * Get per-category security attribute results (unlike hasPositiveSecurityAttribute which returns a single boolean).
   */
  private getAttributeCategories(attrs: any): {
    authentication: boolean
    encryption_at_rest: boolean
    monitoring: boolean
  } {
    // A placeholder ("unknown", "") is no evidence of a control.
    const get = (key: string): unknown => {
      const value = attrs?.attributes?.[key] ?? attrs?.[key] ?? null
      return isStandIn(value) ? null : value
    }

    const encInTransit = get('encryption_in_transit')
    const encAtRest = get('encryption_at_rest')
    const authType = get('authentication_type')
    const monTools = get('monitoring_tools')

    const authentication = (() => {
      if (!authenticationClaimed(authType)) return false
      const authLower = normToken(authType as string)
      // Basic and digest credentials count only over encryption.
      if (authLower === 'basic' || authLower === 'digest') return encryptionClaim(encInTransit, 'transit') === 'affirms'
      return true
    })()

    // Only an answer that names encryption counts; "not applicable", "none" or a placeholder is no evidence.
    const encryption_at_rest = encryptionClaim(encAtRest, 'rest') === 'affirms'

    const monitoring = this.hasRealMonitoring(monTools)

    return { authentication, encryption_at_rest, monitoring }
  }

  /**
   * Count controls by source field (discovered/declared/both) from structure, flows and data items.
   */
  private computeSourceBreakdown(boundary: any, dataFlows: any[], dataItems: any[]): SourceBreakdown {
    const result: SourceBreakdown = { discovered: 0, declared: 0, both: 0 }

    const countControls = (controls: any[] | undefined) => {
      if (!Array.isArray(controls)) return
      for (const ctrl of controls) {
        const src = ctrl.source?.toLowerCase()
        if (src === 'discovered') result.discovered++
        else if (src === 'both') result.both++
        else if (ctrl.id || ctrl.name) result.declared++ // default to declared
      }
    }

    const walkBoundary = (b: any): void => {
      countControls(b.controls)
      if (b.components) {
        for (const c of b.components) countControls(c.controls)
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) walkBoundary(nested)
      }
    }
    walkBoundary(boundary)

    for (const flow of dataFlows) {
      countControls(flow.controls)
    }
    for (const item of dataItems) {
      countControls(item.controls)
    }

    return result
  }

  private countClassifiedComponents(boundary: any): number {
    let count = 0
    const process = (b: any): void => {
      if (b.components) {
        for (const c of b.components) {
          if (c.classData?.id) count++
        }
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) {
          process(nested)
        }
      }
    }
    process(boundary)
    return count
  }

  private getBoundaryDepth(boundary: any): number {
    if (!boundary.boundaries || boundary.boundaries.length === 0) return 1
    let maxChildDepth = 0
    for (const nested of boundary.boundaries) {
      maxChildDepth = Math.max(maxChildDepth, this.getBoundaryDepth(nested))
    }
    return 1 + maxChildDepth
  }

  private hasSingleChildBoundary(boundary: any): boolean {
    // Check if any non-root boundary has exactly one child (component or boundary)
    const checkNested = (b: any, isRoot: boolean): boolean => {
      if (b.boundaries) {
        for (const nested of b.boundaries) {
          const childCount =
            (nested.components?.length || 0) + (nested.boundaries?.length || 0)
          if (childCount === 1) return true
          if (checkNested(nested, false)) return true
        }
      }
      return false
    }
    return checkNested(boundary, true)
  }

  /**
   * Check if an element's attributes contain at least one positive security attribute.
   * Uses the mapping table in CONTROL_INTEGRATION.md, "Quality score from attributes".
   */
  private hasPositiveSecurityAttribute(attrs: any): boolean {
    // A placeholder ("unknown", "") is no evidence of a control.
    const get = (key: string): unknown => {
      const value = attrs?.attributes?.[key] ?? attrs?.[key] ?? null
      return isStandIn(value) ? null : value
    }

    const encInTransit = get('encryption_in_transit')
    const encAtRest = get('encryption_at_rest')
    const authType = get('authentication_type')
    const monTools = get('monitoring_tools')
    const implDeny = get('implicit_deny_enabled')

    // Encryption counts only where the answer names it (see encryptionClaim).
    if (encryptionClaim(encInTransit, 'transit') === 'affirms') return true
    if (encryptionClaim(encAtRest, 'rest') === 'affirms') return true

    // authentication_type: named authentication; basic/digest only over encryption
    if (authenticationClaimed(authType)) {
      const authLower = normToken(authType as string)
      if (authLower !== 'basic' && authLower !== 'digest') return true
      if (encryptionClaim(encInTransit, 'transit') === 'affirms') return true
    }

    // monitoring_tools: at least one real tool (the ["None"] sentinel doesn't count)
    if (this.hasRealMonitoring(monTools)) {
      return true
    }

    // implicit_deny_enabled: true
    if (implDeny === true) {
      return true
    }

    return false
  }

  /**
   * Build a set of element IDs that have control coverage (directly or boundary-inherited).
   * Walks the boundary tree propagating controls[] downward.
   */
  private buildControlCoverageSet(boundary: any, dataFlows: any[]): Set<string> {
    const coveredIds = new Set<string>()

    const propagate = (b: any, parentHasControls: boolean): void => {
      const hasOwnControls = Array.isArray(b.controls) && b.controls.length > 0
      const hasControls = hasOwnControls || parentHasControls

      if (b.id && hasControls) coveredIds.add(b.id)

      if (b.components) {
        for (const comp of b.components) {
          const compHasOwnControls = Array.isArray(comp.controls) && comp.controls.length > 0
          if (compHasOwnControls || hasControls) {
            coveredIds.add(comp.id)
          }
        }
      }

      if (b.boundaries) {
        for (const nested of b.boundaries) {
          propagate(nested, hasControls)
        }
      }
    }

    propagate(boundary, false)

    for (const flow of dataFlows) {
      if (Array.isArray(flow.controls) && flow.controls.length > 0) {
        coveredIds.add(flow.id)
      }
    }

    return coveredIds
  }

  /**
   * Collect IDs of classified components from both attribute files and inline structure.
   */
  private collectClassifiedComponentIds(boundary: any, attributes: any): Set<string> {
    const ids = new Set<string>()

    const process = (b: any): void => {
      if (b.components) {
        for (const c of b.components) {
          if (c.classData?.id) {
            ids.add(c.id)
          } else if (attributes.components?.[c.id] &&
                     (attributes.components[c.id] as any).classData?.id) {
            ids.add(c.id)
          }
        }
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) process(nested)
      }
    }

    process(boundary)
    return ids
  }

  private async validateDirectory(dirPath: string, settlement?: SettlementMode): Promise<ToolResult<ValidateOutput>> {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Check directory exists
    if (!await pathExists(dirPath)) {
      return {
        success: true,
        data: {
          valid: false,
          errors: [{ file: dirPath, message: 'Directory not found' }],
          warnings: []
        }
      }
    }

    // Check it's a model directory
    if (!await isModelDirectory(dirPath)) {
      return {
        success: true,
        data: {
          valid: false,
          errors: [{ file: dirPath, message: 'Not a valid model directory (missing manifest.json)' }],
          warnings: []
        }
      }
    }

    // Validate manifest
    try {
      const manifest = await readManifest(dirPath)
      const result = ManifestSchema.safeParse(manifest)
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            file: 'manifest.json',
            path: issue.path.join('.'),
            message: issue.message
          })
        }
      }
    } catch (e) {
      errors.push({
        file: 'manifest.json',
        message: `Failed to read: ${safeErrorMessage(e)}`
      })
    }

    // Validate structure
    let allComponentIds = new Set<string>()
    let allBoundaryIds = new Set<string>()
    let validatedStructure: Awaited<ReturnType<typeof readStructure>> | undefined
    let validatedDataFlows: Awaited<ReturnType<typeof readDataFlows>> | undefined
    let validatedDataItems: Awaited<ReturnType<typeof readDataItems>> | undefined
    try {
      const structure = await readStructure(dirPath)
      validatedStructure = structure
      const result = StructureSchema.safeParse(structure)
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            file: 'structure.json',
            path: issue.path.join('.'),
            message: issue.message
          })
        }
      }
      // Collect all component and boundary IDs for reference validation
      allComponentIds = this.collectComponentIds(structure.defaultBoundary)
      allBoundaryIds = this.collectBoundaryIds(structure.defaultBoundary)

      // Conduit peerId integrity — a conduit is a boundary↔boundary edge, so its peer must be a known
      // boundary (tested against allBoundaryIds ONLY, unlike the flow-ref check which also allows a
      // component endpoint). A self-conduit (peerId === own id) validates as a "known" boundary but is
      // silently dropped by the write path's dedupeByPeer, so flag it here to keep validate and write in sync.
      const conduitBoundaries = flattenStructure(structure).boundaries
      // The write path is OUTBOUND-canonical: each physical edge is persisted once from its source's
      // OUTBOUND conduit; an INBOUND conduit is only the read-side mirror. So an INBOUND conduit whose
      // peer carries no matching OUTBOUND back would be silently dropped on write — flag it (validate
      // rejects exactly what write can't persist). Lone-OUTBOUND is fine (write persists it; the inbound
      // view is re-derived on read).
      const outboundEdges = new Set<string>()
      for (const boundary of conduitBoundaries) {
        for (const conduit of boundary.conduits ?? []) {
          if (conduit.direction === 'OUTBOUND') outboundEdges.add(`${boundary.id}->${conduit.peerId}`)
        }
      }
      for (const boundary of conduitBoundaries) {
        for (const conduit of boundary.conduits ?? []) {
          if (conduit.peerId === boundary.id) {
            errors.push({
              file: 'structure.json',
              path: `${boundary.name || boundary.id}.conduits.${conduit.peerId}`,
              message: `Self-conduit: boundary references itself as a conduit peer (${conduit.peerId})`
            })
          } else if (!allBoundaryIds.has(conduit.peerId)) {
            errors.push({
              file: 'structure.json',
              path: `${boundary.name || boundary.id}.conduits.${conduit.peerId}`,
              message: `Invalid conduit peerId: ${conduit.peerId} not found in structure`
            })
          } else if (conduit.direction === 'INBOUND' && !outboundEdges.has(`${conduit.peerId}->${boundary.id}`)) {
            errors.push({
              file: 'structure.json',
              path: `${boundary.name || boundary.id}.conduits.${conduit.peerId}`,
              message: `Lone inbound conduit: peer ${conduit.peerId} declares no matching outbound conduit to this boundary (asymmetric; the write would drop it)`
            })
          }
        }
      }
    } catch (e) {
      errors.push({
        file: 'structure.json',
        message: `Failed to read: ${safeErrorMessage(e)}`
      })
    }

    // Validate data flows
    const allDataFlowIds = new Set<string>()
    try {
      const dataFlows = await readDataFlows(dirPath)
      validatedDataFlows = dataFlows
      for (const flow of dataFlows) {
        const result = DataFlowSchema.safeParse(flow)
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              file: 'dataflows.json',
              path: `${flow.id || 'unknown'}.${issue.path.join('.')}`,
              message: issue.message
            })
          }
        }
        if (flow.id) {
          allDataFlowIds.add(flow.id)
        }

        // Validate source/target references
        if (flow.source?.id && !allComponentIds.has(flow.source.id) && !allBoundaryIds.has(flow.source.id)) {
          errors.push({
            file: 'dataflows.json',
            path: `${flow.name || flow.id}.source`,
            message: `Invalid source reference: ${flow.source.id} not found in structure`
          })
        }
        if (flow.target?.id && !allComponentIds.has(flow.target.id) && !allBoundaryIds.has(flow.target.id)) {
          errors.push({
            file: 'dataflows.json',
            path: `${flow.name || flow.id}.target`,
            message: `Invalid target reference: ${flow.target.id} not found in structure`
          })
        }
      }
    } catch (e) {
      errors.push({
        file: 'dataflows.json',
        message: `Failed to read: ${safeErrorMessage(e)}`
      })
    }

    // Validate data items
    const allDataItemIds = new Set<string>()
    try {
      const dataItems = await readDataItems(dirPath)
      validatedDataItems = dataItems
      for (const item of dataItems) {
        const result = DataItemSchema.safeParse(item)
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              file: 'data-items.json',
              path: `${item.id || 'unknown'}.${issue.path.join('.')}`,
              message: issue.message
            })
          }
        }
        if (item.id) {
          allDataItemIds.add(item.id)
        }
      }
    } catch (e) {
      errors.push({
        file: 'data-items.json',
        message: `Failed to read: ${safeErrorMessage(e)}`
      })
    }

    // Validate attributes
    try {
      const normCtx = validatedStructure && validatedDataFlows && validatedDataItems
        ? { structure: validatedStructure, dataFlows: validatedDataFlows, dataItems: validatedDataItems }
        : undefined
      // An unparseable attribute file must fail validation. readAttributes
      // swallows per-file parse errors so it never throws, which meant the
      // catch below could not fire and `valid: true` was returned for a model
      // with a truncated file — the exact failure a full-file overwrite by the
      // enricher produces, and the one this validator exists to catch.
      const attributeIssues: AttributeReadIssue[] = []
      const attributes = await readAttributes(dirPath, normCtx, attributeIssues)
      for (const issue of attributeIssues) {
        errors.push({ file: issue.file, message: 'Attribute file could not be read (invalid JSON or unreadable)' })
      }
      const result = AttributesSchema.safeParse(attributes)
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            file: 'attributes/',
            path: issue.path.join('.'),
            message: issue.message
          })
        }
      }

      // Validate attribute references
      const allElementIds = new Set([...allComponentIds, ...allBoundaryIds, ...allDataFlowIds, ...allDataItemIds])

      for (const [elementId] of Object.entries(attributes.boundaries || {})) {
        if (!allBoundaryIds.has(elementId)) {
          warnings.push({
            file: 'attributes/boundaries/',
            message: `Attribute file references unknown boundary: ${elementId}`
          })
        }
      }
      for (const [elementId] of Object.entries(attributes.components || {})) {
        if (!allComponentIds.has(elementId)) {
          warnings.push({
            file: 'attributes/components/',
            message: `Attribute file references unknown component: ${elementId}`
          })
        }
      }

      // Component type vs the assigned class's declared type.
      //
      // A component declares PROCESS | STORE | EXTERNAL_ENTITY, and so does each
      // ComponentClass. Classification asks `match_classes` once per component
      // type with `componentType`, its only hard type filter (an element's own
      // `type` only shapes the vector query). Nothing at write time holds a run to
      // that: a call that mixes types, or a class chosen by hand, can bind a STORE
      // to a PROCESS class, which then evaluates its policy against a thing it does
      // not describe. This check makes such a mismatch visible.
      //
      // A warning, not an error: the cache can be stale or predate this field,
      // and only the platform is authoritative about the binding.
      if (validatedStructure) {
        const { templates: classTypes } = await readClassTemplates(dirPath)
        const checkTypes = (b: StructureBoundary): void => {
          for (const c of b.components ?? []) {
            const classId = c.classData?.id
            if (!classId || !c.type) continue
            const known = classTypes.get(classId)
            if (!known?.componentType) continue
            if (known.componentType !== c.type) {
              warnings.push({
                file: 'structure.json',
                message:
                  `Component "${c.name || c.id}" is type ${c.type}, but its class ` +
                  `"${known.name}" describes a ${known.componentType}. Either the component type ` +
                  `or the class assignment is wrong — the class's policy is written for a ` +
                  `${known.componentType}.`,
              })
            }
          }
          for (const nested of b.boundaries ?? []) checkTypes(nested)
        }
        checkTypes(validatedStructure.defaultBoundary)
      }
      for (const [elementId] of Object.entries(attributes.dataFlows || {})) {
        if (!allDataFlowIds.has(elementId)) {
          warnings.push({
            file: 'attributes/dataFlows/',
            message: `Attribute file references unknown data flow: ${elementId}`
          })
        }
      }
      for (const [elementId] of Object.entries(attributes.dataItems || {})) {
        if (!allDataItemIds.has(elementId)) {
          warnings.push({
            file: 'attributes/dataItems/',
            message: `Attribute file references unknown data item: ${elementId}`
          })
        }
      }

    } catch (e) {
      // Attributes directory is optional
      warnings.push({
        file: 'attributes/',
        message: `Could not read attributes: ${safeErrorMessage(e)}`
      })
    }

    // --- Control library validation ---
    // controls/<id>.json files hold the per-Control state (attributes,
    // platformAttributes, pendingEdit, lifecycle). Validate each against the
    // `validateControlFile` rules, then surface orphan and missing-file
    // cross-reference warnings against the model's controls[] arrays.
    try {
      const controlFileIds = await listControlFiles(dirPath)

      const referencedControlIds = new Set<string>()
      const collectControlRefs = (b: any): void => {
        if (Array.isArray(b?.controls)) {
          for (const c of b.controls) if (c?.id) referencedControlIds.add(c.id)
        }
        if (Array.isArray(b?.components)) {
          for (const comp of b.components) {
            if (Array.isArray(comp?.controls)) {
              for (const c of comp.controls) if (c?.id) referencedControlIds.add(c.id)
            }
          }
        }
        if (Array.isArray(b?.boundaries)) {
          for (const nested of b.boundaries) collectControlRefs(nested)
        }
      }
      if (validatedStructure) collectControlRefs(validatedStructure.defaultBoundary)
      for (const holder of [...(validatedDataFlows ?? []), ...(validatedDataItems ?? [])]) {
        if (Array.isArray((holder as any).controls)) {
          for (const c of (holder as any).controls) if (c?.id) referencedControlIds.add(c.id)
        }
      }

      for (const controlId of controlFileIds) {
        try {
          const controlFile = await readControlFile(dirPath, controlId)
          if (!controlFile) continue
          const result = validateControlFile(controlFile)
          for (const err of result.errors) {
            errors.push({ file: `controls/${controlId}.json`, message: err })
          }
          for (const warn of result.warnings) {
            warnings.push({ file: `controls/${controlId}.json`, message: warn })
          }
        } catch (e) {
          errors.push({
            file: `controls/${controlId}.json`,
            message: `Failed to read/parse: ${safeErrorMessage(e)}`,
          })
        }
      }

      for (const fileId of controlFileIds) {
        if (!referencedControlIds.has(fileId)) {
          warnings.push({
            file: `controls/${fileId}.json`,
            message: `Orphan control file: ${fileId} (no reference in structure, dataflows or data-items)`,
          })
        }
      }

      const controlFileIdSet = new Set(controlFileIds)
      for (const refId of referencedControlIds) {
        if (!controlFileIdSet.has(refId)) {
          warnings.push({
            file: 'controls/',
            message: `Missing control file: ${refId} (referenced but not pulled)`,
          })
        }
      }
    } catch (e) {
      warnings.push({
        file: 'controls/',
        message: `Could not enumerate control files: ${safeErrorMessage(e)}`,
      })
    }

    // Lints (the same ones Gate 2 applies). A model the gate loader refuses is
    // already invalid above, so they are skipped rather than failing the call.
    try {
      const gates = computeGates(await loadGateInput(dirPath, { settlement }), await storedWaivers(dirPath))
      for (const finding of gates.lints) {
        const file = finding.file ?? (finding.element ? `element ${finding.element.name ?? finding.element.id}` : 'model')
        if (finding.severity === 'error') errors.push({ file, message: `${finding.rule}: ${finding.message}` })
        else warnings.push({ file, message: `${finding.severity === 'info' ? 'info: ' : ''}${finding.rule}: ${finding.message}` })
      }
    } catch {
      // Reported by the checks above.
    }

    return {
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings: collapseWarnings(warnings),
      }
    }
  }

  private async validateInlineData(
    data: string | Record<string, any>,
    fileType?: FileType
  ): Promise<ToolResult<ValidateOutput>> {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Parse data if it's a string
    let parsedData: any
    if (typeof data === 'string') {
      try {
        parsedData = JSON.parse(data)
      } catch (e) {
        return {
          success: true,
          data: {
            valid: false,
            errors: [{ file: 'inline', message: `Invalid JSON: ${(e as Error).message}` }],
            warnings: []
          }
        }
      }
    } else {
      parsedData = data
    }

    // Get the appropriate schema based on file_type
    const schema = this.getSchema(fileType)
    const result = schema.safeParse(parsedData)

    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          file: fileType || 'inline',
          path: issue.path.join('.'),
          message: issue.message
        })
      }
    }

    return {
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings
      }
    }
  }

  private collectComponentIds(boundary: any): Set<string> {
    const ids = new Set<string>()

    const process = (b: any): void => {
      if (b.components) {
        for (const c of b.components) {
          if (c.id) ids.add(c.id)
        }
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) {
          process(nested)
        }
      }
    }

    process(boundary)
    return ids
  }

  private collectBoundaryIds(boundary: any): Set<string> {
    const ids = new Set<string>()

    const process = (b: any): void => {
      if (b.id) ids.add(b.id)
      if (b.boundaries) {
        for (const nested of b.boundaries) {
          process(nested)
        }
      }
    }

    process(boundary)
    return ids
  }

  private getSchema(fileType?: FileType): z.ZodType {
    switch (fileType) {
      case 'manifest':
        return ManifestSchema
      case 'structure':
        return StructureSchema
      case 'dataflows':
        return z.array(DataFlowSchema)
      case 'data-items':
        return z.array(DataItemSchema)
      case 'attributes':
        return AttributesSchema
      default:
        // For complete SplitModel validation
        return z.object({
          manifest: ManifestSchema,
          structure: StructureSchema,
          dataFlows: z.array(DataFlowSchema),
          dataItems: z.array(DataItemSchema),
          attributes: AttributesSchema.optional()
        })
    }
  }
}

// Export singleton instance
export const validateModelTool = new ValidateModelTool()
