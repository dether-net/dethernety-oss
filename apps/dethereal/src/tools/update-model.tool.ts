/**
 * Update Model Tool
 *
 * Updates an existing threat model in the Dethernety platform from a split-file directory.
 * Uses DtUpdateSplit from dt-core for API communication.
 *
 * Directory structure expected:
 * model-directory/
 * ├── manifest.json       # Model metadata, modules
 * ├── structure.json      # Boundaries & components (no attributes)
 * ├── dataflows.json      # All data flows
 * ├── data-items.json     # All data items
 * └── attributes/         # Per-element attributes
 *     ├── boundaries/
 *     ├── components/
 *     ├── dataFlows/
 *     └── dataItems/
 *
 * After update, the model is exported back to the source directory.
 */

import { z } from 'zod'
import { DtUpdateSplit, DtExportSplit, type UpdateProgress } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  readModelDirectory,
  writeModelDirectory,
  createDirectoryBackup,
  isModelDirectory,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'

const InputSchema = z.object({
  model_id: z.string().describe('The ID of the model to update'),
  directory_path: z.string().describe('Path to the model directory containing updated data'),
  delete_orphaned: z.boolean().optional().describe('Whether to delete elements not present in the update data (default: true)'),
  create_backup: z.boolean().optional().describe('Create a timestamped backup of the directory before update (default: true)'),
  disable_source_file_update: z.boolean().optional().describe('Disable automatic export back to source directory after update (default: false)')
})

type UpdateInput = z.infer<typeof InputSchema>

interface UpdateOutput {
  model_id: string
  name: string
  stats: {
    created: number
    updated: number
    deleted: number
  }
  warnings: string[]
  backup_path?: string
  source_files_updated: boolean
}

export class UpdateModelTool extends ClientDependentTool<UpdateInput, UpdateOutput> {
  readonly name = 'update_model'
  readonly description = 'Update an existing threat model in your Dethernety platform instance. This synchronizes the model with new JSON data, creating/updating/deleting elements as needed. Supports reading from file or inline JSON data.'
  readonly inputSchema = InputSchema

  async execute(input: UpdateInput, context: ToolContext): Promise<ToolResult<UpdateOutput>> {
    const config = getConfig()
    const createBackup = input.create_backup !== false

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      // Validate directory exists
      if (!await pathExists(input.directory_path)) {
        return {
          success: false,
          error: `Directory not found: ${input.directory_path}`
        }
      }

      // Validate it's a model directory
      if (!await isModelDirectory(input.directory_path)) {
        return {
          success: false,
          error: `Not a valid model directory (missing manifest.json): ${input.directory_path}`
        }
      }

      let backupPath: string | undefined

      // Create backup before processing
      if (createBackup) {
        try {
          backupPath = await createDirectoryBackup(input.directory_path)
          debugLog(config, `Created backup at: ${backupPath}`)
        } catch (error) {
          debugLog(config, `Failed to create backup: ${error}`)
          // Continue without backup but warn
        }
      }

      // Read the split model from directory
      debugLog(config, `Reading model from directory: ${input.directory_path}`)
      const splitModel = await readModelDirectory(input.directory_path)

      debugLog(config, `Updating model: ${input.model_id}`)

      // Use DtUpdateSplit from dt-core
      const dtUpdateSplit = new DtUpdateSplit(context.apolloClient)

      const result = await dtUpdateSplit.updateFromSplitModel(input.model_id, splitModel, {
        deleteOrphaned: input.delete_orphaned !== false, // Default to true
        onProgress: (progress: UpdateProgress) => {
          debugLog(config, `Update progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (!result.success) {
        return {
          success: false,
          error: `Update failed: ${result.errors.map((e: { error: string }) => e.error).join(', ')}`
        }
      }

      let sourceFilesUpdated = false

      // Export back to source directory if update is not disabled
      if (!input.disable_source_file_update) {
        try {
          const dtExportSplit = new DtExportSplit(context.apolloClient)
          const exportedModel = await dtExportSplit.exportModelToSplit(input.model_id)
          await writeModelDirectory(input.directory_path, exportedModel)
          sourceFilesUpdated = true
          debugLog(config, `Updated source directory with current state`)
        } catch (error) {
          debugLog(config, `Failed to update source directory: ${error}`)
          result.warnings.push(`Could not update source directory: ${error}`)
        }
      }

      return {
        success: true,
        data: {
          model_id: input.model_id,
          name: result.model?.name || splitModel.manifest.model.name || 'Unknown',
          stats: {
            created: result.stats.created,
            updated: result.stats.updated,
            deleted: result.stats.deleted
          },
          warnings: result.warnings,
          backup_path: backupPath,
          source_files_updated: sourceFilesUpdated
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Update failed'
      }
    }
  }
}

// Export singleton instance
export const updateModelTool = new UpdateModelTool()
