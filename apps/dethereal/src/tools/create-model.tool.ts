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
import { DtImportSplit, CONTROL_RESOLUTION_CODES, type ControlErrorFields, type ImportProgress, type ResolvedControl, type SplitModel } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { payloadPushRefusal } from '../utils/gates.js'
import { getConfig, debugLog } from '../config.js'
import { computeContentHash, collectBaselineElementIds } from '../utils/sync-utils.js'
import { baselineForSync, exportPlatformPrints, recordSyncBaseline } from '../utils/platform-baseline.js'
import { registerModel, registerWarning } from '../utils/model-registry.js'
import { pinnedModel, registerPushPin, type Registration } from '../utils/settlement-writers.js'
import { getExample, ExampleType } from '../data/examples.js'
import { getSchemaTool } from './get-schema.tool.js'
import {
  writeModelDirectory,
  applyIdMapping,
  ensureModelDirectoryStructure,
  validatePathConfinement,
  isModelDirectory,
} from '../utils/directory-utils.js'
import { settlementOn } from '../utils/settlement-switch.js'

const ExampleTypeEnum = z.enum(['simple', 'web_app', 'api_service', 'database', 'microservices'])

const InputSchema = z.object({
  model: z.union([z.record(z.string(), z.any()), z.string()]).describe('Complete threat model in SplitModel JSON structure or JSON string'),
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
  /** With a directory: whether the platform model was recorded for the next push's change check */
  platform_baseline?: 'recorded' | 'not_recorded'
  /** With a directory: whether it is in the project's model registry (.dethernety/models.json) */
  registered?: boolean
  /** The controls linked to each element, by the ref the model held ('@model' for the model's own) */
  resolved_controls?: Record<string, ResolvedControl[]>
  /** With an existing model directory: the controls the push linked by name, registered with their ids */
  settlement_registration?: Registration
}

/** At most this many control errors are returned; the total is given when there are more. */
const MAX_CONTROL_ERRORS = 100
const REFUSAL_CODES = new Set<string>([...CONTROL_RESOLUTION_CODES, 'duplicate_element_id'])

/**
 * A strict refusal made before anything was written: the codes and the entries
 * they concern, the same for every push. Null when the failure is anything else.
 */
export function controlResolutionRefusal(errors: ReadonlyArray<Partial<ControlErrorFields> & { code?: string }>): { error: string; data: Record<string, unknown> } | null {
  const refused = errors.filter((e) => e.code !== undefined && REFUSAL_CODES.has(e.code))
  if (refused.length === 0) return null
  const codes = [...new Set(refused.map((e) => e.code!))]
  const onlyIds = codes.every((c) => c === 'duplicate_element_id')
  const controlErrors = refused.slice(0, MAX_CONTROL_ERRORS).map((e) => ({
    code: e.code,
    ...(e.ref !== undefined ? { ref: e.ref } : {}),
    ...(e.index !== undefined ? { index: e.index } : {}),
    ...(e.control ? { control: e.control } : {}),
    ...(e.candidates ? { candidates: e.candidates, candidates_total: e.candidates_total } : {}),
  }))
  return {
    error: onlyIds ? 'Element ids must be unique in the model; nothing was pushed' : 'Control references could not be resolved; nothing was pushed',
    data: { codes, control_errors: controlErrors, ...(refused.length > MAX_CONTROL_ERRORS ? { control_errors_total: refused.length } : {}) },
  }
}

export class CreateModelTool extends ClientDependentTool<CreateInput, CreateOutput> {
  readonly name = 'create_threat_model'
  // With the settlement on (read once, as the tool list is), a push also waits for the operator's confirmation.
  readonly description = 'Create and import a threat model into the Dethernety platform. This tool automatically provides the current schema and example models to help you compose the threat model correctly before importing.' +
    (settlementOn() ? ' It refuses while the target model directory lists enrichment values the operator has not confirmed; a model passed only in memory carries no such list.' : '')
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

      // Validate the output path BEFORE the platform import — failing the
      // confinement check after importSplitModel succeeds would report
      // failure on a model that now exists server-side (and invite a
      // duplicate-creating retry).
      if (input.directory_path) input.directory_path = await validatePathConfinement(input.directory_path)

      // The push gate, before anything reaches the platform: Gate 2 on the model given, then (when it is
      // written into an existing model directory) that model's unconfirmed enrichment, then the settlement:
      // the values created must be the operator's, held against that directory's baseline, else against
      // none (every value is then unregistered).
      const target = input.directory_path && (await isModelDirectory(input.directory_path)) ? input.directory_path : null
      const pushGate = await payloadPushRefusal(target, modelData, { settlement: context.settlement })
      if (pushGate) return { success: false, error: pushGate }

      // Use DtImportSplit from dt-core
      const dtImportSplit = new DtImportSplit(context.apolloClient)

      const result = await dtImportSplit.importSplitModel(modelData, {
        folderId: input.folder_id,
        // Every push is settled: a control reference links only the control it names beyond doubt.
        controlResolution: 'strict',
        onProgress: (progress: ImportProgress) => {
          debugLog(config, `Import progress: ${progress.stepName} (${progress.percentage}%)`)
        }
      })

      if (!result.success || !result.model) {
        // Refused before the model existed: say so, with what to fix. A failure after it exists keeps the usual wording.
        const refusal = result.model ? null : controlResolutionRefusal(result.errors)
        if (refusal) return { success: false, error: refusal.error, data: refusal.data as never }
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
      let platformBaseline: 'recorded' | 'not_recorded' | undefined
      let registered: boolean | undefined
      let settled: Registration | undefined
      const idMappingsCount = result.idMapping.size
      const resolved = result.resolvedControls ?? {}

      // Write to directory if path provided (path already confinement-checked
      // before the import above)
      if (input.directory_path) {
        try {
          // Ensure directory structure exists
          await ensureModelDirectoryStructure(input.directory_path)

          // Write the model with original IDs first, the controls it linked by name pinned to the linked ids
          await writeModelDirectory(input.directory_path, pinnedModel(modelData, resolved))

          // Apply ID mappings to update with server-generated IDs
          const sidecarWarnings = await applyIdMapping(input.directory_path, result.idMapping, result.model.id)
          if (sidecarWarnings) result.warnings.push(...sidecarWarnings)

          directoryWritten = input.directory_path
          debugLog(config, `Wrote model to directory: ${input.directory_path}`)

          // Write sync.json for push metadata, with the platform model as the create left
          // it: the baseline the next push checks against.
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
            debugLog(config, `Failed to read the written directory for sync.json: ${syncError}`)
          }
          const recorded = await recordSyncBaseline(input.directory_path, syncFields, baseline, 'push')
          platformBaseline = recorded.status
          if (recorded.warning) result.warnings.push(recorded.warning)
          // The created directory in the project's model registry.
          const registration = await registerModel(input.directory_path, { name: result.model.name || modelData.manifest.model.name || 'Unknown', source: 'create' })
          registered = registration.registered
          if (!registration.registered) result.warnings.push(registerWarning(registration.code))
          // A model directory the operator registered keeps its registrations of the pinned lists.
          if (target) settled = await registerPushPin(input.directory_path, modelData, resolved, result.idMapping, result.model.id, { settlement: context.settlement })
          // A registration reports in settlement_registration; with nothing registered, a warning is all there is to say.
          if (settled?.status === 'nothing' && settled.warning) result.warnings.push(settled.warning)
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
          id_mappings_count: idMappingsCount,
          ...(platformBaseline ? { platform_baseline: platformBaseline } : {}),
          ...(registered !== undefined ? { registered } : {}),
          ...(result.resolvedControls ? { resolved_controls: result.resolvedControls } : {}),
          ...(settled && settled.status !== 'nothing' ? { settlement_registration: settled } : {}),
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
