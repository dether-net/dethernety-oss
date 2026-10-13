/**
 * The attribute write on push for data items that already exist: like every other element kind, an existing data
 * item with a class gets its attributes written (even none), queued until every element is written.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const setup = () => {
  const dtUpdate = new DtUpdate({} as any) as any;
  dtUpdate.existingDataitemIds = new Set(['d1']);
  dtUpdate.dtDataitem.updateDataItem = vi.fn().mockResolvedValue({ residualOk: true });
  const write = vi.fn().mockResolvedValue({ success: true, staleFlippedCount: 0, errorMessage: null });
  dtUpdate.dtClass.setInstantiationAttributesWithStaleCount = write;
  return { dtUpdate, write };
};

describe('DtUpdate — attributes of existing data items on push', () => {
  it('queues the attribute write for an existing item with a class, and runs it with the queue', async () => {
    const { dtUpdate, write } = setup();
    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Token', classData: { id: 'cls-1' }, attributes: { scope: { broad: true } } }]);

    expect(write).not.toHaveBeenCalled();
    expect(dtUpdate.attributeWrites).toHaveLength(1);
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));
    expect(write).toHaveBeenCalledWith({ componentId: 'd1', classId: 'cls-1', attributes: { 'scope.broad': true } });
  });

  it('writes no answers as an empty set, so a class bound with none is still evaluated', async () => {
    const { dtUpdate, write } = setup();
    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Token', classData: { id: 'cls-1' } }]);
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));
    expect(write).toHaveBeenCalledWith({ componentId: 'd1', classId: 'cls-1', attributes: {} });
  });

  it('queues nothing when the class is unassigned or not given', async () => {
    const { dtUpdate } = setup();
    await dtUpdate.updateDataItems([
      { id: 'd1', name: 'Token', classData: null },
      { id: 'd1', name: 'Token' },
    ]);
    expect(dtUpdate.attributeWrites).toHaveLength(0);
  });
});
