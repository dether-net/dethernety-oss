/**
 * Pure determination cascade + inheritance resolver + coherence findings.
 * The golden cascade matrix runs over the committed `zoning-fixture`; resolver/edge cases are inline.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveZone,
  determineZoneTier,
  computeZoningFindings,
  DEFAULT_ZONE,
  type ZoningContext,
} from '../zone-determination.js'
import type { StructureBoundary } from '../../schemas/structure.schema.js'
import { boundariesById, zoningContext, expectedTiers, DEFAULT_BOUNDARY_ID } from './zoning-fixture.js'

describe('determineZoneTier — golden cascade matrix (worked examples, v1-adjusted)', () => {
  for (const [id, tier] of Object.entries(expectedTiers)) {
    it(`${id} → ${tier}`, () => {
      expect(determineZoneTier(boundariesById.get(id)!, zoningContext).tier).toBe(tier)
    })
  }

  it('blocks RESTRICTED on an EXPOSED-ingress asset with blockedBy="exposure" (under-segmented)', () => {
    const r = determineZoneTier(boundariesById.get('exposeddb')!, zoningContext)
    expect(r.tier).toBe('INTERNAL')
    expect(r.blockedBy).toBe('exposure')
  })

  it('positive-ingress: an asset boundary with ZERO ingress stays INTERNAL (never RESTRICTED)', () => {
    const r = determineZoneTier(boundariesById.get('orphan')!, zoningContext)
    expect(r.tier).toBe('INTERNAL')
    expect(r.blockedBy).toBe('no-ingress')
  })

  it('v1 vendor divergence: an asset reached directly from a VENDOR is PUBLIC, not INTERNAL', () => {
    expect(determineZoneTier(boundariesById.get('vapp')!, zoningContext).tier).toBe('PUBLIC')
  })

  it('exposure outranks asset pull: an asset in a DMZ boundary stays EXPOSED', () => {
    expect(determineZoneTier(boundariesById.get('dmzasset')!, zoningContext).tier).toBe('EXPOSED')
  })
})

describe('determineZoneTier — default-then-promote (directAssetIds gates RESTRICTED)', () => {
  // Step-4 skeleton blanks BOTH asset sets (the gate reads directAssetIds now).
  const skeletonCtx: ZoningContext = { ...zoningContext, assetIds: new Set(), directAssetIds: new Set() }

  it('with assetIds EMPTY (Step-4 skeleton), the asset boundary is INTERNAL — no RESTRICTED', () => {
    expect(determineZoneTier(boundariesById.get('paydb')!, skeletonCtx).tier).toBe('INTERNAL')
  })

  it('with assetIds populated (close-of-Step-7), the same boundary promotes to RESTRICTED', () => {
    expect(determineZoneTier(boundariesById.get('paydb')!, zoningContext).tier).toBe('RESTRICTED')
  })

  it('exposure tiers are unaffected by assetIds (computed from topology only)', () => {
    expect(determineZoneTier(boundariesById.get('web')!, skeletonCtx).tier).toBe('PUBLIC')
    expect(determineZoneTier(boundariesById.get('dmz')!, skeletonCtx).tier).toBe('EXPOSED')
  })
})

describe('resolveEffectiveZone — inheritance', () => {
  const make = (boundaries: StructureBoundary[]) => new Map(boundaries.map((x) => [x.id, x]))

  it('declared: a boundary with its own zone', () => {
    const m = make([{ id: 'a', name: 'a', zone: 'RESTRICTED' }])
    expect(resolveEffectiveZone('a', m, 'a')).toEqual({ zone: 'RESTRICTED', source: 'declared' })
  })

  it('inherited: walks up to the nearest declaring ancestor, reporting `from`', () => {
    const m = make([
      { id: 'root', name: 'root', zone: 'EXPOSED' },
      { id: 'child', name: 'child', parentBoundary: { id: 'root' } },
    ])
    expect(resolveEffectiveZone('child', m, 'root')).toEqual({ zone: 'EXPOSED', source: 'inherited', from: 'root' })
  })

  it('default: no zone anywhere in the chain → INTERNAL/default', () => {
    const m = make([
      { id: 'root', name: 'root' },
      { id: 'child', name: 'child', parentBoundary: { id: 'root' } },
    ])
    expect(resolveEffectiveZone('child', m, 'root')).toEqual({ zone: DEFAULT_ZONE, source: 'default' })
  })

  it('explicit null zone inherits (not treated as declared)', () => {
    const m = make([
      { id: 'root', name: 'root', zone: 'PUBLIC' },
      { id: 'child', name: 'child', zone: null, parentBoundary: { id: 'root' } },
    ])
    expect(resolveEffectiveZone('child', m, 'root')).toEqual({ zone: 'PUBLIC', source: 'inherited', from: 'root' })
  })

  it('root self-loop (parent undefined → defaultBoundaryId === self) terminates at default', () => {
    const m = make([{ id: 'root', name: 'root' }])
    expect(resolveEffectiveZone('root', m, 'root')).toEqual({ zone: DEFAULT_ZONE, source: 'default' })
  })

  it('a 2-cycle is guarded and falls through to default', () => {
    const m = make([
      { id: 'a', name: 'a', parentBoundary: { id: 'b' } },
      { id: 'b', name: 'b', parentBoundary: { id: 'a' } },
    ])
    expect(resolveEffectiveZone('a', m, 'root').source).toBe('default')
  })

  it('a missing ancestor falls through to default', () => {
    const m = make([{ id: 'child', name: 'child', parentBoundary: { id: 'gone' } }])
    expect(resolveEffectiveZone('child', m, 'gone').source).toBe('default')
  })
})

describe('computeZoningFindings — conduit-independent kinds', () => {
  const findings = computeZoningFindings(zoningContext)
  const byKind = (kind: string) => findings.filter((f) => f.kind === kind)
  const on = (kind: string, id: string) => findings.some((f) => f.kind === kind && f.boundaryId === id)

  it('under-protected fires for every asset boundary that is not RESTRICTED, not for RESTRICTED', () => {
    expect(on('under-protected', 'exposeddb')).toBe(true) // under-segmented
    expect(on('under-protected', 'dmzasset')).toBe(true) // misplaced
    expect(on('under-protected', 'vapp')).toBe(true) // misplaced (vendor-reached)
    expect(on('under-protected', 'orphan')).toBe(true) // cannot verify
    expect(on('under-protected', 'paydb')).toBe(false) // RESTRICTED → no finding
  })

  it('under-protected detail distinguishes misplaced vs under-segmented vs cannot-verify', () => {
    const detail = (id: string) => findings.find((f) => f.kind === 'under-protected' && f.boundaryId === id)!.detail
    expect(detail('dmzasset')).toMatch(/misplaced/)
    expect(detail('exposeddb')).toMatch(/under-segmented/)
    expect(detail('orphan')).toMatch(/cannot verify/)
  })

  it('mgmt-plane fires for a MANAGEMENT boundary resolved to EXPOSED', () => {
    expect(on('mgmt-plane', 'dmz')).toBe(true)
    expect(byKind('mgmt-plane')).toHaveLength(1)
  })

  it('unclassified rolls up the zoneless boundaries (none declare a zone here) and excludes the root', () => {
    const ids = new Set(byKind('unclassified').map((f) => f.boundaryId))
    expect(ids.has(DEFAULT_BOUNDARY_ID)).toBe(false)
    expect(ids.size).toBe(boundariesById.size - 1) // every non-root boundary, all undeclared
  })

  it('external-ingress fires for every external boundary reaching a declared-trusted target with no conduit', () => {
    // ext (UNTRUSTED) → web, vend (VENDOR) → vapp; both targets resolve to INTERNAL (no declared zone).
    expect(on('external-ingress', 'ext')).toBe(true)
    expect(on('external-ingress', 'vend')).toBe(true)
    expect(byKind('external-ingress')).toHaveLength(2)
  })

  it('external-ingress carries the target boundary as peerId (so a caller can author the conduit)', () => {
    expect(findings.find((f) => f.kind === 'external-ingress' && f.boundaryId === 'ext')!.peerId).toBe('web')
    expect(findings.find((f) => f.kind === 'external-ingress' && f.boundaryId === 'vend')!.peerId).toBe('vapp')
  })

  it('vend→vapp (external AND asset-bearing) is reported once as external-ingress, not double as flow-channel', () => {
    expect(on('external-ingress', 'vend')).toBe(true)
    expect(on('flow-channel', 'vend')).toBe(false)
  })

  it('flow-channel undeclared-path fires for an exposing source into an asset target (non-external)', () => {
    // web (PUBLIC) → dmzasset (asset); dmz (EXPOSED) → exposeddb (asset). Neither source is external.
    expect(on('flow-channel', 'web')).toBe(true)
    expect(on('flow-channel', 'dmz')).toBe(true)
    expect(byKind('flow-channel')).toHaveLength(2)
    expect(findings.find((f) => f.kind === 'flow-channel' && f.boundaryId === 'web')!.detail).toMatch(/undeclared path/)
  })

  it('does not flag mid→paydb — a properly-segmented asset reached from a non-exposing internal source', () => {
    expect(on('external-ingress', 'mid')).toBe(false)
    expect(on('flow-channel', 'mid')).toBe(false)
  })
})

describe('computeZoningFindings — conduit reconciliation', () => {
  const on = (fs: ReturnType<typeof computeZoningFindings>, kind: string, id: string) =>
    fs.some((f) => f.kind === kind && f.boundaryId === id)

  // Spread the golden context, overriding only conduits on specific boundaries.
  const withConduits = (overrides: Record<string, StructureBoundary['conduits']>): ZoningContext => {
    const boundaries = new Map<string, StructureBoundary>()
    for (const [id, b] of zoningContext.boundariesById) {
      boundaries.set(id, id in overrides ? { ...b, conduits: overrides[id] } : b)
    }
    return { ...zoningContext, boundariesById: boundaries }
  }

  it('a ratified OUTBOUND conduit suppresses the external-ingress on that crossing (declared → no finding)', () => {
    const fs = computeZoningFindings(withConduits({ ext: [{ peerId: 'web', direction: 'OUTBOUND', justification: 'vetted edge ingress' }] }))
    expect(on(fs, 'external-ingress', 'ext')).toBe(false) // ext→web now declared
    expect(on(fs, 'external-ingress', 'vend')).toBe(true) // vend→vapp still undeclared
  })

  it('an INBOUND mirror on the target also counts as declared (direction-aware match)', () => {
    const fs = computeZoningFindings(withConduits({ web: [{ peerId: 'ext', direction: 'INBOUND', justification: 'vetted' }] }))
    expect(on(fs, 'external-ingress', 'ext')).toBe(false) // (ext,web) declared via web's INBOUND mirror
  })

  it('dead-intent: a declared channel with no matching flow (info)', () => {
    // ext has a flow to web only; a conduit ext→mid has no backing flow.
    const fs = computeZoningFindings(withConduits({ ext: [{ peerId: 'mid', direction: 'OUTBOUND', justification: 'planned' }] }))
    const dead = fs.find((f) => f.kind === 'flow-channel' && f.boundaryId === 'ext' && /dead intent/.test(f.detail))
    expect(dead).toBeDefined()
    expect(dead!.severity).toBe('info')
    expect(dead!.peerId).toBe('mid') // the declared (unbacked) peer
  })

  it('unreviewable: a declared channel with a blank justification (info)', () => {
    const fs = computeZoningFindings(withConduits({ ext: [{ peerId: 'web', direction: 'OUTBOUND', justification: '  ' }] }))
    const unrev = fs.find((f) => f.kind === 'flow-channel' && f.boundaryId === 'ext' && /unreviewable/.test(f.detail))
    expect(unrev).toBeDefined()
    expect(unrev!.severity).toBe('info')
  })

  it('a dead channel with a blank justification emits BOTH sub-cases (orthogonal)', () => {
    const fs = computeZoningFindings(withConduits({ ext: [{ peerId: 'mid', direction: 'OUTBOUND' }] }))
    const extFlowChannel = fs.filter((f) => f.kind === 'flow-channel' && f.boundaryId === 'ext')
    expect(extFlowChannel.some((f) => /dead intent/.test(f.detail))).toBe(true)
    expect(extFlowChannel.some((f) => /unreviewable/.test(f.detail))).toBe(true)
  })
})

describe('computeZoningFindings — inheritance-implied crossings are excluded', () => {
  const b = (id: string, extra: Partial<StructureBoundary> = {}): StructureBoundary => ({ id, name: id, ...extra })

  it('a parent↔child crossing does not fire external-ingress (ordinary nesting, not a channel)', () => {
    // p (UNTRUSTED) contains child c (no zone → INTERNAL); a p→c flow is inheritance-implied.
    const boundariesById = new Map<string, StructureBoundary>([
      ['root', b('root')],
      ['p', b('p', { parentBoundary: { id: 'root' }, zone: 'UNTRUSTED' })],
      ['c', b('c', { parentBoundary: { id: 'p' } })],
    ])
    const ctx: ZoningContext = {
      boundariesById,
      defaultBoundaryId: 'root',
      adjacency: { in: new Map([['c', new Set(['p'])]]), out: new Map([['p', new Set(['c'])]]) },
      assetIds: new Set(),
      directAssetIds: new Set(),
      externalIds: new Set(['p']),
      vendorIds: new Set(),
    }
    const fs = computeZoningFindings(ctx)
    expect(fs.some((f) => f.kind === 'external-ingress')).toBe(false) // ancestry-excluded
  })
})
