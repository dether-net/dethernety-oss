/**
 * Zoning adapter tests. Two layers:
 *   - PURE: graphToZoningStructure — nesting/forest→root, component placement, casing/naming
 *     translation, HANDLES→dataItemIds routing, flow/conduit mapping, cycle safety. No engine.
 *   - INTEGRATION: computeZoning driven by the REAL dt-core engine (imported from the ./zone-
 *     determination subpath) — proves the adapter feeds the engine correctly end-to-end (findings +
 *     the per-boundary DECLARED effectiveZones map: declared / inherited / default). The inherited
 *     case is the load-bearing one — it proves `buildZoningContext` normalizes `parentBoundary` from
 *     nesting, so `resolveEffectiveZone`'s ancestry walk resolves inheritance despite the adapter's
 *     flat-graph input never setting `parentBoundary` back-refs.
 */

import { describe, it, expect } from 'vitest';
import {
  graphToZoningStructure,
  computeZoning,
  type ZoningEngine,
  type ZoningGraphInput,
  type ZoningGraphBoundary,
  type ZoningGraphComponent,
  type ZoningGraphDataNode,
} from '../zoning-adapter';
import {
  buildZoningContext,
  computeZoningFindings,
  resolveEffectiveZone,
} from '@dethernety/dt-core/zone-determination';

const engine: ZoningEngine = { buildZoningContext, computeZoningFindings, resolveEffectiveZone };

// ── flat-graph builders (the report's native modelGraph shape) ─────────────────────────────────
const graph = (o: Partial<ZoningGraphInput>): ZoningGraphInput => ({
  boundaries: [],
  components: [],
  flows: [],
  dataNodes: [],
  ...o,
});
const bnd = (id: string, extra: Partial<ZoningGraphBoundary> = {}): ZoningGraphBoundary => ({
  id,
  name: id,
  parentBoundaryId: null,
  zone: null,
  planes: [],
  domains: [],
  conduits: [],
  ...extra,
});
const cmp = (id: string, boundaryId: string | null, extra: Partial<ZoningGraphComponent> = {}): ZoningGraphComponent => ({
  id,
  name: id,
  type: 'process',
  boundaryId,
  crownJewel: false,
  ...extra,
});
const flow = (id: string, sourceId: string | null, targetId: string | null) => ({ id, name: id, sourceId, targetId });
const data = (id: string, extra: Partial<ZoningGraphDataNode> = {}): ZoningGraphDataNode => ({
  id,
  name: id,
  sensitivity: null,
  regulatoryFlags: [],
  handledBy: [],
  ...extra,
});

describe('graphToZoningStructure (pure adapter)', () => {
  it('wraps the boundary forest in a synthetic root and nests by parentBoundaryId', () => {
    const { structure } = graphToZoningStructure(
      graph({ boundaries: [bnd('a'), bnd('b'), bnd('a1', { parentBoundaryId: 'a' })] }),
    );
    expect(structure.defaultBoundary.id).toBe('__zoning_root__');
    const top = structure.defaultBoundary.boundaries ?? [];
    expect(top.map((b) => b.id).sort()).toEqual(['a', 'b']);
    const a = top.find((b) => b.id === 'a')!;
    expect((a.boundaries ?? []).map((b) => b.id)).toEqual(['a1']);
  });

  it('places components under their boundary, uppercases type, drops components with no boundary', () => {
    const { structure } = graphToZoningStructure(
      graph({ boundaries: [bnd('a')], components: [cmp('c1', 'a'), cmp('c2', null)] }),
    );
    const a = (structure.defaultBoundary.boundaries ?? []).find((b) => b.id === 'a')!;
    expect((a.components ?? []).map((c) => c.id)).toEqual(['c1']); // c2 has no boundary → dropped
    expect(a.components![0].type).toBe('PROCESS'); // graph lowercase → dt-core ComponentType
  });

  it('lowercases sensitivity and renames regulatoryFlags → regulatory_flags', () => {
    const { dataItems } = graphToZoningStructure(
      graph({ dataNodes: [data('d1', { sensitivity: 'RESTRICTED', regulatoryFlags: ['PCI'] })] }),
    );
    expect(dataItems[0].sensitivity).toBe('restricted');
    expect(dataItems[0].regulatory_flags).toEqual(['PCI']);
  });

  it('inverts HANDLES into dataItemIds routed by handler type (discards flow/unknown handlers)', () => {
    const { structure } = graphToZoningStructure(
      graph({
        boundaries: [bnd('b1')],
        components: [cmp('c1', 'b1')],
        dataNodes: [data('d1', { handledBy: ['c1', 'b1', 'someFlowId', 'unknown'] })],
      }),
    );
    const b1 = (structure.defaultBoundary.boundaries ?? []).find((b) => b.id === 'b1')!;
    expect(b1.dataItemIds).toEqual(['d1']); // boundary-level handler
    expect(b1.components![0].dataItemIds).toEqual(['d1']); // component-level handler
  });

  it('builds flows as {source:{id},target:{id}} and drops null endpoints', () => {
    const { flows } = graphToZoningStructure(
      graph({ flows: [flow('f1', 'c1', 'c2'), flow('f2', null, 'c2'), flow('f3', 'c1', null)] }),
    );
    expect(flows.map((f) => f.id)).toEqual(['f1']);
    expect(flows[0].source).toEqual({ id: 'c1' });
    expect(flows[0].target).toEqual({ id: 'c2' });
  });

  it('maps conduits and normalizes null justification to undefined', () => {
    const { structure } = graphToZoningStructure(
      graph({
        boundaries: [
          bnd('a', {
            conduits: [
              { peerId: 'b', direction: 'OUTBOUND', justification: 'ok' },
              { peerId: 'c', direction: 'OUTBOUND', justification: null },
            ],
          }),
        ],
      }),
    );
    const a = (structure.defaultBoundary.boundaries ?? []).find((b) => b.id === 'a')!;
    expect(a.conduits).toEqual([
      { peerId: 'b', direction: 'OUTBOUND', justification: 'ok' },
      { peerId: 'c', direction: 'OUTBOUND', justification: undefined },
    ]);
  });

  it('passes planes and domains through onto the StructureBoundary (drives mgmt-plane / cross-tier-domain)', () => {
    const { structure } = graphToZoningStructure(
      graph({ boundaries: [bnd('a', { planes: ['MANAGEMENT'], domains: ['payments'] })] }),
    );
    const a = (structure.defaultBoundary.boundaries ?? []).find((b) => b.id === 'a')!;
    expect(a.planes).toEqual(['MANAGEMENT']);
    expect(a.domains).toEqual(['payments']);
  });

  it('breaks an over-deep nesting chain by attaching to the root (depth guard)', () => {
    // A linear chain deeper than the guard (>50) — the deepest boundaries can't resolve an in-bound
    // ancestor chain, so they attach to the synthetic root instead of producing an unbounded tree.
    const boundaries = [bnd('b0')];
    for (let i = 1; i <= 55; i++) boundaries.push(bnd(`b${i}`, { parentBoundaryId: `b${i - 1}` }));
    const { structure } = graphToZoningStructure(graph({ boundaries }));
    const top = structure.defaultBoundary.boundaries ?? [];
    // Exact cut line: bN has N ancestors and passes iff N ≤ 50 — so b0 (the chain's real root)
    // plus exactly b51..b55 land at top level; b50 stays nested under b49.
    expect(top.map((b) => b.id).sort()).toEqual(['b0', 'b51', 'b52', 'b53', 'b54', 'b55']);
  });
});

describe('computeZoning (engine integration)', () => {
  it('is cycle-safe: a parentBoundaryId loop is broken (no infinite flatten)', () => {
    // If the cycle were not broken, buildZoningContext → flattenStructure (unguarded recursion) would
    // hang. Reaching the assertions proves the guard works.
    const res = computeZoning(
      graph({ boundaries: [bnd('a', { parentBoundaryId: 'b' }), bnd('b', { parentBoundaryId: 'a' })] }),
      engine,
    );
    expect(Object.keys(res.effectiveZones).sort()).toEqual(['a', 'b']);
  });

  it('fires external-ingress on an external→trusted flow with no conduit', () => {
    const { findings } = computeZoning(
      graph({
        boundaries: [bnd('ext', { zone: 'UNTRUSTED' }), bnd('app')],
        components: [cmp('extC', 'ext'), cmp('appC', 'app')],
        flows: [flow('f', 'extC', 'appC')],
      }),
      engine,
    );
    const ei = findings.filter((f) => f.kind === 'external-ingress');
    expect(ei).toHaveLength(1);
    expect(ei[0].boundaryId).toBe('ext');
    expect(ei[0].peerId).toBe('app');
  });

  it('suppresses external-ingress when a matching conduit is declared', () => {
    const { findings } = computeZoning(
      graph({
        boundaries: [
          bnd('ext', { zone: 'UNTRUSTED', conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'ratified' }] }),
          bnd('app'),
        ],
        components: [cmp('extC', 'ext'), cmp('appC', 'app')],
        flows: [flow('f', 'extC', 'appC')],
      }),
      engine,
    );
    expect(findings.filter((f) => f.kind === 'external-ingress')).toHaveLength(0);
  });

  it('reports a DECLARED zone as {zone, source:"declared"} — never a data-driven promotion', () => {
    // A boundary declaring RESTRICTED reports RESTRICTED/declared regardless of what data it holds:
    // the effective zone is the operator's declaration, not the topological proposal. (Contrast the
    // retired determineZoneTier, which would promote/relabel by data + reachability.)
    const { effectiveZones } = computeZoning(
      graph({ boundaries: [bnd('app', { zone: 'EXPOSED' }), bnd('vault', { zone: 'RESTRICTED' })] }),
      engine,
    );
    expect(effectiveZones['vault']).toEqual({ zone: 'RESTRICTED', source: 'declared' });
    expect(effectiveZones['app']).toEqual({ zone: 'EXPOSED', source: 'declared' });
  });

  it('resolves an INHERITED zone from a declaring ancestor (proves parentBoundary normalization)', () => {
    // `child` declares no zone and nests under `parent` (RESTRICTED). The adapter never sets a
    // parentBoundary back-ref (nesting-only input) — this passes ONLY because buildZoningContext
    // normalizes parentBoundary from nesting so resolveEffectiveZone can walk the ancestry. This is
    // the fail-fast gate for that normalization: if it breaks, zone inheritance on nested models
    // is silently gone.
    const { effectiveZones } = computeZoning(
      graph({
        boundaries: [bnd('parent', { zone: 'RESTRICTED' }), bnd('child', { parentBoundaryId: 'parent' })],
      }),
      engine,
    );
    expect(effectiveZones['child']).toEqual({ zone: 'RESTRICTED', source: 'inherited', from: 'parent' });
  });

  it('defaults an undeclared boundary with no declaring ancestor to INTERNAL/default', () => {
    const { effectiveZones } = computeZoning(graph({ boundaries: [bnd('plain')] }), engine);
    expect(effectiveZones['plain']).toEqual({ zone: 'INTERNAL', source: 'default' });
  });

  it('excludes the synthetic root from effectiveZones and resolves every real boundary', () => {
    const { effectiveZones } = computeZoning(
      graph({ boundaries: [bnd('a'), bnd('b', { parentBoundaryId: 'a' })] }),
      engine,
    );
    expect(effectiveZones['__zoning_root__']).toBeUndefined();
    expect(Object.keys(effectiveZones).sort()).toEqual(['a', 'b']);
  });
});
