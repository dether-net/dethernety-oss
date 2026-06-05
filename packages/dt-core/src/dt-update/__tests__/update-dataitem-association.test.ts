/**
 * Orchestrator threading (update path): proves DtUpdate HANDS each element's
 * `dataItemIds` to the per-element builders as `data.dataItems`, so data-item↔
 * element links survive an `update_model` re-sync (previously dropped — the
 * builders received no dataItems, which the mutations REPLACE-sync away).
 *
 * Mirrors push-threading.test.ts: sub-methods are spied; private orchestrator
 * methods are reached via the `(instance as any)` idiom. `idMapping` is seeded
 * to prove ids are remapped (new items → server ids) before linking.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const seed = (dtUpdate: any) => {
  dtUpdate.idMapping = new Map([['d1', 'D1'], ['d2', 'D2']]);
};

describe('DtUpdate — data-item association threading (update)', () => {
  it('updateComponent threads mapped dataItemIds into node.data.dataItems', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const spy = vi.fn().mockResolvedValue({ id: 'c1' });
    dtUpdate.dtComponent.updateComponent = spy;

    await dtUpdate.updateComponent({ id: 'c1', type: 'STORE', name: 'C', dataItemIds: ['d1', 'd2'] }, 'b0');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D1', 'D2']);
  });

  it('updateComponent omits data.dataItems when no dataItemIds (clean disconnect-all path)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const spy = vi.fn().mockResolvedValue({ id: 'c1' });
    dtUpdate.dtComponent.updateComponent = spy;

    await dtUpdate.updateComponent({ id: 'c1', type: 'STORE', name: 'C' }, 'b0');

    expect(spy.mock.calls[0][0].updatedNode.data).not.toHaveProperty('dataItems');
  });

  it('updateDataFlow threads mapped dataItemIds into edge.data.dataItems', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const spy = vi.fn().mockResolvedValue({ id: 'f1' });
    dtUpdate.dtDataflow.updateDataFlow = spy;

    await dtUpdate.updateDataFlow(
      { id: 'f1', name: 'F', source: { id: 's' }, target: { id: 't' }, dataItemIds: ['d1'] },
      's', 't',
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].edge.data.dataItems).toEqual(['D1']);
  });

  it('updateBoundary threads mapped dataItemIds into node.data.dataItems', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const spy = vi.fn().mockResolvedValue({ id: 'b1' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;

    await dtUpdate.updateBoundary({ id: 'b1', name: 'B', dataItemIds: ['d2'] }, 'b0');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D2']);
  });

  it('updateDefaultBoundary threads mapped dataItemIds into node.data.dataItems', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0'; // required, else the method early-returns
    const spy = vi.fn().mockResolvedValue({ id: 'b0' });
    dtUpdate.dtBoundary.updateBoundaryNode = spy;

    await dtUpdate.updateDefaultBoundary({ name: 'Root', dataItemIds: ['d1'] });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D1']);
  });
});

describe('DtUpdate — data-item association threading (create follow-ups)', () => {
  it('createComponent follow-up carries dataItems even when no controls', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtComponent.createComponentNode = vi.fn().mockResolvedValue({ id: 'C1' });
    const updateSpy = vi.fn().mockResolvedValue({ id: 'C1' });
    dtUpdate.dtComponent.updateComponent = updateSpy;

    await dtUpdate.createComponent({ id: 'c1', type: 'STORE', name: 'C', dataItemIds: ['d1'] }, 'b0');

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D1']);
    expect(updateSpy.mock.calls[0][0].updatedNode.data).not.toHaveProperty('controls');
  });

  it('createDataFlow follow-up carries dataItems even when no controls', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtDataflow.createDataFlow = vi.fn().mockResolvedValue({ id: 'F1' });
    const updateSpy = vi.fn().mockResolvedValue({ id: 'F1' });
    dtUpdate.dtDataflow.updateDataFlow = updateSpy;

    await dtUpdate.createDataFlow(
      { id: 'f1', name: 'F', source: { id: 's' }, target: { id: 't' }, dataItemIds: ['d2'] },
      's', 't',
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].edge.data.dataItems).toEqual(['D2']);
  });

  it('createBoundary follow-up carries dataItems even when no controls', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtBoundary.createBoundaryNode = vi.fn().mockResolvedValue({ id: 'B1' });
    const updateSpy = vi.fn().mockResolvedValue({ id: 'B1' });
    dtUpdate.dtBoundary.updateBoundaryNode = updateSpy;

    await dtUpdate.createBoundary({ id: 'b1', name: 'B', dataItemIds: ['d1'] }, 'b0');

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].updatedNode.data.dataItems).toEqual(['D1']);
  });
});
