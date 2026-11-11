/**
 * Read-only queries over the platform's controls, exposures and countermeasures.
 *
 * These run without an approval prompt, so a specialist agent can read what it
 * needs while every tool that changes the platform keeps asking the operator.
 * Each tool accepts only its read actions and a bounded set of read inputs,
 * copies the per-action requirements of the matching `manage_*` tool, and
 * hands that tool an input built field by field from an allowlist: nothing a
 * caller adds reaches a writing branch.
 */
import { z } from 'zod'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { manageControlsTool } from './manage-controls.tool.js'
import { manageCountermeasuresTool } from './manage-countermeasures.tool.js'
import { manageExposuresTool } from './manage-exposures.tool.js'

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'ids contain only [A-Za-z0-9_-], at most 128 characters')
const TEXT = z.string().max(200)
const IDS = z.array(ID).max(500)
const ELEMENT_TYPES = z.array(z.enum(['PROCESS', 'EXTERNAL_ENTITY', 'STORE', 'BOUNDARY', 'DATA_FLOW', 'DATA'])).min(1).max(10)
const LIMIT = z.number().int().min(1).max(500)
export const DEFAULT_LIMIT = 100

const need = (ctx: z.RefinementCtx, ok: boolean, field: string, action: string) => {
  if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${field}" is required for "${action}"`, path: [field] })
}
const only = (ctx: z.RefinementCtx, present: boolean, field: string, actions: string) => {
  if (present) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${field}" applies only to ${actions}`, path: [field] })
}

/**
 * Cap a list the manage tool returned: `total` stays the uncapped count, and
 * `truncated` appears only when items were cut. Warnings are kept.
 */
function capList(result: ToolResult<unknown>, key: string, limit: number): ToolResult<unknown> {
  if (!result.success || !result.data || typeof result.data !== 'object') return result
  const data = result.data as Record<string, unknown>
  const items = data[key]
  if (!Array.isArray(items)) return result
  const capped = items.length > limit
  return { ...result, data: { ...data, [key]: capped ? items.slice(0, limit) : items, total: items.length, ...(capped ? { truncated: true } : {}) } }
}

const refuse = (action: string): ToolResult<unknown> => ({ success: false, error: `"${action}" is not a read action` })

// =============================================================================
// Controls
// =============================================================================

const CONTROL_READS = new Set(['list', 'get', 'rank'])
const ControlsSchema = z.object({
  action: z.enum(['list', 'get', 'rank']).describe("'list' filters controls; 'get' reads one (control_id); 'rank' scores candidate controls for element types"),
  folder_id: ID.or(z.literal('all')).optional().describe("For 'list': a folder id, or 'all'"),
  control_id: ID.optional().describe("For 'get', or a filter for 'list'"),
  class_ids: IDS.optional().describe("For 'list': control class ids"),
  name: TEXT.optional().describe("For 'list': a name substring"),
  class_type: TEXT.optional().describe("For 'list': a control class type"),
  element_ids: IDS.optional().describe("For 'list': controls that support these elements"),
  module_id: ID.optional().describe("For 'list' and 'rank': a module id"),
  module_name: TEXT.optional().describe("For 'list': a module name"),
  element_types: ELEMENT_TYPES.optional().describe("For 'rank': element types (PROCESS, EXTERNAL_ENTITY, STORE, BOUNDARY, DATA_FLOW, DATA)"),
  top_n: z.number().int().min(1).max(50).optional().describe("For 'rank': how many candidates to return (default 5)"),
  limit: LIMIT.optional().describe(`For 'list': most controls returned (default ${DEFAULT_LIMIT}); total is the full count`),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'get') need(ctx, !!d.control_id, 'control_id', 'get')
  if (d.action === 'rank') need(ctx, !!d.element_types?.length, 'element_types', 'rank')
  only(ctx, d.action !== 'list' && d.limit !== undefined, 'limit', 'list')
  only(ctx, d.action !== 'rank' && (d.top_n !== undefined || d.element_types !== undefined), d.top_n !== undefined ? 'top_n' : 'element_types', 'rank')
})
type ControlsInput = z.infer<typeof ControlsSchema>
type ManageControlsInput = Parameters<typeof manageControlsTool.execute>[0]

export class QueryControlsTool extends ClientDependentTool<ControlsInput, unknown> {
  readonly name = 'query_controls'
  readonly description =
    'Read-only: list, get or rank the platform\'s security controls. It never changes the platform; create, update, ' +
    'assign or delete controls with manage_controls. rank returns the top_n candidates for the given element types ' +
    '(its total counts the returned candidates).'
  readonly inputSchema = ControlsSchema

  async execute(input: ControlsInput, context: ToolContext): Promise<ToolResult<unknown>> {
    if (!CONTROL_READS.has(input.action)) return refuse(input.action)
    const forward = (fields: Partial<ManageControlsInput>) => manageControlsTool.execute({ action: input.action, ...fields } as ManageControlsInput, context)
    switch (input.action) {
      case 'get':
        return forward({ control_id: input.control_id })
      case 'rank':
        return forward({ element_types: input.element_types, module_id: input.module_id, top_n: input.top_n })
      case 'list': {
        const result = await forward({
          folder_id: input.folder_id, control_id: input.control_id, class_ids: input.class_ids, name: input.name,
          class_type: input.class_type, element_ids: input.element_ids, module_id: input.module_id, module_name: input.module_name,
        })
        return capList(result, 'controls', input.limit ?? DEFAULT_LIMIT)
      }
    }
    return refuse(input.action)
  }
}

// =============================================================================
// Exposures
// =============================================================================

const EXPOSURE_READS = new Set(['list', 'get'])
const ExposuresSchema = z.object({
  action: z.enum(['list', 'get']).describe("'list' reads an element's exposures (element_id); 'get' reads one (exposure_id)"),
  element_id: ID.optional().describe("For 'list'"),
  exposure_id: ID.optional().describe("For 'get'"),
  limit: LIMIT.optional().describe(`For 'list': most exposures returned (default ${DEFAULT_LIMIT}); total is the full count`),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'list') need(ctx, !!d.element_id, 'element_id', 'list')
  if (d.action === 'get') need(ctx, !!d.exposure_id, 'exposure_id', 'get')
  only(ctx, d.action !== 'list' && d.limit !== undefined, 'limit', 'list')
})
type ExposuresInput = z.infer<typeof ExposuresSchema>
type ManageExposuresInput = Parameters<typeof manageExposuresTool.execute>[0]

export class QueryExposuresTool extends ClientDependentTool<ExposuresInput, unknown> {
  readonly name = 'query_exposures'
  readonly description =
    'Read-only: list the platform-computed exposures of a model element, or get one. Exposures come from the ' +
    'platform\'s analysis; nothing here changes them.'
  readonly inputSchema = ExposuresSchema

  async execute(input: ExposuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    if (!EXPOSURE_READS.has(input.action)) return refuse(input.action)
    if (input.action === 'get') {
      return manageExposuresTool.execute({ action: 'get', exposure_id: input.exposure_id } as ManageExposuresInput, context)
    }
    const result = await manageExposuresTool.execute({ action: 'list', element_id: input.element_id } as ManageExposuresInput, context)
    return capList(result, 'exposures', input.limit ?? DEFAULT_LIMIT)
  }
}

// =============================================================================
// Countermeasures
// =============================================================================

const COUNTERMEASURE_READS = new Set(['list', 'get'])
const CountermeasuresSchema = z.object({
  action: z.enum(['list', 'get']).describe("'list' reads a control's countermeasures (control_id); 'get' reads one (countermeasure_id)"),
  control_id: ID.optional().describe("For 'list'"),
  countermeasure_id: ID.optional().describe("For 'get'"),
  limit: LIMIT.optional().describe(`For 'list': most countermeasures returned (default ${DEFAULT_LIMIT}); total is the full count`),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'list') need(ctx, !!d.control_id, 'control_id', 'list')
  if (d.action === 'get') need(ctx, !!d.countermeasure_id, 'countermeasure_id', 'get')
  only(ctx, d.action !== 'list' && d.limit !== undefined, 'limit', 'list')
})
type CountermeasuresInput = z.infer<typeof CountermeasuresSchema>
type ManageCountermeasuresInput = Parameters<typeof manageCountermeasuresTool.execute>[0]

export class QueryCountermeasuresTool extends ClientDependentTool<CountermeasuresInput, unknown> {
  readonly name = 'query_countermeasures'
  readonly description =
    'Read-only: list the countermeasures of a control, or get one. It never changes the platform; create, update ' +
    'or delete countermeasures with manage_countermeasures.'
  readonly inputSchema = CountermeasuresSchema

  async execute(input: CountermeasuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    if (!COUNTERMEASURE_READS.has(input.action)) return refuse(input.action)
    if (input.action === 'get') {
      return manageCountermeasuresTool.execute({ action: 'get', countermeasure_id: input.countermeasure_id } as ManageCountermeasuresInput, context)
    }
    const result = await manageCountermeasuresTool.execute({ action: 'list', control_id: input.control_id } as ManageCountermeasuresInput, context)
    return capList(result, 'countermeasures', input.limit ?? DEFAULT_LIMIT)
  }
}

export const queryControlsTool = new QueryControlsTool()
export const queryExposuresTool = new QueryExposuresTool()
export const queryCountermeasuresTool = new QueryCountermeasuresTool()
