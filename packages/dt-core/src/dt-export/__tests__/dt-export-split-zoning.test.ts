/**
 * Export (pull) carries boundary zoning into structure.json.
 *
 * `convertToStructureBoundary` enumerates boundary fields explicitly, so zoning is dropped unless copied.
 * These tests pin zone/domains/planes through the pure `monolithicToSplit` converter (which calls
 * convertToStructureBoundary, no Apollo) on the default boundary AND a nested child (recursion), plus the
 * guard: a zoneless boundary (or empty domains/planes) writes no zoning keys. Conduits are flattened from
 * the raw outbound/inbound connection reads via `flattenConduits`, including on the ROOT boundary (the
 * DUMP_MODEL_DATA root-selection fix — a conduit on the default boundary must not silently drop on export).
 */

import { describe, it, expect } from 'vitest';
import { DtExportSplit } from '../dt-export-split.js';
import type { ExportedModel } from '../dt-export.js';
import type { SplitModel } from '../../schemas/index.js';

const convert = (model: ExportedModel): SplitModel =>
  (new DtExportSplit({} as any) as any).monolithicToSplit(model) as SplitModel;

const baseModel = (defaultBoundary: any): ExportedModel =>
  ({ id: 'm1', name: 'M', description: 'd', defaultBoundary }) as ExportedModel;

describe('DtExportSplit — boundary zoning export (pull)', () => {
  it('carries zone/domains/planes on the default boundary and a nested child', () => {
    const split = convert(
      baseModel({
        id: 'b0',
        name: 'root',
        description: '',
        zone: 'INTERNAL',
        domains: ['core'],
        planes: ['WORKLOAD', 'MANAGEMENT'],
        boundaries: [
          { id: 'b1', name: 'dmz', description: '', zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] },
        ],
      }),
    );

    expect(split.structure.defaultBoundary).toMatchObject({
      zone: 'INTERNAL',
      domains: ['core'],
      planes: ['WORKLOAD', 'MANAGEMENT'],
    });
    const child = split.structure.defaultBoundary.boundaries!.find(b => b.id === 'b1')!;
    expect(child).toMatchObject({ zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] });
  });

  it('flattens raw conduit connections into structure.json — including on the ROOT boundary (B1 guard)', () => {
    const split = convert(
      baseModel({
        id: 'b0',
        name: 'root',
        description: '',
        zone: 'INTERNAL',
        // a conduit ON THE DEFAULT/ROOT boundary — must survive export (root-selection fix)
        outboundConduitsConnection: {
          edges: [{ properties: { justification: 'edge ingress', controlRefs: ['ctrl1'] }, node: { id: 'b1', name: 'dmz' } }],
        },
        boundaries: [
          {
            id: 'b1',
            name: 'dmz',
            description: '',
            zone: 'EXPOSED',
            inboundConduitsConnection: {
              edges: [{ properties: { justification: null, controlRefs: null }, node: { id: 'b0', name: 'root' } }],
            },
          },
        ],
      }),
    );

    expect(split.structure.defaultBoundary.conduits).toEqual([
      { peerId: 'b1', peerName: 'dmz', direction: 'OUTBOUND', justification: 'edge ingress', controlRefs: ['ctrl1'] },
    ]);
    const child = split.structure.defaultBoundary.boundaries!.find(b => b.id === 'b1')!;
    // null justification/controlRefs coalesce to undefined (omitted); direction derived from the connection
    expect(child.conduits).toMatchObject([{ peerId: 'b0', peerName: 'root', direction: 'INBOUND' }]);
  });

  it('writes no zoning or conduit keys for a bare boundary (null/empty ⇒ omit)', () => {
    const split = convert(
      baseModel({
        id: 'b0',
        name: 'root',
        description: '',
        zone: null,
        domains: [],
        planes: [],
      }),
    );

    expect(split.structure.defaultBoundary).not.toHaveProperty('zone');
    expect(split.structure.defaultBoundary).not.toHaveProperty('domains');
    expect(split.structure.defaultBoundary).not.toHaveProperty('planes');
    expect(split.structure.defaultBoundary).not.toHaveProperty('conduits');
    // established fields still copied
    expect(split.structure.defaultBoundary.name).toBe('root');
  });
});
