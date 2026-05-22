/**
 * Asset-context push chokepoint: `splitToMonolithic` (the standalone converter
 * both DtUpdateSplit and DtImportSplit funnel through before the per-element
 * mutations). Verifies the three things the push input-builders rely on:
 *   - model `scope` is carried from the manifest onto the monolithic;
 *   - component `crownJewel` is read from the first-class `structure.json` field
 *     (true when the structure component says so; a definite `false` otherwise so
 *     REPLACE can clear it);
 *   - data-item `sensitivity` / `regulatory_flags` ride the `...item` spread.
 */

import { describe, it, expect } from 'vitest';
import { splitToMonolithic } from '../model.schema.js';
import type { SplitModel } from '../index.js';

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
      components: [
        { id: 'c1', name: 'Crown', type: 'STORE', positionX: 0, positionY: 0, crownJewel: true },
        { id: 'c2', name: 'Plain', type: 'PROCESS', positionX: 0, positionY: 0 },
      ],
    },
  },
  dataFlows: [],
  dataItems: [],
  attributes: {
    boundaries: {},
    components: {
      c1: {
        elementId: 'c1',
        elementType: 'component',
        elementName: 'Crown',
        attributes: { ssl_enabled: true },
      },
    },
    dataFlows: {},
    dataItems: {},
  },
});

describe('splitToMonolithic — asset-context push chokepoint', () => {
  it('carries model scope from the manifest', () => {
    const split = baseSplit();
    split.manifest.model.scope = {
      depth: 'design',
      compliance_drivers: ['PCI cardholder'],
    };
    const mono = splitToMonolithic(split);
    expect(mono.scope).toEqual({ depth: 'design', compliance_drivers: ['PCI cardholder'] });
  });

  it('leaves scope undefined when the manifest has none', () => {
    expect(splitToMonolithic(baseSplit()).scope).toBeUndefined();
  });

  it('reads crownJewel from the structure component (true / definite false)', () => {
    const mono = splitToMonolithic(baseSplit());
    const comps = mono.defaultBoundary.components!;
    const crown = comps.find(c => c.id === 'c1')!;
    const plain = comps.find(c => c.id === 'c2')!;
    expect(crown.crownJewel).toBe(true);
    // Definite false (not undefined) so the push REPLACE clears a stale platform flag.
    expect(plain.crownJewel).toBe(false);
    // crownJewel is not an attribute-bag field — the bag carries only typed attributes.
    expect(crown.attributes).toEqual({ ssl_enabled: true });
  });

  it('rides data-item sensitivity / regulatory_flags through the spread', () => {
    const split = baseSplit();
    split.dataItems = [
      {
        id: 'd1',
        name: 'Cardholder',
        sensitivity: 'restricted',
        regulatory_flags: ['PCI cardholder'],
      },
    ];
    const mono = splitToMonolithic(split);
    expect(mono.dataItems![0]).toMatchObject({
      id: 'd1',
      sensitivity: 'restricted',
      regulatory_flags: ['PCI cardholder'],
    });
  });
});
