/**
 * Read-only queries over the platform's controls, exposures and countermeasures.
 *
 * These run without an approval prompt, so a specialist agent can read what it
 * needs while every tool that changes the platform keeps asking the operator.
 * Each tool accepts only its read actions and a bounded set of read inputs,
 * copies the per-action requirements of the matching `manage_*` tool, and
 * hands that tool an input built field by field from an allowlist: nothing a
 * caller adds reaches a writing branch. The exposure reads of a whole model
 * (`list_model`, `evidence`) have no manage counterpart and query the platform
 * themselves; `list_model` answers in views small enough to reach the model whole.
 */
import { z } from 'zod'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { coded, PLATFORM_ID, need, only } from './input-rules.js'
import { manageControlsTool } from './manage-controls.tool.js'
import { manageCountermeasuresTool } from './manage-countermeasures.tool.js'
import { manageExposuresTool } from './manage-exposures.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { platformModelOf, TriageModelError } from '../triage/model.js'
import { ModelReadError, readExposureEvidence, readModelExposures, ROW_REASON_MAX } from '../triage/exposures.js'
import { elementOf, GROUP_PART_MAX, groupTriageSet, listingOf, pageOf, PARTS_MAX, partitionView, rowOf, selectRows, triageRows } from '../triage/model-views.js'
import { keepTriageFilesOut } from '../triage/log.js'
import { hiddenEdgeFlows } from '../hidden-edges/predicate.js'
import { readDataFlows } from '../utils/directory-utils.js'

const TEXT = z.string().max(200)
const IDS = z.array(PLATFORM_ID).max(500)
const ELEMENT_TYPES = z.array(z.enum(['PROCESS', 'EXTERNAL_ENTITY', 'STORE', 'BOUNDARY', 'DATA_FLOW', 'DATA'])).min(1).max(10)
const LIMIT = z.number().int().min(1).max(500)
export const DEFAULT_LIMIT = 100

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
  folder_id: PLATFORM_ID.or(z.literal('all')).optional().describe("For 'list': a folder id, or 'all'"),
  control_id: PLATFORM_ID.optional().describe("For 'get', or a filter for 'list'"),
  class_ids: IDS.optional().describe("For 'list': control class ids"),
  name: TEXT.optional().describe("For 'list': a name substring"),
  class_type: TEXT.optional().describe("For 'list': a control class type"),
  element_ids: IDS.optional().describe("For 'list': controls that support these elements"),
  module_id: PLATFORM_ID.optional().describe("For 'list' and 'rank': a module id"),
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

const EXPOSURE_READS = new Set(['list', 'get', 'list_model', 'evidence'])
const LISTING = z.string().regex(/^[0-9a-f]{16}$/, 'a listing is 16 hexadecimal characters')
const ExposuresSchema = z.object({
  action: z.enum(['list', 'get', 'list_model', 'evidence']).describe(
    "'list' reads an element's exposures (element_id); 'get' reads one (exposure_id); 'list_model' reads the exposures " +
    "of a model directory's platform model (directory_path) in the given view; 'evidence' reads one exposure's full evidence (exposure_id)",
  ),
  element_id: PLATFORM_ID.optional().describe("For 'list'; for 'list_model', narrows the view to one element"),
  exposure_id: PLATFORM_ID.optional().describe("For 'get' and 'evidence'"),
  limit: LIMIT.optional().describe(`For 'list': most exposures returned (default ${DEFAULT_LIMIT}); total is the full count`),
  directory_path: z.string().min(1).max(4096).optional().describe("For 'list_model': the model directory, pushed to the configured platform"),
  view: z.enum(['partition', 'groups', 'rows']).optional().describe(
    "For 'list_model': 'partition' (the default) the counts only; 'groups' the triage set, grouped; 'rows' the rows select picks",
  ),
  select: z.enum(['stale', 'user', 'all']).optional().describe("For 'list_model' view 'rows': stale dispositions, USER-created rows, or all (the default)"),
  offset: z.number().int().min(0).max(100_000).optional().describe("For 'list_model' views 'groups' and 'rows': where the page starts, 0 or the previous page's next_offset"),
  listing: LISTING.optional().describe("For 'list_model' views 'groups' and 'rows' past offset 0: the listing the first page returned"),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'list') need(ctx, !!d.element_id, 'element_id', 'list')
  if (d.action === 'get') need(ctx, !!d.exposure_id, 'exposure_id', 'get')
  if (d.action === 'list_model') need(ctx, !!d.directory_path, 'directory_path', 'list_model')
  if (d.action === 'evidence') need(ctx, !!d.exposure_id, 'exposure_id', 'evidence')
  only(ctx, d.action !== 'list' && d.limit !== undefined, 'limit', 'list')
  only(ctx, d.action === 'evidence' && d.element_id !== undefined, 'element_id', 'list and list_model')
  only(ctx, d.action === 'list_model' && d.exposure_id !== undefined, 'exposure_id', 'get and evidence')
  only(ctx, d.action !== 'list_model' && d.directory_path !== undefined, 'directory_path', 'list_model')
  only(ctx, d.action !== 'list_model' && d.view !== undefined, 'view', 'list_model')
  const paged = d.action === 'list_model' && (d.view === 'groups' || d.view === 'rows')
  only(ctx, !(d.action === 'list_model' && d.view === 'rows') && d.select !== undefined, 'select', "list_model view 'rows'")
  only(ctx, !paged && d.offset !== undefined, 'offset', "list_model views 'groups' and 'rows'")
  only(ctx, !paged && d.listing !== undefined, 'listing', "list_model views 'groups' and 'rows'")
  only(ctx, paged && !d.offset && d.listing !== undefined, 'listing', 'a page past offset 0')
})
type ExposuresInput = z.infer<typeof ExposuresSchema>
type ManageExposuresInput = Parameters<typeof manageExposuresTool.execute>[0]

const LISTING_CHANGED = "the model's exposures changed since the first page — start again at offset 0; the platform analysis may still be running"

export class QueryExposuresTool extends ClientDependentTool<ExposuresInput, unknown> {
  readonly name = 'query_exposures'
  readonly description =
    'Read-only on the platform: reads the platform-computed exposures; nothing here changes them. list returns a model element\'s ' +
    'exposures; get returns one. list_model reads the model a directory was pushed as, in one of three views, each within the ' +
    'tool-output limits. View \'partition\' (the default) returns the model\'s exposure count, its lifecycle partition (pending, ' +
    'confirmed, disposed, the stale overlay, USER and SYSTEM), the triage count (pending, not created by USER), the USER-created ' +
    'pending count and the elements with no exposures, with no rows; with element_id, that element\'s counts too. It also adds the ' +
    'per-machine files (.dethereal/triage-log.json, .dethereal/triage-run/, .dethereal/hidden-edges-log.json among them) to the model\'s .dethereal/.gitignore. View \'groups\' returns ' +
    'the triage set, pending findings not created by USER, grouped by name, type, category and definition hash, in parts of at ' +
    `most ${GROUP_PART_MAX} members. View 'rows' returns rows filtered by select (stale, user, all): element and its class, ` +
    `lifecycle, disposition fields with the reason cut to ${ROW_REASON_MAX} characters, ATT&CK and ATLAS ids, definition hash. ` +
    'Both page: follow next_offset, passing listing back, until truncated is false; listing_changed means the model changed ' +
    'between pages, so start again at offset 0. Long texts are cut; evidence returns one exposure\'s full evidence: description, ' +
    'references, techniques, tags, mitigation suggestions, detection methods, and the exploiting ATT&CK and ATLAS techniques. ' +
    'A failure names its reason in data.codes.'
  readonly inputSchema = ExposuresSchema

  async execute(input: ExposuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    if (!EXPOSURE_READS.has(input.action)) return refuse(input.action)
    switch (input.action) {
      case 'get':
        return manageExposuresTool.execute({ action: 'get', exposure_id: input.exposure_id } as ManageExposuresInput, context)
      case 'list': {
        const result = await manageExposuresTool.execute({ action: 'list', element_id: input.element_id } as ManageExposuresInput, context)
        return capList(result, 'exposures', input.limit ?? DEFAULT_LIMIT)
      }
      case 'list_model':
        return this.listModel(input, context)
      case 'evidence': {
        const exposure = await readExposureEvidence(context.apolloClient!, input.exposure_id!)
        if (!exposure) return coded('not_found', `Exposure ${input.exposure_id} not found`)
        return { success: true, data: { exposure } }
      }
    }
    return refuse(input.action)
  }

  private async listModel(input: ExposuresInput, context: ToolContext): Promise<ToolResult<unknown>> {
    const view = input.view ?? 'partition'
    const offset = input.offset ?? 0
    if (offset > 0 && input.listing === undefined) {
      return coded('listing_required', 'a page past offset 0 needs the listing the first page returned: pass it back, or start again at offset 0')
    }
    const dir = await validatePathConfinement(input.directory_path!)
    let modelId: string
    try {
      modelId = await platformModelOf(dir)
    } catch (err) {
      if (err instanceof TriageModelError) return coded(err.code, err.message)
      throw err
    }
    let read: Awaited<ReturnType<typeof readModelExposures>>
    try {
      read = await readModelExposures(context.apolloClient!, modelId)
    } catch (err) {
      if (err instanceof ModelReadError) return coded(err.code, err.message)
      throw err
    }
    const elementId = input.element_id
    if (elementId !== undefined && !elementOf(read, elementId)) return coded('element_not_found', `No element ${elementId} in this model`)

    if (view === 'partition') {
      // A triage run reads the partition first, and writes its files under .dethereal/triage-run/ next: keep them out of git now.
      const warnings = await keepTriageFilesOut(dir)
      return { success: true, data: { ...partitionView(read, elementId), ...(warnings.length ? { warnings } : {}) } }
    }

    const scope = elementId === undefined ? {} : { element_id: elementId }
    const changed = (listing: string) => input.listing !== undefined && input.listing !== listing

    if (view === 'groups') {
      const rows = triageRows(read.rows, elementId)
      const listing = listingOf(rows)
      if (changed(listing)) return coded('listing_changed', LISTING_CHANGED)
      // Findings on hidden edges this machine accepted are marked: they are the edge's own, reviewed with it.
      const flows = await readDataFlows(dir).catch(() => [])
      // A label only: a failure to read the decisions leaves the groups unmarked, never fails the listing.
      const parts = groupTriageSet(read.rows, elementId, await hiddenEdgeFlows(dir, flows).catch(() => new Map<string, Set<string>>()))
      const kept = parts.slice(0, PARTS_MAX)
      const data = pageOf(kept, offset, (page, next, returned) => ({
        model_id: read.model_id, view: 'groups', ...scope, groups: page, rows_total: rows.length,
        parts_total: parts.length, parts_left_over: parts.length - kept.length,
        returned, offset, truncated: next !== undefined, ...(next !== undefined ? { next_offset: next } : {}), listing,
      }))
      return { success: true, data }
    }

    const select = input.select ?? 'all'
    const rows = selectRows(read.rows, select, elementId)
    const listing = listingOf(rows)
    if (changed(listing)) return coded('listing_changed', LISTING_CHANGED)
    const data = pageOf(rows.map(rowOf), offset, (page, next, returned) => ({
      model_id: read.model_id, view: 'rows', select, ...scope, rows: page, total: rows.length,
      returned, offset, truncated: next !== undefined, ...(next !== undefined ? { next_offset: next } : {}), listing,
    }))
    return { success: true, data }
  }
}

// =============================================================================
// Countermeasures
// =============================================================================

const COUNTERMEASURE_READS = new Set(['list', 'get'])
const CountermeasuresSchema = z.object({
  action: z.enum(['list', 'get']).describe("'list' reads a control's countermeasures (control_id); 'get' reads one (countermeasure_id)"),
  control_id: PLATFORM_ID.optional().describe("For 'list'"),
  countermeasure_id: PLATFORM_ID.optional().describe("For 'get'"),
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
