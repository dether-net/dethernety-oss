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
import { DtUpdateSplit, DtExportSplit, mergeAttributes, type UpdateProgress } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  readModelDirectory,
  readAttributes,
  protectedAttributeFiles,
  remapLocalSidecars,
  writeModelDirectory,
  readScope,
  writeScope,
  localOnlyCrownJewelNotice,
  createDirectoryBackup,
  isModelDirectory,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import type { AttributeReadIssue } from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'
import { writeSyncJson, readSyncJson, computeContentHash, collectBaselineElementIds } from '../utils/sync-utils.js'

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

      // Warnings raised before dt-core returns its result object, merged into
      // result.warnings once it exists.
      const preWarnings: string[] = []

      // Create backup before processing
      if (createBackup) {
        try {
          backupPath = await createDirectoryBackup(input.directory_path)
          debugLog(config, `Created backup at: ${backupPath}`)
        } catch (error) {
          debugLog(config, `Failed to create backup: ${error}`)
          // "Continue without backup but warn" — the warn was missing, so a
          // failed backup was reported only on the debug channel and the
          // response was indistinguishable from a successful one.
          preWarnings.push(
            `Backup could not be created (${error instanceof Error ? error.message : String(error)}). ` +
            `Proceeding without one — this push overwrites local files with no restore point.`,
          )
        }
      }

      // Read the split model from directory
      debugLog(config, `Reading model from directory: ${input.directory_path}`)
      // Collect read failures: a file that cannot be read is simply absent
      // from the bag that gets pushed, so without this the push reports success
      // having silently left that element's attributes behind.
      const readIssues: AttributeReadIssue[] = []
      const splitModel = await readModelDirectory(input.directory_path, readIssues)
      for (const issue of readIssues) {
        preWarnings.push(
          `${issue.file} could not be read (${issue.reason}) — its attributes were NOT pushed.`,
        )
      }

      // Attach the local scope (.dethereal/scope.json is not read by readModelDirectory)
      // so it publishes with the model. scope.json is the authoritative on-disk home.
      splitModel.manifest.model.scope = (await readScope(input.directory_path)) ?? undefined

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

      result.warnings.push(...preWarnings)

      // Surface crown-jewel marks on non-component elements (local-only; no platform field).
      // Computed from the local model we pushed, not the re-export below.
      const crownJewelNotice = localOnlyCrownJewelNotice(splitModel.attributes)
      if (crownJewelNotice) result.warnings.push(crownJewelNotice)

      let sourceFilesUpdated = false

      // Export back to source directory if update is not disabled
      if (!input.disable_source_file_update) {
        try {
          const dtExportSplit = new DtExportSplit(context.apolloClient)
          const exportedModel = await dtExportSplit.exportModelToSplit(input.model_id)

          // Preserve local attributes that the platform doesn't have.
          // Platform is the authority for attributes it knows about;
          // local files are preserved for attributes not yet pushed.
          // The normalization context is required, and the issue accumulator is
          // load-bearing here: a file missing from `localAttributes` is absent
          // from the merged bag, and writeModelDirectory's stale-file cleanup
          // then unlinks it. Without the context a flat-format file is skipped;
          // without the accumulator an unparseable one is skipped. Either way
          // the merge-back silently destroys local work.
          const attributeIssues: AttributeReadIssue[] = []
          const localAttributes = await readAttributes(
            input.directory_path,
            { structure: splitModel.structure, dataFlows: splitModel.dataFlows, dataItems: splitModel.dataItems },
            attributeIssues,
          )
          for (const issue of attributeIssues) {
            result.warnings.push(
              `${issue.file} could not be read (${issue.reason}) and is NOT in the merged result. ` +
              (backupPath
                ? `Restore it from the backup at ${backupPath} before re-running.`
                : `No backup was taken — restore it from version control before re-running.`),
            )
          }
          exportedModel.attributes = mergeAttributes(localAttributes, exportedModel.attributes)

          // Re-materialise scope.json from the post-push platform state and strip it from
          // the manifest (scope.json is the single on-disk home — same as the pull path).
          // writeScope runs unconditionally (with {} when the platform has no scope) so the
          // REPLACE mirror can clear any stale synced keys left on disk.
          const scope = exportedModel.manifest.model.scope
          if (scope) delete exportedModel.manifest.model.scope

          // Hand the read failures to the write so its stale-file cleanup does
          // not unlink them. Reporting the warning above is not enough on its
          // own: the very next statement is the write that would delete the
          // file the warning tells the operator to go and restore.
          await writeModelDirectory(input.directory_path, exportedModel, {
            protectedAttributeFiles: protectedAttributeFiles(attributeIssues),
          })
          // The write above just rewrote the model files with the platform's
          // ids, including the ids minted for elements created by this push.
          // The id-keyed sidecars under .dethereal/ still hold the local
          // reference ids and must follow. Only the create/import path used to
          // do this, so on an existing model every newly added element orphaned
          // its template-field manifest and its re-enrichment queue entry.
          //
          // Three things about the placement, each load-bearing:
          //  - inside `!disable_source_file_update`, because with the re-export
          //    off the files keep their local ids and remapping the sidecars
          //    would be the thing that broke them;
          //  - before writeScope, which throws on a malformed
          //    .dethereal/scope.json — after it, the re-key would be skipped
          //    for exactly the directories most likely to need it;
          //  - in its own try, because the model files are already written and
          //    a sidecar failure must not report that they were not.
          try {
            await remapLocalSidecars(input.directory_path, result.idMapping)
          } catch (sidecarError) {
            result.warnings.push(
              `Local .dethereal/ sidecars could not be re-keyed to the new element ids ` +
              `(${sidecarError instanceof Error ? sidecarError.message : String(sidecarError)}). ` +
              `Re-run generate_attribute_stubs for the elements added by this push.`,
            )
          }

          await writeScope(input.directory_path, scope ?? {})
          sourceFilesUpdated = true
          debugLog(config, `Updated source directory with current state`)
        } catch (error) {
          debugLog(config, `Failed to update source directory: ${error}`)
          result.warnings.push(`Could not update source directory: ${error}`)
        }
      }

      // Update sync.json push metadata
      try {
        const contentHash = await computeContentHash(input.directory_path)
        // Refresh the baseline from the post-push directory state so the next push's
        // C1/C2 conflict disambiguation has an accurate reference point. After the
        // re-export above the files carry the platform's authoritative IDs; when
        // re-export is disabled they carry the just-pushed local IDs — both correct.
        const baselineIds = await collectBaselineElementIds(input.directory_path)
        const existingSync = await readSyncJson(input.directory_path)
        await writeSyncJson(input.directory_path, {
          ...existingSync,
          platform_model_id: input.model_id,
          platform_url: config.baseUrl,
          last_push_at: new Date().toISOString(),
          push_content_hash: contentHash,
          baseline_element_ids: baselineIds,
        })
      } catch (syncError) {
        debugLog(config, `Failed to update sync.json: ${syncError}`)
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
