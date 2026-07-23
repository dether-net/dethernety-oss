/**
 * Export / round-trip data-loss guards.
 *  - enrichBoundary / enrichDataFlow read `.dataItems` (not the stale
 *    `.data`), so boundary/dataflow dataItemIds actually survive export.
 *  - DUMP_MODEL_DATA's ROOT defaultBoundary selection includes
 *    controls + dataItems.
 *  - model-level controls round-trip through the split transport
 *    (monolithicToSplit → splitToMonolithic), createModel connects them at create
 *    time, and import forwards resolved model controls to createModel.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtExport } from '../dt-export.js';
import { DtExportSplit } from '../dt-export-split.js';
import type { ExportedModel } from '../dt-export.js';
import { DtModel } from '../../dt-model/dt-model.js';
import { DtImport } from '../../dt-import/dt-import.js';
import { DUMP_MODEL_DATA } from '../../dt-model/dt-model-gql.js';
import { splitToMonolithic, monolithicToSplit } from '../../schemas/model.schema.js';

describe('dataItemIds survive export (.dataItems, not .data)', () => {
  const exporter = () => {
    const dt = new DtExport({} as any) as any;
    // No class / no represented-model → the enrich mappers skip those branches.
    dt.dtClass.getBoundaryClass = vi.fn().mockResolvedValue(null);
    dt.dtClass.getDataFlowClass = vi.fn().mockResolvedValue(null);
    dt.dtBoundary.getBoundaryRepresentedModel = vi.fn().mockResolvedValue(null);
    return dt;
  };
  const allDataItems = [{ id: 'd1' }, { id: 'd2' }];

  it('enrichBoundary emits dataItemIds from a .dataItems-bearing boundary', async () => {
    const dt = exporter();
    const result = await dt.enrichBoundary(
      { id: 'b1', name: 'B', dataItems: [{ id: 'd1' }, { id: 'd2' }] },
      [], [], allDataItems,
    );
    expect(result.dataItemIds).toEqual(['d1', 'd2']);
  });

  it('enrichDataFlow emits dataItemIds from a .dataItems-bearing flow', async () => {
    const dt = exporter();
    const result = await dt.enrichDataFlow(
      { id: 'f1', name: 'F', dataItems: [{ id: 'd2' }] },
      allDataItems,
    );
    expect(result.dataItemIds).toEqual(['d2']);
  });
});

describe('DUMP_MODEL_DATA root defaultBoundary selects controls + dataItems', () => {
  it('the root boundary block (before conduits) selects controls and dataItems', () => {
    const q = DUMP_MODEL_DATA.loc?.source.body ?? '';
    // The root defaultBoundary's own scalar/relationship fields sit between
    // `defaultBoundary {` and its first `outboundConduitsConnection`.
    const rootBlock = q.slice(q.indexOf('defaultBoundary {'), q.indexOf('outboundConduitsConnection'));
    expect(rootBlock).toContain('controls');
    expect(rootBlock).toContain('dataItems');
  });
});

describe('model-level controls round-trip', () => {
  const convert = (m: ExportedModel) =>
    (new DtExportSplit({} as any) as any).monolithicToSplit(m);

  it('monolithicToSplit emits manifest.model.controls; splitToMonolithic carries them back', () => {
    const model: ExportedModel = {
      id: 'm1', name: 'M', description: '',
      controls: [{ id: 'ctl1', name: 'C1' }] as any,
      defaultBoundary: { id: 'b0', name: 'root', description: '' },
    };
    const split = convert(model);
    expect(split.manifest.model.controls).toEqual([{ id: 'ctl1', name: 'C1' }]);
    const mono = splitToMonolithic(split);
    expect(mono.controls).toEqual([{ id: 'ctl1', name: 'C1' }]);
  });

  it('the standalone monolithicToSplit/splitToMonolithic pair also round-trips model controls (symmetry)', () => {
    const mono: any = {
      id: 'm1', name: 'M',
      controls: [{ id: 'ctl1', name: 'C1' }],
      defaultBoundary: { id: 'b0', name: 'root' },
    };
    const split = monolithicToSplit(mono);
    expect(split.manifest.model.controls).toEqual([{ id: 'ctl1', name: 'C1' }]);
    expect(splitToMonolithic(split).controls).toEqual([{ id: 'ctl1', name: 'C1' }]);
  });

  it('no model controls → manifest.model.controls is omitted', () => {
    const split = convert({ id: 'm1', name: 'M', description: '', defaultBoundary: { id: 'b0', name: 'root', description: '' } });
    expect(split.manifest.model.controls).toBeUndefined();
  });

  it('createModel connects model controls at create time (create-only, no disconnect)', async () => {
    const dtModel = new DtModel({} as any) as any;
    dtModel.dtUtils.performMutation = vi.fn().mockResolvedValue({ createModels: { models: [{ id: 'm1' }] } });

    await dtModel.createModel({ name: 'M', description: '', modules: [], folderId: undefined, controls: ['ctl1', 'ctl2'] });

    const input = dtModel.dtUtils.performMutation.mock.calls[0][0].variables.input[0];
    expect(input.controls.connect).toEqual([
      { where: { node: { id: { eq: 'ctl1' } } } },
      { where: { node: { id: { eq: 'ctl2' } } } },
    ]);
    expect(input.controls.disconnect).toBeUndefined(); // create-only: never clears
  });

  it('createModel omits controls when none are given', async () => {
    const dtModel = new DtModel({} as any) as any;
    dtModel.dtUtils.performMutation = vi.fn().mockResolvedValue({ createModels: { models: [{ id: 'm1' }] } });

    await dtModel.createModel({ name: 'M', description: '', modules: [], folderId: undefined });

    const input = dtModel.dtUtils.performMutation.mock.calls[0][0].variables.input[0];
    expect(input.controls).toBeUndefined();
  });

  it('import resolves jsonData.controls and forwards them to createModel', async () => {
    const dtImport = new DtImport({} as any) as any;
    dtImport.resolveModuleIds = vi.fn().mockResolvedValue(['mod1']);
    dtImport.resolveControls = vi.fn().mockResolvedValue(['CTL1']);
    const createSpy = vi.fn().mockResolvedValue({ id: 'm1' });
    dtImport.dtModel.createModel = createSpy;

    await dtImport.createModel({ name: 'M', description: '', controls: [{ id: 'ctl1', name: 'C1' }] });

    expect(dtImport.resolveControls).toHaveBeenCalledWith([{ id: 'ctl1', name: 'C1' }]);
    expect(createSpy.mock.calls[0][0].controls).toEqual(['CTL1']);
  });
});
