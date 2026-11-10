/**
 * Get Classes Tool
 *
 * Finds available Dethernety classes (component types, boundary types, data flow types, etc.)
 * based on flexible search criteria. Classes are provided by modules and define the attributes
 * to set for threat model elements.
 *
 * A listing comes back in pages that stay well under the harnesses' tool-output limits: a result
 * over the limit is saved to a file the session may not be allowed to read, so the listing would be
 * lost. The page is sent without indentation and stops at a character budget.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DtModule, DtClass } from '@dethernety/dt-core'
import { Class, Module } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { getConfig, debugLog } from '../config.js'

const ClassTypeEnum = z.enum(['PROCESS', 'EXTERNAL_ENTITY', 'STORE', 'BOUNDARY', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL'])

const FieldsEnum = z.enum(['id', 'name', 'description', 'type', 'category', 'attributes', 'guide', 'module', 'enrich', 'template_keys'])

/** The most characters one page's result may take, serialised as sent. */
export const GET_CLASSES_PAGE_CHARS = 24_000
const DEFAULT_LIMIT = 100
/** The most module names a page's note spells out; remaining_modules holds them all. */
const NOTE_MODULES = 10
const MAX_LIMIT = 200

/** The class arrays of a module, in listing order: what `class_type` selects. */
const BUCKETS = ['component', 'boundary', 'dataflow', 'data', 'control'] as const
type Bucket = (typeof BUCKETS)[number]

/** Component class types: a component class carries one of these as its own type. */
const COMPONENT_TYPES = new Set(['PROCESS', 'EXTERNAL_ENTITY', 'STORE'])

const LEAN_FIELDS = '["id", "name", "type", "category", "module"]'

const InputSchema = z.object({
  class_id: z.string().optional().describe('The ID of a specific class to find'),
  name: z.string().optional().describe('The name of the class to find'),
  class_type: ClassTypeEnum.optional().describe('The type of class (PROCESS, EXTERNAL_ENTITY, STORE, BOUNDARY, SECURITY_BOUNDARY, DATA_FLOW, DATA, CONTROL)'),
  category: z.string().optional().describe('The category of the class'),
  module_id: z.string().optional().describe('The ID of the module to find classes in'),
  module_name: z.string().optional().describe('The name of the module to find classes in'),
  fields: z.array(FieldsEnum).optional().describe('Optional list of field names to return. Available: id, name, description, type, category, attributes (as a JSON schema), guide, module, enrich (each template field with its type, allowed values, what it means and where its value is found: the compact view for enriching), and template_keys (the names of the template fields only, with class_id: to tell close classes apart). If omitted, returns all fields but enrich and template_keys.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`The most classes in one page (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}); a page also stops at a size budget`),
  offset: z.number().int().min(0).max(100_000).optional().describe("Where the page starts: 0, or the previous page's next_offset"),
  enrich_offset: z.number().int().min(0).max(10_000).optional()
    .describe("With class_id and fields enrich: the first template field of the class's enrich page, as the previous page's enrich_next_offset gave it"),
  view: z.enum(['classes', 'modules']).optional()
    .describe("'classes' (the default) lists classes; 'modules' lists the installed modules with their class counts per type (module filters only)"),
})

type GetClassesInput = z.infer<typeof InputSchema>

interface ClassInfo {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  attributes?: any
  guide?: any
  enrich?: EnrichField[]
  /** The class's template fields in all, when its enrich view is paged */
  enrich_total?: number
  /** The first field the next enrich page starts at: call again with class_id and enrich_offset */
  enrich_next_offset?: number
  /** The names of the class's template fields */
  template_keys?: string[]
  module?: {
    id: string
    name: string
  }
}

/** One template field as an enrichment needs it: its type and values, what it means, and where its value is found. */
export interface EnrichField {
  name: string
  value_type?: string
  typical_values?: unknown
  enum?: unknown[]
  description?: string
  how_to_obtain?: Array<{ type?: string; instruction?: string; file_path?: string; navigation?: string; source?: string }>
}

/** The parts of a guide's how_to_obtain step an enrichment uses: never its commands or their expected output. */
const HOW_KEPT = ['type', 'instruction', 'file_path', 'navigation', 'source'] as const

/** A guide's entries, as the platform returns them: a list, or a list under one key. */
function guideEntries(guide: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(guide) ? guide
    : guide && typeof guide === 'object' ? Object.values(guide as Record<string, unknown>).find(Array.isArray) ?? [] : []
  return (list as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** One how_to_obtain step as kept: a plain step is its instruction; an object keeps only the parts listed in HOW_KEPT. */
function keptStep(h: unknown): Record<string, string> | null {
  if (text(h)) return { instruction: h as string }
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null
  const kept = Object.fromEntries(HOW_KEPT.flatMap((k) => (text((h as Record<string, unknown>)[k]) ? [[k, (h as Record<string, unknown>)[k] as string]] : [])))
  return Object.keys(kept).length ? kept : null
}

/** The names of a class's template fields, in the template's order. */
export function templateKeys(cls: Pick<Class, 'template'>): string[] {
  const schema = (cls.template as { schema?: { properties?: unknown } } | null | undefined)?.schema
  return schema?.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? Object.keys(schema.properties) : []
}

/**
 * The class's template fields, in the template's order, each with its guide entry: the type, the allowed values,
 * the whole option description (what it means, when it applies, the secure value) and where the value is found.
 * A guide names its field by `attribute_name` where it has one (its `option_name` is then a title), else by
 * `option_name`; the first entry for a field counts. A guide entry for a field the template lacks is left out; a
 * field without a guide entry keeps its type and values.
 */
export function enrichView(cls: Pick<Class, 'template' | 'guide'>): EnrichField[] {
  const schema = (cls.template as { schema?: { properties?: Record<string, Record<string, unknown>> } } | null | undefined)?.schema
  const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const byName = new Map<string, Record<string, unknown>>()
  for (const e of guideEntries(cls.guide)) {
    const key = text(e.attribute_name) ?? text(e.option_name)
    if (key && !byName.has(key)) byName.set(key, e)
  }
  return Object.entries(props).map(([name, raw]) => {
    const prop = raw && typeof raw === 'object' ? raw : {}
    const entry = byName.get(name)
    const items = prop.items as { enum?: unknown[] } | undefined
    const allowed = Array.isArray(prop.enum) ? prop.enum : Array.isArray(items?.enum) ? items!.enum : undefined
    const how = Array.isArray(entry?.how_to_obtain) ? (entry!.how_to_obtain as unknown[]).map(keptStep).filter((h): h is Record<string, string> => h !== null) : []
    const valueType = text(entry?.value_type) ?? text(prop.type)
    const description = text(entry?.option_description) ?? text(prop.description)
    const typical = entry?.typical_values
    return {
      name,
      ...(valueType ? { value_type: valueType } : {}),
      ...(typical !== undefined && typical !== null ? { typical_values: typical } : {}),
      ...(allowed ? { enum: allowed } : {}),
      ...(description ? { description } : {}),
      ...(how.length ? { how_to_obtain: how } : {}),
    }
  })
}

interface ClassesPage {
  classes: ClassInfo[]
  /** Every class that matches, on every page */
  total: number
  returned: number
  offset: number
  /** More classes follow: call again with `offset` = next_offset */
  truncated: boolean
  next_offset?: number
  /** On a truncated page: the modules the later pages hold classes of, in listing order */
  remaining_modules?: string[]
  /** A short hash of the matching class ids: a change between pages means the catalogue changed */
  listing: string
  /** The one class on this page is larger than the page budget on its own */
  oversized?: boolean
  note?: string
}

interface ModulesView {
  modules: { id: string; name: string; class_counts: Record<Bucket, number> }[]
  total: number
}

type GetClassesOutput = ClassesPage | ModulesView

interface Match {
  cls: Class
  module: { id: string; name: string }
  bucket: Bucket
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export class GetClassesTool extends ClientDependentTool<GetClassesInput, GetClassesOutput> {
  readonly name = 'get_classes'
  readonly description =
    'Find available Dethernety classes (component types, boundary types, data flow types, etc.) based on flexible search criteria. ' +
    'Classes provided by modules and define the attributes to set for threat model elements. ' +
    `Results come in pages: when truncated is true, call again with offset = next_offset until it is false; remaining_modules names the modules the later pages hold. ` +
    `List with lean fields (e.g. ${LEAN_FIELDS}); attributes and guide need class_id, name or category, so fetch a class's template by class_id. ` +
    "fields ['id', 'name', 'enrich'] gives each template field with its type, allowed values, meaning and where its value is found: the compact view for enriching; " +
    'a class whose view is larger than a page gives enrich_next_offset: call again with its class_id and enrich_offset for the rest. ' +
    "fields ['id', 'name', 'template_keys'] with class_id gives the template's field names alone, to tell close classes apart. " +
    "PROCESS, EXTERNAL_ENTITY and STORE select component classes of that type. view 'modules' lists the installed modules with class counts."
  readonly inputSchema = InputSchema
  override readonly compactResult = true

  async execute(input: GetClassesInput, context: ToolContext): Promise<ToolResult<GetClassesOutput>> {
    const config = getConfig()

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      const modulesView = input.view === 'modules'
      if (modulesView) {
        const extra = (['class_id', 'name', 'class_type', 'category', 'fields', 'limit', 'offset'] as const).filter((k) => input[k] !== undefined)
        if (extra.length) return { success: false, error: `view 'modules' takes only module_id or module_name; drop ${extra.join(', ')}` }
      }

      if (input.enrich_offset !== undefined && (!input.class_id || !input.fields?.includes('enrich'))) {
        return { success: false, error: 'enrich_offset pages one class\'s enrich view: give it with class_id and fields that include enrich' }
      }
      // The view is built from the template and the guide: asked with them, every page would carry them again.
      if (input.fields?.includes('enrich') && (input.fields.includes('attributes') || input.fields.includes('guide'))) {
        return { success: false, error: "enrich is the compact view of attributes and guide: ask for it without them (fields ['id', 'name', 'enrich'])" }
      }
      // The template's field names alone, for one class: never a listing, never beside the views that hold them.
      if (input.fields?.includes('template_keys')) {
        if (!input.class_id) return { success: false, error: "template_keys is for one class: give class_id (fields ['id', 'name', 'template_keys'])" }
        const beside = (['attributes', 'guide', 'enrich'] as const).filter((f) => input.fields!.includes(f))
        if (beside.length) return { success: false, error: `template_keys is the names alone: ask for it without ${beside.join(', ')}` }
      }

      // Templates and guides are large: fetched for a narrowed listing only.
      const needsTemplateData = !input.fields || input.fields.length === 0
        || input.fields.includes('attributes') || input.fields.includes('guide') || input.fields.includes('enrich') || input.fields.includes('template_keys')
      if (!modulesView && needsTemplateData && !input.class_id && !input.name && !input.category) {
        return {
          success: false,
          error: `attributes, guide and enrich (asked for, or attributes and guide by leaving out fields) need class_id, name or category. List with fields ${LEAN_FIELDS} (it pages), then fetch a class's attributes and guide, or its enrich view, by class_id.`
        }
      }

      const dtModule = new DtModule(context.apolloClient)

      // Get modules based on filter
      let modules: Module[] = []

      if (input.module_id) {
        const module = await dtModule.getModuleById(input.module_id)
        if (module) {
          modules = [module]
        }
      } else if (input.module_name) {
        const module = await dtModule.getModuleByName(input.module_name)
        if (module) {
          modules = [module]
        }
      } else {
        modules = await dtModule.getModules()
      }

      debugLog(config, `Found ${modules.length} modules to search`)

      if (modulesView) return { success: true, data: this.modulesView(modules) }

      const matches = this.matches(modules, input)
      debugLog(config, `Found ${matches.length} matching classes`)
      if (input.enrich_offset !== undefined && matches.length !== 1) {
        return { success: false, error: `enrich_offset pages one class's enrich view, and class_id matches ${matches.length} classes: narrow it with module_id` }
      }

      const dtClass = needsTemplateData ? new DtClass(context.apolloClient) : undefined
      return { success: true, data: await this.page(matches, input, dtClass) }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get classes'
      }
    }
  }

  /** The installed modules, each with its class count per type, in a stable order. */
  private modulesView(modules: Module[]): ModulesView {
    const out = modules.map((m) => ({
      id: m.id,
      name: m.name,
      class_counts: Object.fromEntries(BUCKETS.map((b) => [b, this.getClassArrayFromModule(m, b)?.length ?? 0])) as Record<Bucket, number>,
    }))
    out.sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
    return { modules: out, total: out.length }
  }

  /** Every class the filters select, in a stable order (so pages follow one another). */
  private matches(modules: Module[], input: GetClassesInput): Match[] {
    const buckets: Bucket[] = input.class_type ? [this.mapClassType(input.class_type)] : [...BUCKETS]
    // A component class carries its own type; one that does not is listed for every component type.
    const ownType = input.class_type && COMPONENT_TYPES.has(input.class_type) ? input.class_type : undefined
    const out: Match[] = []
    for (const module of modules) {
      const moduleRef = { id: module.id, name: module.name }
      for (const bucket of buckets) {
        for (const cls of this.getClassArrayFromModule(module, bucket) ?? []) {
          if (input.class_id && cls.id !== input.class_id) continue
          if (input.name && !cls.name.toLowerCase().includes(input.name.toLowerCase())) continue
          if (input.category && cls.category !== input.category) continue
          if (ownType && typeof cls.type === 'string' && cls.type && cls.type !== ownType) continue
          out.push({ cls, module: moduleRef, bucket })
        }
      }
    }
    out.sort((a, b) =>
      byText(a.module.name, b.module.name) || byText(a.module.id, b.module.id) ||
      BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || byText(a.cls.name, b.cls.name) || byText(a.cls.id, b.cls.id))
    return out
  }

  /**
   * One page from `offset`: at most `limit` classes, and never past the size budget, measured on the
   * whole result as it is sent. Templates and guides are fetched for this page's classes only, one
   * at a time, and the fetching stops at the budget.
   */
  private async page(matches: Match[], input: GetClassesInput, dtClass: DtClass | undefined): Promise<ClassesPage> {
    const offset = input.offset ?? 0
    const limit = input.limit ?? DEFAULT_LIMIT
    const total = matches.length
    const listing = createHash('sha256').update(matches.map((m) => m.cls.id).join('\n')).digest('hex').slice(0, 16)
    const shape = (classes: ClassInfo[], next: number): ClassesPage => {
      if (next >= total) return { classes, total, returned: classes.length, offset, truncated: false, listing }
      const remaining = [...new Set(matches.slice(next).map((m) => m.module.name))]
      const named = remaining.length > NOTE_MODULES ? `${remaining.slice(0, NOTE_MODULES).join(', ')} and ${remaining.length - NOTE_MODULES} more (remaining_modules)` : remaining.join(', ')
      const narrowed = input.module_id !== undefined || input.module_name !== undefined
      return {
        classes, total, returned: classes.length, offset, truncated: true, listing, next_offset: next, remaining_modules: remaining,
        note: `${total - next} more classes, from ${remaining.length === 1 ? 'module' : 'modules'} ${named}: ` +
          `call again with offset ${next}${narrowed ? '' : ', or narrow the listing with module_name'}`,
      }
    }
    const classes: ClassInfo[] = []
    let next = offset
    while (next < total && classes.length < limit) {
      const m = matches[next]!
      let cls = m.cls
      if (dtClass) {
        // A class the platform cannot return with its template is listed as the module lists it.
        const fetched = await dtClass.getClassById({ classId: cls.id, classType: m.bucket })
        if (fetched) cls = fetched
      }
      const entry = this.buildClassInfo(cls, m.module, m.bucket, input.fields, input.enrich_offset)
      if (input.enrich_offset !== undefined && input.enrich_offset >= Math.max(1, entry.enrich_total ?? 0)) {
        throw new Error(`enrich_offset ${input.enrich_offset} is past the end: ${entry.name} has ${entry.enrich_total ?? 0} template fields`)
      }
      const candidate = shape([...classes, entry], next + 1)
      if (JSON.stringify(candidate).length > GET_CLASSES_PAGE_CHARS) {
        // A class whose enrich view is larger than a page on its own is sent alone, its view paged by field.
        if (classes.length === 0 && entry.enrich) return this.enrichPage(entry, (c) => shape([c], next + 1), input.enrich_offset ?? 0)
        // Any other class larger than a page on its own is sent alone.
        if (classes.length === 0) return { ...candidate, oversized: true }
        break
      }
      classes.push(entry)
      next++
    }
    return shape(classes, next)
  }

  /**
   * One class's enrich view, from field `offset`, as many fields as fit the page: the entry says where the next
   * page of its fields starts, and the page's note says how to ask for it (class_id and enrich_offset; next_offset,
   * when there is one, goes on to the next class). A single field larger than a page is sent alone.
   */
  private enrichPage(entry: ClassInfo, shape: (c: ClassInfo) => ClassesPage, offset: number): ClassesPage {
    const fields = entry.enrich ?? []
    const sized = (k: number): ClassesPage => {
      const more = k < fields.length
      const page = shape({ ...entry, enrich: fields.slice(0, k), ...(more ? { enrich_next_offset: offset + k } : {}) })
      if (!more) return page
      const rest = `${fields.length - k} more fields of ${entry.name}: call again with class_id ${entry.id} and enrich_offset ${offset + k}`
      return { ...page, note: page.note ? `${rest}; ${page.note}` : rest }
    }
    let fit = 1
    while (fit < fields.length && JSON.stringify(sized(fit + 1)).length <= GET_CLASSES_PAGE_CHARS) fit++
    const page = sized(fit)
    return JSON.stringify(page).length > GET_CLASSES_PAGE_CHARS ? { ...page, oversized: true } : page
  }

  private mapClassType(type: string): Bucket {
    switch (type) {
      case 'PROCESS':
      case 'EXTERNAL_ENTITY':
      case 'STORE':
        return 'component'
      case 'BOUNDARY':
      case 'SECURITY_BOUNDARY':
        return 'boundary'
      case 'DATA_FLOW':
        return 'dataflow'
      case 'DATA':
        return 'data'
      case 'CONTROL':
        return 'control'
      default:
        return 'component'
    }
  }

  private getClassArrayFromModule(module: Module, classType: string): Class[] | undefined {
    switch (classType) {
      case 'component':
        return module.componentClasses
      case 'boundary':
        return module.securityBoundaryClasses
      case 'dataflow':
        return module.dataFlowClasses
      case 'data':
        return module.dataClasses
      case 'control':
        return module.controlClasses
      default:
        return undefined
    }
  }

  private buildClassInfo(cls: Class, moduleRef: { id: string; name: string }, classType: string, fields?: string[], enrichOffset = 0): ClassInfo {
    const allFields = !fields || fields.length === 0

    const info: ClassInfo = {
      id: cls.id,
      name: cls.name
    }

    if (allFields || fields?.includes('description')) {
      info.description = cls.description
    }

    if (allFields || fields?.includes('type')) {
      info.type = cls.type || classType.toUpperCase()
    }

    if (allFields || fields?.includes('category')) {
      info.category = cls.category
    }

    if (allFields || fields?.includes('attributes')) {
      // Return template as attributes schema
      info.attributes = cls.template || {}
    }

    if (allFields || fields?.includes('guide')) {
      info.guide = cls.guide
    }

    if (allFields || fields?.includes('module')) {
      info.module = moduleRef
    }

    // Never part of all fields: the names alone, for one class.
    if (fields?.includes('template_keys')) info.template_keys = templateKeys(cls)

    // Never part of all fields: it is the compact view, for a call that asks for it alone.
    if (fields?.includes('enrich')) {
      const view = enrichView(cls)
      info.enrich = view.slice(enrichOffset)
      info.enrich_total = view.length
    }

    return info
  }
}

// Export singleton instance
export const getClassesTool = new GetClassesTool()
