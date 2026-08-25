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
  readAttributes,
  readStructure,
  readDataFlows,
  readDataItems,
  isModelDirectory,
  validatePathConfinement,
} from '../utils/directory-utils.js'
import { pathExists } from '../utils/file-utils.js'
import { getConfig, debugLog } from '../config.js'

const InputSchema = z.object({
  model_id: z.string().describe('The ID of the model containing the elements'),
  directory_path: z.string().describe('Path to the model directory containing attributes/ subdirectory')
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
        else { kept[key] = value; sent++ }
      }
      target[elementId] = { ...entry, attributes: kept }
    }
    filtered[group] = target
  }

  return { filtered, sent, withheld, withoutClass }
}

export class UpdateAttributesTool extends ClientDependentTool<UpdateAttributesInput, UpdateAttributesOutput> {
  readonly name = 'update_attributes'
  readonly description = 'Update attributes for specific elements in a threat model without modifying the model structure. Supports single element updates or batch updates.'
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

      debugLog(config, `Reading attributes from directory: ${input.directory_path}`)

      // Read attributes from directory.
      //
      // The normalization context is REQUIRED here, not optional. Without it,
      // readAttributes cannot resolve a flat-format attribute file to an
      // element and skips it with a console.warn that goes to the MCP server's
      // stderr and reaches neither the agent nor the operator — so a flat file
      // is silently never pushed. Flat is the format the plugin's own agent
      // guidelines tell agents to author, and every read/report path already
      // passes this context; only the write paths did not.
      const structure = await readStructure(input.directory_path)
      const dataFlows = await readDataFlows(input.directory_path)
      const dataItems = await readDataItems(input.directory_path)
      const attributeIssues: AttributeReadIssue[] = []
      const attributes = await readAttributes(
        input.directory_path, { structure, dataFlows, dataItems }, attributeIssues,
      )

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

      // Use DtUpdateSplit to update attributes only
      const dtUpdateSplit = new DtUpdateSplit(context.apolloClient)
      const result = await dtUpdateSplit.updateAttributesOnly(input.model_id, filtered)

      const warnings = [...result.warnings]
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
