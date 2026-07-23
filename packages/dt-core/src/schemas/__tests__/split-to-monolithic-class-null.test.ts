/**
 * Explicit-null classData through `splitToMonolithic`: the unassign sentinel must
 * survive the attributes-bag merge. The merge previously used `??`, which swallows
 * an explicit null and resurrects a stale `classData` from the attributes bag —
 * silently re-binding the class the caller just removed. Covers all four element
 * kinds (component, boundary, data flow, data item) plus the absent-key fallback
 * regression (absent still falls back to the bag).
 */

import { describe, it, expect } from 'vitest';
import { splitToMonolithic } from '../model.schema.js';
import type { SplitModel } from '../index.js';

const KLASS = { id: 'k1', name: 'K' };

const baseSplit = (): SplitModel => ({
  manifest: {
    schemaVersion: '2.0.0',
    format: 'split',
    model: { id: 'm1', name: 'M', description: 'd', defaultBoundaryId: 'b0' },
    modules: [],
    exportedAt: '2026-05-21T00:00:00.000Z',
  },
  structure: {
    defaultBoundary: {
      id: 'b0',
      name: 'root',
      boundaries: [{ id: 'b1', name: 'DMZ' }],
      components: [{ id: 'c1', name: 'C', type: 'PROCESS', positionX: 0, positionY: 0 }],
    },
  },
  dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1' }, target: { id: 'c1' } }],
  dataItems: [{ id: 'd1', name: 'PII' }],
  attributes: {
    // Every bag entry carries a stale classData — the resurrect hazard under `??`.
    boundaries: {
      b1: { elementId: 'b1', elementType: 'boundary', elementName: 'DMZ', classData: KLASS, attributes: {} },
    },
    components: {
      c1: { elementId: 'c1', elementType: 'component', elementName: 'C', classData: KLASS, attributes: {} },
    },
    dataFlows: {
      f1: { elementId: 'f1', elementType: 'dataFlow', elementName: 'flow', classData: KLASS, attributes: {} },
    },
    dataItems: {
      d1: { elementId: 'd1', elementType: 'dataItem', elementName: 'PII', classData: KLASS, attributes: {} },
    },
  },
});

describe('splitToMonolithic — explicit-null classData survives the attributes-bag merge', () => {
  it('component: explicit null is NOT resurrected from the bag', () => {
    const split = baseSplit();
    split.structure.defaultBoundary.components![0].classData = null;
    const mono = splitToMonolithic(split);
    expect(mono.defaultBoundary.components![0].classData).toBeNull();
  });

  it('boundary: explicit null is NOT resurrected from the bag', () => {
    const split = baseSplit();
    split.structure.defaultBoundary.boundaries![0].classData = null;
    const mono = splitToMonolithic(split);
    expect(mono.defaultBoundary.boundaries![0].classData).toBeNull();
  });

  it('data flow: explicit null is NOT resurrected from the bag', () => {
    const split = baseSplit();
    split.dataFlows[0].classData = null;
    const mono = splitToMonolithic(split);
    expect(mono.dataFlows![0].classData).toBeNull();
  });

  it('data item: explicit null is NOT resurrected from the bag', () => {
    const split = baseSplit();
    split.dataItems[0].classData = null;
    const mono = splitToMonolithic(split);
    expect(mono.dataItems![0].classData).toBeNull();
  });

  it('absent classData still falls back to the attributes bag (regression)', () => {
    const mono = splitToMonolithic(baseSplit());
    expect(mono.defaultBoundary.components![0].classData).toEqual(KLASS);
    expect(mono.defaultBoundary.boundaries![0].classData).toEqual(KLASS);
    expect(mono.dataFlows![0].classData).toEqual(KLASS);
    expect(mono.dataItems![0].classData).toEqual(KLASS);
  });

  it('declared classData wins over the bag (regression)', () => {
    const split = baseSplit();
    const OTHER = { id: 'k2', name: 'K2' };
    split.structure.defaultBoundary.components![0].classData = OTHER;
    const mono = splitToMonolithic(split);
    expect(mono.defaultBoundary.components![0].classData).toEqual(OTHER);
  });
});
