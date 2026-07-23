/**
 * The pure converters must be identity on the asset-context fields.
 * Pre-fix, extractStructureComponent omitted crownJewel (round-trip flipped
 * true→false — pushing that under REPLACE cleared crown jewels), and the forward
 * dataItems map omitted sensitivity/regulatory_flags. Plus: classless elements
 * keep their attributes through mono→split (extractAttributes no longer gated
 * on classData).
 */
import { describe, it, expect } from 'vitest';
import { monolithicToSplit, splitToMonolithic } from '../model.schema.js';
import type { MonolithicModel } from '../model.schema.js';

const model = (): MonolithicModel => ({
  name: 'M',
  defaultBoundary: {
    id: 'b0',
    name: 'root',
    components: [
      { id: 'c1', name: 'CJ', type: 'PROCESS', positionX: 0, positionY: 0, crownJewel: true },
      { id: 'c2', name: 'plain', type: 'STORE', positionX: 1, positionY: 1 },
    ],
  },
  dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1' }, target: { id: 'c2' } }],
  dataItems: [
    { id: 'd1', name: 'PII', sensitivity: 'restricted', regulatory_flags: ['PCI cardholder', 'PHI'] },
  ],
});

describe('mono→split→mono round-trip — asset-context fields', () => {
  it('preserves crownJewel: true on the component', () => {
    const mono = splitToMonolithic(monolithicToSplit(model()));
    expect(mono.defaultBoundary.components![0].crownJewel).toBe(true);
    // Non-crown-jewel stays definitively false (REPLACE semantics on the reverse).
    expect(mono.defaultBoundary.components![1].crownJewel).toBe(false);
  });

  it('preserves data-item sensitivity and regulatory_flags', () => {
    const mono = splitToMonolithic(monolithicToSplit(model()));
    expect(mono.dataItems![0].sensitivity).toBe('restricted');
    expect(mono.dataItems![0].regulatory_flags).toEqual(['PCI cardholder', 'PHI']);
  });

  it('forward conversion lands crownJewel on the structure component', () => {
    const split = monolithicToSplit(model());
    expect(split.structure.defaultBoundary.components![0].crownJewel).toBe(true);
  });
});

describe('mono→split→mono round-trip — model scope', () => {
  it('preserves model.scope through the standalone converter pair', () => {
    const m = model();
    m.scope = { depth: 'design', modeling_intent: 'security_review', compliance_drivers: ['nis2'] };
    const split = monolithicToSplit(m);
    // Forward: scope rides in the manifest (splitToMonolithic reads it from there).
    expect(split.manifest.model.scope).toEqual(m.scope);
    const mono = splitToMonolithic(split);
    expect(mono.scope).toEqual(m.scope);
  });

  it('omits scope from the manifest when unset (no key synthesized)', () => {
    const split = monolithicToSplit(model());
    expect('scope' in split.manifest.model).toBe(false);
  });
});

describe('mono→split — classless attributes survive', () => {
  it('a classless component with attributes keeps them in the bag and through the round-trip', () => {
    const m = model();
    m.defaultBoundary.components![0].classData = undefined;
    m.defaultBoundary.components![0].attributes = { note: 'crown-jewel-only' };

    const split = monolithicToSplit(m);
    expect(split.attributes.components!['c1']).toBeDefined();
    expect(split.attributes.components!['c1'].attributes).toEqual({ note: 'crown-jewel-only' });
    // No classData key synthesized for a classless element.
    expect(split.attributes.components!['c1'].classData).toBeUndefined();

    const mono = splitToMonolithic(split);
    expect(mono.defaultBoundary.components![0].attributes).toEqual({ note: 'crown-jewel-only' });
  });

  it('a classed component still carries classData in the bag (unchanged)', () => {
    const m = model();
    m.defaultBoundary.components![0].classData = { id: 'k1', name: 'K' };
    m.defaultBoundary.components![0].attributes = { a: 1 };
    const split = monolithicToSplit(m);
    expect(split.attributes.components!['c1'].classData).toEqual({ id: 'k1', name: 'K' });
  });
});
