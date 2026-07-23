/**
 * validateMonolithicModel must REJECT malformed input, not throw on it.
 * The pre-repair validator crashed (TypeError) on a missing defaultBoundary or a
 * flow with no source — exactly the shapes it exists to reject. Plus the new
 * checks: duplicate element ids, component type enum, finite positions, and
 * boundary-legal flow endpoints (shared collector with the split-import validator).
 */
import { describe, it, expect } from 'vitest';
import { validateMonolithicModel, collectFlowEndpointIds } from '../model.schema.js';
import type { MonolithicModel } from '../model.schema.js';

const baseModel = (): MonolithicModel => ({
  name: 'M',
  defaultBoundary: {
    id: 'b0',
    name: 'root',
    components: [
      { id: 'c1', name: 'C1', type: 'PROCESS', positionX: 0, positionY: 0 },
      { id: 'c2', name: 'C2', type: 'STORE', positionX: 10, positionY: 10 },
    ],
    boundaries: [
      { id: 'b1', name: 'DMZ', components: [{ id: 'c3', name: 'C3', type: 'EXTERNAL_ENTITY', positionX: 5, positionY: 5 }] },
    ],
  },
  dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1' }, target: { id: 'c2' } }],
  dataItems: [{ id: 'd1', name: 'PII' }],
});

describe('validateMonolithicModel — crash guards', () => {
  it('missing defaultBoundary with dataFlows present returns invalid, does not throw', () => {
    const model = { name: 'M', dataFlows: [{ id: 'f1', name: 'f', source: { id: 'x' }, target: { id: 'y' } }] } as any;
    const result = validateMonolithicModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_DEFAULT_BOUNDARY')).toBe(true);
  });

  it('a flow with no source returns INVALID_FLOW_SOURCE, does not throw', () => {
    const model = baseModel();
    (model.dataFlows![0] as any).source = undefined;
    const result = validateMonolithicModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_FLOW_SOURCE')).toBe(true);
  });

  it('missing defaultBoundary with dataItems present does not throw either', () => {
    const model = { name: 'M', dataItems: [{ id: 'd1', name: 'PII' }] } as any;
    expect(validateMonolithicModel(model).valid).toBe(false);
  });
});

describe('validateMonolithicModel — endpoint semantics', () => {
  it('a boundary-attached flow is VALID (boundaries are legal endpoints)', () => {
    const model = baseModel();
    model.dataFlows = [{ id: 'f1', name: 'to-dmz', source: { id: 'c1' }, target: { id: 'b1' } }];
    const result = validateMonolithicModel(model);
    expect(result.errors.filter(e => e.code.startsWith('INVALID_FLOW'))).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('an unknown endpoint id still fails', () => {
    const model = baseModel();
    model.dataFlows = [{ id: 'f1', name: 'bad', source: { id: 'nope' }, target: { id: 'c2' } }];
    const result = validateMonolithicModel(model);
    expect(result.errors.some(e => e.code === 'INVALID_FLOW_SOURCE')).toBe(true);
  });
});

describe('validateMonolithicModel — duplicate ids + scalar shapes', () => {
  it('two components sharing an id produce DUPLICATE_ELEMENT_ID', () => {
    const model = baseModel();
    model.defaultBoundary.components!.push({ id: 'c1', name: 'C1-again', type: 'PROCESS', positionX: 1, positionY: 1 });
    const result = validateMonolithicModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_ELEMENT_ID' && e.elementId === 'c1')).toBe(true);
  });

  it('an invalid component type produces INVALID_COMPONENT_TYPE', () => {
    const model = baseModel();
    (model.defaultBoundary.components![0] as any).type = 'WIDGET';
    const result = validateMonolithicModel(model);
    expect(result.errors.some(e => e.code === 'INVALID_COMPONENT_TYPE')).toBe(true);
  });

  it('a non-numeric position produces INVALID_POSITION', () => {
    const model = baseModel();
    (model.defaultBoundary.components![0] as any).positionX = '12';
    const result = validateMonolithicModel(model);
    expect(result.errors.some(e => e.code === 'INVALID_POSITION')).toBe(true);
  });

  it('a fully valid model stays valid (position 0 is fine)', () => {
    const result = validateMonolithicModel(baseModel());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('validateMonolithicModel — never throws on junk shapes', () => {
  // Every shape here used to throw a TypeError; each must now return a
  // MALFORMED_STRUCTURE (or other) error instead.
  const junkShapes: Array<[string, (m: any) => void]> = [
    ['null component entry', m => { m.defaultBoundary.components = [null]; }],
    ['null boundary entry', m => { m.defaultBoundary.boundaries = [null]; }],
    ['null dataFlow entry', m => { m.dataFlows = [null]; }],
    ['null dataItem entry', m => { m.dataItems = [null]; }],
    ['components as object', m => { m.defaultBoundary.components = {}; }],
    ['boundaries as string', m => { m.defaultBoundary.boundaries = 'junk'; }],
    ['dataFlows as object', m => { m.dataFlows = {}; }],
    ['dataItems as object', m => { m.dataItems = {}; }],
    ['dataItemIds as object', m => { m.defaultBoundary.components[0].dataItemIds = {}; m.dataItems = [{ id: 'd1', name: 'x' }]; }],
    ['nested junk under a valid boundary', m => { m.defaultBoundary.boundaries = [{ id: 'bx', name: 'X', components: 'junk' }]; }],
  ];

  for (const [label, mutate] of junkShapes) {
    it(`${label}: returns a validation result, not a TypeError`, () => {
      const m: any = baseModel();
      mutate(m);
      const result = validateMonolithicModel(m);
      expect(result).toHaveProperty('valid');
      // Junk shapes are invalid (except pure-collector cases that only skip);
      // at minimum the call must not throw. Non-object/non-array shapes error:
      if (label !== 'dataItemIds as object') {
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'MALFORMED_STRUCTURE')).toBe(true);
      }
    });
  }
});

describe('collectFlowEndpointIds — shared collector', () => {
  it('collects boundary AND component ids, nested', () => {
    const ids = collectFlowEndpointIds(baseModel().defaultBoundary);
    expect(ids).toEqual(new Set(['b0', 'c1', 'c2', 'b1', 'c3']));
  });

  it('is null-safe on a missing boundary', () => {
    expect(collectFlowEndpointIds(undefined)).toEqual(new Set());
  });
});
