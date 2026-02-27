/**
 * Export Model Tool
 *
 * Exports a threat model from the Dethernety platform to split-file directory format.
 * Uses DtExportSplit from dt-core for API communication.
 *
 * By default, exports to a directory named after the model ID in the current
 * working directory. Use directory_path to specify a custom location.
 *
 * Directory structure:
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
 */

import { z } from 'zod'
import path from 'path'
import { DtExportSplit } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  writeModelDirectory,
  createDirectoryBackup,
  isModelDirectory,
  ensureModelDirectoryStructure,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'

const InputSchema = z.object({
  model_id: z.string().describe('The ID of the model to export'),
  directory_path: z.string().optional()
    .describe('Path to export the model directory. If not provided, creates a directory named after the model ID in the current working directory.'),
  if_exists: z.enum(['backup', 'update', 'error']).optional()
    .describe("Action if directory exists: 'backup' creates timestamped copy, 'update' overwrites, 'error' fails (default: 'backup')")
})

type ExportInput = z.infer<typeof InputSchema>

interface ExportOutput {
  model_id: string
  name?: string
  directory_path: string
  backup_path?: string
  files_written: string[]
}

export class ExportModelTool extends ClientDependentTool<ExportInput, ExportOutput> {
  readonly name = 'export_model'
  readonly description = 'Export a threat model from your Dethernety platform instance to JSON format. This retrieves the complete model structure including components, boundaries, data flows, and security configurations. Can export to a file or return as JSON string.'
  readonly inputSchema = InputSchema

  async execute(input: ExportInput, context: ToolContext): Promise<ToolResult<ExportOutput>> {
    const config = getConfig()
    const ifExists = input.if_exists || 'backup'

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      // Determine directory path: use provided path or default to model ID
      const directoryPath = input.directory_path || path.join(process.cwd(), input.model_id)

      debugLog(config, `Exporting model: ${input.model_id} to directory: ${directoryPath}`)

      // Check if directory exists
      const dirExists = await pathExists(directoryPath)
      let backupPath: string | undefined

      if (dirExists) {
        const isModel = await isModelDirectory(directoryPath)

        if (ifExists === 'error') {
          return {
            success: false,
            error: `Directory already exists: ${directoryPath}. Use if_exists='backup' or 'update' to overwrite.`
          }
        }

        if (ifExists === 'backup' && isModel) {
          // Create timestamped backup
          backupPath = await createDirectoryBackup(directoryPath)
          debugLog(config, `Created backup at: ${backupPath}`)
        }
      }

      // Use DtExportSplit from dt-core
      const dtExportSplit = new DtExportSplit(context.apolloClient)
      const splitModel = await dtExportSplit.exportModelToSplit(input.model_id)

      if (!splitModel) {
        return {
          success: false,
          error: `Model with ID ${input.model_id} not found`
        }
      }

      // Ensure directory structure exists
      await ensureModelDirectoryStructure(directoryPath)

      // Write split model to directory
      await writeModelDirectory(directoryPath, splitModel)
      debugLog(config, `Exported model to directory: ${directoryPath}`)

      const filesWritten = [
        'manifest.json',
        'structure.json',
        'dataflows.json',
        'data-items.json',
        'attributes/',
      ]

      return {
        success: true,
        data: {
          model_id: input.model_id,
          name: splitModel.manifest.model.name,
          directory_path: directoryPath,
          backup_path: backupPath,
          files_written: filesWritten
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed'
      }
    }
  }
}

// Export singleton instance
export const exportModelTool = new ExportModelTool()
