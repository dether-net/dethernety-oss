/**
 * get_classes' enrich view: each template field with its type, allowed values, meaning and where its value is found,
 * and none of the guide's commands, expected outputs or security impact. Read against the shipped classes.
 */
import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GET_CLASSES_PAGE_CHARS, enrichView, getClassesTool, templateKeys } from '../get-classes.tool.js'

const MODULE_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../modules/dethernety-general/data/dethernety-general')
const read = (dir: string, file: string) => JSON.parse(readFileSync(path.join(MODULE_DATA, dir, file), 'utf8'))
/** Whether a shipped class has this file. */
const has = (dir: string, file: string) => { try { readFileSync(path.join(MODULE_DATA, dir, file)); return true } catch { return false } }
/** A shipped class as the platform returns it: the template as `{schema, uischema}`, the guide as its entries (none when it ships without one). */
const shippedClass = (dir: string) => {
  const schema = read(dir, 'schema.json')
  return { id: `cls-${dir.replace('/', '-')}`, name: dir, type: 'DATA_FLOW', category: 'c', description: '', template: { schema: schema.schema, uischema: schema.uiSchema }, guide: has(dir, 'guide.json') ? read(dir, 'guide.json') : null }
}
const SHIPPED = readdirSync(MODULE_DATA, { withFileTypes: true }).filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(path.join(MODULE_DATA, d.name)).map((c) => `${d.name}/${c}`))
  .filter((dir) => has(dir, 'schema.json'))

// The mock is hoisted above the fixtures: it reads the class from here only when it is called.
const held = vi.hoisted(() => ({ cls: undefined as unknown as Record<string, any>, modules: 1 }))
vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const module = () => ({
    id: 'mod-general', name: 'dethernety-general', componentClasses: [], securityBoundaryClasses: [], dataClasses: [], controlClasses: [],
    dataFlowClasses: [{ id: held.cls.id, name: held.cls.name, type: held.cls.type, category: held.cls.category, description: held.cls.description }],
  })
  return {
    ...actual,
    DtModule: class {
      getModules = async () => Array.from({ length: held.modules }, (_, i) => ({ ...module(), id: `mod-${i}` }))
      getModuleById = async () => module()
      getModuleByName = async () => module()
    },
    DtClass: class {
      getClassById = async () => held.cls
    },
  }
})

const https = shippedClass('dataFlow/http-s-request')
const context = { debug: false, apolloClient: {} as never }
const enrichOf = async (cls: Record<string, any>, offset?: number) => {
  held.cls = cls
  return (await getClassesTool.run({ class_id: cls.id, fields: ['id', 'name', 'enrich'], ...(offset !== undefined ? { enrich_offset: offset } : {}) } as never, context)) as any
}

describe('the enrich view of a class', () => {
  it('gives every template field in order, with the whole option description and where to find the value', () => {
    const view = enrichView(https)
    expect(view.map((f) => f.name)).toEqual(Object.keys(https.template.schema.properties))
    const entry = https.guide.find((e: any) => e.option_name === 'tls_only_transport')
    const tls = view.find((f) => f.name === 'tls_only_transport')!
    expect(tls).toMatchObject({ value_type: entry.value_type, description: entry.option_description })
    expect(Object.keys(tls.how_to_obtain![0]!).sort()).toEqual(['instruction', 'source', 'type'])
  })

  it('leaves out commands, expected outputs and security impact', () => {
    const text = JSON.stringify(enrichView(https))
    for (const k of ['command', 'expected_output', 'security_impact']) expect(text).not.toContain(`"${k}"`)
    expect(text).toContain('"source"')
    expect(text.length).toBeLessThan(JSON.stringify(https.guide).length * 0.75)
  })

  it('reads a guide that names its fields by attribute_name, with plain steps', () => {
    const tokens = shippedClass('data/authentication-tokens')
    const entry = tokens.guide.find((e: any) => typeof e.attribute_name === 'string' && Array.isArray(e.how_to_obtain) && typeof e.how_to_obtain[0] === 'string')
    expect(entry, 'the shipped guide still keys by attribute_name').toBeDefined()
    const field = enrichView(tokens).find((f) => f.name === entry.attribute_name)!
    // Its option_name is a title, and it carries no option description: the template's description stands.
    expect(field.description).toBe(tokens.template.schema.properties[entry.attribute_name].description)
    expect(field.how_to_obtain![0]).toEqual({ instruction: entry.how_to_obtain[0] })
  })

  it('keeps a field the guide does not cover, drops an entry for a field the template lacks, and takes a field\'s first entry', () => {
    const view = enrichView({
      template: { schema: { properties: { mode: { type: 'string', enum: ['a', 'b'] }, tags: { type: 'array', items: { enum: ['x'] } }, odd: null } } },
      guide: [{ option_name: 'ghost', option_description: 'not in the template' }, 'not an entry', { option_name: 'mode', option_description: 'first' },
        { option_name: 'mode', option_description: 'second' }, { option_name: 7 }, { option_name: 'tags', typical_values: null, how_to_obtain: [null, 3, {}, ' '] }],
    } as never)
    expect(view).toEqual([
      { name: 'mode', value_type: 'string', enum: ['a', 'b'], description: 'first' },
      { name: 'tags', value_type: 'array', enum: ['x'] },
      { name: 'odd' },
    ])
  })

  it('gives nothing for a class without a template, and reads a guide kept under a key', () => {
    expect(enrichView({ template: null, guide: null } as never)).toEqual([])
    const keyed = enrichView({ template: { schema: { properties: { mode: { type: 'string' } } } }, guide: { options: [{ option_name: 'mode', option_description: 'How it runs.' }] } } as never)
    expect(keyed).toEqual([{ name: 'mode', value_type: 'string', description: 'How it runs.' }])
  })
})

describe('get_classes with fields enrich', () => {
  it('always says how many fields the view has, refuses an offset past them, and enrich asked with what it is built from', async () => {
    const r = await enrichOf(https)
    expect(r.data.classes[0].enrich_total).toBe(enrichView(https).length)
    expect((await enrichOf(https, enrichView(https).length)).error).toMatch(/past the end/)
    held.cls = https
    expect(((await getClassesTool.run({ class_id: https.id, fields: ['id', 'guide', 'enrich'] } as never, context)) as any).error).toMatch(/without them/)
  })

  it('pages only a class_id that names one class', async () => {
    held.modules = 2
    try {
      held.cls = https
      expect(((await getClassesTool.run({ class_id: https.id, fields: ['id', 'enrich'], enrich_offset: 1 } as never, context)) as any).error).toMatch(/matches 2 classes/)
    } finally {
      held.modules = 1
    }
  })

  it('tells where the rest of a paged view is, and sends a field larger than a page alone', async () => {
    const big = { ...https, id: 'cls-big', template: { schema: { properties: { a: { type: 'string', description: 'x'.repeat(GET_CLASSES_PAGE_CHARS) }, b: { type: 'string' } } } }, guide: [] }
    const first = await enrichOf(big)
    expect(first.data).toMatchObject({ oversized: true, classes: [{ enrich: [{ name: 'a' }], enrich_total: 2, enrich_next_offset: 1 }] })
    expect(first.data.note).toMatch(/call again with class_id cls-big and enrich_offset 1/)
    const second = await enrichOf(big, 1)
    expect(second.data.classes[0]).toMatchObject({ enrich: [{ name: 'b', value_type: 'string' }], enrich_total: 2 })
    expect(second.data.classes[0].enrich_next_offset).toBeUndefined()
  })

  it('fetches the class and returns the view, never in a default listing', async () => {
    const r = await enrichOf(https)
    expect(r.success, JSON.stringify(r)).toBe(true)
    expect(r.data.classes[0]).toEqual({ id: https.id, name: https.name, enrich: enrichView(https), enrich_total: enrichView(https).length })
    held.cls = https
    const all = (await getClassesTool.run({ class_id: https.id } as never, context)) as any
    expect(all.data.classes[0].enrich).toBeUndefined()
    expect(all.data.classes[0].guide).toBeDefined()
  })

  it('needs a narrowed listing, and enrich_offset needs class_id and enrich', async () => {
    expect(((await getClassesTool.run({ fields: ['id', 'enrich'] } as never, context)) as any).error).toMatch(/enrich/)
    expect(((await getClassesTool.run({ class_id: https.id, fields: ['id'], enrich_offset: 3 } as never, context)) as any).error).toMatch(/enrich_offset/)
  })

  it('pages every shipped class\'s view under the page budget, and the pages hold every field once', async () => {
    let paged = 0
    for (const dir of SHIPPED) {
      const cls = shippedClass(dir)
      const want = enrichView(cls).map((f) => f.name)
      const got: string[] = []
      let offset: number | undefined
      for (let i = 0; i < 20; i++) {
        const r = await enrichOf(cls, offset)
        expect(r.success, `${dir}: ${JSON.stringify(r).slice(0, 200)}`).toBe(true)
        expect(JSON.stringify(r.data).length, dir).toBeLessThanOrEqual(GET_CLASSES_PAGE_CHARS)
        expect(r.data.oversized, dir).toBeUndefined()
        const entry = r.data.classes[0]
        got.push(...entry.enrich.map((f: { name: string }) => f.name))
        expect(entry.enrich_total, dir).toBe(want.length)
        if (entry.enrich_next_offset === undefined) break
        offset = entry.enrich_next_offset
        paged++
      }
      expect(got, dir).toEqual(want)
    }
    expect(SHIPPED.length).toBeGreaterThan(75)
    // The classes known to be larger than a page do page.
    expect(paged).toBeGreaterThanOrEqual(10)
  })
})

describe('get_classes with fields template_keys', () => {
  it('gives every shipped class\'s field names, each reply small enough to fetch two or three when classes tie', async () => {
    const sizes: number[] = []
    for (const dir of SHIPPED) {
      const cls = shippedClass(dir)
      held.cls = cls
      const r = (await getClassesTool.run({ class_id: cls.id, fields: ['id', 'name', 'template_keys'] } as never, context)) as any
      expect(r.success, dir).toBe(true)
      expect(r.data.classes[0].template_keys, dir).toEqual(Object.keys(cls.template.schema.properties))
      expect(templateKeys(cls), dir).toEqual(enrichView(cls).map((f) => f.name))
      sizes.push(JSON.stringify(r.data).length)
    }
    sizes.sort((a, b) => a - b)
    expect(sizes[Math.floor(sizes.length / 2)]!).toBeLessThan(1_200)
    expect(sizes.at(-1)!).toBeLessThan(2_500)
  })
})
