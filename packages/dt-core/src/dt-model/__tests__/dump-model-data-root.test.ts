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

  it('maps the root boundary\'s zone: what inherits from the root inherits what it declares', async () => {
    const dump = async (zone: string | null) => {
      const dtModel = new DtModel({} as any) as any;
      dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
        models: [{
          id: 'm1',
          name: 'M',
          description: '',
          controls: [],
          defaultBoundary: [{
            id: 'b0',
            name: 'root',
            description: '',
            zone,
            controls: [],
            dataItems: [],
            allDescendantComponents: [],
            allDescendantBoundaries: [],
            allDescendantDataFlows: [],
          }],
          dataItems: [],
        }],
      });
      return dtModel.dumpModelData({ modelId: 'm1' });
    };

    expect((await dump('VENDOR')).defaultBoundary.data.zone).toBe('VENDOR');
    expect((await dump(null)).defaultBoundary.data.zone).toBeNull();
  });

  it('maps the root boundary\'s class id: its class read can fail like any other', async () => {
    const dump = async (securityBoundaryClass: { id: string }[]) => {
      const dtModel = new DtModel({} as any) as any;
      dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
        models: [{
          id: 'm1',
          name: 'M',
          description: '',
          controls: [],
          defaultBoundary: [{
            id: 'b0',
            name: 'root',
            description: '',
            securityBoundaryClass,
            controls: [],
            dataItems: [],
            allDescendantComponents: [],
            allDescendantBoundaries: [],
            allDescendantDataFlows: [],
          }],
          dataItems: [],
        }],
      });
      return dtModel.dumpModelData({ modelId: 'm1' });
    };

    expect((await dump([{ id: 'cls' }])).defaultBoundary.data.classId).toBe('cls');
    expect((await dump([])).defaultBoundary.data.classId).toBeNull();
  });
});
