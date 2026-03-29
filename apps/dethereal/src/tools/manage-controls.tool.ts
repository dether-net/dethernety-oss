/**
 * Manage Controls Tool
 *
 * CRUD operations for security controls on the Dethernety platform.
 * Controls can be assigned to component classes and linked to exposures via countermeasures.
 */

import { z } from 'zod'
import { DtControl } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('CRUD action to perform'),
  folder_id: z.string().optional().describe('Folder ID for listing or creating controls'),
  control_id: z.string().optional().describe('Control ID (required for get, update, delete)'),
  class_ids: z.array(z.string()).optional().describe('Control class IDs for filtering (list) or assignment (create/update)'),
  name: z.string().optional().describe('Control name (required for create)'),
  description: z.string().optional().describe('Control description')
}).superRefine((data, ctx) => {
  if (['get', 'update', 'delete'].includes(data.action) && !data.control_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for this action', path: ['control_id'] })
  }
  if (data.action === 'create' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"name" is required for "create" action', path: ['name'] })
  }
})

type ManageControlsInput = z.infer<typeof InputSchema>

export class ManageControlsTool extends ClientDependentTool<ManageControlsInput, unknown> {
  readonly name = 'manage_controls'
  readonly description = 'Create, read, update, and delete security controls on the Dethernety platform. Controls can be assigned to component classes and linked to exposures via countermeasures.'
  readonly inputSchema = InputSchema

  async execute(input: ManageControlsInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtControl = new DtControl(context.apolloClient)

      switch (input.action) {
        case 'list': {
          let controls = await dtControl.getControls({ folderId: input.folder_id })

          // Client-side class_ids filter
          if (input.class_ids && input.class_ids.length > 0) {
            const classIdSet = new Set(input.class_ids)
            controls = controls.filter(c =>
              c.controlClasses?.some(cc => cc.id && classIdSet.has(cc.id))
            )
          }

          return { success: true, data: { controls, total: controls.length } }
        }

        case 'get': {
          const control = await dtControl.getControl({ controlId: input.control_id! })
          if (!control) {
            return { success: false, error: `Control ${input.control_id} not found` }
          }
          return { success: true, data: { control } }
        }

        case 'create': {
          const control = await dtControl.createControl({
            newControl: { name: input.name!, description: input.description } as any,
            classIds: input.class_ids || null,
            folderId: input.folder_id
          })
          if (!control) {
            return { success: false, error: 'Failed to create control' }
          }
          return { success: true, data: { control } }
        }

        case 'update': {
          const control = await dtControl.updateControl({
            controlId: input.control_id!,
            name: input.name || '',
            description: input.description || '',
            controlClasses: input.class_ids || [],
            folderId: input.folder_id
          })
          if (!control) {
            return { success: false, error: `Failed to update control ${input.control_id}` }
          }
          return { success: true, data: { control } }
        }

        case 'delete': {
          const deleted = await dtControl.deleteControl({ controlId: input.control_id! })
          return { success: true, data: { deleted, control_id: input.control_id } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Control operation failed'
      }
    }
  }
}

export const manageControlsTool = new ManageControlsTool()
