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
  writeScope,
  createDirectoryBackup,
  isModelDirectory,
  ensureModelDirectoryStructure,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'
import { computeContentHash, collectBaselineElementIds, readSyncJson } from '../utils/sync-utils.js'
import { baselineForSync, fingerprintSplitModel, recordSyncBaseline } from '../utils/platform-baseline.js'
import { registerModel, registerWarning } from '../utils/model-registry.js'
import { registerPulled, type Registration } from '../utils/settlement-writers.js'

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
  /** Whether the platform model was recorded for the next push's change check */
  platform_baseline: 'recorded' | 'not_recorded'
  /** Whether the directory is in the project's model registry (.dethernety/models.json) */
  registered: boolean
  /** The pulled values registered in this machine's settlement (not the project registry); absent when there was nothing to register */
  settlement_registration?: Registration
  warnings?: string[]
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

      // Validate model_id doesn't contain path traversal sequences
      if (input.model_id.includes('/') || input.model_id.includes('\\') || input.model_id.includes('..')) {
        return {
          success: false,
          error: 'Invalid model_id: must not contain path separators or traversal sequences'
        }
      }

      // Determine directory path: use provided path or default to model ID
      let directoryPath = input.directory_path || path.join(process.cwd(), input.model_id)

      // Validate path confinement for all paths (user-supplied or derived)
      directoryPath = await validatePathConfinement(directoryPath)

      debugLog(config, `Exporting model: ${input.model_id} to directory: ${directoryPath}`)

      // Check if directory exists
      const dirExists = await pathExists(directoryPath)
      let backupPath: string | undefined

      // A directory that holds another platform model is never exported over: its files would be
      // replaced by a different model's, whatever if_exists says. Checked before any backup or
      // platform call, so a refusal changes nothing.
      if (dirExists) {
        const linked = (await readSyncJson(directoryPath))?.platform_model_id
        if (typeof linked === 'string' && linked !== '' && linked !== input.model_id) {
          return {
            success: false,
            error: `Refused (directory_linked_to_other_model): ${directoryPath} holds platform model ${linked}, not ${input.model_id}. Pull into a new directory.`,
            data: { code: 'directory_linked_to_other_model', linked_model_id: linked } as never
          }
        }
      }

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
      // Taken from the export as returned, before the scope is moved out of it.
      const platformPrints = fingerprintSplitModel(splitModel)

      // Ensure directory structure exists
      await ensureModelDirectoryStructure(directoryPath)

      // Materialise model scope into .dethereal/scope.json (the single on-disk home) and
      // strip it from the manifest so manifest.json doesn't carry a stale duplicate.
      // writeScope runs unconditionally (with {} when the platform has no scope) so the
      // REPLACE mirror can clear any stale synced keys left on disk; it no-ops for a
      // scope-less model with no existing scope.json.
      const scope = splitModel.manifest.model.scope
      if (scope) delete splitModel.manifest.model.scope

      // Write split model to directory
      await writeModelDirectory(directoryPath, splitModel)
      await writeScope(directoryPath, scope ?? {})
      debugLog(config, `Exported model to directory: ${directoryPath}`)

      const filesWritten = [
        'manifest.json',
        'structure.json',
        'dataflows.json',
        'data-items.json',
        'attributes/',
        ...(scope ? ['.dethereal/scope.json'] : []),
      ]

      // Write sync.json for pull metadata, with the platform baseline the next push checks against
      const baseline = await baselineForSync(directoryPath, input.model_id, platformPrints)
      let syncFields: Parameters<typeof recordSyncBaseline>[1] = { platform_model_id: input.model_id, platform_url: config.baseUrl }
      try {
        syncFields = {
          ...syncFields,
          last_pull_at: new Date().toISOString(),
          pull_content_hash: await computeContentHash(directoryPath),
          baseline_element_ids: await collectBaselineElementIds(directoryPath),
        }
      } catch (syncError) {
        debugLog(config, `Failed to read the pulled directory for sync.json: ${syncError}`)
      }
      const recorded = await recordSyncBaseline(directoryPath, syncFields, baseline, 'pull')
      const platformBaseline = recorded.status
      // The values as pulled, registered for this platform model: exactly the model written (its scope moved out).
      const settled = await registerPulled(directoryPath, splitModel, { modelId: input.model_id, prints: platformPrints }, { settlement: context.settlement })
      // The pulled directory in the project's model registry (added, or its entry updated).
      const modelRegistry = await registerModel(directoryPath, { name: splitModel.manifest.model.name || input.model_id, source: 'pull' })
      const warnings = [
        ...(recorded.warning ? [recorded.warning] : []),
        ...(settled.warning ? [settled.warning] : []),
        ...(settled.status === 'failed' ? [`The pulled values were not registered (${settled.code ?? 'failed'}): they show as unregistered values until the operator settles them.`] : []),
        ...(modelRegistry.registered ? [] : [registerWarning(modelRegistry.code)]),
      ]

      return {
        success: true,
        data: {
          model_id: input.model_id,
          name: splitModel.manifest.model.name,
          directory_path: directoryPath,
          backup_path: backupPath,
          files_written: filesWritten,
          platform_baseline: platformBaseline,
          registered: modelRegistry.registered,
          ...(settled.status !== 'nothing' ? { settlement_registration: settled } : {}),
          ...(warnings.length ? { warnings } : {})
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
