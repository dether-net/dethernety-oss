/**
 * Get MITRE D3FEND Tool
 *
 * Browse MITRE D3FEND defensive techniques from the platform's graph database.
 * Used to reference verified defensive techniques in countermeasures.
 */

import { z } from 'zod'
import { DtMitreDefend } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum([
    'tactics',
    'techniques_by_tactic',
    'technique'
  ]).describe('Action to perform'),
  tactic_id: z.string().optional().describe('Tactic ID to filter techniques (required for "techniques_by_tactic")'),
  d3fend_id: z.string().optional().describe('D3FEND technique ID (required for "technique" action)')
}).superRefine((data, ctx) => {
  if (data.action === 'techniques_by_tactic' && !data.tactic_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"tactic_id" is required for "techniques_by_tactic" action', path: ['tactic_id'] })
  }
  if (data.action === 'technique' && !data.d3fend_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"d3fend_id" is required for "technique" action', path: ['d3fend_id'] })
  }
})

type GetMitreDefendInput = z.infer<typeof InputSchema>

export class GetMitreDefendTool extends ClientDependentTool<GetMitreDefendInput, unknown> {
  readonly name = 'get_mitre_defend'
  readonly description = 'Browse MITRE D3FEND defensive techniques and tactics from the platform database. Use this to find verified defensive technique IDs for countermeasures.'
  readonly inputSchema = InputSchema

  async execute(input: GetMitreDefendInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtMitreDefend = new DtMitreDefend(context.apolloClient)

      switch (input.action) {
        case 'tactics': {
          const tactics = await dtMitreDefend.fetchMitreDefendTactics()
          return { success: true, data: { tactics: tactics || [] } }
        }

        case 'techniques_by_tactic': {
          const techniques = await dtMitreDefend.getMitreDefendTechniquesByTactic({
            tacticId: input.tactic_id!
          })
          return { success: true, data: { techniques, tactic_id: input.tactic_id } }
        }

        case 'technique': {
          const technique = await dtMitreDefend.getMitreDefendTechnique({
            d3fendId: input.d3fend_id!
          })
          if (!technique) {
            return { success: false, error: `D3FEND technique ${input.d3fend_id} not found` }
          }
          return { success: true, data: { technique } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MITRE D3FEND lookup failed'
      }
    }
  }
}

export const getMitreDefendTool = new GetMitreDefendTool()
