/**
 * Match Classes Tool
 *
 * Matches elements against the class catalog using a multi-priority pipeline
 * (exact name, fuzzy name, vector similarity, type-filtered heuristic).
 * Returns ranked candidates for each element.
 */

import { z } from 'zod'
import { DtClass } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  elements: z.array(z.object({
    name: z.string().describe('Element name to match against classes'),
    type: z.string().optional().describe('Element type (e.g. PROCESS, STORE, EXTERNAL_ENTITY)'),
    description: z.string().optional().describe('Element description for semantic matching'),
  })).min(1).max(100).describe('Elements to classify (max 100 per call)'),
  classLabel: z.enum(['COMPONENT', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL'])
    .describe('Class category to match against'),
  componentType: z.enum(['PROCESS', 'STORE', 'EXTERNAL_ENTITY']).optional()
    .describe('Filter ComponentClass by type (only when classLabel is COMPONENT)'),
  moduleIds: z.array(z.string()).optional()
    .describe('Restrict to classes from these modules'),
  topN: z.number().int().min(1).max(10).optional().default(3)
    .describe('Number of top candidates per element (default 3)'),
  fields: z.array(z.enum(['description', 'category', 'type'])).optional()
    .describe('Optional fields to include on candidates'),
})

type MatchClassesInput = z.infer<typeof InputSchema>

interface MatchClassesOutput {
  matches: Array<{
    elementName: string
    candidates: Array<{
      classId: string
      className: string
      classDescription?: string
      classCategory?: string
      classType?: string
      moduleName: string
      matchType: string
      confidence: string
      similarityScore?: number
    }>
  }>
  unmatched: string[]
  total_elements: number
  matched_count: number
  unmatched_count: number
  /** Whether semantic (vector) search is available on this deployment. */
  vector_search_available: boolean
  /** Present only when vector_search_available === false; a human-readable hint AI agents can relay. */
  clarification?: string
}

export class MatchClassesTool extends ClientDependentTool<MatchClassesInput, MatchClassesOutput> {
  readonly name = 'match_classes'
  readonly description = 'Match elements against the class catalog using a multi-priority pipeline (exact name, fuzzy name, vector similarity, type). Returns ranked candidates for each element. Use this instead of multiple get_classes calls when classifying model elements.'
  readonly inputSchema = InputSchema

  async execute(input: MatchClassesInput, context: ToolContext): Promise<ToolResult<MatchClassesOutput>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtClass = new DtClass(context.apolloClient)

      const result = await dtClass.matchClasses({
        elements: input.elements,
        classLabel: input.classLabel,
        ...(input.componentType ? { componentType: input.componentType } : {}),
        ...(input.moduleIds ? { moduleIds: input.moduleIds } : {}),
        ...(input.topN !== undefined ? { topN: input.topN } : {}),
        ...(input.fields ? { fields: input.fields } : {}),
      })

      // Destructure rather than spread: re-emit `vectorAvailable` under the
      // snake_case `vector_search_available` so the output has one canonical
      // spelling for AI agents to read.
      const { matches, unmatched, vectorAvailable } = result
      return {
        success: true,
        data: {
          matches,
          unmatched,
          total_elements: input.elements.length,
          matched_count: matches.length,
          unmatched_count: unmatched.length,
          vector_search_available: vectorAvailable,
          ...(vectorAvailable
            ? {}
            : {
                clarification:
                  'Semantic (vector) search is not available on this deployment; results are name- and type-based only.',
              }),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to match classes',
      }
    }
  }
}

export const matchClassesTool = new MatchClassesTool()
