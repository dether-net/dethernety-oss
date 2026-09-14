import { describe, it, expect } from 'vitest'
import { editPaths, projectEdit } from '../editProjection'

/**
 * The three properties that make a projection safe, each with the case that motivates it.
 *
 * Every one of these is a real edit the canvas produces, not a hypothetical: a cleared zone, an
 * un-marked crown jewel, a node dragged to the root boundary, a conduit list, a drag.
 */

describe('editPaths — an array is a leaf', () => {
  it('names the list, never a position inside it', () => {
    // The merge that produced the element replaces arrays wholesale rather than merging them
    // element-wise. Descending here would name `data.conduits.0.justification` and rebuild a
    // one-element list from a list that has three.
    expect(editPaths({ data: { conduits: [{ peerId: 'p1', justification: 'edited' }] } }))
      .toEqual([['data', 'conduits']])
  })

  it('names an empty list, which is how a list is cleared', () => {
    expect(editPaths({ data: { controls: [] } })).toEqual([['data', 'controls']])
  })
})

describe('editPaths — presence is the test, not truth', () => {
  it.each([
    ['a cleared zone', { data: { zone: null } }, [['data', 'zone']]],
    ['an un-marked crown jewel', { data: { crownJewel: false } }, [['data', 'crownJewel']]],
    ['a drag to the root boundary', { parentNode: '' }, [['parentNode']]],
    ['an origin position', { position: { x: 0, y: 0 } }, [['position', 'x'], ['position', 'y']]],
  ])('keeps %s', (_name, updates, expected) => {
    expect(editPaths(updates)).toEqual(expected)
  })
})

describe('editPaths — depth', () => {
  it('names the leaf, not the branch it sits on', () => {
    expect(editPaths({ data: { description: 'd' } })).toEqual([['data', 'description']])
  })

  it('names every leaf of a compound value', () => {
    expect(editPaths({ position: { x: 5, y: 6 } })).toEqual([['position', 'x'], ['position', 'y']])
  })

  it('names nothing for an object with no keys, rather than standing for its whole subtree', () => {
    expect(editPaths({ data: {} })).toEqual([])
    expect(editPaths({})).toEqual([])
  })
})

describe('projectEdit', () => {
  const node = () => ({
    id: 'n-1',
    type: 'PROCESS',
    position: { x: 1, y: 2 },
    parentNode: 'b1',
    width: 300,
    data: {
      label: 'N', description: 'd', zone: 'PUBLIC', crownJewel: true,
      controls: ['ctl-1'], conduits: [{ peerId: 'p1' }],
    },
  })

  it('carries only what the edit names', () => {
    expect(projectEdit(node(), { data: { description: 'edited' } }))
      .toEqual({ id: 'n-1', data: { description: 'd' } })
  })

  it('always carries the id, which is how the write addresses the element', () => {
    expect(projectEdit(node(), {})).toEqual({ id: 'n-1' })
  })

  it('leaves an unnamed sibling behind', () => {
    const projected: any = projectEdit(node(), { data: { label: 'x' } })
    expect(projected.data).not.toHaveProperty('description')
    expect(projected).not.toHaveProperty('position')
    expect(projected).not.toHaveProperty('parentNode')
  })

  it('reads the VALUE from the element, not from the edit', () => {
    // The element has already been merged, and it is the merged element the writer must see — the
    // edit object only says which fields travel.
    expect(projectEdit({ id: 'n-1', data: { description: 'merged' } }, { data: { description: 'stale' } }))
      .toEqual({ id: 'n-1', data: { description: 'merged' } })
  })

  it('carries a compound value whole', () => {
    expect(projectEdit(node(), { position: { x: 9, y: 9 } }))
      .toEqual({ id: 'n-1', position: { x: 1, y: 2 } })
  })

  it('carries a list by reference to the merged element, not rebuilt', () => {
    const source = node()
    const projected: any = projectEdit(source, { data: { conduits: [] } })
    expect(projected.data.conduits).toBe(source.data.conduits)
  })

  it.each([
    ['a cleared zone', { data: { zone: null } }, { id: 'n-1', data: { zone: 'PUBLIC' } }],
    ['a drag to the root', { parentNode: '' }, { id: 'n-1', parentNode: 'b1' }],
    ['a width', { width: 0 }, { id: 'n-1', width: 300 }],
  ])('carries %s', (_name, updates, expected) => {
    expect(projectEdit(node(), updates)).toEqual(expected)
  })

  it('skips a named path the element does not hold rather than writing undefined', () => {
    const projected = projectEdit({ id: 'n-1', data: {} }, { data: { zone: null } })
    expect(projected).toEqual({ id: 'n-1' })
    expect('zone' in ((projected as any).data ?? {})).toBe(false)
  })

  it('does not touch the element it reads from', () => {
    const source = node()
    const before = JSON.stringify(source)
    projectEdit(source, { data: { description: 'x' }, position: { x: 1, y: 1 } })
    expect(JSON.stringify(source)).toBe(before)
  })
})
