/**
 * Manage Analyses Tool
 *
 * Lifecycle management for platform analyses: list available analysis classes,
 * create, run, poll status, retrieve results, and delete.
 *
 * Polling contract (MCP tools are stateless — no streaming):
 *   1. create → returns analysis_id
 *   2. run → returns session_id, status: 'started'
 *   3. status → returns 'running' | 'completed' | 'failed'
 *   4. results → returns analysis output when complete
 */

import { z } from 'zod'
import { DtAnalysis } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum([
    'list_classes',
    'list',
    'create',
    'run',
    'status',
    'results',
    'delete'
  ]).describe('Action to perform. Polling contract: create → run → status (poll) → results'),
  element_id: z.string().optional().describe('Model element ID (required for "list" and "create")'),
  analysis_id: z.string().optional().describe('Analysis ID (required for "run", "status", "results", "delete")'),
  analysis_class_id: z.string().optional().describe('Analysis class ID (required for "create")'),
  name: z.string().optional().describe('Analysis name (required for "create")'),
  description: z.string().optional().describe('Analysis description')
}).superRefine((data, ctx) => {
  if (data.action === 'list' && !data.element_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"element_id" is required for "list" action', path: ['element_id'] })
  }
  if (data.action === 'create') {
    if (!data.element_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"element_id" is required for "create" action', path: ['element_id'] })
    }
    if (!data.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"name" is required for "create" action', path: ['name'] })
    }
    if (!data.analysis_class_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"analysis_class_id" is required for "create" action', path: ['analysis_class_id'] })
    }
  }
  if (['run', 'status', 'results', 'delete'].includes(data.action) && !data.analysis_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"analysis_id" is required for this action', path: ['analysis_id'] })
  }
})

type ManageAnalysesInput = z.infer<typeof InputSchema>

export class ManageAnalysesTool extends ClientDependentTool<ManageAnalysesInput, unknown> {
  readonly name = 'manage_analyses'
  readonly description = 'Manage platform analyses: list available analysis classes, create analyses, run them, poll status, and retrieve results. After calling "run", poll "status" until completed, then use "results" to get output.'
  readonly inputSchema = InputSchema

  async execute(input: ManageAnalysesInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtAnalysis = new DtAnalysis(context.apolloClient)

      switch (input.action) {
        case 'list_classes': {
          const classes = await dtAnalysis.findAnalysisClasses({})
          return { success: true, data: { analysis_classes: classes || [] } }
        }

        case 'list': {
          const analyses = await dtAnalysis.findAnalyses({ elementId: input.element_id! })
          return { success: true, data: { analyses: analyses || [], total: analyses?.length || 0 } }
        }

        case 'create': {
          const analysis = await dtAnalysis.createAnalysis({
            elementId: input.element_id!,
            name: input.name!,
            description: input.description || '',
            analysisClassId: input.analysis_class_id!
          })
          if (!analysis) {
            return { success: false, error: 'Failed to create analysis' }
          }
          return { success: true, data: { analysis } }
        }

        case 'run': {
          const sessionId = await dtAnalysis.runAnalysis({
            analysisId: input.analysis_id!
          })
          return {
            success: true,
            data: {
              session_id: sessionId,
              status: 'started',
              next: 'Poll "status" action until completed, then use "results" to get output'
            }
          }
        }

        case 'status': {
          const status = await dtAnalysis.getAnalysisValues({
            analysisId: input.analysis_id!,
            valueKey: 'status'
          })
          return { success: true, data: { analysis_id: input.analysis_id, status } }
        }

        case 'results': {
          const results = await dtAnalysis.getDocument({
            analysisId: input.analysis_id!,
            filter: {}
          })
          if (!results) {
            return {
              success: true,
              data: {
                analysis_id: input.analysis_id,
                status: 'no_results',
                message: 'No results available yet. Check "status" to verify the analysis has completed.'
              }
            }
          }
          return { success: true, data: { analysis_id: input.analysis_id, results } }
        }

        case 'delete': {
          const deleted = await dtAnalysis.deleteAnalysis({ analysisId: input.analysis_id! })
          return { success: true, data: { deleted, analysis_id: input.analysis_id } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis operation failed'
      }
    }
  }
}

export const manageAnalysesTool = new ManageAnalysesTool()
