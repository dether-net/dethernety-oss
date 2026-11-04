import { describe, it, expect } from 'vitest'
import { DtUtils } from '@dethernety/dt-core'
import { flattenProperties, unflattenProperties, getNewName, getPageDisplayName, withClearedAttributes, withoutEmptiedListEntries } from '../dataFlowUtils'

describe('flattenProperties', () => {
  // The server writes a key only in its plain form, and checks dt-core's flattener for that; this one writes the same keys.
  it('writes the keys dt-core writes, for groups, lists, lists of groups and empty groups', () => {
    const answers = {
      enabled: true,
      tls: { version: '1.3', ciphers: ['a', 'b'] },
      rules: [{ port: 443, sources: ['10.0.0.0/8'] }, { port: 22, meta: { owner: 'ops' } }],
      ports: [22, null, 443],
      extra: {},
      none: null,
    }
    expect(flattenProperties(answers)).toEqual(DtUtils.flattenProperties(answers))
  })

  it('should flatten a simple nested object', () => {
    const result = flattenProperties({ a: { b: 'value' } })
    expect(result).toEqual({ 'a.b': 'value' })
  })

  it('should handle primitive values at top level', () => {
    const result = flattenProperties({ x: 1, y: 'two', z: true })
    expect(result).toEqual({ x: 1, y: 'two', z: true })
  })

  it('should flatten arrays with index notation', () => {
    const result = flattenProperties({ items: ['a', 'b', 'c'] })
    expect(result).toEqual({
      'items[0]': 'a',
      'items[1]': 'b',
      'items[2]': 'c',
    })
  })

  it('should flatten deeply nested objects', () => {
    const result = flattenProperties({ a: { b: { c: { d: 42 } } } })
    expect(result).toEqual({ 'a.b.c.d': 42 })
  })

  it('should handle empty objects', () => {
    const result = flattenProperties({ empty: {} })
    expect(result).toEqual({ empty: {} })
  })

  it('should handle null values', () => {
    const result = flattenProperties({ x: null })
    expect(result).toEqual({ x: null })
  })

  it('should flatten objects within arrays', () => {
    const result = flattenProperties({ items: [{ name: 'a' }, { name: 'b' }] })
    expect(result).toEqual({
      'items[0].name': 'a',
      'items[1].name': 'b',
    })
  })
})

describe('unflattenProperties', () => {
  it('should unflatten dot-separated keys', () => {
    const result = unflattenProperties({ 'a.b': 'value' })
    expect(result).toEqual({ a: { b: 'value' } })
  })

  it('should unflatten array notation', () => {
    const result = unflattenProperties({ 'items[0]': 'a', 'items[1]': 'b' })
    expect(result).toEqual({ items: ['a', 'b'] })
  })

  it('should round-trip with flattenProperties', () => {
    const original = {
      name: 'test',
      nested: { value: 42, deep: { flag: true } },
      items: [{ id: 1 }, { id: 2 }],
    }
    const flattened = flattenProperties(original)
    const restored = unflattenProperties(flattened)
    expect(restored).toEqual(original)
  })

  it('should protect against prototype pollution', () => {
    const result = unflattenProperties({
      '__proto__.polluted': 'yes',
      'constructor.polluted': 'yes',
      'prototype.polluted': 'yes',
    })
    // Keys with a reserved part are left out whole, not moved elsewhere
    expect(({} as any).polluted).toBeUndefined()
    expect(result).toEqual({})
  })

  it('leaves out a key whose list index is far above the limit, and keeps lists sparse', () => {
    const result = unflattenProperties({ 'allowed_origins[4294967294]': 'x', 'allowed_origins[0]': 'a', 'ports[2]': 443 })
    expect(result.allowed_origins).toEqual(['a'])
    expect(result.ports).toHaveLength(3)
    expect(0 in result.ports).toBe(false)
    expect(JSON.stringify(result).length).toBeLessThan(100)
  })
})

describe('getNewName', () => {
  it('should return baseName when no conflicts', () => {
    expect(getNewName({ baseName: 'Node', existingNames: ['Other'] })).toBe('Node')
  })

  it('should append index when name exists', () => {
    expect(getNewName({ baseName: 'Node', existingNames: ['Node'] })).toBe('Node 1')
  })

  it('should increment index to find unique name', () => {
    expect(
      getNewName({
        baseName: 'Node',
        existingNames: ['Node', 'Node 1', 'Node 2'],
      }),
    ).toBe('Node 3')
  })

  it('should handle empty existing names', () => {
    expect(getNewName({ baseName: 'Node', existingNames: [] })).toBe('Node')
  })

  it('should handle null/undefined in existing names', () => {
    expect(getNewName({ baseName: 'Node', existingNames: [null, undefined] })).toBe('Node')
  })
})

describe('getPageDisplayName', () => {
  it('should return known page names', () => {
    expect(getPageDisplayName('/dataflow')).toBe('Data Flow')
    expect(getPageDisplayName('/browser')).toBe('Browser')
    expect(getPageDisplayName('/issues')).toBe('Issues')
    expect(getPageDisplayName('/analysisresults')).toBe('Analysis Results')
  })

  it('should format unknown paths', () => {
    expect(getPageDisplayName('/some-page')).toBe('Some Page')
  })
})

describe('withClearedAttributes', () => {
  it('clears keys named like built-ins, keeping a __proto__ key an own key', () => {
    const prior = JSON.parse('{"__proto__": "p", "toString": "x", "constructor": "y", "ok": 1}')
    const out = withClearedAttributes(prior, {})
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'constructor', 'ok', 'toString'])
    expect(Object.values(out)).toEqual([null, null, null, null])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })

  it('sends a key the prior attributes held and the new ones lack as null, and keeps the rest', () => {
    expect(withClearedAttributes({ a: true, b: 'x', c: false }, { b: 'y', d: 1 })).toEqual({ b: 'y', d: 1, a: null, c: null })
  })

  it('sends nothing extra for a key that was never answered, or is answered still', () => {
    expect(withClearedAttributes({ a: null, b: undefined, c: 0 }, { c: 0 })).toEqual({ c: 0 })
    expect(withClearedAttributes({}, { a: true })).toEqual({ a: true })
  })

  it('works on flattened keys, so a shortened list clears its dropped entries', () => {
    expect(withClearedAttributes({ 'l[0]': 'a', 'l[1]': 'b' }, { 'l[0]': 'a' })).toEqual({ 'l[0]': 'a', 'l[1]': null })
  })
})

describe('withoutEmptiedListEntries', () => {
  it('drops null, undefined and holes from every list, and keeps empty strings and empty lists', () => {
    const sparse: string[] = ['a']
    sparse[2] = 'c'
    expect(withoutEmptiedListEntries({
      feeds: ['nvd', null, undefined],
      sparse,
      blanks: ['', 'x'],
      none: [],
    })).toEqual({ feeds: ['nvd'], sparse: ['a', 'c'], blanks: ['', 'x'], none: [] })
  })

  it('sends a fully emptied list as an empty list, so the key is not cleared', () => {
    expect(withoutEmptiedListEntries({ feeds: [null] })).toEqual({ feeds: [] })
  })

  it('keeps a __proto__ key as an own key', () => {
    const out = withoutEmptiedListEntries(JSON.parse('{"__proto__": ["a", null], "b": 1}'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__', 'b'])
  })

  it('leaves every other value alone, a top-level null included', () => {
    expect(withoutEmptiedListEntries({ a: null, b: 0, c: false, d: 'x' })).toEqual({ a: null, b: 0, c: false, d: 'x' })
  })
})
