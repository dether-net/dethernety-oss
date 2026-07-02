/**
 * S6b — the ZoningContext builder (component→component model → boundary→boundary context).
 *
 * The done-criterion suite builds a context from the committed model fixture and asserts (a) the S6a cascade
 * reproduces the golden `expectedTiers` over the BUILT context, and (b) the built adjacency/assetIds/external/
 * vendor sets equal the hand-built `zoningContext`. The focused matrix covers the projection's load-bearing
 * cases (external→asset, nesting, both dataItem levels, root no-phantom-ingress, payment-db) plus hygiene.
 */
import { describe, it, expect } from 'vitest'
import {
  buildZoningContext,
  buildBoundaryAdjacency,
  determineZoneTier,
  resolveEffectiveZone,
  computeZoningFindings,
  isStructuralContainer,
  computeContainerSummary,
} from '../zone-determination.js'
import type {
  ModelStructure,
  StructureBoundary,
  StructureComponent,
} from '../../schemas/structure.schema.js'
import type { DataFlow } from '../../schemas/dataflows.schema.js'
import type { DataItem } from '../../schemas/data-items.schema.js'
import {
  scenarioStructure,
  scenarioFlows,
  scenarioDataItems,
  zoningContext,
  expectedTiers,
} from './zoning-fixture.js'

// ── Inline model builders (flat children of root unless nested explicitly) ─────────────────────
const comp = (id: string, extra: Partial<StructureComponent> = {}): StructureComponent => ({
  id,
  name: id,
  type: 'PROCESS',
  positionX: 0,
  positionY: 0,
  ...extra,
})
const bnd = (
  id: string,
  components: StructureComponent[],
  extra: Partial<StructureBoundary> = {},
): StructureBoundary => ({ id, name: id, parentBoundary: { id: 'root' }, components, ...extra })
const flow = (src: string, tgt: string): DataFlow => ({
  id: `${src}->${tgt}`,
  name: `${src}->${tgt}`,
  source: { id: src },
  target: { id: tgt },
})
const rootOf = (children: StructureBoundary[], rootComponents: StructureComponent[] = []): ModelStructure => ({
  defaultBoundary: { id: 'root', name: 'root', boundaries: children, components: rootComponents },
})

describe('buildZoningContext — built context reproduces S6a golden output (done-criterion)', () => {
  const built = buildZoningContext(scenarioStructure, scenarioFlows, scenarioDataItems)

  for (const [id, tier] of Object.entries(expectedTiers)) {
    it(`${id} → ${tier} (cascade over the BUILT context)`, () => {
      expect(determineZoneTier(built.boundariesById.get(id)!, built).tier).toBe(tier)
    })
  }

  it('built assetIds equal the hand-built fixture (catches asset-flag drift the tier loop can mask)', () => {
    expect(built.assetIds).toEqual(zoningContext.assetIds)
  })
  it('built directAssetIds equal the hand-built fixture (flat scenario: every asset held directly)', () => {
    expect(built.directAssetIds).toEqual(zoningContext.directAssetIds)
  })
  it('built externalIds / vendorIds equal the hand-built fixture', () => {
    expect(built.externalIds).toEqual(zoningContext.externalIds)
    expect(built.vendorIds).toEqual(zoningContext.vendorIds)
  })
  it('built adjacency equals the hand-built fixture (no empty-set pre-seeding)', () => {
    expect(built.adjacency).toEqual(zoningContext.adjacency)
  })
  it('defaultBoundaryId is the structure root', () => {
    expect(built.defaultBoundaryId).toBe('root')
  })
})

describe('S6b matrix — projection + asset join', () => {
  it('1a. external-entity → asset boundary, direct edge ⇒ PUBLIC, never RESTRICTED', () => {
    const struct = rootOf([
      bnd('extB', [comp('ext-c', { type: 'EXTERNAL_ENTITY' })], { zone: 'UNTRUSTED' }),
      bnd('dbB', [comp('db-c', { crownJewel: true })]),
    ])
    const ctx = buildZoningContext(struct, [flow('ext-c', 'db-c')], [])
    expect(ctx.assetIds.has('dbB')).toBe(true) // asset-bearing…
    expect(determineZoneTier(ctx.boundariesById.get('dbB')!, ctx).tier).toBe('PUBLIC') // …but exposure outranks
  })

  it('1b. asset boundary one hop behind a public front door ⇒ EXPOSED, never RESTRICTED', () => {
    const struct = rootOf([
      bnd('extB', [comp('ext-c', { type: 'EXTERNAL_ENTITY' })], { zone: 'UNTRUSTED' }),
      bnd('webB', [comp('web-c')]),
      bnd('dbB', [comp('db-c', { crownJewel: true })]),
    ])
    const ctx = buildZoningContext(struct, [flow('ext-c', 'web-c'), flow('web-c', 'db-c')], [])
    expect(determineZoneTier(ctx.boundariesById.get('dbB')!, ctx).tier).toBe('EXPOSED')
  })

  it('2. nested containment: an asset in inner ⊂ outer ⊂ root marks inner AND outer, excludes root', () => {
    const inner: StructureBoundary = {
      id: 'inner',
      name: 'inner',
      parentBoundary: { id: 'outer' },
      components: [comp('inner-c', { crownJewel: true })],
    }
    const outer: StructureBoundary = {
      id: 'outer',
      name: 'outer',
      parentBoundary: { id: 'root' },
      boundaries: [inner],
      components: [],
    }
    const ctx = buildZoningContext(rootOf([outer]), [], [])
    expect(ctx.assetIds.has('inner')).toBe(true)
    expect(ctx.assetIds.has('outer')).toBe(true) // rollup still marks the ancestor (S15b display flag)
    expect(ctx.assetIds.has('root')).toBe(false)
    // S15a: directAssetIds is the direct holder ONLY — the structural ancestor `outer` drops out, so it
    // no longer promotes / fires a false under-protected (bug-1). This is the load-bearing discriminator.
    expect(ctx.directAssetIds.has('inner')).toBe(true) // direct holder of the crown jewel
    expect(ctx.directAssetIds.has('outer')).toBe(false) // rollup-only ancestor — NOT a direct holder
  })

  it('3. asset data items are counted at BOTH component- and boundary-level references', () => {
    const di: DataItem[] = [{ id: 'r', name: 'r', sensitivity: 'restricted' }]
    const struct = rootOf([
      bnd('compRef', [comp('c1', { dataItemIds: ['r'] })]),
      bnd('bndRef', [comp('c2')], { dataItemIds: ['r'] }),
    ])
    const ctx = buildZoningContext(struct, [], di)
    expect(ctx.assetIds.has('compRef')).toBe(true)
    expect(ctx.assetIds.has('bndRef')).toBe(true)
  })

  it('4. default-root contributes no phantom ingress: a root→asset edge keeps the asset INTERNAL/no-ingress', () => {
    const struct = rootOf(
      [bnd('dbB', [comp('db-c', { crownJewel: true })])],
      [comp('root-c')], // sits DIRECTLY in the default root
    )
    const ctx = buildZoningContext(struct, [flow('root-c', 'db-c')], [])
    expect(ctx.adjacency.in.has('dbB')).toBe(false) // root-incident edge dropped
    const r = determineZoneTier(ctx.boundariesById.get('dbB')!, ctx)
    expect(r.tier).toBe('INTERNAL')
    expect(r.blockedBy).toBe('no-ingress') // cannot prove isolation — fails safe, never false-RESTRICTED
  })

  it('5. canonical payment-db: confidential + PCI flag is asset-bearing; promotes to RESTRICTED under internal ingress', () => {
    const di: DataItem[] = [
      { id: 'card', name: 'card', sensitivity: 'confidential', regulatory_flags: ['PCI cardholder'] },
    ]
    const struct = rootOf([
      bnd('appB', [comp('app-c')]),
      bnd('dbB', [comp('db-c', { dataItemIds: ['card'] })]),
    ])
    const ctx = buildZoningContext(struct, [flow('app-c', 'db-c')], di)
    expect(ctx.assetIds.has('dbB')).toBe(true) // regulated data → asset, even though sensitivity ≠ 'restricted'
    expect(determineZoneTier(ctx.boundariesById.get('dbB')!, ctx).tier).toBe('RESTRICTED')
  })
})

describe('S6b — buildBoundaryAdjacency shape + hygiene', () => {
  it('creates in/out entries per kept edge only — an edge-less boundary is absent from both maps', () => {
    const struct = rootOf([bnd('a', [comp('a-c')]), bnd('b', [comp('b-c')]), bnd('c', [comp('c-c')])])
    const adj = buildBoundaryAdjacency(struct, [flow('a-c', 'b-c')])
    expect([...adj.out.keys()]).toEqual(['a'])
    expect([...adj.in.keys()]).toEqual(['b'])
    expect(adj.out.get('a')).toEqual(new Set(['b']))
    expect(adj.in.get('b')).toEqual(new Set(['a']))
    expect(adj.in.has('c')).toBe(false)
    expect(adj.out.has('c')).toBe(false)
  })

  it('a dangling flow endpoint is skipped (no phantom edge)', () => {
    const struct = rootOf([bnd('a', [comp('a-c')]), bnd('b', [comp('b-c')])])
    const ctx = buildZoningContext(struct, [flow('a-c', 'ghost')], [])
    expect(ctx.adjacency.out.size).toBe(0)
    expect(ctx.adjacency.in.size).toBe(0)
  })

  it('an intra-boundary edge (same source/target boundary) is dropped', () => {
    const struct = rootOf([bnd('a', [comp('a-c1'), comp('a-c2')])])
    const ctx = buildZoningContext(struct, [flow('a-c1', 'a-c2')], [])
    expect(ctx.adjacency.in.size).toBe(0)
    expect(ctx.adjacency.out.size).toBe(0)
  })
})

describe('S6b — asset/external predicate precision', () => {
  it('empty regulatory_flags is NOT asset-bearing; confidential without a flag is NOT either', () => {
    const di: DataItem[] = [
      { id: 'x', name: 'x', regulatory_flags: [] },
      { id: 'y', name: 'y', sensitivity: 'confidential' },
    ]
    const struct = rootOf([bnd('a', [comp('a-c', { dataItemIds: ['x', 'y'] })])])
    const ctx = buildZoningContext(struct, [], di)
    expect(ctx.assetIds.has('a')).toBe(false)
  })

  it('sensitivity match is lowercase-exact — uppercase RESTRICTED does not qualify', () => {
    const di: DataItem[] = [{ id: 'z', name: 'z', sensitivity: 'RESTRICTED' }]
    const struct = rootOf([bnd('a', [comp('a-c', { dataItemIds: ['z'] })])])
    const ctx = buildZoningContext(struct, [], di)
    expect(ctx.assetIds.has('a')).toBe(false)
  })

  it('inheritance works on a nested structure with NO parentBoundary back-refs (normalized from nesting)', () => {
    // inner ⊂ outer ⊂ root, real nesting, no `parentBoundary` fields; only outer declares a zone.
    const inner: StructureBoundary = { id: 'inner', name: 'inner', components: [comp('inner-c')] }
    const outer: StructureBoundary = {
      id: 'outer',
      name: 'outer',
      zone: 'PUBLIC',
      boundaries: [inner],
      components: [],
    }
    const ctx = buildZoningContext(rootOf([outer]), [], [])
    // resolveEffectiveZone walks parentBoundary — which buildZoningContext normalized from nesting.
    const eff = resolveEffectiveZone('inner', ctx.boundariesById, ctx.defaultBoundaryId)
    expect(eff).toEqual({ zone: 'PUBLIC', source: 'inherited', from: 'outer' })
  })

  it('externalIds/vendorIds come from each boundary OWN declared zone, excluding root', () => {
    const struct = rootOf([
      bnd('u', [comp('u-c')], { zone: 'UNTRUSTED' }),
      bnd('v', [comp('v-c')], { zone: 'VENDOR' }),
      bnd('i', [comp('i-c')], { zone: 'INTERNAL' }),
    ])
    const ctx = buildZoningContext(struct, [], [])
    expect(ctx.externalIds).toEqual(new Set(['u']))
    expect(ctx.vendorIds).toEqual(new Set(['v']))
  })
})

describe('S15a — structural containers abstain; asset findings at the direct holder', () => {
  const on = (fs: ReturnType<typeof computeZoningFindings>, kind: string, id: string): boolean =>
    fs.some((f) => f.kind === kind && f.boundaryId === id)

  it('deep AWS nesting: account→region→vpc→az abstain; the crown-jewel subnet is the only direct holder', () => {
    // account ⊃ region ⊃ vpc ⊃ az ⊃ subnet-data(crown jewel). Every level above the subnet is structural.
    const subnetData: StructureBoundary = {
      id: 'subnet-data',
      name: 'subnet-data',
      components: [comp('db-c', { crownJewel: true })],
    }
    const az: StructureBoundary = { id: 'az', name: 'az', boundaries: [subnetData], components: [] }
    const vpc: StructureBoundary = { id: 'vpc', name: 'vpc', boundaries: [az], components: [] }
    const region: StructureBoundary = { id: 'region', name: 'region', boundaries: [vpc], components: [] }
    const account: StructureBoundary = { id: 'account', name: 'account', boundaries: [region], components: [] }
    const ctx = buildZoningContext(rootOf([account]), [], [])

    for (const id of ['account', 'region', 'vpc', 'az']) {
      expect(isStructuralContainer(ctx.boundariesById.get(id)!)).toBe(true)
      expect(ctx.assetIds.has(id)).toBe(true) // rollup still marks every ancestor
      expect(ctx.directAssetIds.has(id)).toBe(false) // …but none DIRECTLY holds the asset
    }
    expect(isStructuralContainer(ctx.boundariesById.get('subnet-data')!)).toBe(false)
    expect(ctx.directAssetIds.has('subnet-data')).toBe(true)

    const fs = computeZoningFindings(ctx)
    for (const id of ['account', 'region', 'vpc', 'az']) {
      expect(on(fs, 'unclassified', id)).toBe(false) // structural → suppressed (no depth-multiplied noise)
      expect(on(fs, 'under-protected', id)).toBe(false) // rollup-only ancestor → not flagged (bug-1 fixed)
    }
    // The leaf that actually holds the crown jewel still gets its normal finding.
    expect(on(fs, 'under-protected', 'subnet-data')).toBe(true)
  })

  it('C4 with clean internal ingress: a crown jewel DIRECTLY in a container still promotes to RESTRICTED', () => {
    // svc is BOTH a structural container (has a child) AND a direct crown-jewel holder.
    const child: StructureBoundary = { id: 'svc-child', name: 'svc-child', components: [comp('child-c')] }
    const svc: StructureBoundary = {
      id: 'svc',
      name: 'svc',
      boundaries: [child],
      components: [comp('svc-c', { crownJewel: true })],
    }
    const peer: StructureBoundary = { id: 'peer', name: 'peer', components: [comp('peer-c')] } // internal, non-exposing
    const ctx = buildZoningContext(rootOf([svc, peer]), [flow('peer-c', 'svc-c')], [])

    expect(isStructuralContainer(ctx.boundariesById.get('svc')!)).toBe(true)
    expect(ctx.directAssetIds.has('svc')).toBe(true) // direct holder overrides the structural exemption
    expect(determineZoneTier(ctx.boundariesById.get('svc')!, ctx).tier).toBe('RESTRICTED')
    const fs = computeZoningFindings(ctx)
    expect(on(fs, 'under-protected', 'svc')).toBe(false) // RESTRICTED → no finding
    expect(on(fs, 'unclassified', 'svc')).toBe(false) // structural → suppressed
  })

  it('C4 without direct ingress: the same container fails safe to INTERNAL/no-ingress and IS flagged', () => {
    const child: StructureBoundary = { id: 'svc-child', name: 'svc-child', components: [comp('child-c')] }
    const svc: StructureBoundary = {
      id: 'svc',
      name: 'svc',
      boundaries: [child],
      components: [comp('svc-c', { crownJewel: true })],
    }
    const ctx = buildZoningContext(rootOf([svc]), [], [])

    const r = determineZoneTier(ctx.boundariesById.get('svc')!, ctx)
    expect(r.tier).toBe('INTERNAL')
    expect(r.blockedBy).toBe('no-ingress') // never a false RESTRICTED
    const fs = computeZoningFindings(ctx)
    // The two guards are INDEPENDENT: direct-holder still flags under-protected while structural suppresses unclassified.
    expect(on(fs, 'under-protected', 'svc')).toBe(true)
    expect(on(fs, 'unclassified', 'svc')).toBe(false)
  })

  it('a homogeneous container abstains but still forces its undeclared leaves to be classified', () => {
    const leaf1: StructureBoundary = { id: 'leaf1', name: 'leaf1', components: [comp('l1-c')] }
    const leaf2: StructureBoundary = { id: 'leaf2', name: 'leaf2', components: [comp('l2-c')] }
    const app: StructureBoundary = { id: 'app', name: 'app', boundaries: [leaf1, leaf2], components: [] }
    const ctx = buildZoningContext(rootOf([app]), [], [])

    const fs = computeZoningFindings(ctx)
    expect(on(fs, 'unclassified', 'app')).toBe(false) // container abstains (silence)
    expect(on(fs, 'unclassified', 'leaf1')).toBe(true) // leaves still forced to classify
    expect(on(fs, 'unclassified', 'leaf2')).toBe(true)
  })
})

describe('S15b — computeContainerSummary (display roll-up over a structural container)', () => {
  it('k8s-in-subnet: the range spans the exposed ingress leaf down to the internal workload', () => {
    // ext(UNTRUSTED) ─► ns-ingress(PUBLIC); ns-workload has no ingress (INTERNAL). subnet ⊃ cluster ⊃ {both}.
    const nsIngress: StructureBoundary = { id: 'ns-ingress', name: 'ns-ingress', components: [comp('ingress-c')] }
    const nsWorkload: StructureBoundary = { id: 'ns-workload', name: 'ns-workload', components: [comp('workload-c')] }
    const cluster: StructureBoundary = { id: 'cluster', name: 'cluster', boundaries: [nsIngress, nsWorkload], components: [] }
    const subnet: StructureBoundary = { id: 'subnet', name: 'subnet', boundaries: [cluster], components: [] }
    const ext: StructureBoundary = { id: 'ext', name: 'ext', components: [comp('ext-c')], zone: 'UNTRUSTED' }
    const ctx = buildZoningContext(rootOf([subnet, ext]), [flow('ext-c', 'ingress-c')], [])

    // Sanity: the leaves compute the tiers the roll-up rolls up.
    expect(determineZoneTier(ctx.boundariesById.get('ns-ingress')!, ctx).tier).toBe('PUBLIC')
    expect(determineZoneTier(ctx.boundariesById.get('ns-workload')!, ctx).tier).toBe('INTERNAL')

    const summary = computeContainerSummary(ctx.boundariesById.get('subnet')!, ctx)!
    expect(summary).not.toBeNull()
    expect(summary.range).toEqual({ min: 'PUBLIC', max: 'INTERNAL' }) // most-exposed … least-exposed
    expect(summary.maxExposure).toBe('PUBLIC')
    expect(summary.reachesExternal).toBe(true)
    expect(summary.containsVendor).toBe(false)
    expect(summary.containsAssets).toBe(false)
    expect(summary.unclassifiedDescendants).toBe(2) // both leaves resolve to the default zone

    // The intermediate container rolls up the same subtree; a leaf is not a container → null.
    expect(computeContainerSummary(ctx.boundariesById.get('cluster')!, ctx)!.range).toEqual({ min: 'PUBLIC', max: 'INTERNAL' })
    expect(computeContainerSummary(ctx.boundariesById.get('ns-ingress')!, ctx)).toBeNull()
  })

  it('C4/C7: a crown jewel held DIRECTLY in a container extends the range to RESTRICTED and flags containsAssets', () => {
    // svc is BOTH a container (nests svc-child) AND a direct crown-jewel holder with clean internal ingress → RESTRICTED.
    const child: StructureBoundary = { id: 'svc-child', name: 'svc-child', components: [comp('child-c')] }
    const svc: StructureBoundary = { id: 'svc', name: 'svc', boundaries: [child], components: [comp('svc-c', { crownJewel: true })] }
    const peer: StructureBoundary = { id: 'peer', name: 'peer', components: [comp('peer-c')] }
    const ctx = buildZoningContext(rootOf([svc, peer]), [flow('peer-c', 'svc-c')], [])

    expect(ctx.directAssetIds.has('svc')).toBe(true)
    const summary = computeContainerSummary(ctx.boundariesById.get('svc')!, ctx)!
    expect(summary.range!.max).toBe('RESTRICTED') // own-tier (direct asset) contributes RESTRICTED
    expect(summary.maxExposure).toBe('INTERNAL') // least exposed is the child leaf (INTERNAL)
    expect(summary.containsAssets).toBe(true)
    expect(summary.reachesExternal).toBe(false)
  })

  it('C3: a VENDOR enclave is off the exposure gradient — flagged separately, never a range endpoint', () => {
    const vendorLeaf: StructureBoundary = { id: 'vendor-seg', name: 'vendor-seg', components: [comp('v-c')], zone: 'VENDOR' }
    const internalLeaf: StructureBoundary = { id: 'internal-seg', name: 'internal-seg', components: [comp('i-c')] }
    const container: StructureBoundary = { id: 'container', name: 'container', boundaries: [vendorLeaf, internalLeaf], components: [] }
    const ctx = buildZoningContext(rootOf([container]), [], [])

    expect(determineZoneTier(ctx.boundariesById.get('vendor-seg')!, ctx).tier).toBe('VENDOR')
    const summary = computeContainerSummary(ctx.boundariesById.get('container')!, ctx)!
    expect(summary.containsVendor).toBe(true)
    expect(summary.reachesExternal).toBe(true) // vendor enclave counts as external-adjacent
    expect(summary.range).toEqual({ min: 'INTERNAL', max: 'INTERNAL' }) // VENDOR excluded from the span
    expect(summary.maxExposure).toBe('INTERNAL')
  })

  it('self-correcting: a child mislabelled RESTRICTED does not inflate the range (signature uses COMPUTED tiers)', () => {
    // The leaf DECLARES RESTRICTED but computes INTERNAL (no asset, no ingress). The roll-up must ignore the label.
    const mislabelled: StructureBoundary = { id: 'mislabelled', name: 'mislabelled', components: [comp('m-c')], zone: 'RESTRICTED' }
    const container: StructureBoundary = { id: 'wrap', name: 'wrap', boundaries: [mislabelled], components: [] }
    const ctx = buildZoningContext(rootOf([container]), [], [])

    expect(determineZoneTier(ctx.boundariesById.get('mislabelled')!, ctx).tier).toBe('INTERNAL')
    const summary = computeContainerSummary(ctx.boundariesById.get('wrap')!, ctx)!
    expect(summary.range).toEqual({ min: 'INTERNAL', max: 'INTERNAL' }) // NOT RESTRICTED — the mislabel is ignored
    expect(summary.unclassifiedDescendants).toBe(0) // a declared leaf resolves 'declared', not 'default'
  })

  it('unclassifiedDescendants counts only leaves resolving to the default zone', () => {
    const declaredLeaf: StructureBoundary = { id: 'declared-leaf', name: 'declared-leaf', components: [comp('d-c')], zone: 'INTERNAL' }
    const plainLeaf: StructureBoundary = { id: 'plain-leaf', name: 'plain-leaf', components: [comp('p-c')] }
    const outer: StructureBoundary = { id: 'outer', name: 'outer', boundaries: [declaredLeaf, plainLeaf], components: [] }
    const ctx = buildZoningContext(rootOf([outer]), [], [])

    const summary = computeContainerSummary(ctx.boundariesById.get('outer')!, ctx)!
    expect(summary.unclassifiedDescendants).toBe(1) // only plain-leaf is default; declared-leaf resolves 'declared'
  })

  it('returns null for a non-structural (leaf) boundary', () => {
    const leaf: StructureBoundary = { id: 'lonely', name: 'lonely', components: [comp('l-c')] }
    const ctx = buildZoningContext(rootOf([leaf]), [], [])
    expect(computeContainerSummary(ctx.boundariesById.get('lonely')!, ctx)).toBeNull()
  })
})

describe('S16 — cross-tier-domain (a shared `domains` tag coupling an exposed and a protected segment)', () => {
  const ctd = (ctx: Parameters<typeof computeZoningFindings>[0]) =>
    computeZoningFindings(ctx).filter((f) => f.kind === 'cross-tier-domain')
  const ext = () => bnd('ext', [comp('ext-c', { type: 'EXTERNAL_ENTITY' })], { zone: 'UNTRUSTED' })

  it('fires when a tag couples a PUBLIC boundary with a directly-held crown jewel (anchor=protected, peer=external)', () => {
    const web = bnd('web', [comp('web-c')], { domains: ['principal-a'] })
    const peer = bnd('peer', [comp('peer-c')]) // internal, non-exposing → gives vault clean ingress
    const vault = bnd('vault', [comp('vault-c', { crownJewel: true })], { domains: ['principal-a'] })
    const ctx = buildZoningContext(rootOf([ext(), web, peer, vault]), [flow('ext-c', 'web-c'), flow('peer-c', 'vault-c')], [])

    expect(determineZoneTier(ctx.boundariesById.get('web')!, ctx).tier).toBe('PUBLIC')
    expect(determineZoneTier(ctx.boundariesById.get('vault')!, ctx).tier).toBe('RESTRICTED')
    const fs = ctd(ctx)
    expect(fs).toHaveLength(1)
    expect(fs[0].boundaryId).toBe('vault') // anchor = the at-risk protected member
    expect(fs[0].peerId).toBe('web') // peer = the externally-reachable coupling source
    expect(fs[0].severity).toBe('info')
  })

  it('a DECLARED Restricted boundary (computes INTERNAL, no asset) counts as protected', () => {
    const web = bnd('web', [comp('web-c')], { domains: ['team-x'] })
    const rdb = bnd('rdb', [comp('rdb-c')], { zone: 'RESTRICTED', domains: ['team-x'] }) // no asset, no ingress → computes INTERNAL
    const ctx = buildZoningContext(rootOf([ext(), web, rdb]), [flow('ext-c', 'web-c')], [])

    expect(determineZoneTier(ctx.boundariesById.get('rdb')!, ctx).tier).toBe('INTERNAL') // computed, not RESTRICTED
    const fs = ctd(ctx)
    expect(fs).toHaveLength(1)
    expect(fs[0].boundaryId).toBe('rdb') // protected via resolveEffectiveZone === 'RESTRICTED'
    expect(fs[0].peerId).toBe('web')
  })

  it('does NOT fire without an external member — pure {INTERNAL, RESTRICTED} co-tenancy is out of scope (deferred)', () => {
    const intb = bnd('intb', [comp('int-c')], { domains: ['svc-y'] })
    const peer = bnd('peer', [comp('peer-c')])
    const vault = bnd('vault', [comp('vault-c', { crownJewel: true })], { domains: ['svc-y'] })
    const ctx = buildZoningContext(rootOf([intb, peer, vault]), [flow('peer-c', 'vault-c')], [])

    expect(determineZoneTier(ctx.boundariesById.get('vault')!, ctx).tier).toBe('RESTRICTED')
    expect(ctd(ctx)).toHaveLength(0) // INTERNAL + RESTRICTED, no exposed member → no coupling
  })

  it('does NOT fire without a protected member — two external boundaries sharing a tag', () => {
    const web1 = bnd('web1', [comp('web1-c')], { domains: ['edge-z'] })
    const web2 = bnd('web2', [comp('web2-c')], { domains: ['edge-z'] })
    const ctx = buildZoningContext(rootOf([ext(), web1, web2]), [flow('ext-c', 'web1-c'), flow('ext-c', 'web2-c')], [])

    expect(determineZoneTier(ctx.boundariesById.get('web1')!, ctx).tier).toBe('PUBLIC')
    expect(ctd(ctx)).toHaveLength(0)
  })

  it('does NOT fire on an unshared tag or an intra-boundary duplicate (≥2 DISTINCT boundaries required)', () => {
    const web = bnd('web', [comp('web-c')], { domains: ['solo', 'solo'] }) // intra-boundary dupe collapses
    const peer = bnd('peer', [comp('peer-c')])
    const vault = bnd('vault', [comp('vault-c', { crownJewel: true })], { domains: ['different'] })
    const ctx = buildZoningContext(rootOf([ext(), web, peer, vault]), [flow('ext-c', 'web-c'), flow('peer-c', 'vault-c')], [])

    expect(ctd(ctx)).toHaveLength(0) // 'solo' → {web} only; 'different' → {vault} only
  })

  it('groups tags case-insensitively', () => {
    const web = bnd('web', [comp('web-c')], { domains: ['Principal-A'] })
    const peer = bnd('peer', [comp('peer-c')])
    const vault = bnd('vault', [comp('vault-c', { crownJewel: true })], { domains: ['principal-a'] })
    const ctx = buildZoningContext(rootOf([ext(), web, peer, vault]), [flow('ext-c', 'web-c'), flow('peer-c', 'vault-c')], [])

    const fs = ctd(ctx)
    expect(fs).toHaveLength(1)
    expect(fs[0].boundaryId).toBe('vault')
    expect(fs[0].peerId).toBe('web')
  })

  it('excludes structural containers from tag membership (a container never self-fires)', () => {
    // `clus` is a structural container declared Restricted AND tagged `shared`; `web` (PUBLIC) shares the tag.
    // If the container participated it would be a protected member and couple with web → fire. It must not.
    const clusChild: StructureBoundary = { id: 'clus-child', name: 'clus-child', components: [comp('cc-c')] }
    const clus: StructureBoundary = { id: 'clus', name: 'clus', zone: 'RESTRICTED', domains: ['shared'], boundaries: [clusChild], components: [] }
    const web = bnd('web', [comp('web-c')], { domains: ['shared'] })
    const ctx = buildZoningContext(rootOf([ext(), web, clus]), [flow('ext-c', 'web-c')], [])

    expect(isStructuralContainer(ctx.boundariesById.get('clus')!)).toBe(true)
    const fs = ctd(ctx)
    expect(fs).toHaveLength(0) // container excluded → 'shared' has only {web} → no coupling
    expect(fs.some((f) => f.boundaryId === 'clus' || f.peerId === 'clus')).toBe(false)
  })
})
