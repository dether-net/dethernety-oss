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
  name: z.string().optional().describe('Countermeasure name. For update: omitted = unchanged'),
  type: z.enum(['preventive', 'detective', 'corrective']).optional().describe('Countermeasure type. For update: omitted = unchanged'),
  category: z.string().optional().describe('Category (e.g., "access-control", "encryption", "monitoring"). For update: omitted = unchanged'),
  description: z.string().optional().describe('Description. For update: omitted = unchanged'),
  score: z.number().min(0).max(100).optional().describe('Effectiveness score (0-100, default 50 on create). For update: omitted = unchanged'),
  exposure_ids: z.array(z.string()).optional().describe('IDs of exposures this countermeasure addresses. For update: omitted = current links preserved; provided list REPLACES them'),
  defend_technique_ids: z.array(z.string()).optional().describe('D3FEND technique IDs. For update: omitted = current links preserved; provided list REPLACES them'),
  mitigations: z.array(z.object({ id: z.string() })).optional().describe('ATT&CK mitigation references. For update: omitted = current links preserved; provided list REPLACES them'),
  references: z.string().optional().describe('External references. For update: omitted = unchanged')
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

/** Why an update of a SYSTEM countermeasure is refused, and what to do instead. */
export function systemCountermeasureRefusal(countermeasureId: string, name?: string): string {
  const which = name ? `"${name}" (${countermeasureId})` : countermeasureId
  return `Countermeasure ${which} is derived from its control's class policy (createdBy SYSTEM). ` +
    'The platform rewrites it from that policy on every save of the control, so an update here would be undone. ' +
    'To change it, supersede it into a USER copy (in the platform, the countermeasure\'s ' +
    '"Customize as an editable copy" action), then update the copy with this tool.'
}

/** Why a delete of a SYSTEM countermeasure is refused, and what to do instead. */
export function systemCountermeasureDeleteRefusal(countermeasureId: string, name?: string): string {
  const which = name ? `"${name}" (${countermeasureId})` : countermeasureId
  return `Countermeasure ${which} is derived from its control's class policy (createdBy SYSTEM). ` +
    'The platform re-creates it from that policy on the next save of the control, so a delete here would be undone. ' +
    'To remove it, change the control\'s attribute answers so its policy no longer derives it, or supersede it into a ' +
    'USER copy (in the platform, the countermeasure\'s "Customize as an editable copy" action) and change that copy.'
}

export class ManageCountermeasuresTool extends ClientDependentTool<ManageCountermeasuresInput, unknown> {
  readonly name = 'manage_countermeasures'
  readonly description = 'Create, read, update, and delete countermeasures that link security controls to exposures. Countermeasures document what defenses exist and their effectiveness. Update and delete apply only to USER countermeasures: a SYSTEM countermeasure is derived from its control\'s class policy and rewritten on every save of the control, so an update or delete of one is refused; supersede it into a USER copy and edit that, or change the control\'s attribute answers.'
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
          // updateCountermeasure is full-replace on the platform side: every
          // scalar is set, and mitigations/defendedTechniques are
          // disconnect-all + reconnect. Omitted inputs must preserve the
          // current values — fetch them first and merge. Provided lists
          // REPLACE the stored ones.
          const current = await dtCountermeasure.getCountermeasure({
            countermeasureId: input.countermeasure_id!
          })
          if (!current) {
            return { success: false, error: `Countermeasure ${input.countermeasure_id} not found` }
          }
          // A SYSTEM countermeasure (or a legacy one with no createdBy) is exactly what its class
          // policy says: every save of the control rewrites its fields and links from the policy, so
          // an edit here would be undone silently. Refuse it and name the supported edit.
          if (current.createdBy !== 'USER') {
            return { success: false, error: systemCountermeasureRefusal(input.countermeasure_id!, current.name) }
          }
          const merged = {
            name: input.name ?? current.name ?? '',
            description: input.description ?? current.description ?? '',
            type: input.type ?? current.type ?? 'preventive',
            category: input.category ?? current.category ?? '',
            score: input.score ?? current.score ?? 50,
            references: input.references ?? current.references ?? '',
            addressedExposures: input.exposure_ids ?? current.addressedExposures ?? [],
            tags: current.tags ?? [],
            defendedTechniques: input.defend_technique_ids
              ? input.defend_technique_ids.map(id => ({ id } as any))
              : current.defendedTechniques ?? [],
            mitigations: input.mitigations
              ? (input.mitigations as any[])
              : current.mitigations ?? []
          } as Countermeasure
          const countermeasure = await dtCountermeasure.updateCountermeasure({
            countermeasureId: input.countermeasure_id!,
            countermeasure: merged
          })
          if (!countermeasure) {
            return { success: false, error: `Failed to update countermeasure ${input.countermeasure_id}` }
          }
          return { success: true, data: { countermeasure } }
        }

        case 'delete': {
          // Pre-check existence, following the same pattern the update branch
          // uses above. This is not belt-and-braces: dt-core's
          // deleteCountermeasure returns `true` whenever the GraphQL response
          // object is merely non-nullish — it never inspects nodesDeleted — so
          // its boolean cannot distinguish "removed it" from "matched nothing".
          // Without this check the tool reported `deleted: true` for a
          // countermeasure that was never there.
          const existing = await dtCountermeasure.getCountermeasure({
            countermeasureId: input.countermeasure_id!
          })
          if (!existing) {
            return { success: false, error: `Countermeasure ${input.countermeasure_id} not found` }
          }
          // A SYSTEM (or legacy) countermeasure comes back on the next save of its control while
          // the policy still derives it, so a delete here would be undone. Refuse it, as update does.
          if (existing.createdBy !== 'USER') {
            return { success: false, error: systemCountermeasureDeleteRefusal(input.countermeasure_id!, existing.name) }
          }

          // Pass the name captured by the pre-check. dt-core uses it to flip
          // `dispositionStale` on any SYSTEM countermeasure this USER copy
          // superseded, and skips that companion entirely when the name is
          // absent (a wildcard match would flip unrelated dispositions). The
          // tool never supplied one, so deleting a USER copy silently left the
          // superseded SYSTEM countermeasure un-flipped. The name must be the
          // pre-delete value, which is exactly what the check above holds.
          const deleted = await dtCountermeasure.deleteCountermeasure({
            countermeasureId: input.countermeasure_id!,
            countermeasureName: existing.name,
          })
          if (!deleted) {
            // Wording stays non-committal, like manage_controls': dt-core's
            // deleteCountermeasure ends in `catch { return false }`, so a false
            // is a refusal, a nullish response, or a transport error that may
            // have deleted the node before failing — the boolean cannot tell
            // them apart. What it definitely is not is a confirmed delete, and
            // reporting success:true with deleted:false said exactly that.
            return {
              success: false,
              error: `Countermeasure ${input.countermeasure_id} delete was not confirmed — it may not have been removed`,
              data: { countermeasure_id: input.countermeasure_id, deleted: false },
            }
          }
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
