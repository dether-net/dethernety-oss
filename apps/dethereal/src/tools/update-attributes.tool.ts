/**
 * Update Attributes Tool
 *
 * Targeted attribute updates for elements from a split-file directory.
 * Reads attributes from the attributes/ subdirectory and updates elements
 * without touching model structure.
 *
 * Uses DtUpdateSplit.updateAttributesOnly() from dt-core.
 *
 * Directory structure expected:
 * model-directory/
 * └── attributes/
 *     ├── boundaries/
 *     │   └── {uuid}.json
 *     ├── components/
 *     │   └── {uuid}.json
 *     ├── dataFlows/
 *     │   └── {uuid}.json
 *     └── dataItems/
 *         └── {uuid}.json
 */

import { z } from 'zod'
import { DtUpdateSplit } from '@dethernety/dt-core'
import type { ConsolidatedAttributesFile, ElementAttributes } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import type { AttributeReadIssue } from '../utils/directory-utils.js'
import {
  readModelDirectory,
  isModelDirectory,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { directoryPushRefusal, modulesForPush, safeErrorMessage } from '../utils/gates.js'
import {
  ATTRIBUTE_PUSH_FIELDS,
  MAX_ACKNOWLEDGED_CHANGES,
  checkPlatformChanges,
  exportPlatformPrints,
  partialPushBaseline,
  sentAttributePrints,
  recordSyncBaseline,
  type PlatformCheck,
} from '../utils/platform-baseline.js'
import { getConfig, debugLog } from '../config.js'

const InputSchema = z.object({
  model_id: z.string().describe('The ID of the model containing the elements'),
  directory_path: z.string().describe('Path to the model directory containing attributes/ subdirectory'),
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

type UpdateAttributesInput = z.infer<typeof InputSchema>

interface UpdateAttributesOutput {
  model_id: string
  stats: {
    boundaries: { updated: number; failed: number }
    components: { updated: number; failed: number }
    dataFlows: { updated: number; failed: number }
    dataItems: { updated: number; failed: number }
    total: { updated: number; failed: number }
  }
  /**
   * Attribute-level outcome. `stats` counts ELEMENTS, so on its own it cannot
   * distinguish "29 elements fully enriched" from "29 elements whose every
   * value is still unresolved" — both report `updated: 29, failed: 0`.
   */
  attributes: {
    /** Attribute keys actually sent to the platform. */
    sent: number
    /** Null-valued (unresolved) keys deliberately withheld — see filterUnresolved. */
    withheld_unresolved: number
    /** Elements skipped entirely because they carry no class binding. */
    elements_without_class: number
  }
  /** Per-element failures from dt-core, which were previously discarded. */
  errors: Array<{ step: string; elementId?: string; elementName?: string; error: string }>
  warnings: string[]
  /** Whether the platform model as this push left it is recorded for the next push's check. */
  platform_baseline?: 'recorded' | 'not_recorded'
  /** `accepted`: the named platform changes were overwritten; `unused`: nothing had changed. */
  acknowledgement?: 'accepted' | 'unused'
}

/** The four element groups carried by a ConsolidatedAttributesFile. */
const ELEMENT_GROUPS = ['boundaries', 'components', 'dataFlows', 'dataItems'] as const

/**
 * Strip null-valued attributes from the payload before it is pushed.
 *
 * A null in an attribute file means "template field, not yet resolved" — it is
 * the enrichment checklist (see generate-attribute-stubs.tool.ts and the enrich
 * skill), NOT an instruction to clear the value. But the platform write is a
 * Cypher property merge (`SET r += $attributes`), and neither Neo4j nor
 * Memgraph can store a null property: pushing `{k: null}` REMOVES k from the
 * IS_INSTANCE_OF edge when it is already there, and is a no-op when it is not.
 *
 * So sending nulls can only do one of two things — nothing, or destroy a value
 * somebody else established (another operator, an earlier enrichment pass, or
 * the platform UI). Withholding them is strictly better: a key absent from the
 * payload is left untouched by the merge.
 *
 * Consequence worth knowing: the plugin therefore cannot CLEAR a platform-side
 * attribute by nulling it locally. That matches the per-instance control
 * attribute contract in dt-core, where dropping a key from the payload
 * deliberately does not remove it platform-side.
 */
function filterUnresolved(
  attributes: ConsolidatedAttributesFile,
): { filtered: ConsolidatedAttributesFile; sent: number; withheld: number; withoutClass: number } {
  const filtered: ConsolidatedAttributesFile = {}
  let sent = 0
  let withheld = 0
  let withoutClass = 0

  for (const group of ELEMENT_GROUPS) {
    const source = attributes[group]
    if (!source) continue
    // Null-prototype: `target['__proto__'] = entry` on a `{}` literal hits the
    // prototype setter instead of defining a key, so an element whose id is
    // `__proto__` would be silently dropped from the push while still counted
    // as sent. validateElementId's [\w-]+ permits that id.
    const target: Record<string, ElementAttributes> = Object.create(null)

    for (const [elementId, entry] of Object.entries(source)) {
      // A malformed entry is dt-core's to reject and report per-element; do not
      // silently drop it here or the failure disappears from the ledger.
      if (!entry || typeof entry !== 'object') {
        target[elementId] = entry
        continue
      }
      if (!entry.classData?.id) withoutClass++

      const values = entry.attributes
      if (!values || typeof values !== 'object') {
        target[elementId] = entry
        continue
      }

      const kept: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) withheld++
        else {
          const counted = withoutNulls(value)
          kept[key] = counted.value
          withheld += counted.withheld
          sent++
        }
      }
      target[elementId] = { ...entry, attributes: kept }
    }
    filtered[group] = target
  }

  return { filtered, sent, withheld, withoutClass }
}

/**
 * A value with its nested nulls removed. dt-core flattens an object into one key per
 * leaf (`a.b`), so a nested null is pushed as its own key and erases it just like a
 * top-level one. Array elements stay: removing one would shift every later index.
 */
function withoutNulls(value: unknown): { value: unknown; withheld: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, withheld: 0 }
  const out: Record<string, unknown> = Object.create(null)
  let withheld = 0
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) {
      withheld++
      continue
    }
    const inner = withoutNulls(v)
    out[k] = inner.value
    withheld += inner.withheld
  }
  return { value: out, withheld }
}

/** The elements this push writes: those with a class and at least one value left to send. */
function writtenIds(filtered: ConsolidatedAttributesFile): Set<string> {
  const ids = new Set<string>()
  for (const group of ELEMENT_GROUPS) {
    for (const [id, entry] of Object.entries(filtered[group] ?? {})) {
      if (entry && typeof entry === 'object' && entry.classData?.id && entry.attributes && Object.keys(entry.attributes).length > 0) ids.add(id)
    }
  }
  return ids
}

export class UpdateAttributesTool extends ClientDependentTool<UpdateAttributesInput, UpdateAttributesOutput> {
  readonly name = 'update_attributes'
  readonly description =
    'Update attributes for specific elements in a threat model without modifying the model structure. Supports single element updates or batch updates. ' +
    'Refuses with PLATFORM_CHANGED_SINCE_SYNC when a value it would overwrite changed on the platform since the last pull or push; ' +
    'overwrite only after the operator names them (overwrite_changed with the refusal\'s changed_ids, and overwrite_revision).'
  readonly inputSchema = InputSchema

  async execute(input: UpdateAttributesInput, context: ToolContext): Promise<ToolResult<UpdateAttributesOutput>> {
    const config = getConfig()

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

      debugLog(config, `Reading attributes from directory: ${input.directory_path}`)

      // Read the model once: the gate checks this object and the push sends its
      // attributes, so nothing written to the directory in between reaches the
      // platform ungated. readModelDirectory reads the attributes with the
      // structure as their normalization context, which a flat-format attribute
      // file needs to resolve to its element; without it the file would be
      // skipped and silently never pushed.
      const attributeIssues: AttributeReadIssue[] = []
      let model: Awaited<ReturnType<typeof readModelDirectory>>
      try {
        model = await readModelDirectory(input.directory_path, attributeIssues)
      } catch (err) {
        return { success: false, error: `Push refused: the model could not be read (${safeErrorMessage(err)}).` }
      }
      const { attributes } = model
      // The module list is derived, and gated as derived; this push sends no modules, so nothing is written.
      model.manifest.modules = (await modulesForPush(input.directory_path, model)).modules

      // Gate 2 blocks a push: refuse before any platform call. The platform model named, so a pull's
      // registrations for it count.
      const pushGate = await directoryPushRefusal(input.directory_path, model, { modelId: input.model_id, settlement: context.settlement })
      if (pushGate) return { success: false, error: pushGate }

      // Count total elements to update
      const totalCount =
        Object.keys(attributes.boundaries || {}).length +
        Object.keys(attributes.components || {}).length +
        Object.keys(attributes.dataFlows || {}).length +
        Object.keys(attributes.dataItems || {}).length

      if (totalCount === 0) {
        return {
          success: true,
          data: {
            model_id: input.model_id,
            stats: {
              boundaries: { updated: 0, failed: 0 },
              components: { updated: 0, failed: 0 },
              dataFlows: { updated: 0, failed: 0 },
              dataItems: { updated: 0, failed: 0 },
              total: { updated: 0, failed: 0 }
            },
            attributes: { sent: 0, withheld_unresolved: 0, elements_without_class: 0 },
            errors: [],
            warnings: ['No attributes found to update']
          }
        }
      }

      debugLog(config, `Updating attributes for ${totalCount} elements in model ${input.model_id}`)

      // Withhold unresolved (null) values — see filterUnresolved.
      const { filtered, sent, withheld, withoutClass } = filterUnresolved(attributes)

      debugLog(config, `Pushing ${sent} attribute values; withholding ${withheld} unresolved`)

      // What changed on the platform since the last pull or push, among the values this
      // push writes, is never overwritten without the operator naming it. A platform
      // read only: a refusal leaves everything as it was.
      const written = writtenIds(filtered)
      let platformCheck: PlatformCheck | undefined
      if (written.size > 0) {
        const livePrints = await exportPlatformPrints(context.apolloClient, input.model_id)
        if (!livePrints) {
          return {
            success: false,
            error: 'The platform model could not be read to check it for changes since your last pull or push, so nothing was pushed.'
          }
        }
        platformCheck = await checkPlatformChanges(input.directory_path, input.model_id, livePrints, {
          includeAdded: false,
          scope: { fields: ATTRIBUTE_PUSH_FIELDS, ids: written },
          overwriteChanged: input.overwrite_changed,
          overwriteRevision: input.overwrite_revision,
        })
        if (platformCheck.refusal) {
          return { success: false, error: platformCheck.refusal.message, data: platformCheck.refusal.data as never }
        }
      }

      // Use DtUpdateSplit to update attributes only
      const dtUpdateSplit = new DtUpdateSplit(context.apolloClient)
      const result = await dtUpdateSplit.updateAttributesOnly(input.model_id, filtered)

      const warnings = [...result.warnings]

      // The record for the next push's check: this push's values, taken from the platform
      // as it left them, in the record the check compared against.
      let platformBaseline: 'recorded' | 'not_recorded' | undefined
      if (platformCheck && result.success) {
        const postPush = await exportPlatformPrints(context.apolloClient, input.model_id)
        const next = await partialPushBaseline(
          input.directory_path, input.model_id, platformCheck, written, ATTRIBUTE_PUSH_FIELDS, postPush, sentAttributePrints(filtered),
        )
        if (next.write) {
          const recorded = await recordSyncBaseline(input.directory_path, {}, next, 'push')
          platformBaseline = recorded.status
          if (recorded.warning) warnings.push(recorded.warning)
        } else {
          // There was no trusted record before this push either: nothing new to say.
          platformBaseline = 'not_recorded'
        }
      } else if (platformCheck) {
        platformBaseline = 'not_recorded'
        warnings.push(
          'The record of the platform model from before this push was kept, so the next push lists any part of it that ' +
          'did reach the platform as platform changes; pull to refresh it.',
        )
      }
      for (const issue of attributeIssues) {
        warnings.push(
          `${issue.file} could not be read (${issue.reason}) — its attributes were NOT pushed. ` +
          `The element counts below do not include it.`,
        )
      }
      if (withheld > 0) {
        warnings.push(
          `${withheld} attribute value(s) are still unresolved (null) and were NOT pushed — ` +
          `element counts below say nothing about them. Pushing a null cannot store "unknown"; ` +
          `it would only erase whatever the platform already holds for that key.`,
        )
      }

      return {
        success: result.success,
        data: {
          model_id: input.model_id,
          stats: result.stats,
          attributes: {
            sent,
            withheld_unresolved: withheld,
            elements_without_class: withoutClass,
          },
          // dt-core reports per-element failures here; forwarding them keeps a
          // `failed` count from being the only thing the operator can see.
          errors: result.errors.map((e) => ({
            step: e.step,
            ...(e.elementId ? { elementId: e.elementId } : {}),
            ...(e.elementName ? { elementName: e.elementName } : {}),
            error: e.error,
          })),
          warnings,
          ...(platformBaseline ? { platform_baseline: platformBaseline } : {}),
          ...(platformCheck?.acknowledgement ? { acknowledgement: platformCheck.acknowledgement } : {}),
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update attributes'
      }
    }
  }
}

// Export singleton instance
export const updateAttributesTool = new UpdateAttributesTool()
