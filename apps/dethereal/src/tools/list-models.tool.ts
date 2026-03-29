/**
 * List Models Tool
 *
 * Lists threat models available on the Dethernety platform.
 * Supports filtering by folder and client-side name search.
 */

import { z } from 'zod'
import { DtModel } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  folder_id: z.string().optional().describe('Filter models by folder ID'),
  name: z.string().optional().describe('Filter models by name (case-insensitive substring match)')
})

type ListModelsInput = z.infer<typeof InputSchema>

interface ModelSummary {
  id: string
  name: string
  description?: string
}

interface ListModelsOutput {
  models: ModelSummary[]
  total: number
}

export class ListModelsTool extends ClientDependentTool<ListModelsInput, ListModelsOutput> {
  readonly name = 'list_models'
  readonly description = 'List threat models available on the Dethernety platform. Optionally filter by folder or name.'
  readonly inputSchema = InputSchema

  async execute(input: ListModelsInput, context: ToolContext): Promise<ToolResult<ListModelsOutput>> {
    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      const dtModel = new DtModel(context.apolloClient)
      let models = await dtModel.getModels({ folderId: input.folder_id })

      // Client-side name filter
      if (input.name) {
        const searchTerm = input.name.toLowerCase()
        models = models.filter(m => m.name?.toLowerCase().includes(searchTerm))
      }

      return {
        success: true,
        data: {
          models: models.map(m => ({
            id: m.id!,
            name: m.name || 'Unnamed',
            description: m.description || undefined
          })),
          total: models.length
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list models'
      }
    }
  }
}

export const listModelsTool = new ListModelsTool()
