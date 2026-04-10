/**
 * Get Control Gaps Tool
 *
 * Analyzes control gaps for a threat model by traversing the MITRE framework chain.
 * Returns unmitigated exposures, unaddressable exposures, recommended controls,
 * and a coverage summary.
 */

import { z } from 'zod'
import { DtControl } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  model_id: z.string().describe('Model ID to analyze for control gaps'),
  top_n: z.number().int().min(1).max(20).optional().default(3)
    .describe('Number of top recommended controls to return (default 3)'),
  limit: z.number().int().min(1).max(200).optional().default(50)
    .describe('Maximum number of unmitigated exposures to return (default 50)'),
})

type GetControlGapsInput = z.infer<typeof InputSchema>

export class GetControlGapsTool extends ClientDependentTool<GetControlGapsInput, unknown> {
  readonly name = 'get_control_gaps'
  readonly description = 'Analyze control gaps for a threat model. Returns unmitigated exposures, unaddressable exposures (no module covers them), recommended controls ranked by coverage, and a coverage summary with percentage. Requires a model that has been analyzed for exposures first.'
  readonly inputSchema = InputSchema

  async execute(input: GetControlGapsInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtControl = new DtControl(context.apolloClient)

      const result = await dtControl.controlGaps({
        modelId: input.model_id,
        topN: input.top_n,
        limit: input.limit,
      })

      const warnings: string[] = []
      if (result.coverageSummary.totalExposures === 0) {
        warnings.push('No exposures found for this model. Run an exposure analysis first to generate control gap data.')
      }

      return {
        success: true,
        data: result,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze control gaps',
      }
    }
  }
}

export const getControlGapsTool = new GetControlGapsTool()
