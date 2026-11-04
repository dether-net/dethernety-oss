import { describe, expect, it } from 'vitest'
import { DtUtils } from '../dt-utils.js'
import { FLAT_KEY_MAX_INDEX, FLAT_KEY_MAX_LIST_SLOTS, FLAT_KEY_MAX_SEGMENTS, unflattenFlatKeys } from '../flat-keys.js'

const unflatten = (flat: Record<string, unknown>) => DtUtils.unflattenProperties(flat)

// The total length of every list in a value: what a JSON encoding of it walks.
function listSlots(v: unknown): number {
  if (Array.isArray(v)) return v.length + Array.from(v).reduce((n: number, x) => n + listSlots(x), 0)
  if (v && typeof v === 'object') return Object.values(v).reduce((n: number, x) => n + listSlots(x), 0)
  return 0
}

describe('DtUtils.unflattenProperties: well-formed keys', () => {
  it('rebuilds groups and lists, padding lists with null as the export always has', () => {
    expect(unflatten({ 'a.b': 1, 'items[0]': 'x', 'ports[2]': 443, 'deep.list[0].name': 'n' })).toEqual({
      a: { b: 1 },
      items: ['x'],
      ports: [null, null, 443],
      deep: { list: [{ name: 'n' }] },
    })
  })

  it('gives the same result whatever order the keys arrive in', () => {
    const keys = { 'l[10]': 'k', 'l[2]': 'c', 'l[0]': 'a', 'g.b': 1, s: 's' }
    expect(unflatten(Object.fromEntries(Object.entries(keys).reverse()))).toEqual(unflatten(keys))
  })

  it('leaves holes instead of nulls with padLists: false (the properties panel)', () => {
    const { value } = unflattenFlatKeys({ 'ports[2]': 443 }, { padLists: false })
    expect(value.ports).toHaveLength(3)
    expect(0 in value.ports).toBe(false)
  })
})

describe('DtUtils.unflattenProperties: keys over the limits are dropped whole', () => {
  it('drops an index far above the limit without padding up to it', () => {
    const value = unflatten({ 'allowed_origins[4294967294]': 'x', 'allowed_origins[0]': 'a.example' })
    expect(value).toEqual({ allowed_origins: ['a.example'] })
    expect(JSON.stringify(value).length).toBeLessThan(100)
  })

  it('keeps the largest allowed index and drops the next one', () => {
    expect(unflatten({ [`l[${FLAT_KEY_MAX_INDEX}]`]: 'x' }).l).toHaveLength(FLAT_KEY_MAX_INDEX + 1)
    expect(unflatten({ [`l[${FLAT_KEY_MAX_INDEX + 1}]`]: 'x' })).toEqual({})
    expect(unflatten({ [`l[${'9'.repeat(400)}]`]: 'x' })).toEqual({})
  })

  it('bounds the total list length across many keys, separate or nested', () => {
    const flat: Record<string, string> = {}
    for (let i = 0; i < 200; i++) flat[`a${i}[${FLAT_KEY_MAX_INDEX}]`] = 'x'
    for (let i = 0; i < 20; i++) flat[`n[${i}][${FLAT_KEY_MAX_INDEX}]`] = 'x'
    const { value, dropped } = unflattenFlatKeys(flat)
    expect(listSlots(value)).toBeLessThanOrEqual(FLAT_KEY_MAX_LIST_SLOTS)
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped.every((d) => d.problem === 'budget')).toBe(true)
  })

  it('drops too many parts, no parts, and reserved parts', () => {
    const deep = Array.from({ length: FLAT_KEY_MAX_SEGMENTS + 1 }, (_, i) => `p${i}`).join('.')
    expect(unflattenFlatKeys({ [deep]: 1, '': 2, 'x.__proto__': 3 }).dropped.map((d) => d.problem)).toEqual([
      'empty',
      'depth',
      'reserved',
    ])
  })

  it('treats inherited names as own keys and never reaches the built-ins', () => {
    const callBefore = Function.prototype.call
    expect(unflatten({ 'hasOwnProperty.call': 1, 'valueOf[0]': 2 })).toEqual({ hasOwnProperty: { call: 1 }, valueOf: [2] })
    expect(Object.prototype.hasOwnProperty.call).toBe(callBefore)
    expect((Object.prototype.valueOf as any)[0]).toBeUndefined()
  })

  it('never extends a list that came in as a value', () => {
    const flat = { a: ['x'], 'a[3]': 'y' }
    expect(unflatten(flat)).toEqual({ a: ['x'] })
    expect(flat.a).toEqual(['x'])
  })

  it('keeps the first of two keys that disagree about a place, in sorted order', () => {
    expect(unflatten({ 'ports[0]': 1, 'ports.length': 9 })).toEqual({ ports: { length: 9 } })
    expect(unflatten({ 'x[0]y': 2, 'x[0][1]': 1 })).toEqual({ x: [[null, 1]] })
    expect(unflatten({ a: 5, 'a.b': 6 })).toEqual({ a: 5 })
    expect(unflatten({ '[5]': 'x' })).toEqual({})
  })
})
