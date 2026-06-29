import { describe, it, expect } from 'vitest'
import type { Node } from '@vue-flow/core'
import { buildBoundaryTree, flattenBoundaryTree, isAncestorBoundary } from '../boundaryTree'

// Minimal Vue-Flow Node factory: only id, type, parentNode, data.label matter to the builder.
const b = (id: string, parentNode = '', label?: string): Node =>
  ({ id, type: 'BOUNDARY', parentNode, position: { x: 0, y: 0 }, data: { label: label ?? id } }) as any

describe('buildBoundaryTree', () => {
  it('nests children under their parentNode and surfaces top-level boundaries as roots', () => {
    // root1 ─ child ─ grandchild ; root2 (parentNode = '')
    const tree = buildBoundaryTree(
      [b('root1'), b('child', 'root1'), b('grand', 'child'), b('root2')],
      '',
    )
    expect(tree.map(t => t.id).sort()).toEqual(['root1', 'root2'])
    const root1 = tree.find(t => t.id === 'root1')!
    expect(root1.children.map(c => c.id)).toEqual(['child'])
    expect(root1.children[0].children.map(c => c.id)).toEqual(['grand'])
  })

  it('treats the default root id as a root sentinel (its children surface at top level)', () => {
    // Boundaries whose parentNode is the default container id are top-level peers.
    const tree = buildBoundaryTree([b('a', 'default-root'), b('c', 'a')], 'default-root')
    expect(tree.map(t => t.id)).toEqual(['a'])
    expect(tree[0].children.map(c => c.id)).toEqual(['c'])
  })

  it('treats an unknown/missing parent as a root', () => {
    const tree = buildBoundaryTree([b('orphan', 'ghost')], '')
    expect(tree.map(t => t.id)).toEqual(['orphan'])
  })

  it('uses the node label as the row title, falling back to the id', () => {
    const tree = buildBoundaryTree([b('x', '', 'Datacenter'), { id: 'y', type: 'BOUNDARY', parentNode: '', position: { x: 0, y: 0 }, data: {} } as any], '')
    expect(tree.find(t => t.id === 'x')!.title).toBe('Datacenter')
    expect(tree.find(t => t.id === 'y')!.title).toBe('y')
  })

  it('does not loop on a self-reference or a 2-cycle (both become roots)', () => {
    expect(buildBoundaryTree([b('self', 'self')], '').map(t => t.id)).toEqual(['self'])
    const cyc = buildBoundaryTree([b('A', 'B'), b('B', 'A')], '')
    expect(cyc.map(t => t.id).sort()).toEqual(['A', 'B'])
    // No node ends up as its own descendant.
    expect(cyc.every(t => t.children.length === 0)).toBe(true)
  })
})

describe('isAncestorBoundary', () => {
  // dc ─ app ─ pay ; db is a sibling branch under dc.
  const MODEL: Node[] = [b('dc'), b('app', 'dc'), b('pay', 'app'), b('db', 'dc')]
  const get = (id: string) => MODEL.find(n => n.id === id) ?? null

  it('is true for a direct parent', () => {
    expect(isAncestorBoundary('app', 'pay', get)).toBe(true)
  })

  it('is true for a multi-hop ancestor', () => {
    expect(isAncestorBoundary('dc', 'pay', get)).toBe(true)
  })

  it('is false in the reverse (descendant is not an ancestor)', () => {
    expect(isAncestorBoundary('pay', 'dc', get)).toBe(false)
  })

  it('is false for a sibling-branch peer (not on the chain)', () => {
    expect(isAncestorBoundary('db', 'pay', get)).toBe(false)
    expect(isAncestorBoundary('pay', 'db', get)).toBe(false)
  })

  it('is false for self', () => {
    expect(isAncestorBoundary('app', 'app', get)).toBe(false)
  })

  it('is false for empty ids or a missing node', () => {
    expect(isAncestorBoundary('', 'pay', get)).toBe(false)
    expect(isAncestorBoundary('dc', '', get)).toBe(false)
    expect(isAncestorBoundary('dc', 'ghost', get)).toBe(false)
  })

  it('is cycle-safe (a 2-cycle never loops or reports a false ancestor)', () => {
    const cyc: Node[] = [b('A', 'B'), b('B', 'A')]
    const getCyc = (id: string) => cyc.find(n => n.id === id) ?? null
    // A's parent is B, B's parent is A; neither is the OTHER's ancestor in a way that loops forever.
    expect(isAncestorBoundary('A', 'B', getCyc)).toBe(true) // B's parent chain reaches A in one hop
    expect(isAncestorBoundary('B', 'A', getCyc)).toBe(true) // symmetric
    // The bounded walk terminates (no hang) — reaching here is the assertion.
    expect(true).toBe(true)
  })
})

describe('flattenBoundaryTree', () => {
  it('pre-orders the forest with depth (child directly under its parent)', () => {
    const tree = buildBoundaryTree([b('root1'), b('child', 'root1'), b('grand', 'child'), b('root2')], '')
    const flat = flattenBoundaryTree(tree)
    expect(flat.map(r => [r.id, r.depth])).toEqual([
      ['root1', 0],
      ['child', 1],
      ['grand', 2],
      ['root2', 0],
    ])
  })
})
