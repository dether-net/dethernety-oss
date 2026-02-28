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

const InputSchema = z.object({
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

export class ValidateModelTool extends ClientFreeTool<ValidateInput, ValidateOutput> {
  readonly name = 'validate_model_json'
  readonly description = 'Validate a threat model JSON structure against the Dethernety schema without importing it into the platform'
  readonly inputSchema = InputSchema

  async execute(input: ValidateInput, context: ToolContext): Promise<ToolResult<ValidateOutput>> {
    try {
      // Validate path confinement if directory path provided
      if (input.directory_path) {
        validatePathConfinement(input.directory_path)
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
    try {
      const structure = await readStructure(dirPath)
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
    let allDataFlowIds = new Set<string>()
    try {
      const dataFlows = await readDataFlows(dirPath)
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
    let allDataItemIds = new Set<string>()
    try {
      const dataItems = await readDataItems(dirPath)
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
      const attributes = await readAttributes(dirPath)
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
