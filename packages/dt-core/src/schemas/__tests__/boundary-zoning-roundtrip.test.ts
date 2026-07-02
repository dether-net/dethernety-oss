/**
 * Boundary zoning scalars survive the split↔monolithic round-trip.
 *
 * `monolithicToSplit` / `splitToMonolithic` rebuild each boundary by enumerating
 * its fields explicitly (no spread), so any field not threaded through both
 * `extractStructureBoundary` and `injectAttributesBoundary` is silently dropped.
 * These tests pin the three zoning scalars (`zone`, `domains`, `planes`) and the
 * flattened `conduits` array through a full round-trip on the default boundary AND
 * a nested child (the recursion), plus the migration case (a zoneless/conduitless
 * boundary gains no spurious keys). The established `representedModel`/`controls`
 * fields are asserted alongside to show the thread didn't disturb them. (Conduits are
 * a graph relationship live, but the split file carries the flattened `Conduit[]`.)
 */

import { describe, it, expect } from 'vitest';
import { monolithicToSplit, splitToMonolithic } from '../model.schema.js';
import type { MonolithicModel } from '../index.js';

const baseMonolithic = (): MonolithicModel => ({
  name: 'Zoned',
  defaultBoundary: {
    id: 'b0',
    name: 'root',
    zone: 'INTERNAL',
    domains: ['payments', 'core'],
    planes: ['WORKLOAD', 'MANAGEMENT'],
    conduits: [
      { peerId: 'b1', peerName: 'dmz', direction: 'OUTBOUND', justification: 'edge ingress', controlRefs: ['ctrl1'] },
    ],
    representedModel: { id: 'rm1', name: 'Sub-model' },
    controls: [{ id: 'ctrl1', name: 'WAF' }],
    boundaries: [
      {
        id: 'b1',
        name: 'dmz',
        zone: 'EXPOSED',
        domains: ['edge'],
        planes: ['WORKLOAD'],
        conduits: [{ peerId: 'b0', direction: 'INBOUND' }],
      },
    ],
    components: [{ id: 'c1', name: 'API', type: 'PROCESS', positionX: 0, positionY: 0 }],
  },
  dataFlows: [],
  dataItems: [],
});

describe('boundary zoning scalars — split↔monolithic round-trip', () => {
  it('preserves zone/domains/planes on the default boundary', () => {
    const mono = splitToMonolithic(monolithicToSplit(baseMonolithic()));
    expect(mono.defaultBoundary.zone).toBe('INTERNAL');
    expect(mono.defaultBoundary.domains).toEqual(['payments', 'core']);
    expect(mono.defaultBoundary.planes).toEqual(['WORKLOAD', 'MANAGEMENT']);
  });

  it('preserves zoning on a nested child boundary (recursion)', () => {
    const mono = splitToMonolithic(monolithicToSplit(baseMonolithic()));
    const child = mono.defaultBoundary.boundaries!.find(b => b.id === 'b1')!;
    expect(child.zone).toBe('EXPOSED');
    expect(child.domains).toEqual(['edge']);
    expect(child.planes).toEqual(['WORKLOAD']);
  });

  it('preserves the flattened conduits array on the default boundary and a nested child', () => {
    const mono = splitToMonolithic(monolithicToSplit(baseMonolithic()));
    expect(mono.defaultBoundary.conduits).toEqual([
      { peerId: 'b1', peerName: 'dmz', direction: 'OUTBOUND', justification: 'edge ingress', controlRefs: ['ctrl1'] },
    ]);
    const child = mono.defaultBoundary.boundaries!.find(b => b.id === 'b1')!;
    expect(child.conduits).toEqual([{ peerId: 'b0', direction: 'INBOUND' }]);
  });

  it('leaves zoning + conduit fields undefined on a bare boundary (migration-safe)', () => {
    const model = baseMonolithic();
    const zoneless: MonolithicModel = {
      ...model,
      defaultBoundary: { id: 'b0', name: 'root', components: [] },
    };
    const mono = splitToMonolithic(monolithicToSplit(zoneless));
    expect(mono.defaultBoundary.zone).toBeUndefined();
    expect(mono.defaultBoundary.domains).toBeUndefined();
    expect(mono.defaultBoundary.planes).toBeUndefined();
    expect(mono.defaultBoundary.conduits).toBeUndefined();
  });

  it('does not disturb established boundary fields alongside zoning', () => {
    const mono = splitToMonolithic(monolithicToSplit(baseMonolithic()));
    expect(mono.defaultBoundary.representedModel).toEqual({ id: 'rm1', name: 'Sub-model' });
    expect(mono.defaultBoundary.controls).toEqual([{ id: 'ctrl1', name: 'WAF' }]);
  });
});
