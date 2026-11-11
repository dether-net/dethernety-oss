/**
 * The platform's reserved fields in a run's class cache: the platform serves its own properties and one category on
 * every component and security-boundary template, so the drift check reads a template without them. Anything else the
 * cache changes is still drift.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RESERVED_ATTRIBUTE_PREFIX as DT_CORE_PREFIX } from '@dethernety/dt-core/operation-determination'
import { classCacheDrift, readModuleClasses, RESERVED_ATTRIBUTE_PREFIX, withoutReserved, type ModuleClass } from '../score/model-gates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODULE = path.resolve(__dirname, '../../../../../modules/dethernety-general/data/dethernety-general')
// The platform's own serving code, read from its source: the module package is not a dependency of this one.
const OPERATION_FIELDS = path.resolve(__dirname, '../../../../../packages/dt-module/src/operation-fields.ts')
const classes = readModuleClasses(MODULE)

let platform: { RESERVED_ATTRIBUTE_PREFIX: string; withOperationFields: (template: unknown, classType: string | undefined) => any }
beforeAll(async () => {
  platform = await import(pathToFileURL(OPERATION_FIELDS).href)
})

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
/** A module template under the platform's name for its UI schema. */
const platformNamed = (template: any) => {
  const t = clone(template)
  if (!('uiSchema' in t)) return t
  const { uiSchema, ...rest } = t
  return { ...rest, uischema: uiSchema }
}
/** A class type as the run's cache spells it. */
const cacheType = (classType: string) => ({ securityBoundary: 'boundary', dataFlow: 'dataflow' } as Record<string, string>)[classType] ?? classType
/** A template as the platform serves it: its own fields added to the class's. */
const served = (cls: ModuleClass) => platform.withOperationFields(platformNamed(cls.template), cls.classType)
/** Every scope a UI schema holds, at any depth, its options included. */
const scopesOf = (ui: any): string[] =>
  !ui || typeof ui !== 'object' ? [] : [...(typeof ui.scope === 'string' ? [ui.scope] : []), ...Object.values(ui).flatMap((v) => scopesOf(v))]
/** The first Control in a UI schema, depth first. */
const firstControl = (ui: any): any => {
  if (ui?.type === 'Control') return ui
  for (const e of Array.isArray(ui?.elements) ? ui.elements : []) {
    const hit = firstControl(e)
    if (hit) return hit
  }
  return undefined
}
const operated = [...classes.values()].filter((c) => c.classType === 'component' || c.classType === 'securityBoundary')
const component = operated.find((c) => c.classType === 'component')!
const boundary = operated.find((c) => c.classType === 'securityBoundary')!

let tmp: string
let cacheDir: string
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-reserved-')))
  cacheDir = path.join(tmp, '.dethereal', 'class-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const cache = (cls: ModuleClass, template: unknown, componentType = cls.type) =>
  fs.writeFileSync(path.join(cacheDir, `${cls.id}.json`), JSON.stringify({ classId: cls.id, className: cls.name, classType: cacheType(cls.classType), componentType, template }))

describe('the reserved prefix', () => {
  it("is the platform's, in both of its packages", () => {
    expect(RESERVED_ATTRIBUTE_PREFIX).toBe(DT_CORE_PREFIX)
    expect(RESERVED_ATTRIBUTE_PREFIX).toBe(platform.RESERVED_ATTRIBUTE_PREFIX)
  })
})

describe('class cache drift with the platform-served fields', () => {
  it('reads every component and boundary template the platform serves as the module\'s', () => {
    expect(operated.length).toBeGreaterThan(10)
    for (const cls of operated) {
      const t = served(cls)
      // The platform did add its fields: the check is not vacuous.
      expect(Object.keys(t.schema.properties).filter((k) => k.startsWith('dethernety_')).length).toBeGreaterThanOrEqual(2)
      expect(t.uischema.elements.length).toBe((cls.template as any).uiSchema.elements.length + 1)
      cache(cls, t)
    }
    expect(classCacheDrift(tmp, classes)).toEqual([])
  })

  it('still fails a changed property beside the reserved ones, and a changed component type', () => {
    const t = served(component)
    const own = Object.keys(t.schema.properties).find((k) => !k.startsWith('dethernety_'))!
    t.schema.properties[own] = { ...t.schema.properties[own], title: 'Changed' }
    cache(component, t)
    cache(boundary, served(boundary), 'PROCESS')
    expect(classCacheDrift(tmp, classes)).toEqual([
      { classId: component.id, reason: 'template differs' },
      { classId: boundary.id, reason: 'component type differs' },
    ].sort((a, b) => a.classId.localeCompare(b.classId)))
  })

  it('still fails a changed reserved-looking key that differs in case, a dropped required entry and an added one', () => {
    const cases: Array<(t: any) => void> = [
      (t) => { t.schema.properties.Dethernety_product = { type: 'string' } },
      (t) => { t.schema.required = (t.schema.required ?? []).slice(1) },
      (t) => { t.schema.required = [...(t.schema.required ?? []), 'not_a_field'] },
    ]
    for (const change of cases) {
      const t = served(component)
      change(t)
      cache(component, t)
      expect(classCacheDrift(tmp, classes)).toEqual([{ classId: component.id, reason: 'template differs' }])
    }
  })

  it("still fails a change in the platform's category that is not one of its Controls", () => {
    const own = Object.keys((component.template as any).schema.properties)[0]!
    const cases: Array<(category: any) => void> = [
      // A Control on a key of the class's own, in the category's place.
      (c) => { c.elements.push({ type: 'Control', scope: `#/properties/${own}` }) },
      // An element that is not a Control, in a layout of reserved Controls.
      (c) => { c.elements[0].elements.push({ type: 'Label', text: 'x' }) },
      // A null the platform never serves.
      (c) => { c.elements.push(null) },
    ]
    for (const change of cases) {
      const t = served(component)
      change(t.uischema.elements[0])
      cache(component, t)
      expect(classCacheDrift(tmp, classes)).toEqual([{ classId: component.id, reason: 'template differs' }])
    }
    // A category holding only reserved Controls goes whole, its label with it, as the platform's own removal does.
    const relabelled = served(component)
    relabelled.uischema.elements[0].label = 'Something else'
    cache(component, relabelled)
    expect(classCacheDrift(tmp, classes)).toEqual([])
    // In the class's own categories, after the platform's: a label, a rule on a Control of its own (even one naming a reserved key), a null.
    const ownChanges: Array<(t: any) => void> = [
      (t) => { t.uischema.elements[1].label = 'Changed' },
      (t) => { firstControl(t.uischema.elements[1]).rule = { effect: 'HIDE', condition: { scope: '#/properties/dethernety_operated_by', schema: { const: 'VENDOR' } } } },
      (t) => { t.uischema.elements[1].elements.push(null) },
      (t) => { t.uischema.elements.splice(2, 0, null) },
    ]
    for (const change of ownChanges) {
      const t = served(boundary)
      change(t)
      cache(boundary, t)
      expect(classCacheDrift(tmp, classes).filter((d) => d.classId === boundary.id)).toEqual([{ classId: boundary.id, reason: 'template differs' }])
    }
  })

  it('reads reserved fields on any other class as drift: the platform serves none there', () => {
    const others = [...classes.values()].filter((c) => !['component', 'securityBoundary'].includes(c.classType))
    expect(new Set(others.map((c) => c.classType))).toEqual(new Set(['dataFlow', 'data', 'control', 'issue']))
    for (const cls of others) {
      // The platform's own code leaves these templates as they are.
      expect(platform.withOperationFields(platformNamed(cls.template), cls.classType)).toEqual(platformNamed(cls.template))
    }
    const flow = others.find((c) => c.classType === 'dataFlow')!
    const plants: Array<(t: any) => void> = [
      (t) => { t.schema.properties.dethernety_x = { type: 'string' } },
      (t) => { t.schema.required = [...(t.schema.required ?? []), 'dethernety_x'] },
      (t) => { t.uischema.elements.push({ type: 'Category', label: 'Anything', elements: [{ type: 'Control', scope: '#/properties/dethernety_x' }] }) },
    ]
    for (const plant of plants) {
      fs.rmSync(cacheDir, { recursive: true, force: true })
      fs.mkdirSync(cacheDir, { recursive: true })
      const t = platformNamed(flow.template)
      plant(t)
      cache(flow, t)
      expect(classCacheDrift(tmp, classes)).toEqual([{ classId: flow.id, reason: 'template differs' }])
      // The module's class type decides, not the one the entry claims.
      fs.writeFileSync(path.join(cacheDir, `${flow.id}.json`), JSON.stringify({ classId: flow.id, className: flow.name, classType: 'component', componentType: flow.type, template: t }))
      expect(classCacheDrift(tmp, classes)).toEqual([{ classId: flow.id, reason: 'template differs' }])
    }
  })

  it('still calls a module class under another id moved when the platform served it with its fields', () => {
    const MOVED = '00000000-0000-4000-8000-0000000000aa'
    fs.writeFileSync(path.join(cacheDir, `${MOVED}.json`), JSON.stringify({ classId: MOVED, className: component.name, classType: 'component', template: served(component) }))
    expect(classCacheDrift(tmp, classes)).toEqual([{ classId: MOVED, reason: `the platform served ${component.name} under another id` }])
    // A boundary, which the cache calls a boundary and the module a securityBoundary.
    fs.rmSync(path.join(cacheDir, `${MOVED}.json`))
    fs.writeFileSync(path.join(cacheDir, `${MOVED}.json`), JSON.stringify({ classId: MOVED, className: boundary.name, classType: 'boundary', template: served(boundary) }))
    expect(classCacheDrift(tmp, classes)).toEqual([{ classId: MOVED, reason: `the platform served ${boundary.name} under another id` }])
  })

  it('still fails a cache the platform would not have extended: no Categorization, or no properties', () => {
    const cases: Array<(t: any) => void> = [
      (t) => { t.uischema.type = 'VerticalLayout' },
      (t) => { t.schema.properties = [] },
      (t) => { delete t.schema.properties },
    ]
    for (const change of cases) {
      const t = served(component)
      change(t)
      cache(component, t)
      expect(classCacheDrift(tmp, classes)).toEqual([{ classId: component.id, reason: 'template differs' }])
    }
  })
})

describe('withoutReserved', () => {
  /** A template with reserved entries planted where a module could put them, at several depths and scope forms. */
  const planted = () => {
    const t = platformNamed(component.template)
    const own = Object.keys(t.schema.properties)[0]!
    t.schema.properties.dethernety_custom = { type: 'string' }
    t.schema.required = ['dethernety_custom', ...(t.schema.required ?? [])]
    const first = t.uischema.elements[0]
    first.elements = [
      { type: 'Control', scope: '#/properties/dethernety_custom' },
      { type: 'VerticalLayout', elements: [{ type: 'Control', scope: '#/allOf/0/properties/dethernety_custom' }, { type: 'Control', scope: '#/properties/dethernety_custom/items' }] },
      { type: 'HorizontalLayout', elements: [{ type: 'Control', scope: '#/properties/dethernety_a~1b' }, { type: 'Control', scope: `#/properties/${own}` }] },
      { type: 'HorizontalLayout', elements: [] },
      { type: 'Control', scope: '#/properties/x~0dethernety_' },
      ...first.elements,
    ]
    // Nested uischema in options: one the walk empties, one it keeps, and a value that is not uischema.
    first.options = {
      detail: { type: 'VerticalLayout', elements: [{ type: 'Control', scope: '#/properties/dethernety_custom' }] },
      kept: { type: 'Control', scope: `#/properties/${own}` },
      label: 'x',
    }
    t.uischema.elements.push({ type: 'Category', label: 'Only reserved', elements: [{ type: 'Control', scope: '#/properties/dethernety_custom' }] })
    return t
  }
  const moduleNamed = ({ uischema, ...rest }: any) => ({ ...rest, uiSchema: uischema })

  it("removes exactly what the platform removes before adding its own fields", () => {
    // A root scope that may not bind is dropped from a Categorization; elsewhere it takes the whole UI schema with it.
    const rootScoped = planted()
    rootScoped.uischema.scope = '#/properties/dethernety_custom'
    for (const t of [planted(), rootScoped, platformNamed(component.template), platformNamed(boundary.template)]) {
      const platformOut = platform.withOperationFields(clone(t), 'component')
      const ours = withoutReserved(moduleNamed(clone(t)), 'component') as any
      // The platform's category comes first.
      expect(ours.uiSchema.elements).toEqual(platformOut.uischema.elements.slice(1))
      expect({ ...ours.uiSchema, elements: [] }).toEqual({ ...platformOut.uischema, elements: [] })
      expect(ours.schema.properties).toEqual(Object.fromEntries(Object.entries(platformOut.schema.properties).filter(([k]) => !k.startsWith('dethernety_'))))
      expect(ours.schema.required).toEqual(platformOut.schema.required)
    }
    // Where the platform adds nothing, it removes only the elements that may not bind, and so does the strip; on another
    // class type it removes nothing.
    const t = planted()
    expect(platform.withOperationFields(clone(t), 'dataFlow')).toEqual(t)
    const shapes = [[t, 'dataFlow'], [{ ...t, uischema: { ...t.uischema, type: 'VerticalLayout' } }, 'component'], [{ ...t, schema: { type: 'object' } }, 'securityBoundary']] as const
    for (const [shape, type] of shapes) {
      expect(withoutReserved(moduleNamed(clone(shape)), type)).toEqual(moduleNamed(platform.withOperationFields(clone(shape), type)))
    }
  })

  it('keeps a layout that was empty before, and drops a scope that is not a plain chain of properties', () => {
    const ours = withoutReserved(moduleNamed(planted()), 'component') as any
    const first = ours.uiSchema.elements[0].elements
    expect(first.slice(0, 2)).toEqual([
      { type: 'HorizontalLayout', elements: [{ type: 'Control', scope: `#/properties/${Object.keys((component.template as any).schema.properties)[0]}` }] },
      { type: 'HorizontalLayout', elements: [] },
    ])
    expect(JSON.stringify(ours)).not.toContain('x~0dethernety_')
    expect(ours.uiSchema.elements.map((e: any) => e.label)).not.toContain('Only reserved')
  })

  it('is idempotent, and returns a template with nothing reserved as it came', () => {
    for (const [t, type] of [[moduleNamed(planted()), 'component'], [moduleNamed(served(component)), 'component'], [moduleNamed(served(boundary)), 'securityBoundary']] as const) {
      const once = withoutReserved(t, type)
      expect(withoutReserved(once, type)).toBe(once)
      expect(JSON.stringify(withoutReserved(clone(once), type))).toBe(JSON.stringify(once))
    }
    for (const cls of classes.values()) expect(withoutReserved(cls.template, cls.classType)).toBe(cls.template)
    for (const v of [null, 'x', 3, [], {}]) expect(withoutReserved(v, 'component')).toBe(v)
    // Another class type comes back as it came.
    const t = moduleNamed(planted())
    expect(withoutReserved(t, 'dataFlow')).toBe(t)
    expect(withoutReserved(t, 'Component')).toBe(t)
    // A template the platform would not extend loses only the elements that may not bind; its schema stays.
    const flat = { ...t, uiSchema: { ...t.uiSchema, type: 'VerticalLayout' } }
    expect((withoutReserved(flat, 'component') as any).schema).toBe(flat.schema)
    expect(scopesOf((withoutReserved(flat, 'component') as any).uiSchema).filter((x) => x.includes('dethernety_'))).toEqual([])
    const noProperties = { ...t, schema: { type: 'object' } }
    const clean = withoutReserved(noProperties, 'component')
    expect(withoutReserved(clean, 'component')).toBe(clean)
  })
})
