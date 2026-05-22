/**
 * Orchestrator threading (create/import path): proves DtImport hands the
 * asset-context values to the create builders. Sub-methods are spied; private
 * methods reached via `(instance as any)`. Elements are constructed without
 * `classData` so the class-resolution branch short-circuits (no Apollo).
 */

import { describe, it, expect, vi } from 'vitest';
import { DtImport } from '../dt-import.js';

describe('DtImport — asset-context threading (create)', () => {
  it('createModel forwards scope to dtModel.createModel', async () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.dtModule.getModules = vi.fn().mockResolvedValue([]); // no module resolution noise
    const spy = vi.fn().mockResolvedValue({ id: 'm1' });
    dtImport.dtModel.createModel = spy;

    await dtImport.createModel({ name: 'M', scope: { depth: 'design' } });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].scope).toEqual({ depth: 'design' });
  });

  it('createComponent sets node.data.crownJewel for createComponentNode', async () => {
    const dtImport = new DtImport({} as any) as any;
    const spy = vi.fn().mockResolvedValue({ id: 'c1' });
    dtImport.dtComponent.createComponentNode = spy;

    await dtImport.createComponent({ id: 'c1', type: 'STORE', name: 'C', crownJewel: true }, 'b0');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].newNode.data.crownJewel).toBe(true);
  });

  it('createDataItems forwards sensitivity + regulatory_flags to createDataItem', async () => {
    const dtImport = new DtImport({} as any) as any;
    const spy = vi.fn().mockResolvedValue({ id: 'd1' });
    dtImport.dtDataitem.createDataItem = spy;

    await dtImport.createDataItems(
      [{ id: 'd1', name: 'Cardholder', sensitivity: 'restricted', regulatory_flags: ['PCI cardholder'] }],
      'm1',
      {},
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      sensitivity: 'restricted',
      regulatoryFlags: ['PCI cardholder'],
    });
  });
});
