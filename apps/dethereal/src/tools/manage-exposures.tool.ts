/**
 * Manage Exposures Tool
 *
 * Read-only access to platform-computed exposures.
 * Exposures are analysis outputs — they cannot be created or modified by the plugin.
 */

import { z } from 'zod'
import { DtExposure } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum(['list', 'get']).describe('Action to perform (read-only)'),
  element_id: z.string().optional().describe('Element ID to list exposures for (required for "list")'),
  exposure_id: z.string().optional().describe('Exposure ID (required for "get")')
}).superRefine((data, ctx) => {
  if (data.action === 'list' && !data.element_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"element_id" is required for "list" action', path: ['element_id'] })
  }
  if (data.action === 'get' && !data.exposure_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"exposure_id" is required for "get" action', path: ['exposure_id'] })
  }
})

type ManageExposuresInput = z.infer<typeof InputSchema>

export class ManageExposuresTool extends ClientDependentTool<ManageExposuresInput, unknown> {
  readonly name = 'manage_exposures'
  readonly description = 'Read platform-computed exposures for model elements. Exposures are analysis outputs and cannot be created or modified through this tool — use the platform analysis engine to generate them.'
  readonly inputSchema = InputSchema

  async execute(input: ManageExposuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtExposure = new DtExposure(context.apolloClient)

      switch (input.action) {
        case 'list': {
          const exposures = await dtExposure.getExposures({ elementId: input.element_id! })
          return { success: true, data: { exposures, total: exposures.length } }
        }

        case 'get': {
          const exposure = await dtExposure.getExposure({ exposureId: input.exposure_id! })
          if (!exposure) {
            return { success: false, error: `Exposure ${input.exposure_id} not found` }
          }
          return { success: true, data: { exposure } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Exposure lookup failed'
      }
    }
  }
}

export const manageExposuresTool = new ManageExposuresTool()
