/**
 * Manage Countermeasures Tool
 *
 * CRUD operations for countermeasures that link controls to exposures.
 * Full schema per D28: type, category, score, exposure references,
 * D3FEND technique references, ATT&CK mitigation references.
 */

import { z } from 'zod'
import { DtCountermeasure, type Countermeasure } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('CRUD action to perform'),
  control_id: z.string().optional().describe('Control ID (required for "list" and "create")'),
  countermeasure_id: z.string().optional().describe('Countermeasure ID (required for "get", "update", "delete")'),
  name: z.string().optional().describe('Countermeasure name'),
  type: z.enum(['preventive', 'detective', 'corrective']).optional().describe('Countermeasure type'),
  category: z.string().optional().describe('Category (e.g., "access-control", "encryption", "monitoring")'),
  description: z.string().optional().describe('Description'),
  score: z.number().min(0).max(100).optional().describe('Effectiveness score (0-100, default 50)'),
  exposure_ids: z.array(z.string()).optional().describe('IDs of exposures this countermeasure addresses'),
  defend_technique_ids: z.array(z.string()).optional().describe('D3FEND technique IDs'),
  mitigations: z.array(z.object({ id: z.string() })).optional().describe('ATT&CK mitigation references'),
  references: z.string().optional().describe('External references')
}).superRefine((data, ctx) => {
  if (data.action === 'list' && !data.control_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "list" action', path: ['control_id'] })
  }
  if (data.action === 'create' && !data.control_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "create" action', path: ['control_id'] })
  }
  if (data.action === 'create' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"name" is required for "create" action', path: ['name'] })
  }
  if (['get', 'update', 'delete'].includes(data.action) && !data.countermeasure_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"countermeasure_id" is required for this action', path: ['countermeasure_id'] })
  }
})

type ManageCountermeasuresInput = z.infer<typeof InputSchema>

export class ManageCountermeasuresTool extends ClientDependentTool<ManageCountermeasuresInput, unknown> {
  readonly name = 'manage_countermeasures'
  readonly description = 'Create, read, update, and delete countermeasures that link security controls to exposures. Countermeasures document what defenses exist and their effectiveness.'
  readonly inputSchema = InputSchema

  private buildCountermeasureInput(input: ManageCountermeasuresInput): Partial<Countermeasure> {
    return {
      name: input.name || '',
      description: input.description || '',
      type: input.type || 'preventive',
      category: input.category || '',
      score: input.score ?? 50,
      references: input.references || '',
      addressedExposures: input.exposure_ids || [],
      tags: [],
      defendedTechniques: input.defend_technique_ids?.map(id => ({ id } as any)) || [],
      mitigations: input.mitigations as any[] || []
    }
  }

  async execute(input: ManageCountermeasuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtCountermeasure = new DtCountermeasure(context.apolloClient)

      switch (input.action) {
        case 'list': {
          const countermeasures = await dtCountermeasure.getCountermeasuresFromControl({
            controlId: input.control_id!
          })
          return { success: true, data: { countermeasures: countermeasures || [], total: countermeasures?.length || 0 } }
        }

        case 'get': {
          const countermeasure = await dtCountermeasure.getCountermeasure({
            countermeasureId: input.countermeasure_id!
          })
          if (!countermeasure) {
            return { success: false, error: `Countermeasure ${input.countermeasure_id} not found` }
          }
          return { success: true, data: { countermeasure } }
        }

        case 'create': {
          const cmInput = this.buildCountermeasureInput(input) as Countermeasure
          const countermeasure = await dtCountermeasure.createCountermeasure({
            controlId: input.control_id!,
            countermeasure: cmInput
          })
          if (!countermeasure) {
            return { success: false, error: 'Failed to create countermeasure' }
          }
          return { success: true, data: { countermeasure } }
        }

        case 'update': {
          const cmInput = this.buildCountermeasureInput(input) as Countermeasure
          const countermeasure = await dtCountermeasure.updateCountermeasure({
            countermeasureId: input.countermeasure_id!,
            countermeasure: cmInput
          })
          if (!countermeasure) {
            return { success: false, error: `Failed to update countermeasure ${input.countermeasure_id}` }
          }
          return { success: true, data: { countermeasure } }
        }

        case 'delete': {
          const deleted = await dtCountermeasure.deleteCountermeasure({
            countermeasureId: input.countermeasure_id!
          })
          return { success: true, data: { deleted, countermeasure_id: input.countermeasure_id } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Countermeasure operation failed'
      }
    }
  }
}

export const manageCountermeasuresTool = new ManageCountermeasuresTool()
