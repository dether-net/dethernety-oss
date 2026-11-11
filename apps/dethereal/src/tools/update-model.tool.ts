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
import { DtUpdateSplit, DtExportSplit, describeUnresolvedControl, mergeAttributes, type UpdateProgress, type ConsolidatedAttributesFile, type ResolvedControl } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  readAttributes,
  protectedAttributeFiles,
  remapLocalSidecars,
  writeModelDirectory,
  writeScope,
  localOnlyCrownJewelNotice,
  createDirectoryBackup,
  isModelDirectory,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import type { AttributeReadIssue } from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { directoryPushRefusal, modulesForPush, safeErrorMessage } from '../utils/gates.js'
import { readManifestBytes, recordModulesForPush, shownModules, type ModuleRef } from '../utils/manifest-modules.js'
import { keepUnresolvedClasses } from '../utils/unresolved-classes.js'
import { keepUnresolvedControls } from '../utils/unresolved-controls.js'
import { getConfig, debugLog } from '../config.js'
import { StateFileError } from '../utils/state-store.js'
import { computeContentHash, collectBaselineElementIds } from '../utils/sync-utils.js'
import { readPushPayload } from '../utils/push-payload.js'
import { registerPushPin, type Registration } from '../utils/settlement-writers.js'
import { controlResolutionRefusal } from './create-model.tool.js'
import {
  baselineForSync,
  recordSyncBaseline,
  MODEL_PUSH_FIELDS,
  checkPlatformChanges,
  exportPlatformPrints,
  fingerprintSplitModel,
  MAX_ACKNOWLEDGED_CHANGES,
  type PlatformPrints,
} from '../utils/platform-baseline.js'
import { settlementOn } from '../utils/settlement-switch.js'

const InputSchema = z.object({
  model_id: z.string().describe('The ID of the model to update'),
  directory_path: z.string().describe('Path to the model directory containing updated data'),
  delete_orphaned: z.boolean().optional().describe('Whether to delete elements not present in the update data (default: true)'),
  create_backup: z.boolean().optional().describe('Create a timestamped backup of the directory before update (default: true)'),
  disable_source_file_update: z.boolean().optional().describe('Disable automatic export back to source directory after update (default: false)'),
  overwrite_changed: z
    .array(z.string().regex(/^[@A-Za-z0-9._:-]{1,200}$/, 'an element id'))
    .max(MAX_ACKNOWLEDGED_CHANGES)
    .optional()
    .describe(
      'Only after a PLATFORM_CHANGED_SINCE_SYNC refusal the operator answered with overwrite: exactly its changed_ids. ' +
      'Those platform changes are then overwritten.'
    ),
  overwrite_revision: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'the revision from the refusal')
    .optional()
    .describe('With overwrite_changed: the revision from that refusal. A platform that changed again since refuses again.')
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
  /** Whether the platform model was recorded for the next push's change check */
  platform_baseline: 'recorded' | 'not_recorded'
  /** `accepted`: named platform changes were overwritten; `unused`: an overwrite was passed with nothing changed */
  acknowledgement?: 'accepted' | 'unused'
  /** The controls linked to each element, by the ref the files held at push time ('@model' for the model's own) */
  resolved_controls?: Record<string, ResolvedControl[]>
  /** The controls the push linked by name, registered with their ids where the files now hold them */
  settlement_registration?: Registration
  /** The module list sent (derived: manifest.json's, the scope's activeModules and the classes' modules); `before` when manifest.json was rewritten */
  manifest_modules: { after: ModuleRef[]; before?: unknown }
}

/** An update error with the element it concerns, unless the message already names it. */
function describeUpdateError(e: { error: string; elementName?: string }): string {
  return e.elementName && !e.error.includes(`"${e.elementName}"`) ? `${e.elementName}: ${e.error}` : e.error
}

export class UpdateModelTool extends ClientDependentTool<UpdateInput, UpdateOutput> {
  readonly name = 'update_model'
  // With the settlement on (read once, as the tool list is), a push also waits for the operator's confirmation.
  readonly description = 'Update an existing threat model in your Dethernety platform instance. This synchronizes the model with new JSON data, creating/updating/deleting elements as needed. Supports reading from file or inline JSON data.' +
    (settlementOn() ? ' It refuses while the model directory lists enrichment values the operator has not confirmed; only the operator\'s reply to a row clears it.' : '')
  readonly inputSchema = InputSchema

  /** Tests only: the push gate, so a test can change the directory right after it decides. */
  gate?: typeof directoryPushRefusal

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
      input.directory_path = await validatePathConfinement(input.directory_path)

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

      // Warnings raised before dt-core returns its result object, merged into
      // result.warnings once it exists.
      const preWarnings: string[] = []

      // Read the split model and its scope once, before any backup: the gate judges
      // exactly the object that is pushed.
      debugLog(config, `Reading model from directory: ${input.directory_path}`)
      const manifestBytes = await readManifestBytes(input.directory_path)
      const payload = await readPushPayload(input.directory_path)
      if (payload.error !== undefined) return { success: false, error: payload.error }
      const { splitModel } = payload
      // The module list is derived: the push gates and sends the derived list.
      const modulesBefore = splitModel.manifest.modules
      const derivedModules = await modulesForPush(input.directory_path, splitModel)
      splitModel.manifest.modules = derivedModules.modules
      // A file that cannot be read is simply absent from the bag that gets pushed,
      // so without this the push reports success having silently left that
      // element's attributes behind.
      for (const issue of payload.readIssues) {
        preWarnings.push(
          `${issue.file} could not be read (${issue.reason}) — its attributes were NOT pushed.`,
        )
      }

      // Gate 2, and with the settlement on pending enrichment and the settlement, block a push: refuse before any backup or platform call.
      const pushGate = await (this.gate ?? directoryPushRefusal)(input.directory_path, splitModel, { modelId: input.model_id, settlement: context.settlement })
      if (pushGate) return { success: false, error: pushGate }

      // What changed on the platform since the last pull or push is never overwritten
      // without the operator naming it. A platform read only: nothing local is written
      // before this, so a refusal leaves the directory exactly as it was.
      const livePrints = await exportPlatformPrints(context.apolloClient, input.model_id)
      if (!livePrints) {
        return {
          success: false,
          error: 'The platform model could not be read to check it for changes since your last pull or push, so nothing was pushed.'
        }
      }
      // Without deleting orphans the push leaves every element the local model does not hold alone.
      const deleteOrphaned = input.delete_orphaned !== false
      const platformCheck = await checkPlatformChanges(input.directory_path, input.model_id, livePrints, {
        includeAdded: deleteOrphaned,
        scope: {
          fields: MODEL_PUSH_FIELDS,
          ...(deleteOrphaned ? {} : { ids: new Set(Object.keys(fingerprintSplitModel(splitModel))) }),
        },
        overwriteChanged: input.overwrite_changed,
        overwriteRevision: input.overwrite_revision,
      })
      if (platformCheck.refusal) {
        return { success: false, error: platformCheck.refusal.message, data: platformCheck.refusal.data as never }
      }

      let backupPath: string | undefined

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

      // Once every refusal has passed, the platform's own checks included, and before the first platform
      // write, the derived list goes into manifest.json, if the file is still what the push read. The backup
      // holds the files as they were.
      let modulesRecord: Awaited<ReturnType<typeof recordModulesForPush>> | undefined
      const recordModules = async () => {
        try {
          modulesRecord = await recordModulesForPush(input.directory_path, manifestBytes, derivedModules.modules)
        } catch (error) {
          // Raised inside the platform call, a throw would read as a failure after its writes began.
          modulesRecord = {
            refusal: `manifest.json could not be written with the derived module list (${error instanceof Error ? error.message : String(error)}), so nothing was pushed.`,
          }
        }
        return modulesRecord.refusal
      }

      debugLog(config, `Updating model: ${input.model_id}`)

      // Use DtUpdateSplit from dt-core
      const dtUpdateSplit = new DtUpdateSplit(context.apolloClient)

      const result = await dtUpdateSplit.updateFromSplitModel(input.model_id, splitModel, {
        deleteOrphaned: input.delete_orphaned !== false, // Default to true
        // Every push is settled: a control reference links only the control it names beyond doubt.
        controlResolution: 'strict',
        beforeFirstWrite: recordModules,
        onProgress: (progress: UpdateProgress) => {
          debugLog(config, `Update progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (modulesRecord?.refusal !== undefined) return { success: false, error: modulesRecord.refusal }
      if (!result.success) {
        // Refused before anything was written: say so, with what to fix.
        const refusal = controlResolutionRefusal(result.errors)
        if (refusal) return { success: false, error: refusal.error, data: refusal.data as never }
        // Whatever part of the push reached the platform, the record from before it stays: the next
        // push lists those writes as platform changes, never the other way round.
        return {
          success: false,
          error: `Update failed: ${result.errors.map(describeUpdateError).join('; ')}. ` +
            'The record of the platform model from before this push was kept, so the next push lists any part of it that ' +
            'did reach the platform as platform changes; pull to refresh it.'
        }
      }

      result.warnings.push(...preWarnings)

      // Surface crown-jewel marks on non-component elements (local-only; no platform field).
      // Computed from the local model we pushed, not the re-export below.
      const crownJewelNotice = localOnlyCrownJewelNotice(splitModel.attributes)
      if (crownJewelNotice) result.warnings.push(crownJewelNotice)

      let sourceFilesUpdated = false
      // The platform model as this push left it: the next push's baseline.
      let postPushPrints: PlatformPrints | null = null

      // Export back to source directory if update is not disabled
      if (!input.disable_source_file_update) {
        try {
          const dtExportSplit = new DtExportSplit(context.apolloClient)
          const exportedModel = await dtExportSplit.exportModelToSplit(input.model_id)
          // Taken from the export as returned, before local attributes are merged in or the scope moved out.
          postPushPrints = fingerprintSplitModel(exportedModel)

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
          // Local bags are keyed by the ids the push sent; an element the push
          // created comes back under its new platform id. Re-key first, or the
          // merge keeps both and the old id's file lingers as an orphan.
          exportedModel.attributes = mergeAttributes(rekeyAttributes(localAttributes, result.idMapping), exportedModel.attributes)
          // An element whose class the platform does not have keeps the class the user chose, and its answers.
          keepUnresolvedClasses(exportedModel, localAttributes, result.unresolvedClasses, result.idMapping)
          // A control reference the push could not attach stays where it was written, so it can be pinned to an id. A strict
          // push links every reference or refuses, so this guards against an update that reports one after writing.
          const lostControls = keepUnresolvedControls(exportedModel, splitModel, result.unresolvedControls, result.idMapping)
          if (lostControls.length > 0) {
            result.warnings.push(
              `Unresolved control references could not be kept in the model files, because their element is no longer there: ` +
              lostControls.map(describeUnresolvedControl).join('; '),
            )
          }

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
            const sidecarWarnings = await remapLocalSidecars(input.directory_path, result.idMapping)
            if (sidecarWarnings) result.warnings.push(...sidecarWarnings)
          } catch (sidecarError) {
            result.warnings.push(
              `Local .dethereal/ sidecars could not be re-keyed to the new element ids ` +
              `(${sidecarError instanceof Error ? sidecarError.message : String(sidecarError)}). ` +
              `Re-run generate_attribute_stubs for the elements added by this push.`,
            )
          }

          sourceFilesUpdated = true
          // The model files are written: a scope that cannot be updated is its own
          // warning, not a failed update of the source directory.
          try {
            await writeScope(input.directory_path, scope ?? {})
          } catch (scopeError) {
            const code = scopeError instanceof StateFileError ? scopeError.code : 'unwritable'
            result.warnings.push(
              `.dethereal/scope.json could not be updated (${code}); the model files were updated, ` +
              `but the local scope still holds the values from before the push.`,
            )
          }
          debugLog(config, `Updated source directory with current state`)
        } catch (error) {
          debugLog(config, `Failed to update source directory: ${error}`)
          result.warnings.push(`Could not update source directory: ${error}`)
        }
      }

      if (!postPushPrints) postPushPrints = await exportPlatformPrints(context.apolloClient, input.model_id)
      // Without a new baseline the old one is removed: this push's own writes must
      // never read as platform changes on the next push.
      const baseline = await baselineForSync(input.directory_path, input.model_id, postPushPrints)

      // Update sync.json push metadata. Refresh the element ids from the post-push
      // directory state so the next push's C1/C2 conflict disambiguation has an
      // accurate reference point. After the re-export above the files carry the
      // platform's authoritative IDs; when re-export is disabled they carry the
      // just-pushed local IDs — both correct.
      let syncFields: Parameters<typeof recordSyncBaseline>[1] = {}
      try {
        syncFields = {
          platform_model_id: input.model_id,
          platform_url: config.baseUrl,
          last_push_at: new Date().toISOString(),
          push_content_hash: await computeContentHash(input.directory_path),
          baseline_element_ids: await collectBaselineElementIds(input.directory_path),
        }
      } catch (syncError) {
        debugLog(config, `Failed to read the pushed directory for sync.json: ${syncError}`)
      }
      const recorded = await recordSyncBaseline(input.directory_path, syncFields, baseline, 'push')
      const platformBaseline = recorded.status
      if (recorded.warning) result.warnings.push(recorded.warning)
      // The controls linked by name, registered with their ids where the directory now holds them (the re-export writes them).
      const registration = await registerPushPin(input.directory_path, splitModel, result.resolvedControls ?? {}, result.idMapping, input.model_id, { settlement: context.settlement })
      // A registration reports in settlement_registration; with nothing registered, a warning is all there is to say.
      if (registration.status === 'nothing' && registration.warning) result.warnings.push(registration.warning)

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
          source_files_updated: sourceFilesUpdated,
          platform_baseline: platformBaseline,
          ...(platformCheck.acknowledgement ? { acknowledgement: platformCheck.acknowledgement } : {}),
          ...(result.resolvedControls ? { resolved_controls: result.resolvedControls } : {}),
          ...(registration.status !== 'nothing' ? { settlement_registration: registration } : {}),
          manifest_modules: { after: derivedModules.modules, ...(modulesRecord?.written ? { before: shownModules(modulesBefore) } : {}) },
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

/** Re-key an attribute bag (keys and `elementId`) through a push's id mapping. */
export function rekeyAttributes(
  attributes: ConsolidatedAttributesFile,
  idMapping: Map<string, string> | undefined,
): ConsolidatedAttributesFile {
  if (!idMapping || idMapping.size === 0) return attributes
  const out: ConsolidatedAttributesFile = {}
  for (const [group, bag] of Object.entries(attributes) as Array<[keyof ConsolidatedAttributesFile, Record<string, any> | undefined]>) {
    if (!bag) continue
    out[group] = Object.fromEntries(Object.entries(bag).map(([id, entry]) => {
      const next = idMapping.get(id) ?? id
      return [next, entry && typeof entry === 'object' ? { ...entry, elementId: next } : entry]
    }))
  }
  return out
}
