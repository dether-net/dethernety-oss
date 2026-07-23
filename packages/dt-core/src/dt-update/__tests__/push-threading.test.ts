/**
 * Orchestrator threading (update path): proves DtUpdate actually HANDS the
 * asset-context values to the per-element builders — the gap a builder-only
 * test would miss. Sub-methods are replaced with spies; the private
 * orchestrator methods are reached via the established `(instance as any)` idiom.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

describe('DtUpdate — asset-context threading (update)', () => {
  it('updateModelProperties forwards scope to dtModel.updateModel', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    const spy = vi.fn().mockResolvedValue({ id: 'm1' });
    dtUpdate.dtModel.updateModel = spy;
    dtUpdate.currentModelId = 'm1';

    await dtUpdate.updateModelProperties(
      { name: 'M', scope: { depth: 'design' } },
      { name: 'M', modules: [], controls: [] },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].scope).toEqual({ depth: 'design' });
  });

  it('updateDataItems forwards sensitivity + regulatory_flags to updateDataItem', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    // Return a genuine success shape so the orchestrator's residualOk check counts it
    // as updated (not the error branch) — this test only asserts the forwarded args.
    const spy = vi.fn().mockResolvedValue({ dataItem: { id: 'd1' }, bindingResult: null, residualOk: true });
    dtUpdate.dtDataitem.updateDataItem = spy;
    dtUpdate.existingDataitemIds = new Set(['d1']); // route to the update branch

    await dtUpdate.updateDataItems([
      { id: 'd1', name: 'Cardholder', sensitivity: 'restricted', regulatory_flags: ['PCI cardholder'] },
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      sensitivity: 'restricted',
      regulatoryFlags: ['PCI cardholder'],
    });
  });

  it('updateComponent sets node.data.crownJewel for dtComponent.updateComponent', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    const spy = vi.fn().mockResolvedValue({ id: 'c1' });
    dtUpdate.dtComponent.updateComponent = spy;

    // classData-free component → the class-binding / attribute branch is skipped.
    await dtUpdate.updateComponent({ id: 'c1', type: 'STORE', name: 'C', crownJewel: true }, 'b0');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].updatedNode.data.crownJewel).toBe(true);
  });
});
