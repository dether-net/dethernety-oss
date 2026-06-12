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
} from '@dethernety/dt-core'
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

const StructureSchema = z.object({
  defaultBoundary: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    dimensionsWidth: z.number().optional(),
    dimensionsHeight: z.number().optional(),
    boundaries: z.array(z.any()).optional(),
    components: z.array(z.any()).optional()
  })
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
  classData: z.object({
    id: z.string(),
    name: z.string()
  }).optional(),
  // Asset-context fields (snake_case local). Flag *values* are free-text — not enumed.
  sensitivity: z.enum(['restricted', 'confidential', 'internal', 'public']).optional(),
  regulatory_flags: z.array(z.string()).optional()
})

const AttributesSchema = z.object({
  boundaries: z.record(z.string(), z.any()).optional(),
  components: z.record(z.string(), z.any()).optional(),
  dataFlows: z.record(z.string(), z.any()).optional(),
  dataItems: z.record(z.string(), z.any()).optional()
})

const FileTypeEnum = z.enum(['manifest', 'structure', 'dataflows', 'data-items', 'attributes'])
type FileType = z.infer<typeof FileTypeEnum>

const ActionEnum = z.enum(['validate', 'quality', 'coverage']).optional().default('validate')

const InputSchema = z.object({
  action: ActionEnum.describe("Action: 'validate' checks schema/references, 'quality' computes quality score (0-100), 'coverage' analyzes control coverage"),
  directory_path: z.string().optional().describe('Path to model directory to validate (validates entire directory)'),
  model_id: z.string().optional().describe('Model ID for online coverage analysis (requires authentication)'),
  data: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('JSON data to validate (string or object)'),
  file_type: FileTypeEnum.optional().describe('Type of file to validate when using data parameter')
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
}

interface ValidateOutput {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  files_validated?: string[]
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
  model_name: string
  warnings?: string[]
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
  total: number
  with_controls: number
  gaps: string[]
}

interface FormalTierBreakdown {
  tier_1_crown_jewels: TierCoverage
  tier_2_cross_boundary: TierCoverage
  tier_3_internet_facing: TierCoverage
  tier_4_internal: TierCoverage
}

interface SourceBreakdown {
  discovered: number
  declared: number
  both: number
}

interface CoverageOutput {
  mode: 'online' | 'offline'
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

export class ValidateModelTool extends ClientFreeTool<ValidateInput, ValidateOutput | QualityOutput | CoverageOutput> {
  readonly name = 'validate_model_json'
  readonly description = 'Validate a threat model JSON structure, compute a quality score (0-100), or analyze control coverage. Use action "validate" for schema checks, "quality" for enrichment progress, or "coverage" for control gap analysis.'
  readonly inputSchema = InputSchema

  async execute(input: ValidateInput, context: ToolContext): Promise<ToolResult<ValidateOutput | QualityOutput | CoverageOutput>> {
    try {
      // Coverage action
      if (input.action === 'coverage') {
        return await this.computeCoverage(input, context)
      }

      // Quality score action
      if (input.action === 'quality') {
        if (!input.directory_path) {
          return { success: false, error: 'directory_path is required for quality action' }
        }
        await validatePathConfinement(input.directory_path)
        return await this.computeQuality(input.directory_path)
      }

      // Validate path confinement if directory path provided
      if (input.directory_path) {
        await validatePathConfinement(input.directory_path)
        return await this.validateDirectory(input.directory_path)
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
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }
    }
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
    const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems })

    const allComponentIds = this.collectComponentIds(structure.defaultBoundary)
    const allBoundaryIds = this.collectBoundaryIds(structure.defaultBoundary)
    const totalComponents = allComponentIds.size
    const totalBoundaries = allBoundaryIds.size

    // Build component-to-boundary mapping for cross-boundary flow detection
    const componentBoundaryMap = this.buildComponentBoundaryMap(structure.defaultBoundary)

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
    // Data items are first-class enrichable elements (DATA class templates →
    // attributes/dataItems/<id>.json), so they count in the same factor —
    // otherwise a model with fully unenriched data items still scores 100%
    // here. Component-only models are unaffected (dataItems.length adds 0).
    const componentAttrCount = Object.keys(attributes.components || {}).length
    const dataItemAttrCount = Object.keys(attributes.dataItems || {}).length
    const attributeDenominator = totalComponents + dataItems.length
    const attributeCompletionRate = attributeDenominator > 0
      ? Math.min((componentAttrCount + dataItemAttrCount) / attributeDenominator, 1.0) : 0

    // Factor 3: boundary_hierarchy_quality (weight 15)
    // Three conditions, each +0.33:
    // (a) Hierarchy depth >= 2
    // (b) No boundary contains only one child
    // (c) No external entities share boundary with internal components
    let bhq = 0
    const maxDepth = this.getBoundaryDepth(structure.defaultBoundary)
    if (maxDepth >= 2) bhq += 0.33
    if (totalBoundaries === 0 || !this.hasSingleChildBoundary(structure.defaultBoundary)) bhq += 0.33
    // Condition (c): simplified — check if all components share boundary type correctly
    // For V1, award this point by default since we can't distinguish external entities
    bhq += 0.34 // round to 1.0 when all conditions met
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
      controlCoverageNote = 'No security attributes or controls found on classified elements'
    }

    // Factor 7: credential_coverage_rate (weight 5)
    // Percentage of cross-boundary data flows with credential_type set (not "none")
    let crossBoundaryFlows = 0
    let crossBoundaryWithCreds = 0
    for (const flow of dataFlows) {
      const sourceBoundary = componentBoundaryMap.get(flow.source?.id || '')
      const targetBoundary = componentBoundaryMap.get(flow.target?.id || '')
      if (sourceBoundary && targetBoundary && sourceBoundary !== targetBoundary) {
        crossBoundaryFlows++
        const flowAttrs = attributes.dataFlows?.[flow.id]
        if (flowAttrs) {
          const credType = (flowAttrs as any).credential_type || (flowAttrs as any).attributes?.credential_type
          if (credType && credType !== 'none') {
            crossBoundaryWithCreds++
          }
        }
      }
    }
    const credentialCoverageRate = crossBoundaryFlows > 0
      ? crossBoundaryWithCreds / crossBoundaryFlows : 0

    // Scan for expired compensating controls
    const warnings: string[] = []
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
          attribute_completion_rate: { value: attributeCompletionRate, weight: 20 },
          boundary_hierarchy_quality: { value: boundaryHierarchyQuality, weight: 15 },
          data_flow_coverage: { value: dataFlowCoverage, weight: 15 },
          data_classification_rate: { value: dataClassificationRate, weight: 10 },
          control_coverage_rate: { value: controlCoverageRate, weight: 10, ...(controlCoverageNote ? { note: controlCoverageNote } : {}) },
          credential_coverage_rate: { value: credentialCoverageRate, weight: 5 }
        },
        element_counts: {
          boundaries: totalBoundaries,
          components: totalComponents,
          data_flows: dataFlows.length,
          data_items: totalDataItems
        },
        model_name: manifest.model.name,
        ...(warnings.length > 0 ? { warnings } : {})
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
        if (input.directory_path && await pathExists(input.directory_path) && await isModelDirectory(input.directory_path)) {
          await validatePathConfinement(input.directory_path)
          const localData = await this.computeLocalCoverageBreakdown(input.directory_path)
          inferred_coverage = localData.inferred_coverage
          formal_coverage = localData.formal_coverage
          source_breakdown = localData.source_breakdown
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
      await validatePathConfinement(input.directory_path)
      if (!await pathExists(input.directory_path)) {
        return { success: false, error: `Directory not found: ${input.directory_path}` }
      }
      if (!await isModelDirectory(input.directory_path)) {
        return { success: false, error: `Not a valid model directory: ${input.directory_path}` }
      }

      const localData = await this.computeLocalCoverageBreakdown(input.directory_path)
      const classifiedCount = localData.classified_count
      const coveredCount = localData.covered_count

      return {
        success: true,
        data: {
          mode: 'offline',
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
          'Offline mode: coverage estimated from local attributes and controls. Use model_id with authentication for authoritative MITRE-chain coverage analysis.',
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
  }> {
    const structure = await readStructure(dirPath)
    const dataFlows = await readDataFlows(dirPath)
    const dataItems = await readDataItems(dirPath)
    const attributes = await readAttributes(dirPath, { structure, dataFlows, dataItems })

    const classifiedIds = this.collectClassifiedComponentIds(structure.defaultBoundary, attributes)
    const controlCoverageSet = this.buildControlCoverageSet(structure.defaultBoundary, dataFlows)
    const componentBoundaryMap = this.buildComponentBoundaryMap(structure.defaultBoundary)

    // Per-category inferred coverage
    const auth: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const encTransit: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const encRest: CategoryCoverage = { covered: 0, total: 0, missing: [] }
    const monitoring: CategoryCoverage = { covered: 0, total: 0, missing: [] }

    // Per-tier formal coverage
    type TierKey = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4'
    const tiers: Record<TierKey, TierCoverage> = {
      tier_1: { total: 0, with_controls: 0, gaps: [] },
      tier_2: { total: 0, with_controls: 0, gaps: [] },
      tier_3: { total: 0, with_controls: 0, gaps: [] },
      tier_4: { total: 0, with_controls: 0, gaps: [] },
    }

    // Identify cross-boundary and internet-facing components for tier assignment
    const crossBoundaryIds = new Set<string>()
    const internetFacingIds = new Set<string>()
    const externalEntityIds = new Set<string>()

    // Crown jewels are a first-class structure.json field (Component.crownJewel).
    const crownJewelIds = new Set<string>()

    // Collect external entity IDs (and crown-jewel IDs) from the structure tree.
    const collectExternals = (b: any): void => {
      if (b.components) {
        for (const c of b.components) {
          if (c.type === 'EXTERNAL_ENTITY') externalEntityIds.add(c.id)
          if (c.crownJewel === true) crownJewelIds.add(c.id)
        }
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) collectExternals(nested)
      }
    }
    collectExternals(structure.defaultBoundary)

    // Identify cross-boundary and internet-facing from flows
    for (const flow of dataFlows) {
      const srcBoundary = flow.source?.id ? componentBoundaryMap.get(flow.source.id) : undefined
      const tgtBoundary = flow.target?.id ? componentBoundaryMap.get(flow.target.id) : undefined
      if (srcBoundary && tgtBoundary && srcBoundary !== tgtBoundary) {
        if (flow.source?.id) crossBoundaryIds.add(flow.source.id)
        if (flow.target?.id) crossBoundaryIds.add(flow.target.id)
      }
      if (flow.source?.id && externalEntityIds.has(flow.source.id) && flow.target?.id) {
        internetFacingIds.add(flow.target.id)
      }
      if (flow.target?.id && externalEntityIds.has(flow.target.id) && flow.source?.id) {
        internetFacingIds.add(flow.source.id)
      }
    }

    let coveredCount = 0

    for (const compId of classifiedIds) {
      const compAttrs = attributes.components?.[compId] as any
      const compName = this.getComponentName(structure.defaultBoundary, compId) || compId

      // Per-category inferred coverage
      const categories = this.getAttributeCategories(compAttrs)
      auth.total++
      encRest.total++
      monitoring.total++
      if (categories.authentication) { auth.covered++ } else { auth.missing.push(compName) }
      if (categories.encryption_at_rest) { encRest.covered++ } else { encRest.missing.push(compName) }
      if (categories.monitoring) { monitoring.covered++ } else { monitoring.missing.push(compName) }

      // Check if component has any positive attribute or formal control
      const hasPositive = this.hasPositiveSecurityAttribute(compAttrs)
      const hasFormalControl = controlCoverageSet.has(compId)
      if (hasPositive || hasFormalControl) coveredCount++

      // Per-tier formal coverage — assign to highest priority tier only
      const isCrownJewel = crownJewelIds.has(compId)
      let tier: TierKey
      if (isCrownJewel) {
        tier = 'tier_1'
      } else if (crossBoundaryIds.has(compId)) {
        tier = 'tier_2'
      } else if (internetFacingIds.has(compId)) {
        tier = 'tier_3'
      } else {
        tier = 'tier_4'
      }
      tiers[tier].total++
      if (hasFormalControl) {
        tiers[tier].with_controls++
      } else {
        tiers[tier].gaps.push(compName)
      }
    }

    // Encryption in transit: per cross-boundary flow
    for (const flow of dataFlows) {
      const srcBoundary = flow.source?.id ? componentBoundaryMap.get(flow.source.id) : undefined
      const tgtBoundary = flow.target?.id ? componentBoundaryMap.get(flow.target.id) : undefined
      if (srcBoundary && tgtBoundary && srcBoundary !== tgtBoundary) {
        encTransit.total++
        const flowAttrs = attributes.dataFlows?.[flow.id] as any
        const encValue = flowAttrs?.encryption_in_transit ?? flowAttrs?.attributes?.encryption_in_transit
        const deprecatedTransit = new Set(['none', 'sslv3', 'ssl v3', 'tls 1.0', 'tls1.0'])
        if (encValue && typeof encValue === 'string' && !deprecatedTransit.has(encValue.toLowerCase())) {
          encTransit.covered++
        } else {
          encTransit.missing.push(flow.name || flow.id)
        }
      }
    }

    // Source breakdown from control references
    const source_breakdown = this.computeSourceBreakdown(structure.defaultBoundary, dataFlows)

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
        tier_1_crown_jewels: tiers.tier_1,
        tier_2_cross_boundary: tiers.tier_2,
        tier_3_internet_facing: tiers.tier_3,
        tier_4_internal: tiers.tier_4,
      },
      source_breakdown: source_breakdown.discovered + source_breakdown.declared + source_breakdown.both > 0
        ? source_breakdown : undefined,
    }
  }

  /**
   * Get per-category security attribute results (unlike hasPositiveSecurityAttribute which returns a single boolean).
   */
  private getAttributeCategories(attrs: any): {
    authentication: boolean
    encryption_at_rest: boolean
    monitoring: boolean
  } {
    const get = (key: string): unknown =>
      attrs?.attributes?.[key] ?? attrs?.[key] ?? null

    const encInTransit = get('encryption_in_transit')
    const encAtRest = get('encryption_at_rest')
    const authType = get('authentication_type')
    const monTools = get('monitoring_tools')

    const deprecatedTransit = new Set(['none', 'sslv3', 'ssl v3', 'tls 1.0', 'tls1.0'])
    const deprecatedAtRest = new Set(['none', 'des', '3des', 'triple-des', 'rc4'])

    const authentication = (() => {
      if (!authType || typeof authType !== 'string' || authType.toLowerCase() === 'none') return false
      const authLower = authType.toLowerCase()
      if (authLower === 'basic' || authLower === 'digest') {
        return !!(encInTransit && typeof encInTransit === 'string' &&
          !deprecatedTransit.has(encInTransit.toLowerCase()))
      }
      return true
    })()

    const encryption_at_rest = !!(encAtRest && typeof encAtRest === 'string' &&
      !deprecatedAtRest.has(encAtRest.toLowerCase()))

    const monitoring = !!(Array.isArray(monTools) && monTools.length > 0)

    return { authentication, encryption_at_rest, monitoring }
  }

  /**
   * Get component name from boundary tree by ID.
   */
  private getComponentName(boundary: any, targetId: string): string | undefined {
    if (boundary.components) {
      for (const c of boundary.components) {
        if (c.id === targetId) return c.name
      }
    }
    if (boundary.boundaries) {
      for (const nested of boundary.boundaries) {
        const found = this.getComponentName(nested, targetId)
        if (found) return found
      }
    }
    return undefined
  }

  /**
   * Count controls by source field (discovered/declared/both) from structure and flows.
   */
  private computeSourceBreakdown(boundary: any, dataFlows: any[]): SourceBreakdown {
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

  private buildComponentBoundaryMap(boundary: any): Map<string, string> {
    const map = new Map<string, string>()
    const process = (b: any, boundaryId: string): void => {
      if (b.components) {
        for (const c of b.components) {
          if (c.id) map.set(c.id, boundaryId)
        }
      }
      if (b.boundaries) {
        for (const nested of b.boundaries) {
          process(nested, nested.id || boundaryId)
        }
      }
    }
    process(boundary, boundary.id || 'root')
    return map
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
   * Uses the mapping table from CONTROL_INTEGRATION.md §10 Phase 1.
   */
  private hasPositiveSecurityAttribute(attrs: any): boolean {
    const get = (key: string): unknown =>
      attrs?.attributes?.[key] ?? attrs?.[key] ?? null

    const encInTransit = get('encryption_in_transit')
    const encAtRest = get('encryption_at_rest')
    const authType = get('authentication_type')
    const monTools = get('monitoring_tools')
    const implDeny = get('implicit_deny_enabled')

    const deprecatedTransit = new Set(['none', 'sslv3', 'ssl v3', 'tls 1.0', 'tls1.0'])
    const deprecatedAtRest = new Set(['none', 'des', '3des', 'triple-des', 'rc4'])

    // encryption_in_transit: not none/null/absent/SSLv3/TLS 1.0
    if (encInTransit && typeof encInTransit === 'string' &&
        !deprecatedTransit.has(encInTransit.toLowerCase())) {
      return true
    }

    // encryption_at_rest: not none/null/absent/DES/3DES/RC4
    if (encAtRest && typeof encAtRest === 'string' &&
        !deprecatedAtRest.has(encAtRest.toLowerCase())) {
      return true
    }

    // authentication_type: not none/null/absent; basic/digest only with adequate encryption
    if (authType && typeof authType === 'string' && authType.toLowerCase() !== 'none') {
      const authLower = authType.toLowerCase()
      if (authLower === 'basic' || authLower === 'digest') {
        const hasAdequateEncryption = encInTransit && typeof encInTransit === 'string' &&
          !deprecatedTransit.has(encInTransit.toLowerCase())
        if (hasAdequateEncryption) return true
      } else {
        return true
      }
    }

    // monitoring_tools: non-empty array
    if (Array.isArray(monTools) && monTools.length > 0) {
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

  private async validateDirectory(dirPath: string): Promise<ToolResult<ValidateOutput>> {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []
    const filesValidated: string[] = []

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
      filesValidated.push('manifest.json')
    } catch (e) {
      errors.push({
        file: 'manifest.json',
        message: `Failed to read: ${(e as Error).message}`
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
      filesValidated.push('structure.json')
    } catch (e) {
      errors.push({
        file: 'structure.json',
        message: `Failed to read: ${(e as Error).message}`
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
      filesValidated.push('dataflows.json')
    } catch (e) {
      errors.push({
        file: 'dataflows.json',
        message: `Failed to read: ${(e as Error).message}`
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
      filesValidated.push('data-items.json')
    } catch (e) {
      errors.push({
        file: 'data-items.json',
        message: `Failed to read: ${(e as Error).message}`
      })
    }

    // Validate attributes
    try {
      const normCtx = validatedStructure && validatedDataFlows && validatedDataItems
        ? { structure: validatedStructure, dataFlows: validatedDataFlows, dataItems: validatedDataItems }
        : undefined
      const attributes = await readAttributes(dirPath, normCtx)
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

      filesValidated.push('attributes/')
    } catch (e) {
      // Attributes directory is optional
      warnings.push({
        file: 'attributes/',
        message: `Could not read attributes: ${(e as Error).message}`
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
      if (validatedDataFlows) {
        for (const flow of validatedDataFlows) {
          if (Array.isArray((flow as any).controls)) {
            for (const c of (flow as any).controls) if (c?.id) referencedControlIds.add(c.id)
          }
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
            message: `Failed to read/parse: ${(e as Error).message}`,
          })
        }
      }

      if (controlFileIds.length > 0) {
        filesValidated.push(`controls/ (${controlFileIds.length} files)`)
      }

      for (const fileId of controlFileIds) {
        if (!referencedControlIds.has(fileId)) {
          warnings.push({
            file: `controls/${fileId}.json`,
            message: `Orphan control file: ${fileId} (no reference in structure or dataflows)`,
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
        message: `Could not enumerate control files: ${(e as Error).message}`,
      })
    }

    return {
      success: true,
      data: {
        valid: errors.length === 0,
        errors,
        warnings,
        files_validated: filesValidated
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
