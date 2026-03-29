/**
 * Search MITRE ATT&CK Tool
 *
 * Search and browse MITRE ATT&CK techniques from the platform's graph database.
 * All technique references are verified against the platform — no hallucinated IDs.
 */

import { z } from 'zod'
import { DtMitreAttack } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const MAX_SEARCH_RESULTS = 20

const InputSchema = z.object({
  action: z.enum([
    'search',
    'tactics',
    'techniques_by_tactic',
    'technique',
    'mitigations',
    'mitigation'
  ]).describe('Action to perform'),
  query: z.string().optional().describe('Search query for technique name (required for "search" action)'),
  tactic_id: z.string().optional().describe('Tactic ID to filter techniques (required for "techniques_by_tactic")'),
  attack_id: z.string().optional().describe('ATT&CK technique or mitigation ID (required for "technique" and "mitigation" actions)')
}).superRefine((data, ctx) => {
  if (data.action === 'search' && !data.query) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"query" is required for "search" action', path: ['query'] })
  }
  if (data.action === 'techniques_by_tactic' && !data.tactic_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"tactic_id" is required for "techniques_by_tactic" action', path: ['tactic_id'] })
  }
  if ((data.action === 'technique' || data.action === 'mitigation') && !data.attack_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"attack_id" is required for this action', path: ['attack_id'] })
  }
})

type SearchMitreAttackInput = z.infer<typeof InputSchema>

export class SearchMitreAttackTool extends ClientDependentTool<SearchMitreAttackInput, unknown> {
  readonly name = 'search_mitre_attack'
  readonly description = 'Search and browse MITRE ATT&CK techniques, tactics, and mitigations from the platform database. Use this to verify technique IDs before referencing them in a threat model.'
  readonly inputSchema = InputSchema

  async execute(input: SearchMitreAttackInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtMitreAttack = new DtMitreAttack(context.apolloClient)

      switch (input.action) {
        case 'search': {
          const techniques = await dtMitreAttack.findMitreAttackTechniques({
            query: { name: { contains: input.query! } }
          })
          return {
            success: true,
            data: {
              techniques: techniques.slice(0, MAX_SEARCH_RESULTS),
              total: techniques.length,
              truncated: techniques.length > MAX_SEARCH_RESULTS
            }
          }
        }

        case 'tactics': {
          const tactics = await dtMitreAttack.getMitreAttackTactics()
          return { success: true, data: { tactics } }
        }

        case 'techniques_by_tactic': {
          const techniques = await dtMitreAttack.getMitreAttackTechniquesByTactic({
            tacticId: input.tactic_id!
          })
          return { success: true, data: { techniques, tactic_id: input.tactic_id } }
        }

        case 'technique': {
          const technique = await dtMitreAttack.getMitreAttackTechnique({
            attackId: input.attack_id!
          })
          if (!technique) {
            return { success: false, error: `Technique ${input.attack_id} not found` }
          }
          return { success: true, data: { technique } }
        }

        case 'mitigations': {
          const mitigations = await dtMitreAttack.getMitreAttackMitigations()
          return { success: true, data: { mitigations } }
        }

        case 'mitigation': {
          const mitigation = await dtMitreAttack.getMitreAttackMitigation({
            attackId: input.attack_id!
          })
          if (!mitigation) {
            return { success: false, error: `Mitigation ${input.attack_id} not found` }
          }
          return { success: true, data: { mitigation } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MITRE ATT&CK search failed'
      }
    }
  }
}

export const searchMitreAttackTool = new SearchMitreAttackTool()
