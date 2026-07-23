/**
 * dumpModelData maps the ROOT default boundary's own
 * controls and dataItems. Previously the root boundary read the stale `.data` field
 * (never produced) and its controls weren't selected, so both were dropped on the
 * UI load path.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtModel } from '../dt-model.js';

describe('DtModel.dumpModelData — root default-boundary controls + dataItems', () => {
  it('maps rootBoundary.controls and rootBoundary.dataItems onto defaultBoundary.data', async () => {
    const dtModel = new DtModel({} as any) as any;
    dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
      models: [{
        id: 'm1',
        name: 'M',
        description: '',
        controls: [{ id: 'mc1' }],
        defaultBoundary: [{
          id: 'b0',
          name: 'root',
          description: '',
          controls: [{ id: 'rc1' }],
          dataItems: [{ id: 'rd1' }],
          allDescendantComponents: [],
          allDescendantBoundaries: [],
          allDescendantDataFlows: [],
        }],
        dataItems: [],
      }],
    });

    const result = await dtModel.dumpModelData({ modelId: 'm1' });

    expect(result.defaultBoundary.data.controls).toEqual(['rc1']);
    expect(result.defaultBoundary.data.dataItems).toEqual(['rd1']); // was rootBoundary.data (undefined)
  });
});
