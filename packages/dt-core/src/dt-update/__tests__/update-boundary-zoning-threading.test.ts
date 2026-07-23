/**
 * Update write-path threading for boundary zoning: proves DtUpdate hands zone/domains/planes to
 * updateBoundaryNode on the update path (mirror of the import-side threading test). Sub-methods are
 * spied; private orchestrator methods reached via `(instance as any)`; no Apollo.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const seed = (dtUpdate: any) => {
  dtUpdate.idMapping = new Map();
};

describe('DtUpdate — boundary zoning threading (update write path)', () => {
  it('updateDefaultBoundary threads zoning into node.data', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0'; // required, else the method early-returns
    const spy = vi.fn().mockResolvedValue({ id: 'b0' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;

    await dtUpdate.updateDefaultBoundary({
      name: 'Root',
      zone: 'INTERNAL',
      domains: ['core'],
      planes: ['WORKLOAD', 'MANAGEMENT'],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data).toMatchObject({
      zone: 'INTERNAL',
      domains: ['core'],
      planes: ['WORKLOAD', 'MANAGEMENT'],
    });
  });

  it('updateBoundary threads zoning into node.data', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const spy = vi.fn().mockResolvedValue({ id: 'b1' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;

    await dtUpdate.updateBoundary(
      { id: 'b1', name: 'DMZ', zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] },
      'b0',
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data).toMatchObject({
      zone: 'EXPOSED',
      domains: ['edge'],
      planes: ['WORKLOAD'],
    });
  });

  it('createBoundary follow-up carries zoning even with no controls/dataItems (widened guard)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtBoundary.createBoundaryNode = vi.fn().mockResolvedValue({ id: 'B1' });
    const updateSpy = vi.fn().mockResolvedValue({ id: 'B1' });
    dtUpdate.dtBoundary.updateBoundaryNode = updateSpy;

    await dtUpdate.createBoundary(
      { id: 'b1', name: 'DMZ', zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] },
      'b0',
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].updatedNode.data).toMatchObject({
      zone: 'EXPOSED',
      domains: ['edge'],
      planes: ['WORKLOAD'],
    });
  });

  it('updateBoundary invents no zoning value when the boundary declares none', async () => {
    // The data literal threads zoning by pass-through, so an undeclared field stays `undefined` — which the
    // shipped partial-update in updateBoundaryNode then omits from the mutation (no clobber of persisted zoning).
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.idMapping = new Map([['d2', 'D2']]);
    const spy = vi.fn().mockResolvedValue({ id: 'b1' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;

    await dtUpdate.updateBoundary({ id: 'b1', name: 'B', dataItemIds: ['d2'] }, 'b0');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.zone).toBeUndefined();
    expect(spy.mock.calls[0][0].updatedNode.data.domains).toBeUndefined();
    expect(spy.mock.calls[0][0].updatedNode.data.planes).toBeUndefined();
    // dataItems threading still works alongside (proves the change didn't disturb it).
    expect(spy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D2']);
  });
});

describe('DtUpdate — conduit write pass (real baseline + orphan exclusion)', () => {
  // Seed an existing-model update: ids are self-mapped, and the server baseline is provided so the
  // reconcile sees a real previous state (the S12 deliverable — no more `[]` default).
  const seeded = (opts: {
    conduits?: any[];
    baseline?: any[];
    processed?: string[];
    existing?: string[];
  }) => {
    const dtUpdate = new DtUpdate({} as any) as any;
    dtUpdate.idMapping = new Map([['b0', 'b0'], ['b1', 'b1'], ['orphan', 'orphan']]);
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.existingBoundaryIds = new Set(opts.existing ?? ['b0', 'b1']);
    dtUpdate.processedBoundaryIds = new Set(opts.processed ?? ['b0', 'b1']);
    dtUpdate.existingConduitsByBoundary = new Map([['b0', opts.baseline ?? []]]);
    dtUpdate.warnings = [];
    const spy = vi.fn().mockResolvedValue({ id: 'b0' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;
    const jsonData = { defaultBoundary: { id: 'b0', name: 'root', conduits: opts.conduits } };
    return { dtUpdate, spy, jsonData };
  };

  it('passes the REAL server baseline (not []) so an unchanged edge is not re-connected', async () => {
    const edge = [{ peerId: 'b1', direction: 'OUTBOUND', justification: 'x' }];
    const { dtUpdate, spy, jsonData } = seeded({ conduits: edge, baseline: edge });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].baselineConduits).toEqual(edge); // real baseline, not []
    expect(spy.mock.calls[0][0].updatedNode.data.conduits).toEqual(edge);
  });

  it('does NOT pass the INBOUND mirror as baseline (regression: inbound conduit deleted on re-sync)', async () => {
    // A boundary that both SENDS (outbound → b1) and RECEIVES (inbound mirror ← a). The re-derived server
    // baseline carries both directions; the write is OUTBOUND-canonical. If the full baseline reached
    // updateBoundaryNode, its INBOUND reconcile (empty current vs the inbound baseline) would disconnect the
    // a→b0 channel peer `a` still declares. The baseline must arrive OUTBOUND-only.
    const outbound = { peerId: 'b1', direction: 'OUTBOUND', justification: 'x' };
    const inboundMirror = { peerId: 'a', direction: 'INBOUND' };
    const { dtUpdate, spy, jsonData } = seeded({ conduits: [outbound], baseline: [outbound, inboundMirror] });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).toHaveBeenCalledTimes(1);
    const passedBaseline = spy.mock.calls[0][0].baselineConduits;
    expect(passedBaseline).toEqual([outbound]); // OUTBOUND-only — the inbound mirror is NOT passed as baseline
    expect(passedBaseline.some((c: any) => c.direction === 'INBOUND')).toBe(false);
  });

  it('reconciles a removal: desired [] with a non-empty baseline still writes (to disconnect)', async () => {
    const baseline = [{ peerId: 'b1', direction: 'OUTBOUND' }];
    const { dtUpdate, spy, jsonData } = seeded({ conduits: [], baseline });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.conduits).toEqual([]);
    expect(spy.mock.calls[0][0].baselineConduits).toEqual(baseline);
  });

  it('leaves conduits alone when the boundary has no conduits key (absent ⇒ no write)', async () => {
    const { dtUpdate, spy, jsonData } = seeded({ conduits: undefined, baseline: [{ peerId: 'b1', direction: 'OUTBOUND' }] });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).not.toHaveBeenCalled();
  });

  it('drops + warns a conduit peer that is an orphan (pending deletion), issuing no connect', async () => {
    // 'orphan' is an existing boundary omitted from this update → not processed → about to be deleted.
    const { dtUpdate, spy, jsonData } = seeded({
      conduits: [{ peerId: 'orphan', direction: 'OUTBOUND' }],
      baseline: [],
      existing: ['b0', 'b1', 'orphan'],
      processed: ['b0', 'b1'],
    });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).not.toHaveBeenCalled(); // nothing to reconcile once the orphan peer is dropped
    expect(dtUpdate.warnings.some((w: string) => w.includes('orphan'))).toBe(true);
  });

  it('the conduit pass omits controls/dataItems from the node it hands updateBoundaryNode (builder then preserves — P0)', async () => {
    // Caller-side half of the P0 fix: the safe node carries only conduits, no
    // controls/dataItems keys. The builder-side half (omitted key → no disconnect)
    // is covered by update-boundary-zoning.test.ts. Together: controls survive.
    const edge = [{ peerId: 'b1', direction: 'OUTBOUND', justification: 'x' }];
    const { dtUpdate, spy, jsonData } = seeded({ conduits: edge, baseline: [] });

    await dtUpdate.associateConduitsWithBoundaries(jsonData);

    expect(spy).toHaveBeenCalledTimes(1);
    const data = spy.mock.calls[0][0].updatedNode.data;
    expect(data).not.toHaveProperty('controls');
    expect(data).not.toHaveProperty('dataItems');
  });
});
