/**
 * Explicit-null classData unassign on the update write path: proves each element
 * updater fires a `kind: NONE` rebind for `classData: null`, skips the binding
 * entirely for absent classData (regression: silent no-op is the contract for
 * hand-trimmed inputs), and still binds CLASS for a real id. Sub-methods are
 * spied; private orchestrator methods reached via `(instance as any)`; no Apollo.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const make = () => {
  const dtUpdate = new DtUpdate({} as any) as any;
  dtUpdate.idMapping = new Map();
  const binding = vi.fn().mockResolvedValue({ success: true });
  dtUpdate.dtClass.changeElementBinding = binding;
  dtUpdate.dtBoundary.updateBoundaryNode = vi.fn().mockResolvedValue({ id: 'x' });
  dtUpdate.dtComponent.updateComponent = vi.fn().mockResolvedValue({ id: 'x' });
  dtUpdate.dtDataflow.updateDataFlow = vi.fn().mockResolvedValue({ id: 'x' });
  return { dtUpdate, binding };
};

describe('DtUpdate — explicit-null classData unassign', () => {
  it('updateComponent: classData null → NONE rebind', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateComponent({ id: 'c1', name: 'C', type: 'PROCESS', classData: null }, 'b0');
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith({ elementId: 'c1', target: { kind: 'NONE' } });
  });

  it('updateComponent: absent classData → no binding call (regression)', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateComponent({ id: 'c1', name: 'C', type: 'PROCESS' }, 'b0');
    expect(binding).not.toHaveBeenCalled();
  });

  it('updateComponent: classData id → CLASS rebind (regression)', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateComponent(
      { id: 'c1', name: 'C', type: 'PROCESS', classData: { id: 'k1', name: 'K' } },
      'b0',
    );
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith({ elementId: 'c1', target: { kind: 'CLASS', classIds: ['k1'] } });
  });

  it('updateBoundary: classData null → NONE rebind', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateBoundary({ id: 'b1', name: 'DMZ', classData: null }, 'b0');
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith({ elementId: 'b1', target: { kind: 'NONE' } });
  });

  it('updateBoundary: absent classData → no binding call (regression)', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateBoundary({ id: 'b1', name: 'DMZ' }, 'b0');
    expect(binding).not.toHaveBeenCalled();
  });

  it('updateDefaultBoundary: classData null → NONE rebind', async () => {
    const { dtUpdate, binding } = make();
    dtUpdate.defaultBoundaryId = 'b0'; // required, else the method early-returns
    await dtUpdate.updateDefaultBoundary({ name: 'Root', classData: null });
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith({ elementId: 'b0', target: { kind: 'NONE' } });
  });

  it('updateDataFlow: classData null → NONE rebind', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateDataFlow({ id: 'f1', name: 'flow', classData: null }, 's1', 't1');
    expect(binding).toHaveBeenCalledTimes(1);
    expect(binding).toHaveBeenCalledWith({ elementId: 'f1', target: { kind: 'NONE' } });
  });

  it('updateDataFlow: absent classData → no binding call (regression)', async () => {
    const { dtUpdate, binding } = make();
    await dtUpdate.updateDataFlow({ id: 'f1', name: 'flow' }, 's1', 't1');
    expect(binding).not.toHaveBeenCalled();
  });

  it('updateDataItems: classData null reaches updateDataItem as classId null (NONE path)', async () => {
    const { dtUpdate } = make();
    dtUpdate.existingDataitemIds = new Set(['d1']);
    const spy = vi.fn().mockResolvedValue({ dataItem: { id: 'd1' }, bindingResult: null, residualOk: true });
    dtUpdate.dtDataitem.updateDataItem = spy;

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'PII', classData: null }]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].classId).toBeNull();
  });

  it('updateDataItems: absent classData stays undefined (no binding attempt — regression)', async () => {
    const { dtUpdate } = make();
    dtUpdate.existingDataitemIds = new Set(['d1']);
    const spy = vi.fn().mockResolvedValue({ dataItem: { id: 'd1' }, bindingResult: null, residualOk: true });
    dtUpdate.dtDataitem.updateDataItem = spy;

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'PII' }]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].classId).toBeUndefined();
  });
});
