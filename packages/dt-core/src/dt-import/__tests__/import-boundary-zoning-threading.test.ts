/**
 * Import write-path threading for boundary zoning: proves DtImport persists zone/domains/planes.
 * Sub-methods are spied; private methods reached via `(instance as any)`; no Apollo.
 *  - setupDefaultBoundary threads zoning into the node.data it sends to updateBoundaryNode (UPDATE path).
 *  - createBoundary follows up createBoundaryNode (which can't set zoning) with a guarded updateBoundaryNode;
 *    setElementControlsDirect is stubbed so the follow-up is the only updateBoundaryNode call we observe.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtImport } from '../dt-import.js';

describe('DtImport — boundary zoning threading (import write path)', () => {
  it('setupDefaultBoundary threads zoning into the default-boundary update', async () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.dtModel.dumpModelData = vi.fn().mockResolvedValue({ defaultBoundary: { id: 'b0' } });
    const updateSpy = vi.fn().mockResolvedValue({});
    dtImport.dtBoundary.updateBoundaryNode = updateSpy;

    await dtImport.setupDefaultBoundary(
      { id: 't0', name: 'root', zone: 'INTERNAL', domains: ['core'], planes: ['WORKLOAD', 'MANAGEMENT'] },
      'm1',
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].updatedNode.data).toMatchObject({
      zone: 'INTERNAL',
      domains: ['core'],
      planes: ['WORKLOAD', 'MANAGEMENT'],
    });
  });

  it('createBoundary follows up with an updateBoundaryNode carrying the zoning', async () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.defaultBoundaryId = 'b0';
    dtImport.resolveBoundaryClass = vi.fn().mockResolvedValue('');
    dtImport.setElementControlsDirect = vi.fn().mockResolvedValue(undefined);
    dtImport.dtBoundary.createBoundaryNode = vi.fn().mockResolvedValue({ id: 'b1' });
    const updateSpy = vi.fn().mockResolvedValue({});
    dtImport.dtBoundary.updateBoundaryNode = updateSpy;

    await dtImport.createBoundary(
      { id: 't1', name: 'DMZ', zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] },
      'b0',
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].updatedNode.id).toBe('b1');
    expect(updateSpy.mock.calls[0][0].updatedNode.data).toMatchObject({
      zone: 'EXPOSED',
      domains: ['edge'],
      planes: ['WORKLOAD'],
    });
  });

  it('createBoundary skips the follow-up for a zoneless boundary (no extra mutation)', async () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.defaultBoundaryId = 'b0';
    dtImport.resolveBoundaryClass = vi.fn().mockResolvedValue('');
    dtImport.setElementControlsDirect = vi.fn().mockResolvedValue(undefined);
    dtImport.dtBoundary.createBoundaryNode = vi.fn().mockResolvedValue({ id: 'b1' });
    const updateSpy = vi.fn().mockResolvedValue({});
    dtImport.dtBoundary.updateBoundaryNode = updateSpy;

    await dtImport.createBoundary({ id: 't2', name: 'plain' }, 'b0');

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('DtImport — conduit write pass (associateConduitsWithBoundaries)', () => {
  // A symmetric conduit t0→t1 is stored on BOTH ends of the split file (OUTBOUND on t0, INBOUND on t1).
  // The pass must write it ONCE from the source (t0) with the peerId translated old→new, and never emit
  // an inbound connect on t1 — otherwise the same physical edge would be connected twice (dup parallel edge).
  const symmetricModel = () => ({
    defaultBoundary: {
      id: 't0',
      name: 'root',
      conduits: [{ peerId: 't1', direction: 'OUTBOUND', justification: 'edge ingress' }],
      boundaries: [
        { id: 't1', name: 'dmz', type: 'BOUNDARY', conduits: [{ peerId: 't0', direction: 'INBOUND' }] },
      ],
    },
  });

  const seeded = () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.defaultBoundaryId = 'b0';
    dtImport.idMapping = new Map([['t0', 'b0'], ['t1', 'b1']]);
    const updateSpy = vi.fn().mockResolvedValue({});
    dtImport.dtBoundary.updateBoundaryNode = updateSpy;
    return { dtImport, updateSpy };
  };

  it('writes each edge once from the OUTBOUND source, peerId translated, baseline []', async () => {
    const { dtImport, updateSpy } = seeded();

    await dtImport.associateConduitsWithBoundaries(symmetricModel());

    // connect count = added-edge count: exactly one write, on the source boundary b0.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const call = updateSpy.mock.calls[0][0];
    expect(call.updatedNode.id).toBe('b0');
    expect(call.updatedNode.data.conduits).toEqual([
      { peerId: 'b1', direction: 'OUTBOUND', justification: 'edge ingress' }, // t1 → b1
    ]);
    expect(call.baselineConduits).toEqual([]); // fresh model
    // The safe node must NOT carry controls/dataItems/zoning (they would clobber).
    expect(call.updatedNode.data.controls).toBeUndefined();
    expect(call.updatedNode.data.dataItems).toBeUndefined();
    expect(call.updatedNode.data.zone).toBeUndefined();
  });

  it('does not write the INBOUND mirror on the peer boundary', async () => {
    const { dtImport, updateSpy } = seeded();

    await dtImport.associateConduitsWithBoundaries(symmetricModel());

    // No call targets b1 (its only conduit is the INBOUND mirror, which is re-derived on read).
    expect(updateSpy.mock.calls.every((c: any) => c[0].updatedNode.id !== 'b1')).toBe(true);
  });

  it('warns and skips a conduit whose peer does not resolve', async () => {
    const { dtImport, updateSpy } = seeded();
    dtImport.warnings = [];

    await dtImport.associateConduitsWithBoundaries({
      defaultBoundary: {
        id: 't0',
        name: 'root',
        conduits: [{ peerId: 'ghost', direction: 'OUTBOUND' }],
      },
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(dtImport.warnings.some((w: string) => w.includes('ghost'))).toBe(true);
  });
});
