import { describe, it, expect } from 'vitest'
import type { Node } from '@vue-flow/core'
import { resolveEffectiveZone, DEFAULT_ZONE } from '../effectiveZone'

const DEFAULT_ID = 'root'

// Build a getBoundary from a flat map of id -> { zone, parentNode }.
const makeGraph = (defs: Record<string, { zone?: string | null; parentNode?: string }>) => {
  const nodes: Record<string, Node> = {}
  for (const [id, d] of Object.entries(defs)) {
    nodes[id] = { id, type: 'BOUNDARY', position: { x: 0, y: 0 }, data: { zone: d.zone ?? null }, parentNode: d.parentNode } as any
  }
  return (id: string) => nodes[id]
}

describe('resolveEffectiveZone', () => {
  it('reports a zone declared on the boundary itself', () => {
    const get = makeGraph({ b1: { zone: 'PUBLIC', parentNode: '' } })
    expect(resolveEffectiveZone('b1', get, DEFAULT_ID)).toEqual({ zone: 'PUBLIC', source: 'declared' })
  })

  it('inherits the nearest ancestor zone and reports `from`', () => {
    const get = makeGraph({
      child: { zone: null, parentNode: 'mid' },
      mid: { zone: null, parentNode: 'top' },
      top: { zone: 'RESTRICTED', parentNode: '' },
    })
    expect(resolveEffectiveZone('child', get, DEFAULT_ID)).toEqual({ zone: 'RESTRICTED', source: 'inherited', from: 'top' })
  })

  it('falls back to INTERNAL/default when no ancestor declares a zone (root reached)', () => {
    const get = makeGraph({
      child: { zone: null, parentNode: '' }, // '' → root
      [DEFAULT_ID]: { zone: null, parentNode: '' }, // root has no zone and self-loops via ''
    })
    const r = resolveEffectiveZone('child', get, DEFAULT_ID)
    expect(r).toEqual({ zone: DEFAULT_ZONE, source: 'default' })
  })

  it("treats a '' parentNode as the default boundary", () => {
    const get = makeGraph({
      child: { zone: null, parentNode: '' },
      [DEFAULT_ID]: { zone: 'EXPOSED', parentNode: '' },
    })
    expect(resolveEffectiveZone('child', get, DEFAULT_ID)).toEqual({ zone: 'EXPOSED', source: 'inherited', from: DEFAULT_ID })
  })

  it('terminates on a cycle and returns default', () => {
    const get = makeGraph({
      a: { zone: null, parentNode: 'b' },
      b: { zone: null, parentNode: 'a' },
    })
    expect(resolveEffectiveZone('a', get, DEFAULT_ID)).toEqual({ zone: DEFAULT_ZONE, source: 'default' })
  })

  it('falls back to default when an ancestor is unhydrated (getBoundary returns undefined)', () => {
    const get = makeGraph({ child: { zone: null, parentNode: 'missing' } }) // 'missing' not in graph
    expect(resolveEffectiveZone('child', get, DEFAULT_ID)).toEqual({ zone: DEFAULT_ZONE, source: 'default' })
  })
})
