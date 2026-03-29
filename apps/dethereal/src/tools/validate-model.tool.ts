/**
 * Validate Model Tool
 *
 * Validates split-file model directory structure and cross-validates references.
 * Can validate entire directory or individual JSON data.
 */

import { z } from 'zod'
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
  }).optional()
})

const AttributesSchema = z.object({
  boundaries: z.record(z.string(), z.any()).optional(),
  components: z.record(z.string(), z.any()).optional(),
  dataFlows: z.record(z.string(), z.any()).optional(),
  dataItems: z.record(z.string(), z.any()).optional()
})

const FileTypeEnum = z.enum(['manifest', 'structure', 'dataflows', 'data-items', 'attributes'])
type FileType = z.infer<typeof FileTypeEnum>

const ActionEnum = z.enum(['validate', 'quality']).optional().default('validate')

const InputSchema = z.object({
  action: ActionEnum.describe("Action: 'validate' checks schema/references, 'quality' computes quality score (0-100)"),
  directory_path: z.string().optional().describe('Path to model directory to validate (validates entire directory)'),
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
}

export class ValidateModelTool extends ClientFreeTool<ValidateInput, ValidateOutput | QualityOutput> {
  readonly name = 'validate_model_json'
  readonly description = 'Validate a threat model JSON structure or compute a quality score (0-100). Use action "validate" for schema checks or "quality" for enrichment progress tracking.'
  readonly inputSchema = InputSchema

  async execute(input: ValidateInput, context: ToolContext): Promise<ToolResult<ValidateOutput | QualityOutput>> {
    try {
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
    const componentAttrCount = Object.keys(attributes.components || {}).length
    const attributeCompletionRate = totalComponents > 0
      ? Math.min(componentAttrCount / totalComponents, 1.0) : 0

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
    // Requires platform data — set to 0 when offline
    const controlCoverageRate = 0

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
          control_coverage_rate: { value: controlCoverageRate, weight: 10, note: 'Requires platform — 0 when offline' },
          credential_coverage_rate: { value: credentialCoverageRate, weight: 5 }
        },
        element_counts: {
          boundaries: totalBoundaries,
          components: totalComponents,
          data_flows: dataFlows.length,
          data_items: totalDataItems
        },
        model_name: manifest.model.name
      }
    }
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
