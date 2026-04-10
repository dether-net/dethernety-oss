/**
 * Manage Controls Tool
 *
 * CRUD and assignment operations for security controls on the Dethernety platform.
 * Controls can be assigned to component classes, linked to exposures via countermeasures,
 * and assigned to model elements via SUPPORTS edges.
 */

import { z } from 'zod'
import { DtControl } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'delete', 'assign']).describe('Action to perform'),
  folder_id: z.string().optional().describe('Folder ID for listing or creating controls'),
  control_id: z.string().optional().describe('Control ID (required for get, update, delete, assign)'),
  class_ids: z.array(z.string()).optional().describe('Control class IDs for filtering (list) or assignment (create/update)'),
  name: z.string().optional().describe('Control name — required for create, substring filter for list'),
  description: z.string().optional().describe('Control description'),
  class_type: z.string().optional().describe('Control class type filter (for list action)'),
  element_ids: z.array(z.string()).optional().describe('Element IDs — for list: filter controls supporting these elements; for assign: elements to link'),
  module_id: z.string().optional().describe('Module ID filter (for list action)'),
  module_name: z.string().optional().describe('Module name filter (for list action)'),
}).superRefine((data, ctx) => {
  if (['get', 'update', 'delete'].includes(data.action) && !data.control_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for this action', path: ['control_id'] })
  }
  if (data.action === 'create' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"name" is required for "create" action', path: ['name'] })
  }
  if (data.action === 'assign' && (!data.control_id || !data.element_ids || data.element_ids.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" and "element_ids" are required for "assign" action', path: ['control_id'] })
  }
})

type ManageControlsInput = z.infer<typeof InputSchema>

export class ManageControlsTool extends ClientDependentTool<ManageControlsInput, unknown> {
  readonly name = 'manage_controls'
  readonly description = 'Create, read, update, delete, and assign security controls on the Dethernety platform. Controls can be assigned to component classes, linked to exposures via countermeasures, and assigned to model elements. Use "list" with filters (name, class_type, element_ids, module_name) for flexible search.'
  readonly inputSchema = InputSchema

  async execute(input: ManageControlsInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtControl = new DtControl(context.apolloClient)

      switch (input.action) {
        case 'list': {
          const hasAdvancedFilters = input.name || input.class_type || input.element_ids || input.module_id || input.module_name

          if (!hasAdvancedFilters) {
            // Legacy path: folder_id + optional client-side class_ids filter
            let controls = await dtControl.getControls({ folderId: input.folder_id })
            if (input.class_ids && input.class_ids.length > 0) {
              const classIdSet = new Set(input.class_ids)
              controls = controls.filter(c =>
                c.controlClasses?.some(cc => cc.id && classIdSet.has(cc.id))
              )
            }
            return { success: true, data: { controls, total: controls.length } }
          }

          // Advanced path: server-side filtering via findControls
          const controls = await dtControl.findControls({
            controlId: input.control_id,
            name: input.name,
            classId: input.class_ids?.[0],
            classType: input.class_type,
            elementIds: input.element_ids,
            moduleId: input.module_id,
            moduleName: input.module_name,
          })
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

        case 'assign': {
          const control = await dtControl.assignControlToElements({
            controlId: input.control_id!,
            elementIds: input.element_ids!,
          })
          if (!control) {
            return { success: false, error: `Failed to assign control ${input.control_id} to elements` }
          }
          return { success: true, data: { control, assigned_elements: input.element_ids!.length } }
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
