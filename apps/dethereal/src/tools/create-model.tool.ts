/**
 * Create Threat Model Tool
 *
 * Creates and imports a threat model into the Dethernety platform from SplitModel format.
 * Optionally provides schema and example models to help with composition.
 * Uses DtImportSplit from dt-core for API communication.
 *
 * If directory_path is provided, exports the created model to that directory
 * with server-generated IDs written back to the files.
 */

import { z } from 'zod'
import { DtImportSplit, type ImportProgress, type SplitModel } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { getConfig, debugLog } from '../config.js'
import { getExample, ExampleType } from '../data/examples.js'
import { getSchemaTool } from './get-schema.tool.js'
import {
  writeModelDirectory,
  applyIdMapping,
  ensureModelDirectoryStructure,
  validatePathConfinement,
} from '../utils/directory-utils.js'

const ExampleTypeEnum = z.enum(['simple', 'web_app', 'api_service', 'database', 'microservices'])

const InputSchema = z.object({
  model: z.union([z.record(z.any()), z.string()]).describe('Complete threat model in SplitModel JSON structure or JSON string'),
  folder_id: z.string().optional().describe('Optional folder ID to organize the imported model'),
  directory_path: z.string().optional().describe('Optional directory path to write the created model with server-generated IDs'),
  include_schema: z.boolean().optional().describe('Include the current schema in the response to help with model composition (default: true)'),
  include_example: z.boolean().optional().describe('Include a relevant example model in the response (default: true)'),
  example_type: ExampleTypeEnum.optional().describe('Type of example model to include (default: simple)')
})

type CreateInput = z.infer<typeof InputSchema>

interface CreateOutput {
  model_id?: string
  name?: string
  description?: string
  warnings?: string[]
  schema?: any
  example?: any
  directory_path?: string
  id_mappings_count?: number
}

export class CreateModelTool extends ClientDependentTool<CreateInput, CreateOutput> {
  readonly name = 'create_threat_model'
  readonly description = 'Create and import a threat model into the Dethernety platform. This tool automatically provides the current schema and example models to help you compose the threat model correctly before importing.'
  readonly inputSchema = InputSchema

  async execute(input: CreateInput, context: ToolContext): Promise<ToolResult<CreateOutput>> {
    const config = getConfig()

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      // Parse model data if it's a string
      let modelData: SplitModel
      if (typeof input.model === 'string') {
        try {
          modelData = JSON.parse(input.model)
        } catch (e) {
          return {
            success: false,
            error: `Invalid JSON model data: ${(e as Error).message}`
          }
        }
      } else {
        modelData = input.model as SplitModel
      }

      // Validate that it's a SplitModel structure
      if (!modelData.manifest || !modelData.structure) {
        return {
          success: false,
          error: 'Invalid model format. Expected SplitModel structure with manifest and structure fields.'
        }
      }

      // Prepare response with schema and example if requested
      const includeSchema = input.include_schema !== false
      const includeExample = input.include_example !== false
      const exampleType = (input.example_type || 'simple') as ExampleType

      let schema: any
      let example: any

      if (includeSchema) {
        // Get schema from the get-schema tool
        const schemaResult = await getSchemaTool.execute({}, context)
        if (schemaResult.success && schemaResult.data) {
          schema = schemaResult.data.schemas
        }
      }

      if (includeExample) {
        example = getExample(exampleType)
      }

      debugLog(config, `Creating model: ${modelData.manifest.model.name}`)

      // Use DtImportSplit from dt-core
      const dtImportSplit = new DtImportSplit(context.apolloClient)

      const result = await dtImportSplit.importSplitModel(modelData, {
        folderId: input.folder_id,
        onProgress: (progress: ImportProgress) => {
          debugLog(config, `Import progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (!result.success || !result.model) {
        return {
          success: false,
          error: `Model creation failed: ${result.errors.map((e: { error: string }) => e.error).join(', ')}`,
          data: {
            schema: includeSchema ? schema : undefined,
            example: includeExample ? example : undefined,
            warnings: result.warnings
          }
        }
      }

      let directoryWritten: string | undefined
      let idMappingsCount = result.idMapping.size

      // Write to directory if path provided
      if (input.directory_path) {
        validatePathConfinement(input.directory_path)
        try {
          // Ensure directory structure exists
          await ensureModelDirectoryStructure(input.directory_path)

          // Write the model with original IDs first
          await writeModelDirectory(input.directory_path, modelData)

          // Apply ID mappings to update with server-generated IDs
          await applyIdMapping(input.directory_path, result.idMapping, result.model.id)

          directoryWritten = input.directory_path
          debugLog(config, `Wrote model to directory: ${input.directory_path}`)
        } catch (error) {
          result.warnings.push(`Failed to write to directory: ${error}`)
          debugLog(config, `Failed to write to directory: ${error}`)
        }
      }

      return {
        success: true,
        data: {
          model_id: result.model.id,
          name: result.model.name,
          description: result.model.description || undefined,
          warnings: result.warnings,
          schema: includeSchema ? schema : undefined,
          example: includeExample ? example : undefined,
          directory_path: directoryWritten,
          id_mappings_count: idMappingsCount
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Model creation failed'
      }
    }
  }
}

// Export singleton instance
export const createModelTool = new CreateModelTool()
