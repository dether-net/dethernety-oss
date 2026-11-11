import { describe, it, expect, vi, beforeEach } from 'vitest'

// A synthetic catalogue sized like a real platform's: 4 modules, 345 classes (225 component,
// 25 boundary, 20 data flow, 17 data, 58 control), templates of 15–40 fields, guides of 1–3 KB.
interface FakeClass { id: string; name: string; type?: string; category: string; description: string; template?: unknown; guide?: unknown }

const COMPONENT_TYPES = ['PROCESS', 'STORE', 'EXTERNAL_ENTITY']
function fakeCatalogue() {
  const counts = { component: 225, boundary: 25, dataflow: 20, data: 17, control: 58 }
  const modules = ['Cloud Pack', 'General', 'Data Services', 'Identity'].map((name, m) => ({
    id: `mod-${m}`, name, componentClasses: [] as FakeClass[], securityBoundaryClasses: [] as FakeClass[],
    dataFlowClasses: [] as FakeClass[], dataClasses: [] as FakeClass[], controlClasses: [] as FakeClass[],
  }))
  const arrays = { component: 'componentClasses', boundary: 'securityBoundaryClasses', dataflow: 'dataFlowClasses', data: 'dataClasses', control: 'controlClasses' } as const
  let n = 0
  for (const [bucket, count] of Object.entries(counts) as [keyof typeof counts, number][]) {
    for (let i = 0; i < count; i++) {
      const type = bucket === 'component' ? COMPONENT_TYPES[i % 3] : bucket === 'boundary' ? 'SECURITY_BOUNDARY' : bucket.toUpperCase()
      const cls: FakeClass = {
        id: `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`,
        name: `${bucket} class ${i} ${'x'.repeat(10 + (i % 40))}`,
        type,
        category: i % 2 ? 'network' : 'storage',
        description: `A ${bucket} class used by the synthetic catalogue, number ${i}.`,
      }
      modules[i % 4]![arrays[bucket]].push(cls)
    }
  }
  return modules
}
const template = (id: string) => ({
  type: 'object',
  properties: Object.fromEntries(Array.from({ length: 15 + (id.charCodeAt(id.length - 1) % 26) }, (_, k) => [
    `attribute_${k}`, { type: 'string', description: `Attribute ${k} of the class, as the platform's template describes it.`, enum: ['a', 'b', 'c'] },
  ])),
})
const guide = (id: string) => ({ text: 'g'.repeat(1000 + (id.charCodeAt(id.length - 2) % 20) * 100) })

let catalogue = fakeCatalogue()
const getClassById = vi.fn(async ({ classId }: { classId: string }) => {
  for (const m of catalogue) for (const k of ['componentClasses', 'securityBoundaryClasses', 'dataFlowClasses', 'dataClasses', 'controlClasses'] as const) {
    const c = m[k].find((x) => x.id === classId)
    if (c) return { ...c, template: template(c.id), guide: guide(c.id) }
  }
  return null
})

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtModule: class {
      constructor(_client: any) {}
      getModules = async () => catalogue
      getModuleById = async (id: string) => catalogue.find((m) => m.id === id) ?? null
      getModuleByName = async (name: string) => catalogue.find((m) => m.name === name) ?? null
    },
    DtClass: class {
      constructor(_client: any) {}
      getClassById = getClassById
    },
  }
})

import { getClassesTool, GET_CLASSES_PAGE_CHARS } from '../get-classes.tool.js'
import { resultText } from '../base-tool.js'
import { listedTool } from '../../tool-listing.js'
import { manifestTool } from '../manifest.js'
import { allTools } from '../index.js'
import type { ToolContext } from '../base-tool.js'

const context = { apolloClient: {} as any, debug: false } as ToolContext
const call = async (input: Record<string, unknown>): Promise<{ success: boolean; data?: any; error?: string }> => getClassesTool.run(input, context) as never
/** The page as the server sends it. */
const sent = (data: unknown) => resultText(data, getClassesTool.compactResult)
const LEAN = ['id', 'name', 'type', 'category', 'module']
const allIds = () => catalogue.flatMap((m) => [...m.componentClasses, ...m.securityBoundaryClasses, ...m.dataFlowClasses, ...m.dataClasses, ...m.controlClasses].map((c) => c.id))

async function walk(input: Record<string, unknown>) {
  const pages = []
  let offset = 0
  for (;;) {
    const r = await call({ ...input, offset })
    expect(r.success, r.error).toBe(true)
    pages.push(r.data)
    if (!r.data.truncated) return pages
    expect(r.data.next_offset).toBe(offset + r.data.returned)
    offset = r.data.next_offset
  }
}

beforeEach(() => {
  catalogue = fakeCatalogue()
  getClassById.mockClear()
})

describe('get_classes pages', () => {
  it('pages the whole catalogue with lean fields: every page under the budget, every class once', async () => {
    const pages = await walk({ fields: LEAN })
    expect(pages).toHaveLength(Math.ceil(345 / 100))
    for (const p of pages) {
      expect(sent(p).length).toBeLessThanOrEqual(GET_CLASSES_PAGE_CHARS)
      expect(p.total).toBe(345)
    }
    const ids = pages.flatMap((p) => p.classes.map((c: { id: string }) => c.id))
    expect(ids).toHaveLength(345)
    expect(new Set(ids)).toEqual(new Set(allIds()))
    expect(getClassById).not.toHaveBeenCalled()
  })

  it('pages with templates when a filter narrows the listing, fetching only the page', async () => {
    const pages = await walk({ category: 'storage' })
    const total = pages[0].total
    expect(total).toBeGreaterThan(100)
    for (const p of pages) expect(sent(p).length).toBeLessThanOrEqual(GET_CLASSES_PAGE_CHARS)
    expect(pages.reduce((n, p) => n + p.returned, 0)).toBe(total)
    // One fetch per class sent, plus at most one per page for the class that did not fit.
    expect(getClassById.mock.calls.length).toBeLessThanOrEqual(total + pages.length)
    expect(pages[0].classes[0].attributes.type).toBe('object')
  })

  it('refuses templates and guides for an unnarrowed listing, naming the lean path', async () => {
    for (const input of [{}, { fields: ['id', 'attributes'] }, { class_type: 'STORE', fields: ['guide'] }]) {
      const r = await call(input)
      expect(r.success, JSON.stringify(input)).toBe(false)
      expect(r.error).toContain('then fetch a class')
    }
    expect(getClassById).not.toHaveBeenCalled()
    const one = await call({ class_id: allIds()[7] })
    expect(one.success).toBe(true)
    expect(one.data.classes[0].guide).toBeDefined()
  })

  it('sends a class larger than a page alone, marked oversized', async () => {
    getClassById.mockImplementationOnce((async ({ classId }: { classId: string }) => ({ id: classId, name: 'huge', type: 'PROCESS', category: 'storage', description: '', template: {}, guide: 'z'.repeat(GET_CLASSES_PAGE_CHARS) })) as never)
    const r = await call({ category: 'storage' })
    expect(r.data.returned).toBe(1)
    expect(r.data.oversized).toBe(true)
    expect(r.data.next_offset).toBe(1)
  })

  it('handles the edges: an empty match, an offset past the end, limit 1, class_id with an offset', async () => {
    const empty = await call({ name: 'no such class', fields: LEAN })
    expect(empty.data).toMatchObject({ classes: [], total: 0, returned: 0, truncated: false })
    expect(empty.data.next_offset).toBeUndefined()
    const past = await call({ fields: LEAN, offset: 1000 })
    expect(past.data).toMatchObject({ classes: [], total: 345, returned: 0, truncated: false })
    const one = await call({ fields: LEAN, limit: 1 })
    expect(one.data).toMatchObject({ returned: 1, truncated: true, next_offset: 1 })
    const byId = await call({ class_id: allIds()[3], fields: LEAN, offset: 1 })
    expect(byId.data).toMatchObject({ classes: [], total: 1, truncated: false })
  })

  it('keeps the listing hash while the catalogue holds, and changes it when a class is added', async () => {
    const a = await call({ fields: LEAN })
    const b = await call({ fields: LEAN, offset: 100 })
    expect(a.data.listing).toBe(b.data.listing)
    catalogue[0]!.controlClasses.push({ id: 'ffffffff-0000-4000-8000-000000000000', name: 'new', type: 'CONTROL', category: 'network', description: '' })
    const c = await call({ fields: LEAN, offset: 200 })
    expect(c.data.listing).not.toBe(a.data.listing)
  })

  it('keeps the filters and the entry shape', async () => {
    const r = await call({ module_name: 'General', class_type: 'DATA', fields: ['id', 'name', 'module'] })
    const general = catalogue.find((m) => m.name === 'General')!
    expect(r.data.classes.map((c: { id: string }) => c.id).sort()).toEqual(general.dataClasses.map((c) => c.id).sort())
    expect(Object.keys(r.data.classes[0]).sort()).toEqual(['id', 'module', 'name'])
    expect(r.data.classes[0].module).toEqual({ id: general.id, name: 'General' })
    const named = await call({ name: 'CONTROL CLASS 1 ', fields: LEAN })
    expect(named.data.classes.every((c: { name: string }) => c.name.toLowerCase().includes('control class 1 '))).toBe(true)
  })
})

describe('get_classes: the modules later pages hold', () => {
  it('names them on a truncated page, in listing order, and says how to narrow', async () => {
    const pages = await walk({ fields: LEAN })
    const moduleOf = new Map(catalogue.flatMap((m) => [...m.componentClasses, ...m.securityBoundaryClasses, ...m.dataFlowClasses, ...m.dataClasses, ...m.controlClasses].map((c) => [c.id, m.name])))
    pages.forEach((p, i) => {
      const later = pages.slice(i + 1).flatMap((q) => q.classes.map((c: { id: string }) => moduleOf.get(c.id)))
      if (!p.truncated) {
        expect(p.remaining_modules).toBeUndefined()
        return
      }
      expect(p.remaining_modules).toEqual([...new Set(later)])
      for (const m of p.remaining_modules) expect(p.note).toContain(m)
      expect(p.note).toMatch(new RegExp(`call again with offset ${p.next_offset}, or narrow the listing with module_name`))
    })
  })

  it('names them on pages stopped by the size budget too', async () => {
    const pages = await walk({ category: 'storage' })
    expect(pages.length).toBeGreaterThan(1)
    const moduleOf = new Map(catalogue.flatMap((m) => [...m.componentClasses, ...m.securityBoundaryClasses, ...m.dataFlowClasses, ...m.dataClasses, ...m.controlClasses].map((c) => [c.id, m.name])))
    pages.forEach((p, i) => {
      const later = pages.slice(i + 1).flatMap((q) => q.classes.map((c: { id: string }) => moduleOf.get(c.id)))
      if (p.truncated) expect(p.remaining_modules).toEqual([...new Set(later)])
      expect(sent(p).length).toBeLessThanOrEqual(GET_CLASSES_PAGE_CHARS)
    })
  })

  it('names the one module left in the singular, and offers no module narrowing a listing already has', async () => {
    const r = await call({ module_name: 'General', fields: LEAN, limit: 1 })
    expect(r.data).toMatchObject({ truncated: true, remaining_modules: ['General'] })
    expect(r.data.note).toMatch(/from module General: call again with offset 1$/)
  })

  it('spells out at most ten modules in the note, and lists them all', async () => {
    for (let m = 0; m < 12; m++) {
      catalogue.push({ id: `mod-x${m}`, name: `Extra ${String(m).padStart(2, '0')}`, componentClasses: [{ id: `x-${m}`, name: `extra ${m}`, type: 'PROCESS', category: 'storage', description: '' }],
        securityBoundaryClasses: [], dataFlowClasses: [], dataClasses: [], controlClasses: [] })
    }
    const r = await call({ fields: LEAN, limit: 1 })
    expect(r.data.remaining_modules).toHaveLength(16)
    expect(r.data.note).toMatch(/and 6 more \(remaining_modules\): call again with offset 1, or narrow the listing with module_name$/)
  })
})

describe('get_classes template_keys', () => {
  const schemaClass = (classId: string) => ({ id: classId, name: 'Web Server', type: 'PROCESS', category: 'c', description: 'd',
    template: { schema: { properties: { tls_version: { type: 'string' }, auth_method: { type: 'string' }, runs_as_root: { type: 'boolean' } } }, uischema: {} },
    guide: 'g'.repeat(5000) })

  it('gives one class\'s template field names, in order, and nothing of the template or guide', async () => {
    const id = allIds()[0]!
    getClassById.mockImplementationOnce((async ({ classId }: { classId: string }) => schemaClass(classId)) as never)
    const r = await call({ class_id: id, fields: ['id', 'name', 'template_keys'] })
    expect(r.success, r.error).toBe(true)
    expect(r.data.classes).toEqual([{ id, name: 'Web Server', template_keys: ['tls_version', 'auth_method', 'runs_as_root'] }])
  })

  it('needs class_id, and is not asked beside attributes, guide or enrich', async () => {
    for (const input of [{ fields: ['id', 'template_keys'] }, { category: 'storage', fields: ['id', 'template_keys'] }, { name: 'x', fields: ['template_keys'] }]) {
      const r = await call(input)
      expect(r.success, JSON.stringify(input)).toBe(false)
      expect(r.error).toMatch(/give class_id/)
    }
    for (const beside of ['attributes', 'guide', 'enrich']) {
      const r = await call({ class_id: allIds()[0], fields: ['id', 'template_keys', beside] })
      expect(r.success, beside).toBe(false)
      expect(r.error).toContain(`without ${beside}`)
    }
    expect(getClassById).not.toHaveBeenCalled()
  })

  it('gives no names for a class without a template, or one the platform cannot return', async () => {
    const id = allIds()[0]!
    getClassById.mockImplementationOnce((async ({ classId }: { classId: string }) => ({ id: classId, name: 'Bare', type: 'PROCESS', category: 'c', description: '', template: null, guide: null })) as never)
    expect((await call({ class_id: id, fields: ['id', 'template_keys'] })).data.classes[0].template_keys).toEqual([])
    getClassById.mockImplementationOnce((async () => null) as never)
    expect((await call({ class_id: id, fields: ['id', 'template_keys'] })).data.classes[0].template_keys).toEqual([])
  })

  it('takes module_name beside class_id, for an id two modules hold', async () => {
    const shared = catalogue[0]!.componentClasses[0]!
    catalogue[1]!.componentClasses.push({ ...shared })
    getClassById.mockImplementation((async ({ classId }: { classId: string }) => schemaClass(classId)) as never)
    try {
      expect((await call({ class_id: shared.id, fields: ['id', 'template_keys'] })).data.classes).toHaveLength(2)
      const one = await call({ class_id: shared.id, module_name: catalogue[1]!.name, fields: ['id', 'module', 'template_keys'] })
      expect(one.success, one.error).toBe(true)
      expect(one.data.classes).toEqual([{ id: shared.id, name: 'Web Server', module: { id: catalogue[1]!.id, name: catalogue[1]!.name }, template_keys: ['tls_version', 'auth_method', 'runs_as_root'] }])
    } finally {
      getClassById.mockReset()
    }
  })

  it('is never part of the default fields', async () => {
    const r = await call({ class_id: allIds()[0] })
    expect(r.data.classes[0]).not.toHaveProperty('template_keys')
  })
})

describe('get_classes component types', () => {
  it('selects component classes by their own type', async () => {
    for (const t of COMPONENT_TYPES) {
      const pages = await walk({ class_type: t, fields: LEAN })
      const types = new Set(pages.flatMap((p) => p.classes.map((c: { type: string }) => c.type)))
      expect(types).toEqual(new Set([t]))
      expect(pages[0].total).toBe(75)
    }
  })

  it('lists a component class with no own type for every component type', async () => {
    delete catalogue[0]!.componentClasses[0]!.type
    const id = catalogue[0]!.componentClasses[0]!.id
    for (const t of COMPONENT_TYPES) {
      const pages = await walk({ class_type: t, fields: ['id'] })
      expect(pages.flatMap((p) => p.classes.map((c: { id: string }) => c.id)), t).toContain(id)
    }
  })

  it('returns every boundary class for BOUNDARY and SECURITY_BOUNDARY', async () => {
    const a = await call({ class_type: 'BOUNDARY', fields: LEAN })
    const b = await call({ class_type: 'SECURITY_BOUNDARY', fields: LEAN })
    expect(a.data.total).toBe(25)
    expect(b.data.total).toBe(25)
  })
})

describe('get_classes modules view', () => {
  it('counts classes per module and type, as class_type selects them', async () => {
    const r = await call({ view: 'modules' })
    expect(r.success, r.error).toBe(true)
    expect(r.data.total).toBe(4)
    expect(r.data.modules.map((m: { name: string }) => m.name)).toEqual(['Cloud Pack', 'Data Services', 'General', 'Identity'])
    const sum = (k: string) => r.data.modules.reduce((n: number, m: { class_counts: Record<string, number> }) => n + m.class_counts[k]!, 0)
    expect({ component: sum('component'), boundary: sum('boundary'), dataflow: sum('dataflow'), data: sum('data'), control: sum('control') })
      .toEqual({ component: 225, boundary: 25, dataflow: 20, data: 17, control: 58 })
    expect(sent(r.data).length).toBeLessThan(GET_CLASSES_PAGE_CHARS)
    expect(getClassById).not.toHaveBeenCalled()
  })

  it('takes module filters only', async () => {
    expect((await call({ view: 'modules', module_name: 'General' })).data.modules).toHaveLength(1)
    for (const extra of [{ class_type: 'DATA' }, { fields: LEAN }, { limit: 5 }, { offset: 1 }, { name: 'x' }]) {
      const r = await call({ view: 'modules', ...extra })
      expect(r.success, JSON.stringify(extra)).toBe(false)
      expect(r.error).toContain("view 'modules' takes only")
    }
  })
})

describe('get_classes as the server sends it', () => {
  it('is sent compact on success: no line breaks', async () => {
    expect(getClassesTool.compactResult).toBe(true)
    expect(sent((await call({ fields: LEAN })).data)).not.toContain('\n')
  })

  it('sends every tool\'s result compact, and indents only when a tool opts out', () => {
    for (const t of allTools) expect(t.compactResult, t.name).toBe(true)
    expect(resultText({ a: 1 })).toBe('{"a":1}')
    expect(resultText({ a: 1 }, false)).toBe('{\n  "a": 1\n}')
  })

  it('lists limit, offset and view, says how to page, and the manifest names them', () => {
    const listed = listedTool(getClassesTool)
    expect(Object.keys(listed.inputSchema.properties as object)).toEqual(expect.arrayContaining(['limit', 'offset', 'view']))
    expect(listed.description).toContain('next_offset')
    expect(listed.description).toContain("view 'modules'")
    expect(Object.keys(manifestTool('get_classes')!.inputs ?? {})).toEqual(expect.arrayContaining(['limit', 'offset', 'view']))
  })
})
