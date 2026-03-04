import { describe, it, expect } from 'vitest'
import { flattenProperties, unflattenProperties, getNewName, getPageDisplayName } from '../dataFlowUtils'

describe('flattenProperties', () => {
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
    // Prototype pollution keys should be skipped
    expect(({} as any).polluted).toBeUndefined()
    // The result itself should be an empty-ish object (keys were skipped)
    expect(result).toBeDefined()
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
