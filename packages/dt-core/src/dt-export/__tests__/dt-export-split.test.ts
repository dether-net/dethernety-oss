/**
 * Asset-context export (pull) mapper contracts.
 *
 * Exercises the private `DtExportSplit.monolithicToSplit` pure conversion (no
 * Apollo) with a constructed `ExportedModel` that simulates the platform read,
 * asserting on the resulting `SplitModel`:
 *   - flat platform scope → grouped snake_case local; data-item sensitivity
 *     (lowercased) + regulatory_flags; component crownJewel written first-class
 *     onto the structure component.
 *   - null/absent platform values coalesce to absent (no empty scope, no
 *     sensitivity/flags keys, no crownJewel on the structure component).
 *   - a crown-jewel-only component (no class, no attributes) carries crownJewel
 *     on the structure component and synthesizes no attribute-bag entry.
 */

import { describe, it, expect } from 'vitest';
import { DtExportSplit } from '../dt-export-split.js';
import type { ExportedModel } from '../dt-export.js';
import type { SplitModel } from '../../schemas/index.js';

// monolithicToSplit is private and uses no Apollo client — reach it via the
// established `(instance as any)` test idiom.
const convert = (model: ExportedModel): SplitModel =>
  (new DtExportSplit({} as any) as any).monolithicToSplit(model) as SplitModel;

describe('DtExportSplit — asset-context export (pull)', () => {
  it('lowers flat scope + data-item fields, and writes component crownJewel to structure', () => {
    const model: ExportedModel = {
      id: 'm1',
      name: 'M',
      description: 'd',
      depth: 'ARCHITECTURE',
      modelingIntent: 'SECURITY_REVIEW',
      complianceDrivers: ['PCI-DSS'],
      exclusions: ['third-party SaaS'],
      trustAssumptions: ['cloud provider is trusted'],
      defaultBoundary: {
        id: 'b0',
        name: 'root',
        description: '',
        components: [
          {
            id: 'c1',
            name: 'DB',
            description: '',
            type: 'STORE',
            positionX: 0,
            positionY: 0,
            crownJewel: true,
            classData: { id: 'cc1', name: 'Database' },
            attributes: { ssl_enabled: true },
          },
        ],
      },
      dataItems: [
        {
          id: 'd1',
          name: 'Cardholder',
          description: '',
          sensitivity: 'RESTRICTED',
          regulatoryFlags: ['PCI cardholder'],
        },
      ],
    };

    const split = convert(model);

    expect(split.manifest.model.scope).toEqual({
      depth: 'architecture',
      modeling_intent: 'security_review',
      compliance_drivers: ['PCI-DSS'],
      exclusions: ['third-party SaaS'],
      trust_assumptions: ['cloud provider is trusted'],
    });
    expect(split.dataItems[0]).toMatchObject({
      id: 'd1',
      sensitivity: 'restricted',
      regulatory_flags: ['PCI cardholder'],
    });
    // crownJewel is written first-class onto the structure component, not the bag
    const c1 = split.structure.defaultBoundary.components!.find(c => c.id === 'c1')!;
    expect(c1.crownJewel).toBe(true);
    // the bag keeps only its typed attributes (no crown_jewel)
    expect(split.attributes.components!['c1'].attributes).toEqual({ ssl_enabled: true });
  });

  it('null/absent platform values coalesce to absent (no empty scope, no keys)', () => {
    const model: ExportedModel = {
      id: 'm1',
      name: 'M',
      description: '',
      depth: null as any,
      complianceDrivers: [] as any, // empty arrays must be omitted, not written as []
      defaultBoundary: {
        id: 'b0',
        name: 'root',
        description: '',
        components: [
          {
            id: 'c1',
            name: 'C',
            description: '',
            type: 'PROCESS',
            positionX: 0,
            positionY: 0,
            crownJewel: null as any, // not === true → no crownJewel on the structure component
            classData: { id: 'cc', name: 'X' },
            attributes: { foo: 'bar' },
          },
        ],
      },
      dataItems: [{ id: 'd1', name: 'D', description: '' }], // no sensitivity/flags
    };

    const split = convert(model);

    expect(split.manifest.model.scope).toBeUndefined();
    expect(split.dataItems[0].sensitivity).toBeUndefined();
    expect(split.dataItems[0].regulatory_flags).toBeUndefined();
    // crownJewel not === true → omitted from the structure component
    const c1 = split.structure.defaultBoundary.components!.find(c => c.id === 'c1')!;
    expect(c1.crownJewel).toBeUndefined();
    expect(split.attributes.components!['c1'].attributes).toEqual({ foo: 'bar' });
  });

  it('crown-jewel-only component: crownJewel on the structure component, no synthetic bag entry', () => {
    const model: ExportedModel = {
      id: 'm1',
      name: 'M',
      description: '',
      defaultBoundary: {
        id: 'b0',
        name: 'root',
        description: '',
        components: [
          {
            id: 'c1',
            name: 'Lonely CJ',
            description: '',
            type: 'PROCESS',
            positionX: 0,
            positionY: 0,
            crownJewel: true,
            // no classData, no attributes → extractAttributes emits no bag entry
          },
        ],
      },
    };

    const split = convert(model);

    // crownJewel rides the first-class structure field — always present, no bag needed
    const c1 = split.structure.defaultBoundary.components!.find(c => c.id === 'c1')!;
    expect(c1.crownJewel).toBe(true);
    // a component with no typed attributes synthesizes no attribute-bag entry
    expect(split.attributes.components!['c1']).toBeUndefined();
  });
});
