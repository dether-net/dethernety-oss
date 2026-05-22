/**
 * Data-item asset-context push input-builder shapes (spy on `performMutation`).
 *
 * Update path = REPLACE: the full-sync push always overwrites sensitivity
 * + regulatoryFlags ({ set: ... }, never { push }); absent values clear the
 * platform field. Sensitivity is validated/uppercased; an unknown value drops
 * to null with a warning. Create path = present-only. Calls omit `classId` so
 * the class-binding branch (DtClass) is skipped and only the residual fires.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtDataItem } from '../dt-dataitem.js';

const makeDataItem = () => {
  const dtDataitem = new DtDataItem({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'd1' });
  (dtDataitem as any).dtUtils.performMutation = performMutation;
  return { dtDataitem, performMutation };
};

describe('DtDataItem.updateDataItem — sensitivity / regulatoryFlags REPLACE', () => {
  it('sets { set: ... } for present values (replace, not append)', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({
      dataItemId: 'd1', name: 'Cardholder', description: '',
      sensitivity: 'restricted', regulatoryFlags: ['PCI cardholder'],
    });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      sensitivity: { set: 'RESTRICTED' },
      regulatoryFlags: { set: ['PCI cardholder'] },
    });
  });

  it('clears to { set: null } / { set: [] } when absent (replace)', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', name: 'D', description: '' });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      sensitivity: { set: null },
      regulatoryFlags: { set: [] },
    });
  });

  it('drops an unknown sensitivity to null with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', name: 'D', description: '', sensitivity: 'bogus' });
    expect(performMutation.mock.calls[0][0].variables.input.sensitivity).toEqual({ set: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DtDataItem.createDataItem — present-only', () => {
  it('sets sensitivity + regulatoryFlags on the create input when present', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'Cardholder', description: '', elementId: 'b0', classId: null, modelId: 'm1',
      sensitivity: 'restricted', regulatoryFlags: ['PCI cardholder'],
    });
    expect(performMutation.mock.calls[0][0].variables.input[0]).toMatchObject({
      sensitivity: 'RESTRICTED',
      regulatoryFlags: ['PCI cardholder'],
    });
  });

  it('omits both when absent', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'D', description: '', elementId: 'b0', classId: null, modelId: 'm1',
    });
    const input = performMutation.mock.calls[0][0].variables.input[0];
    expect(input).not.toHaveProperty('sensitivity');
    expect(input).not.toHaveProperty('regulatoryFlags');
  });
});
