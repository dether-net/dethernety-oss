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
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { readAttributes, isModelDirectory, validatePathConfinement } from '../utils/directory-utils.js'
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
  warnings: string[]
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

      // Read attributes from directory
      const attributes = await readAttributes(input.directory_path)

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
            warnings: ['No attributes found to update']
          }
        }
      }

      debugLog(config, `Updating attributes for ${totalCount} elements in model ${input.model_id}`)

      // Use DtUpdateSplit to update attributes only
      const dtUpdateSplit = new DtUpdateSplit(context.apolloClient)
      const result = await dtUpdateSplit.updateAttributesOnly(input.model_id, attributes)

      return {
        success: result.success,
        data: {
          model_id: input.model_id,
          stats: result.stats,
          warnings: result.warnings
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
