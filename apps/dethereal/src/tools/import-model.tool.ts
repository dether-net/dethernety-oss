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
import { DtImportSplit, type ImportProgress, type ResolvedControl, type SplitModel } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import {
  localOnlyCrownJewelNotice,
  createDirectoryBackup,
  isModelDirectory,
  applyIdMapping,
  validatePathConfinement,
  readManifest,
  readStructure,
  readDataFlows,
  readDataItems,
  writeManifest,
  writeStructure,
  writeDataFlows,
  writeDataItems,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { directoryPushRefusal, modulesForPush } from '../utils/gates.js'
import { readManifestBytes, recordModulesForPush, shownModules, type ModuleRef } from '../utils/manifest-modules.js'
import { getConfig, debugLog } from '../config.js'
import { computeContentHash, collectBaselineElementIds } from '../utils/sync-utils.js'
import { baselineForSync, exportPlatformPrints, recordSyncBaseline } from '../utils/platform-baseline.js'
import { readPushPayload } from '../utils/push-payload.js'
import { registerModel, registerWarning } from '../utils/model-registry.js'
import { pinList, registerPushPin, type Registration } from '../utils/settlement-writers.js'
import { settlementOn } from '../utils/settlement-switch.js'
import { MODEL_REF_ID } from '../utils/gates.js'
import { canonicalJson } from '../utils/canonical-json.js'
import { controlResolutionRefusal } from './create-model.tool.js'

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
  /** Whether the platform model was recorded for the next push's change check */
  platform_baseline: 'recorded' | 'not_recorded'
  /** Whether the directory is in the project's model registry (.dethernety/models.json) */
  registered: boolean
  /** The controls linked to each element, by the ref the files held at push time ('@model' for the model's own) */
  resolved_controls?: Record<string, ResolvedControl[]>
  /** The linked control ids registered in this machine's settlement (not the project registry); absent when there was nothing to register */
  settlement_registration?: Registration
  /** The module list sent (derived: manifest.json's, the scope's activeModules and the classes' modules); `before` when manifest.json was rewritten */
  manifest_modules: { after: ModuleRef[]; before?: unknown }
}

/** Every controls list of a model, keyed by its group and the id a push reports it under. */
function controlHolders(model: { manifest?: unknown; structure?: unknown; dataFlows?: unknown; dataItems?: unknown }): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  const add = (group: string, holder: any) => {
    if (holder && typeof holder === 'object' && Array.isArray(holder.controls)) out.set(`${group}\u0000${group === 'model' ? MODEL_REF_ID : holder.id}`, holder)
  }
  const walk = (b: any, root: boolean) => {
    if (!b || typeof b !== 'object') return
    if (!root && typeof b.id === 'string') add('boundaries', b)
    for (const c of Array.isArray(b.components) ? b.components : []) if (c && typeof c.id === 'string') add('components', c)
    for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n, false)
  }
  walk((model.structure as any)?.defaultBoundary, true)
  const flows = Array.isArray(model.dataFlows) ? model.dataFlows : (model.dataFlows as any)?.dataFlows ?? []
  for (const f of flows) if (f && typeof f.id === 'string') add('dataFlows', f)
  const items = Array.isArray(model.dataItems) ? model.dataItems : (model.dataItems as any)?.dataItems ?? []
  for (const i of items) if (i && typeof i.id === 'string') add('dataItems', i)
  add('model', (model.manifest as any)?.model)
  return out
}

/**
 * Writes the ids the push linked into the directory's controls lists, so the files hold what the platform
 * linked. Only a list the files still hold exactly as it was pushed is changed (found by the element's
 * platform id once the ids are mapped); anything edited since stays as it is. Returns the lists pinned.
 */
async function pinPushedControls(dirPath: string, pushed: SplitModel, resolved: Record<string, readonly ResolvedControl[]>, idMapping: Map<string, string>): Promise<number> {
  const manifest = await readManifest(dirPath)
  const structure = await readStructure(dirPath)
  const dataFlows = await readDataFlows(dirPath)
  const dataItems = await readDataItems(dirPath)
  const onDisk = controlHolders({ manifest, structure, dataFlows, dataItems })
  const changed = new Set<string>()
  let pinned = 0
  for (const [key, holder] of controlHolders(pushed)) {
    const [group, id] = key.split('\u0000') as [string, string]
    const list = pinList(holder.controls, resolved[id])
    if (!list || canonicalJson(list) === canonicalJson(holder.controls)) continue
    const disk = onDisk.get(`${group}\u0000${group === 'model' ? MODEL_REF_ID : idMapping.get(id) ?? id}`)
    if (!disk || canonicalJson(disk.controls) !== canonicalJson(holder.controls)) continue
    disk.controls = list
    changed.add(group)
    pinned++
  }
  if (changed.has('model')) await writeManifest(dirPath, manifest)
  if (changed.has('boundaries') || changed.has('components')) await writeStructure(dirPath, structure)
  if (changed.has('dataFlows')) await writeDataFlows(dirPath, dataFlows)
  if (changed.has('dataItems')) await writeDataItems(dirPath, dataItems)
  return pinned
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

      // Read the split model and its scope once, before any backup: the gate checks this
      // object and the push sends it, so nothing written to the directory in between
      // reaches the platform ungated.
      debugLog(config, `Reading model from directory: ${input.directory_path}`)
      const manifestBytes = await readManifestBytes(input.directory_path)
      const payload = await readPushPayload(input.directory_path)
      if (payload.error !== undefined) return { success: false, error: payload.error }
      // An attribute file that cannot be read is absent from the bag that gets
      // imported, and nothing downstream would ever mention it.
      const { splitModel, readIssues } = payload
      // The module list is derived: the push gates and sends the derived list.
      const modulesBefore = splitModel.manifest.modules
      const derivedModules = await modulesForPush(input.directory_path, splitModel)
      splitModel.manifest.modules = derivedModules.modules

      // Gate 2 blocks a push: refuse before any backup or platform call.
      const pushGate = await directoryPushRefusal(input.directory_path, splitModel, { settlement: context.settlement })
      if (pushGate) return { success: false, error: pushGate }

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

      debugLog(config, `Importing model: ${splitModel.manifest.model.name}`)

      // Use DtImportSplit from dt-core
      const dtImportSplit = new DtImportSplit(context.apolloClient)

      const result = await dtImportSplit.importSplitModel(splitModel, {
        folderId: input.folder_id,
        // Every push is settled: a control reference links only the control it names beyond doubt.
        controlResolution: 'strict',
        beforeFirstWrite: recordModules,
        onProgress: (progress: ImportProgress) => {
          debugLog(config, `Import progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (modulesRecord?.refusal !== undefined) return { success: false, error: modulesRecord.refusal }
      if (!result.success || !result.model) {
        // Refused before the model existed: say so, with what to fix. A failure after it exists keeps the usual wording.
        const refusal = result.model ? null : controlResolutionRefusal(result.errors)
        if (refusal) return { success: false, error: refusal.error, data: refusal.data as never }
        return {
          success: false,
          error: `Import failed: ${result.errors.map((e: { error: string }) => e.error).join(', ')}`
        }
      }

      for (const issue of readIssues) {
        result.warnings.push(
          `${issue.file} could not be read (${issue.reason}) — its attributes were NOT imported.`,
        )
      }

      // Surface crown-jewel marks on non-component elements (local-only; no platform field).
      const crownJewelNotice = localOnlyCrownJewelNotice(splitModel.attributes)
      if (crownJewelNotice) result.warnings.push(crownJewelNotice)

      let sourceFilesUpdated = false
      let sourceFilesFailed = false

      // Write server-generated IDs back to source files
      if (!input.disable_source_file_update && result.idMapping.size > 0) {
        try {
          const sidecarWarnings = await applyIdMapping(input.directory_path, result.idMapping, result.model.id)
          if (sidecarWarnings) result.warnings.push(...sidecarWarnings)
          sourceFilesUpdated = true
          debugLog(config, `Updated source files with ${result.idMapping.size} ID mappings`)
        } catch (error) {
          sourceFilesFailed = true
          debugLog(config, `Failed to update source files: ${error}`)
          result.warnings.push(`Could not update source files with server IDs: ${error}`)
        }
      }

      // The ids the push linked go into the files, but only where the files now hold the platform's ids.
      // With the reference ids kept, or a mapping that failed part-way, nothing is pinned or registered.
      const resolved = result.resolvedControls ?? {}
      const filesHoldPlatformIds = result.idMapping.size === 0 || sourceFilesUpdated
      let pinFailed = false
      if (filesHoldPlatformIds) {
        try {
          await pinPushedControls(input.directory_path, splitModel, resolved, result.idMapping)
        } catch (error) {
          pinFailed = true
          debugLog(config, `Failed to write the linked control ids: ${error}`)
        }
      }

      // Write sync.json for push metadata, with the platform model as the push left it:
      // the baseline the next push checks against.
      const baseline = await baselineForSync(
        input.directory_path,
        result.model.id,
        await exportPlatformPrints(context.apolloClient, result.model.id)
      )
      let syncFields: Parameters<typeof recordSyncBaseline>[1] = { platform_model_id: result.model.id, platform_url: config.baseUrl }
      try {
        syncFields = {
          ...syncFields,
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
      // The pushed directory in the project's model registry (added when absent; an existing entry keeps its source).
      const modelRegistry = await registerModel(input.directory_path, { name: result.model.name || splitModel.manifest.model.name || 'Unknown', source: 'local' })
      if (!modelRegistry.registered) result.warnings.push(registerWarning(modelRegistry.code))
      // The operator's registrations of the pushed lists follow the ids the push pinned (never a re-read of the directory).
      const on = settlementOn(context.settlement)
      const skipped: Registration | null = sourceFilesFailed
        ? { status: 'nothing', code: 'source_files_update_failed' }
        : !filesHoldPlatformIds
          ? { status: 'nothing', code: 'source_files_not_updated' }
          : pinFailed ? { status: 'failed', code: 'pin_write_failed' } : null
      // With the settlement off nothing is registered: the writer only keeps the per-machine files out of git.
      const settled: Registration = on && skipped
        ? skipped
        : await registerPushPin(input.directory_path, splitModel, resolved, result.idMapping, result.model.id, { settlement: context.settlement })
      if (settled.warning) result.warnings.push(settled.warning)
      if (settled.status === 'failed') {
        result.warnings.push(`The linked control ids were not registered (${settled.code ?? 'failed'}): they show as unregistered values until the operator settles them.`)
      }
      // The pinned ids are the files' own, whatever the settlement: a failed write is said with it off as well.
      if (!on && pinFailed) result.warnings.push('The linked control ids were not written into the model files: they still name those controls as pushed.')

      return {
        success: true,
        data: {
          model_id: result.model.id,
          name: result.model.name || splitModel.manifest.model.name || 'Unknown',
          description: result.model.description || undefined,
          warnings: result.warnings,
          backup_path: backupPath,
          source_files_updated: sourceFilesUpdated,
          id_mappings_count: result.idMapping.size,
          platform_baseline: platformBaseline,
          registered: modelRegistry.registered,
          ...(settled.status !== 'nothing' ? { settlement_registration: settled } : {}),
          ...(result.resolvedControls ? { resolved_controls: result.resolvedControls } : {}),
          manifest_modules: { after: derivedModules.modules, ...(modulesRecord?.written ? { before: shownModules(modulesBefore) } : {}) },
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
