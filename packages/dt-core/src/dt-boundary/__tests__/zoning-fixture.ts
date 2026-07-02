/**
 * Canonical zoning scenario + golden expected tiers — the shared determination test asset.
 *
 * One model exercising every tier, the four worked examples (v1-adjusted), the
 * positive-ingress rule, and the v1 vendor-exposing divergence. S6a asserts the cascade reproduces
 * `expectedTiers` over `zoningContext`; later slices (the context builder, the plugin action) build
 * the same context from a model and re-assert against this golden output.
 *
 * Topology (edges are source → target; boundary→boundary one-hop):
 *   ext  (UNTRUSTED) ─► web (PUBLIC) ─► dmz (EXPOSED, MANAGEMENT) ─► mid (INTERNAL) ─► paydb (RESTRICTED, asset)
 *                              └────────► dmzasset (EXPOSED, asset → misplaced)
 *                                   dmz ─► exposeddb (INTERNAL, asset → under-segmented)
 *   vend (VENDOR)    ─► vapp (PUBLIC, asset → v1 vendor divergence: concept said INTERNAL via a dedicated link)
 *   orphan (INTERNAL, asset, zero ingress → cannot verify isolation)
 */
import type {
  StructureBoundary,
  StructureComponent,
  ModelStructure,
} from '../../schemas/structure.schema.js'
import type { DataFlow } from '../../schemas/dataflows.schema.js'
import type { DataItem } from '../../schemas/data-items.schema.js'
import type { Zone } from '../../interfaces/core-types-interface.js'
import type { ZoningContext } from '../zone-determination.js'

export const DEFAULT_BOUNDARY_ID = 'root'

const b = (id: string, extra: Partial<StructureBoundary> = {}): StructureBoundary => ({
  id,
  name: id,
  parentBoundary: id === DEFAULT_BOUNDARY_ID ? undefined : { id: DEFAULT_BOUNDARY_ID },
  ...extra,
})

const BOUNDARIES: StructureBoundary[] = [
  b('root'),
  b('ext'),
  b('vend'),
  b('web'),
  b('dmz', { planes: ['MANAGEMENT'] }),
  b('mid'),
  b('paydb'),
  b('exposeddb'),
  b('dmzasset'),
  b('vapp'),
  b('orphan'),
]

export const boundariesById: Map<string, StructureBoundary> = new Map(BOUNDARIES.map((x) => [x.id, x]))

// Directed boundary→boundary edges (source → target).
const EDGES: Array<[string, string]> = [
  ['ext', 'web'],
  ['vend', 'vapp'],
  ['web', 'dmz'],
  ['web', 'dmzasset'],
  ['dmz', 'mid'],
  ['dmz', 'exposeddb'],
  ['mid', 'paydb'],
]

const buildAdjacency = (edges: Array<[string, string]>) => {
  const inMap = new Map<string, Set<string>>()
  const outMap = new Map<string, Set<string>>()
  for (const [src, tgt] of edges) {
    if (!outMap.has(src)) outMap.set(src, new Set())
    if (!inMap.has(tgt)) inMap.set(tgt, new Set())
    outMap.get(src)!.add(tgt)
    inMap.get(tgt)!.add(src)
  }
  return { in: inMap, out: outMap }
}

/** The full (close-of-Step-7) context: assets populated. */
export const zoningContext: ZoningContext = {
  boundariesById,
  defaultBoundaryId: DEFAULT_BOUNDARY_ID,
  adjacency: buildAdjacency(EDGES),
  assetIds: new Set(['paydb', 'exposeddb', 'dmzasset', 'vapp', 'orphan']),
  // Flat scenario: every asset boundary holds its component directly → directAssetIds == assetIds here.
  directAssetIds: new Set(['paydb', 'exposeddb', 'dmzasset', 'vapp', 'orphan']),
  externalIds: new Set(['ext']),
  vendorIds: new Set(['vend']),
}

/** Golden output: the tier the cascade must compute for each boundary, with assets populated. */
export const expectedTiers: Record<string, Zone> = {
  ext: 'UNTRUSTED',
  vend: 'VENDOR',
  web: 'PUBLIC',
  dmz: 'EXPOSED',
  mid: 'INTERNAL',
  paydb: 'RESTRICTED',
  exposeddb: 'INTERNAL', // asset, but ingress from EXPOSED dmz → under-segmented
  dmzasset: 'EXPOSED', // asset sitting in an externally-reachable segment → misplaced
  vapp: 'PUBLIC', // v1: vendor ingress is exposing (concept's dedicated-link INTERNAL is v2-only)
  orphan: 'INTERNAL', // asset, zero ingress → cannot verify isolation
}

// ── The same scenario as a MODEL (S6b) ─────────────────────────────────────────────────────────
//
// `buildZoningContext(scenarioStructure, scenarioFlows, scenarioDataItems)` must produce a context whose
// adjacency / assetIds / externalIds / vendorIds equal the hand-built `zoningContext` above, and over which the
// cascade reproduces `expectedTiers`. Flows are derived from `EDGES` via `componentOf`, so the boundary-graph
// projection reproduces `EDGES` by construction; zones and asset signals are stamped explicitly (they are inputs
// independent of `EDGES`). Each scenario boundary is a flat child of root holding exactly one component, so the
// adjacency has no intra-boundary or root-incident edges to drop.

const componentOf = (boundaryId: string): string => `${boundaryId}-c`

const component = (id: string, extra: Partial<StructureComponent> = {}): StructureComponent => ({
  id,
  name: id,
  type: 'PROCESS',
  positionX: 0,
  positionY: 0,
  ...extra,
})

const childBoundary = (
  id: string,
  components: StructureComponent[],
  extra: Partial<StructureBoundary> = {},
): StructureBoundary => ({
  id,
  name: id,
  parentBoundary: { id: DEFAULT_BOUNDARY_ID },
  components,
  ...extra,
})

/** card-data: confidential + a PCI flag (asset via regulatory_flags, NOT via 'restricted'); secret-data: restricted. */
export const scenarioDataItems: DataItem[] = [
  { id: 'card-data', name: 'Card Data', sensitivity: 'confidential', regulatory_flags: ['PCI cardholder'] },
  { id: 'secret-data', name: 'Secret Data', sensitivity: 'restricted' },
]

const scenarioChildren: StructureBoundary[] = [
  childBoundary('ext', [component(componentOf('ext'), { type: 'EXTERNAL_ENTITY' })], { zone: 'UNTRUSTED' }),
  childBoundary('vend', [component(componentOf('vend'), { type: 'EXTERNAL_ENTITY' })], { zone: 'VENDOR' }),
  childBoundary('web', [component(componentOf('web'))]),
  childBoundary('dmz', [component(componentOf('dmz'))], { planes: ['MANAGEMENT'] }),
  childBoundary('mid', [component(componentOf('mid'))]),
  childBoundary('paydb', [component(componentOf('paydb'), { dataItemIds: ['card-data'] })]), // regulated data → asset
  childBoundary('exposeddb', [component(componentOf('exposeddb'), { dataItemIds: ['secret-data'] })]), // restricted data → asset
  childBoundary('dmzasset', [component(componentOf('dmzasset'), { crownJewel: true })]),
  childBoundary('vapp', [component(componentOf('vapp'), { crownJewel: true })]),
  childBoundary('orphan', [component(componentOf('orphan'), { crownJewel: true })]), // no ingress edge
]

export const scenarioStructure: ModelStructure = {
  defaultBoundary: {
    id: DEFAULT_BOUNDARY_ID,
    name: DEFAULT_BOUNDARY_ID,
    boundaries: scenarioChildren,
    components: [],
  },
}

/** Component→component flows derived from the boundary `EDGES` (one component per boundary). */
export const scenarioFlows: DataFlow[] = EDGES.map(([src, tgt], i) => ({
  id: `flow-${i}`,
  name: `${src}->${tgt}`,
  source: { id: componentOf(src) },
  target: { id: componentOf(tgt) },
}))
