/**
 * Strict control resolution: an entry links the control it names beyond doubt, or the push is refused.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ControlCatalog,
  StrictControlResolver,
  normaliseControlName,
  isDeferredControlEntry,
  MODEL_CONTROLS_REF,
} from '../dt-control-resolution.js'

const ZWSP = String.fromCharCode(0x200b)
const BOM = String.fromCharCode(0xfeff)
const COMBINING_ACUTE = String.fromCharCode(0x0301)

const catalogOf = (controls: any[]) => ({ getControls: vi.fn(async () => controls) })

const model = (over: any = {}) => ({
  name: 'M',
  defaultBoundary: { id: 'b0', name: 'root', components: [], boundaries: [] },
  dataFlows: [],
  dataItems: [],
  ...over,
})

describe('normaliseControlName', () => {
  it('composes (NFC), drops zero-width characters and trims; case is kept', () => {
    expect(normaliseControlName(`  Cafe${COMBINING_ACUTE}${ZWSP} `)).toBe('Café')
    expect(normaliseControlName(`${BOM}MFA`)).toBe('MFA')
    expect(normaliseControlName('mfa')).toBe('mfa')
  })

  it('is null for a non-string or a name with nothing left', () => {
    expect(normaliseControlName(undefined)).toBeNull()
    expect(normaliseControlName(42)).toBeNull()
    expect(normaliseControlName(` ${ZWSP} `)).toBeNull()
  })
})

describe('ControlCatalog.resolve', () => {
  const catalog = new ControlCatalog([
    { id: 'm1', name: 'MFA' },
    { id: 'm2', name: 'MFA' },
    { id: 'w1', name: 'WAF' },
    { id: 'n1', name: null as any },
    { id: 'c1', name: 'Café' },
  ])

  it('links an id to that id only, whatever the name says', () => {
    expect(catalog.resolve({ id: 'w1', name: 'MFA' })).toEqual({ control: { id: 'w1', name: 'WAF' } })
  })

  it('refuses an unknown id, offering the controls with the entry\'s exact name', () => {
    expect(catalog.resolve({ id: 'gone', name: 'WAF' })).toEqual({ code: 'control_id_not_found', candidates: [{ id: 'w1', name: 'WAF' }] })
    expect(catalog.resolve({ id: 'gone' })).toEqual({ code: 'control_id_not_found' })
  })

  it('links a name only when exactly one control has it, after normalising both sides', () => {
    expect(catalog.resolve({ name: ' WAF ' })).toEqual({ control: { id: 'w1', name: 'WAF' } })
    expect(catalog.resolve({ id: null, name: `Cafe${COMBINING_ACUTE}` })).toEqual({ control: { id: 'c1', name: 'Café' } })
  })

  it('never links a case-insensitive or partial match', () => {
    expect(catalog.resolve({ name: 'waf' })).toEqual({ code: 'control_name_not_found' })
    expect(catalog.resolve({ name: 'WAF rules' })).toEqual({ code: 'control_name_not_found' })
    expect(catalog.resolve({ name: 'WA' })).toEqual({ code: 'control_name_not_found' })
  })

  it('refuses a name more than one control has, with the candidates', () => {
    const r = catalog.resolve({ name: 'MFA' }) as any
    expect(r.code).toBe('control_name_ambiguous')
    expect(r.candidates.map((c: any) => c.id).sort()).toEqual(['m1', 'm2'])
  })

  it('refuses an entry with no usable id or name', () => {
    for (const entry of [null, 'MFA', ['MFA'], {}, { id: '' }, { id: 5, name: 'WAF' }, { name: '  ' }, { id: null, name: null }]) {
      expect(catalog.resolve(entry), JSON.stringify(entry)).toEqual({ code: 'control_entry_invalid' })
    }
  })

  it('tolerates catalog controls without a name (reachable by id only)', () => {
    expect(catalog.resolve({ id: 'n1' })).toEqual({ control: { id: 'n1', name: '' } })
  })
})

describe('StrictControlResolver.validate', () => {
  it('refuses an element id used twice, across groups', () => {
    const errors = StrictControlResolver.validate(model({
      defaultBoundary: { id: 'b0', components: [{ id: 'x' }], boundaries: [{ id: 'b1', components: [{ id: 'y' }] }] },
      dataFlows: [{ id: 'x' }],
      dataItems: [{ id: 'y' }],
    }))
    expect(errors.map((e) => [e.step, e.code, e.ref])).toEqual([
      ['validate', 'duplicate_element_id', 'x'],
      ['validate', 'duplicate_element_id', 'y'],
    ])
  })

  it('refuses an element whose id is the model ref or collides with the ref of an element without one', () => {
    const errors = StrictControlResolver.validate(model({
      defaultBoundary: { id: 'b0', components: [{ name: 'no id' }, { id: 'components[0]' }, { id: MODEL_CONTROLS_REF }] },
    }))
    expect(errors.map((e) => e.ref)).toEqual(['components[0]', MODEL_CONTROLS_REF])
  })

  it('accepts unique ids and elements without one', () => {
    expect(StrictControlResolver.validate(model({
      defaultBoundary: { id: 'b0', components: [{ name: 'a' }, { name: 'b' }], boundaries: [{ id: 'b1' }] },
    }))).toEqual([])
  })
})

describe('StrictControlResolver.prepare', () => {
  it('walks the model and every group, and reports each failing entry by ref and index', async () => {
    const m = model({
      controls: [{ name: 'Nope' }],
      defaultBoundary: {
        id: 'b0',
        controls: [{ id: 'w1' }],
        components: [{ name: 'no id', controls: [{ name: 'WAF' }, { name: 'MFA' }] }],
        boundaries: [{ id: 'b1', controls: [{ id: 'gone', name: 'x' }], components: [{ id: 'c9', controls: [{}] }] }],
      },
      dataFlows: [{ id: 'f1', controls: [{ name: 'waf' }] }],
    })
    const r = await StrictControlResolver.prepare(m, catalogOf([{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }, { id: 'm2', name: 'MFA' }]))
    expect('errors' in r).toBe(true)
    const errors = (r as any).errors
    expect(errors.map((e: any) => [e.code, e.ref, e.index])).toEqual([
      ['control_name_not_found', MODEL_CONTROLS_REF, 0],
      ['control_name_ambiguous', 'components[0]', 1],
      ['control_id_not_found', 'b1', 0],
      ['control_entry_invalid', 'c9', 0],
      ['control_name_not_found', 'f1', 0],
    ])
    expect(errors[0]).toMatchObject({ step: 'resolve_controls', control: { id: null, name: 'Nope' } })
    expect(errors[1]).toMatchObject({ candidates: [{ id: 'm1', name: 'MFA' }, { id: 'm2', name: 'MFA' }], candidates_total: 2 })
    expect(errors[2]).toMatchObject({ control: { id: 'gone', name: 'x' } })
  })

  it('caps the candidates at 20 and gives the total', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `id${String(i).padStart(2, '0')}`, name: 'Logging' }))
    const r = await StrictControlResolver.prepare(model({ controls: [{ name: 'Logging' }] }), catalogOf(many)) as any
    expect(r.errors[0].candidates).toHaveLength(20)
    expect(r.errors[0].candidates_total).toBe(25)
  })

  it('refuses a controls value that is not a list', async () => {
    const r = await StrictControlResolver.prepare(model({ defaultBoundary: { id: 'b0', controls: 'WAF' } }), catalogOf([])) as any
    expect(r.errors).toEqual([expect.objectContaining({ code: 'control_entry_invalid', ref: 'b0' })])
    expect(r.errors[0]).not.toHaveProperty('index')
  })

  it('refuses when either catalog set cannot be read, with one error', async () => {
    for (const failing of [undefined, 'all']) {
      const dtControl = {
        getControls: vi.fn(async ({ folderId }: any) => {
          if (folderId === failing) throw new Error('catalog refused')
          return [{ id: 'w1', name: 'WAF' }]
        }),
      }
      const r = await StrictControlResolver.prepare(model({ controls: [{ id: 'w1' }] }), dtControl) as any
      expect(r.errors, String(failing)).toEqual([{ step: 'resolve_controls', code: 'control_catalog_unavailable', error: expect.any(String) }])
    }
  })

  it('reads no catalog when no entry needs one', async () => {
    const dtControl = catalogOf([])
    const r = await StrictControlResolver.prepare(model({ controls: [], defaultBoundary: { id: 'b0', controls: [] } }), dtControl)
    expect('resolver' in r).toBe(true)
    expect(dtControl.getControls).not.toHaveBeenCalled()
  })

  it('links each of three same-named controls by its pinned id', async () => {
    const m = model({ defaultBoundary: { id: 'b0', components: [
      { id: 'c1', controls: [{ id: 'm1', name: 'MFA' }] },
      { id: 'c2', controls: [{ id: 'm2', name: 'MFA' }] },
      { id: 'c3', controls: [{ id: 'm3', name: 'MFA' }] },
    ] } })
    const r = await StrictControlResolver.prepare(m, catalogOf(['m1', 'm2', 'm3'].map((id) => ({ id, name: 'MFA' })))) as any
    const [c1, c2, c3] = m.defaultBoundary.components
    expect(r.resolver.resolve(c1, c1.controls)).toEqual([{ id: 'm1', name: 'MFA' }])
    expect(r.resolver.resolve(c2, c2.controls)).toEqual([{ id: 'm2', name: 'MFA' }])
    expect(r.resolver.resolve(c3, c3.controls)).toEqual([{ id: 'm3', name: 'MFA' }])
  })

  it('warns when an id links a control whose catalog name differs from the entry\'s', async () => {
    const r = await StrictControlResolver.prepare(model({ controls: [{ id: 'w1', name: 'Old WAF' }, { id: 'm1', name: ' MFA ' }] }),
      catalogOf([{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }])) as any
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/controls\[0\] of @model: the id "w1" links the catalog control named "WAF", not "Old WAF"/)
  })
})

describe('greenfield Controls (created on the platform after the model push)', () => {
  it('recognises only a temporary greenfield id', () => {
    expect(isDeferredControlEntry({ id: 'greenfield-a1b2', name: 'x' })).toBe(true)
    for (const entry of [{ id: 'greenfield-' }, { id: 'greenfield-a/b' }, { id: 'xgreenfield-a' }, { name: 'greenfield-a' }, 'greenfield-a', null]) {
      expect(isDeferredControlEntry(entry), JSON.stringify(entry)).toBe(false)
    }
  })

  it('neither refuses nor links it, and reads no catalog for a list holding only such entries', async () => {
    const dtControl = catalogOf([{ id: 'w1', name: 'WAF' }])
    const m = model({ defaultBoundary: { id: 'b0', controls: [{ id: 'greenfield-a1b2', name: 'Not yet created' }] } })
    const r = await StrictControlResolver.prepare(m, dtControl) as any
    expect(r.resolver).toBeDefined()
    expect(r.warnings).toEqual([])
    expect(dtControl.getControls).not.toHaveBeenCalled()
    expect(r.resolver.resolve(m.defaultBoundary, m.defaultBoundary.controls)).toEqual([])
  })

  it('keeps the other entries of the list, in order', async () => {
    const m = model({ controls: [{ name: 'WAF' }, { id: 'greenfield-x', name: 'New' }, { id: 'm1' }] })
    const r = await StrictControlResolver.prepare(m, catalogOf([{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }])) as any
    expect(r.resolver.resolve(m, m.controls)).toEqual([{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }])
  })
})

describe('StrictControlResolver — resolve and record', () => {
  it('records only what the caller says was written, in list order, with the catalog name', async () => {
    const m = model({ defaultBoundary: { id: 'b0', components: [
      { id: 'c1', controls: [{ name: 'WAF' }, { id: 'm1', name: 'renamed' }] },
      { id: 'c2', controls: [] },
      { id: 'c3' },
    ] } })
    const { resolver } = await StrictControlResolver.prepare(m, catalogOf([{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }])) as any
    const [c1, c2] = m.defaultBoundary.components
    resolver.record(c1, resolver.resolve(c1, c1.controls))
    resolver.record(c2, resolver.resolve(c2, c2.controls))
    expect(resolver.resolved()).toEqual({ c1: [{ id: 'w1', name: 'WAF' }, { id: 'm1', name: 'MFA' }], c2: [] })
  })

  it('throws for an element the preflight did not see, or an entry the snapshot cannot link', async () => {
    const m = model({ controls: [{ name: 'WAF' }] })
    const { resolver } = await StrictControlResolver.prepare(m, catalogOf([{ id: 'w1', name: 'WAF' }])) as any
    expect(() => resolver.resolve({}, [{ name: 'WAF' }])).toThrow(/did not see/)
    expect(() => resolver.resolve(m, [{ name: 'waf' }])).toThrow(/does not resolve \(control_name_not_found\)/)
  })
})
