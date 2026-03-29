/**
 * Import Model Tool
 *
 * Imports a threat model from a split-file directory into the Dethernety platform.
 * Uses DtImportSplit from dt-core for API communication.
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
 * After import, server-generated IDs are written back to the source files.
 */

import { z } from 'zod'
import { DtImportSplit, type ImportProgress } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  readModelDirectory,
  createDirectoryBackup,
  isModelDirectory,
  applyIdMapping,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'
import { writeSyncJson, computeContentHash, collectBaselineElementIds } from '../utils/sync-utils.js'

const InputSchema = z.object({
  directory_path: z.string().describe('Path to the model directory to import'),
  folder_id: z.string().optional().describe('Optional folder ID to organize the imported model'),
  create_backup: z.boolean().optional().describe('Create a timestamped backup of the directory before import (default: true)'),
  disable_source_file_update: z.boolean().optional().describe('Disable automatic update of the source files with server-generated IDs (default: false)')
})

type ImportInput = z.infer<typeof InputSchema>

interface ImportOutput {
  model_id: string
  name: string
  description?: string
  warnings: string[]
  backup_path?: string
  source_files_updated: boolean
  id_mappings_count: number
}

export class ImportModelTool extends ClientDependentTool<ImportInput, ImportOutput> {
  readonly name = 'import_model'
  readonly description = 'Import a pre-validated threat model JSON into your Dethernety platform instance for security analysis and visualization'
  readonly inputSchema = InputSchema

  async execute(input: ImportInput, context: ToolContext): Promise<ToolResult<ImportOutput>> {
    const config = getConfig()
    const createBackup = input.create_backup !== false

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      // Validate path confinement
      await validatePathConfinement(input.directory_path)

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

      debugLog(config, `Importing model: ${splitModel.manifest.model.name}`)

      // Use DtImportSplit from dt-core
      const dtImportSplit = new DtImportSplit(context.apolloClient)

      const result = await dtImportSplit.importSplitModel(splitModel, {
        folderId: input.folder_id,
        onProgress: (progress: ImportProgress) => {
          debugLog(config, `Import progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (!result.success || !result.model) {
        return {
          success: false,
          error: `Import failed: ${result.errors.map((e: { error: string }) => e.error).join(', ')}`
        }
      }

      let sourceFilesUpdated = false

      // Write server-generated IDs back to source files
      if (!input.disable_source_file_update && result.idMapping.size > 0) {
        try {
          await applyIdMapping(input.directory_path, result.idMapping, result.model.id)
          sourceFilesUpdated = true
          debugLog(config, `Updated source files with ${result.idMapping.size} ID mappings`)
        } catch (error) {
          debugLog(config, `Failed to update source files: ${error}`)
          result.warnings.push(`Could not update source files with server IDs: ${error}`)
        }
      }

      // Write sync.json for push metadata
      try {
        const contentHash = await computeContentHash(input.directory_path)
        const baselineIds = await collectBaselineElementIds(input.directory_path)
        await writeSyncJson(input.directory_path, {
          platform_model_id: result.model.id,
          platform_url: config.baseUrl,
          last_push_at: new Date().toISOString(),
          push_content_hash: contentHash,
          baseline_element_ids: baselineIds,
        })
      } catch (syncError) {
        debugLog(config, `Failed to write sync.json: ${syncError}`)
      }

      return {
        success: true,
        data: {
          model_id: result.model.id,
          name: result.model.name || splitModel.manifest.model.name || 'Unknown',
          description: result.model.description || undefined,
          warnings: result.warnings,
          backup_path: backupPath,
          source_files_updated: sourceFilesUpdated,
          id_mappings_count: result.idMapping.size
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Import failed'
      }
    }
  }
}

// Export singleton instance
export const importModelTool = new ImportModelTool()
