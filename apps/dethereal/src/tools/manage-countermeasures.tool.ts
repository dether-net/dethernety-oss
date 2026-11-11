/**
 * Manage Countermeasures Tool
 *
 * CRUD operations for countermeasures that link controls to exposures.
 * Full schema: type, category, score, exposure references, and links to
 * D3FEND techniques and ATT&CK mitigations by the platform's node ids.
 */

import { z } from 'zod'
import { DtCountermeasure, type Countermeasure } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const Fields = z.object({
  action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('CRUD action to perform'),
  control_id: z.string().optional().describe('Control ID (required for "list" and "create")'),
  countermeasure_id: z.string().optional().describe('Countermeasure ID (required for "get", "update", "delete")'),
  name: z.string().optional().describe('Countermeasure name. For update: omitted = unchanged'),
  type: z.enum(['preventive', 'detective', 'corrective']).optional().describe('Countermeasure type. For update: omitted = unchanged'),
  category: z.string().optional().describe('Category (e.g., "access-control", "encryption", "monitoring"). For update: omitted = unchanged'),
  description: z.string().optional().describe('Description. For update: omitted = unchanged'),
  score: z.number().min(0).max(100).optional().describe('Effectiveness score (0-100, default 50 on create). For update: omitted = unchanged'),
  exposure_ids: z.array(z.string()).optional().describe('IDs of exposures this countermeasure addresses. For update: omitted = current links preserved; provided list REPLACES them'),
  defend_technique_ids: z.array(z.string()).optional().describe('The platform\'s node ids of D3FEND techniques: the `id` that get_mitre_defend (action "technique") returns, not a D3FEND code such as D3-MFA (a code is refused). For update: omitted = current links preserved; provided list REPLACES them'),
  mitigations: z.array(z.object({ id: z.string() })).optional().describe('The platform\'s node ids of ATT&CK mitigations, each as { id }: the `id` that search_mitre_attack (action "mitigation") returns, not an ATT&CK code such as M1032 (a code is refused). For update: omitted = current links preserved; provided list REPLACES them'),
  references: z.string().optional().describe('External references. For update: omitted = unchanged')
})

/** The checks each action's fields need, in the public and the internal schema alike. */
const checkFields = (data: z.infer<typeof Fields>, ctx: z.RefinementCtx) => {
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
}

/** Every action: what execute takes, and what query_countermeasures runs through it (list, get). */
const InternalSchema = Fields.superRefine(checkFields)
/** What an MCP client may call: the write actions only. Reading countermeasures is query_countermeasures'. */
const InputSchema = Fields.extend({ action: z.enum(['create', 'update', 'delete']).describe('Action to perform') }).superRefine(checkFields)

type ManageCountermeasuresInput = z.infer<typeof InternalSchema>

/**
 * A MITRE code where a node id belongs: an ATT&CK mitigation (M1032), a D3FEND technique (D3-MFA) or
 * an ATT&CK technique (T1078, T1078.004). The platform links by node id, so a code links nothing,
 * and the write would succeed without the link.
 */
const MITRE_CODE = /^(?:M\d{4}|D3-[A-Za-z0-9-]+|T\d{4}(?:\.\d{3})?)$/i

/** The code-shaped values among the link ids a write was given. */
function mitreCodes(input: ManageCountermeasuresInput): string[] {
  const ids = [...(input.defend_technique_ids ?? []), ...(input.mitigations ?? []).map((m) => m.id)]
  return [...new Set(ids.filter((id) => MITRE_CODE.test(id.trim())))]
}

/**
 * The ids the call asked to link that the written countermeasure does not hold: an id that is no node
 * of that kind on the platform connects nothing, silently. Only the lists the call gave are checked
 * (an update's preserved links are not the call's). Null when the response does not carry the links.
 */
function notLinked(input: ManageCountermeasuresInput, written: Countermeasure): { mitigations: string[]; defend_technique_ids: string[] } | null {
  const held = (list: unknown): Set<string> | null => (Array.isArray(list) ? new Set(list.map((x: { id?: unknown }) => String(x?.id))) : null)
  const mitigations = held(written.mitigations)
  const techniques = held(written.defendedTechniques)
  const missing = {
    mitigations: input.mitigations && mitigations ? input.mitigations.map((m) => m.id).filter((id) => !mitigations.has(id)) : [],
    defend_technique_ids: input.defend_technique_ids && techniques ? input.defend_technique_ids.filter((id) => !techniques.has(id)) : [],
  }
  return missing.mitigations.length || missing.defend_technique_ids.length ? missing : null
}

const LOOKUP = 'Look each one up and use the `id` it returns: an ATT&CK mitigation with search_mitre_attack (action "mitigation", attack_id), a D3FEND technique with get_mitre_defend (action "technique", d3fend_id).'

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
  readonly description = 'Create, update and delete countermeasures that link security controls to exposures; list and read them with query_countermeasures. Countermeasures document what defenses exist and their effectiveness. Update and delete apply only to USER countermeasures: a SYSTEM countermeasure is derived from its control\'s class policy and rewritten on every save of the control, so an update or delete of one is refused; supersede it into a USER copy and edit that, or change the control\'s attribute answers.'
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

      // A MITRE code links nothing: refused before anything is read or written.
      if (input.action === 'create' || input.action === 'update') {
        const codes = mitreCodes(input)
        if (codes.length) {
          return {
            success: false,
            error: `mitigations and defend_technique_ids take the platform's node ids, not MITRE codes: ${codes.join(', ')}. ${LOOKUP} Nothing was written.`,
            data: { code: 'mitre_code_not_node_id', codes },
          }
        }
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
          const missing = notLinked(input, countermeasure)
          if (missing) {
            return {
              success: false,
              error: `The countermeasure was created (${countermeasure.id}), but these ids linked nothing: ${[...missing.mitigations, ...missing.defend_technique_ids].join(', ')}. They are not node ids of the platform's ATT&CK mitigations or D3FEND techniques. ${LOOKUP} Then update the countermeasure with them.`,
              data: { countermeasure, not_linked: missing },
            }
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
          const missing = notLinked(input, countermeasure)
          if (missing) {
            return {
              success: false,
              error: `Countermeasure ${input.countermeasure_id} was updated, but these ids linked nothing: ${[...missing.mitigations, ...missing.defend_technique_ids].join(', ')}. They are not node ids of the platform's ATT&CK mitigations or D3FEND techniques. ${LOOKUP} Then update it again with them.`,
              data: { countermeasure, not_linked: missing },
            }
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
