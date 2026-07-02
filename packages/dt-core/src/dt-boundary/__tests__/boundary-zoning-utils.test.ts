import { describe, it, expect } from 'vitest'
import {
  sanitizeZone,
  sanitizeDomains,
  normalizePlanes,
  sanitizeJustification,
  flattenConduits,
  buildConduitOps,
  prepareConduitsForWrite,
} from '../boundary-zoning-utils.js'
import { Conduit } from '../../interfaces/core-types-interface.js'

describe('sanitizeZone', () => {
  it('passes a valid Zone through', () => {
    expect(sanitizeZone('RESTRICTED')).toBe('RESTRICTED')
  })
  it('maps invalid / null / undefined to null', () => {
    expect(sanitizeZone('NONSENSE' as any)).toBeNull()
    expect(sanitizeZone(null)).toBeNull()
    expect(sanitizeZone(undefined)).toBeNull()
  })
})

describe('sanitizeDomains', () => {
  it('trims, drops empties, and de-dupes case-insensitively keeping first casing', () => {
    expect(sanitizeDomains(['  ERP ', 'erp', '', '  ', 'BI'])).toEqual(['ERP', 'BI'])
  })
  it('caps each value at 64 chars and the count at 16', () => {
    const long = 'x'.repeat(80)
    expect(sanitizeDomains([long])[0]).toHaveLength(64)
    const many = Array.from({ length: 30 }, (_, i) => `d${i}`)
    expect(sanitizeDomains(many)).toHaveLength(16)
  })
  it('returns [] for undefined / non-array', () => {
    expect(sanitizeDomains(undefined)).toEqual([])
    expect(sanitizeDomains('erp' as any)).toEqual([])
  })
})

describe('normalizePlanes', () => {
  it('returns canonical order so [M,W] equals [W,M]', () => {
    expect(normalizePlanes(['MANAGEMENT', 'WORKLOAD'])).toEqual(['WORKLOAD', 'MANAGEMENT'])
    expect(normalizePlanes(['WORKLOAD', 'MANAGEMENT'])).toEqual(['WORKLOAD', 'MANAGEMENT'])
  })
  it('de-dupes and filters invalid members', () => {
    expect(normalizePlanes(['WORKLOAD', 'WORKLOAD', 'BOGUS' as any])).toEqual(['WORKLOAD'])
  })
  it('returns [] for undefined', () => {
    expect(normalizePlanes(undefined)).toEqual([])
  })
})

describe('sanitizeJustification', () => {
  it('trims and caps at 500 chars', () => {
    expect(sanitizeJustification('  hi  ')).toBe('hi')
    expect(sanitizeJustification('y'.repeat(600))).toHaveLength(500)
  })
  it('returns undefined for empty / whitespace / non-string', () => {
    expect(sanitizeJustification('   ')).toBeUndefined()
    expect(sanitizeJustification('')).toBeUndefined()
    expect(sanitizeJustification(undefined)).toBeUndefined()
  })
})

describe('flattenConduits', () => {
  it('tags edges OUTBOUND/INBOUND by which connection they came from and maps properties', () => {
    const raw = {
      outboundConduitsConnection: {
        edges: [{ properties: { justification: 'to Stripe', controlRefs: ['c1'] }, node: { id: 'p1', name: 'Stripe' } }],
      },
      inboundConduitsConnection: {
        edges: [{ properties: { justification: null, controlRefs: null }, node: { id: 'p2', name: 'Edge' } }],
      },
    }
    expect(flattenConduits(raw)).toEqual([
      { peerId: 'p1', peerName: 'Stripe', direction: 'OUTBOUND', justification: 'to Stripe', controlRefs: ['c1'] },
      { peerId: 'p2', peerName: 'Edge', direction: 'INBOUND', justification: undefined, controlRefs: undefined },
    ])
  })
  it('returns [] for missing connections / null input and skips edges with no node id', () => {
    expect(flattenConduits(null)).toEqual([])
    expect(flattenConduits({})).toEqual([])
    expect(flattenConduits({ outboundConduitsConnection: { edges: [{ node: { id: '' } } as any] } })).toEqual([])
  })
})

describe('buildConduitOps — baseline-driven delta', () => {
  const out = (peerId: string, justification?: string): Conduit => ({ peerId, direction: 'OUTBOUND', justification })
  const SELF = 'self'

  it('connects only added peers, with the edge justification', () => {
    const ops = buildConduitOps('OUTBOUND', [out('p1', 'why')], [], SELF)
    expect(ops).toEqual([{ connect: [{ where: { node: { id: { eq: 'p1' } } }, edge: { justification: 'why' } }] }])
  })

  it('disconnects only removed peers', () => {
    const ops = buildConduitOps('OUTBOUND', [], [out('p1')], SELF)
    expect(ops).toEqual([{ disconnect: [{ where: { node: { id: { eq: 'p1' } } } }] }])
  })

  it('emits a single update op (not disconnect+reconnect) when only the justification changed', () => {
    const ops = buildConduitOps('OUTBOUND', [out('p1', 'new')], [out('p1', 'old')], SELF)
    expect(ops).toEqual([
      { update: { where: { node: { id: { eq: 'p1' } } }, edge: { justification: { set: 'new' } } } },
    ])
  })

  it('is a no-op (undefined) when nothing changed', () => {
    expect(buildConduitOps('OUTBOUND', [out('p1', 'same')], [out('p1', 'same')], SELF)).toBeUndefined()
  })

  it('combines added + removed in one membership op-object and one update op per changed peer', () => {
    const ops = buildConduitOps(
      'OUTBOUND',
      [out('keep', 'edited'), out('add')],
      [out('keep', 'orig'), out('drop')],
      SELF,
    )
    expect(ops).toEqual([
      {
        connect: [{ where: { node: { id: { eq: 'add' } } }, edge: { justification: undefined } }],
        disconnect: [{ where: { node: { id: { eq: 'drop' } } } }],
      },
      { update: { where: { node: { id: { eq: 'keep' } } }, edge: { justification: { set: 'edited' } } } },
    ])
  })

  it('drops a self-conduit and de-dupes per direction (first wins)', () => {
    const ops = buildConduitOps('OUTBOUND', [out(SELF), out('p1', 'a'), out('p1', 'b')], [], SELF)
    expect(ops).toEqual([{ connect: [{ where: { node: { id: { eq: 'p1' } } }, edge: { justification: 'a' } }] }])
  })

  it('only considers conduits of the requested direction', () => {
    const mixed: Conduit[] = [out('p1', 'x'), { peerId: 'p2', direction: 'INBOUND', justification: 'y' }]
    expect(buildConduitOps('OUTBOUND', mixed, [], SELF)).toEqual([
      { connect: [{ where: { node: { id: { eq: 'p1' } } }, edge: { justification: 'x' } }] },
    ])
    expect(buildConduitOps('INBOUND', mixed, [], SELF)).toEqual([
      { connect: [{ where: { node: { id: { eq: 'p2' } } }, edge: { justification: 'y' } }] },
    ])
  })
})

describe('prepareConduitsForWrite — OUTBOUND-only + peerId translation', () => {
  const id = (x: string) => `srv-${x}` // resolver: old id → server id

  it('keeps OUTBOUND conduits and translates their peerId', () => {
    const conduits: Conduit[] = [{ peerId: 'p1', direction: 'OUTBOUND', justification: 'why' }]
    expect(prepareConduitsForWrite(conduits, id)).toEqual({
      conduits: [{ peerId: 'srv-p1', direction: 'OUTBOUND', justification: 'why' }],
      dropped: [],
    })
  })

  it('drops INBOUND conduits (the read-side mirror is never written — avoids the two-sided dup)', () => {
    const conduits: Conduit[] = [
      { peerId: 'p1', direction: 'OUTBOUND' },
      { peerId: 'p2', direction: 'INBOUND' },
    ]
    expect(prepareConduitsForWrite(conduits, id)).toEqual({
      conduits: [{ peerId: 'srv-p1', direction: 'OUTBOUND' }],
      dropped: [],
    })
  })

  it('drops + reports an OUTBOUND peer that does not resolve', () => {
    const conduits: Conduit[] = [
      { peerId: 'good', direction: 'OUTBOUND' },
      { peerId: 'gone', direction: 'OUTBOUND' },
    ]
    const resolve = (x: string) => (x === 'gone' ? undefined : `srv-${x}`)
    expect(prepareConduitsForWrite(conduits, resolve)).toEqual({
      conduits: [{ peerId: 'srv-good', direction: 'OUTBOUND' }],
      dropped: ['gone'],
    })
  })

  it('returns empty for undefined / empty input', () => {
    expect(prepareConduitsForWrite(undefined, id)).toEqual({ conduits: [], dropped: [] })
    expect(prepareConduitsForWrite([], id)).toEqual({ conduits: [], dropped: [] })
  })
})
