/**
 * Trustworthy update-orchestration error channel. Regression guards for the six
 * P1s: the Step-3 revert (single-writer merge), control-catalog outage preserve, failed
 * data-item / create counted as success, hard failures downgraded to warnings, and the
 * no-JSON-id boundary dropping its subtree. Private methods reached via `(instance as any)`,
 * sub-clients replaced with spies (no Apollo).
 */

import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const freshStats = () => ({ created: 0, updated: 0, deleted: 0 });

const seed = (dtUpdate: any) => {
  dtUpdate.currentModelId = 'm1';
  dtUpdate.idMapping = new Map();
  dtUpdate.errors = [];
  dtUpdate.warnings = [];
  dtUpdate.stats = freshStats();
};

describe('DtUpdate — single model-property writer (no Step-3 revert)', () => {
  it('writes NEW name/description/controls/modules in ONE call, never re-sends existingModel', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const modelSpy = vi.fn().mockResolvedValue({ id: 'm1' });
    dtUpdate.dtModel.updateModel = modelSpy;
    dtUpdate.dtModule.getModuleById = vi.fn().mockResolvedValue({ id: 'mod1' });
    dtUpdate.dtControl.getControls = vi.fn().mockResolvedValue([{ id: 'c1', name: 'C1' }]);

    const existingModel = {
      name: 'OLD', description: 'OLDDESC',
      modules: [{ id: 'oldMod' }], controls: [{ id: 'oldCtl' }],
      folder: { id: 'f1' },
    };
    await dtUpdate.updateModelProperties(
      { name: 'NEW', description: 'NEWDESC', modules: [{ id: 'mod1' }], controls: [{ id: 'c1' }] },
      existingModel,
    );

    expect(modelSpy).toHaveBeenCalledTimes(1); // one write, not two — the revert is gone
    expect(modelSpy.mock.calls[0][0]).toMatchObject({
      name: 'NEW', description: 'NEWDESC',
      modules: ['mod1'], controls: ['c1'],
      folderId: 'f1', // current folder preserved, not undefined
    });
    expect(dtUpdate.stats.updated).toBe(1);
  });

  it('preserves existing modules when the JSON has no modules key (no dtModule call)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtModel.updateModel = vi.fn().mockResolvedValue({ id: 'm1' });
    const getModules = vi.fn();
    const getModuleById = vi.fn();
    dtUpdate.dtModule.getModules = getModules;
    dtUpdate.dtModule.getModuleById = getModuleById;

    await dtUpdate.updateModelProperties(
      { name: 'NEW' },
      { name: 'OLD', modules: [{ id: 'oldMod' }], controls: [] },
    );

    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].modules).toEqual(['oldMod']);
    expect(getModules).not.toHaveBeenCalled();
    expect(getModuleById).not.toHaveBeenCalled();
  });

  it('preserves existing modules when a present module list resolves to nothing', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtModel.updateModel = vi.fn().mockResolvedValue({ id: 'm1' });
    dtUpdate.dtModule.getModuleById = vi.fn().mockResolvedValue(null);
    dtUpdate.dtModule.getModules = vi.fn().mockResolvedValue([]);

    await dtUpdate.updateModelProperties(
      { modules: [{ id: 'ghost' }] },
      { name: 'OLD', modules: [{ id: 'oldMod' }], controls: [] },
    );

    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].modules).toEqual(['oldMod']);
    expect(dtUpdate.warnings.some((w: string) => w.includes('Module not found'))).toBe(true);
  });
});

describe('DtUpdate — control-catalog outage preserves (does not wipe)', () => {
  it('model path: both getControls reject → preserve existing controls + surface an error', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtModel.updateModel = vi.fn().mockResolvedValue({ id: 'm1' });
    dtUpdate.dtControl.getControls = vi.fn().mockRejectedValue(new Error('catalog down'));

    await dtUpdate.updateModelProperties(
      { controls: [{ id: 'c1' }] },
      { name: 'M', modules: [], controls: [{ id: 'oldCtl' }] },
    );

    // Not [] (wiped) — the existing controls are preserved.
    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].controls).toEqual(['oldCtl']);
    expect(dtUpdate.errors.some((e: any) => e.step === 'resolve_controls')).toBe(true);
  });

  it('element path: outage leaves the controls key UNSET (builder omits ⇒ preserve)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.dtControl.getControls = vi.fn().mockRejectedValue(new Error('catalog down'));
    const boundarySpy = vi.fn().mockResolvedValue({ id: 'b0' });
    dtUpdate.dtBoundary.updateBoundaryNode = boundarySpy;

    await dtUpdate.updateDefaultBoundary({ name: 'Root', controls: [{ id: 'c1' }] });

    expect(boundarySpy).toHaveBeenCalledTimes(1);
    expect(boundarySpy.mock.calls[0][0].updatedNode.data).not.toHaveProperty('controls');
    expect(dtUpdate.errors.some((e: any) => e.step === 'resolve_controls')).toBe(true);
  });

  it("HALF-outage (only the 'all' fetch fails) also preserves — folder-scoped controls must not wipe", async () => {
    // The no-folder fetch returning fine is NOT a complete catalog: folder-scoped
    // controls only come back from folderId:'all'. Pre-fix, the outage flag required
    // BOTH fetches to fail, so this half-outage resolved every folder-scoped control
    // to nothing and REPLACE-wiped it with success:true + warnings.
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtModel.updateModel = vi.fn().mockResolvedValue({ id: 'm1' });
    dtUpdate.dtControl.getControls = vi.fn().mockImplementation(async ({ folderId }: any) => {
      if (folderId === 'all') throw new Error('catalog down');
      return [{ id: 'noFolderCtl', name: 'NF' }];
    });

    await dtUpdate.updateModelProperties(
      { controls: [{ id: 'folderCtl' }] },
      { name: 'M', modules: [], controls: [{ id: 'folderCtl' }] },
    );

    // Preserved, not wiped to [] against the incomplete catalog.
    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].controls).toEqual(['folderCtl']);
    expect(dtUpdate.errors.some((e: any) => e.step === 'resolve_controls')).toBe(true);
  });

  it('explicit [] still CLEARS during an outage (short-circuits before the catalog probe)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    const getControls = vi.fn().mockRejectedValue(new Error('catalog down'));
    dtUpdate.dtControl.getControls = getControls;
    dtUpdate.dtModel.updateModel = vi.fn().mockResolvedValue({ id: 'm1' });

    await dtUpdate.updateModelProperties(
      { controls: [] }, // explicit clear
      { name: 'M', modules: [], controls: [{ id: 'oldCtl' }] },
    );

    // [] returns [] before any catalog fetch — the clear is honoured, catalog never probed.
    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].controls).toEqual([]);
    expect(getControls).not.toHaveBeenCalled();
    expect(dtUpdate.errors.length).toBe(0);
  });
});

describe('DtUpdate — failed data-item update/create is not counted as success', () => {
  const seedDataitems = (dtUpdate: any, existing: string[]) => {
    seed(dtUpdate);
    dtUpdate.existingDataitemIds = new Set(existing);
    dtUpdate.processedDataitemIds = new Set();
    dtUpdate.defaultBoundaryId = 'b0';
  };

  it('residualOk:false → error, no stats.updated, but still marked processed (not orphaned)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seedDataitems(dtUpdate, ['d1']);
    dtUpdate.dtDataitem.updateDataItem = vi.fn().mockResolvedValue({
      dataItem: null, bindingResult: { errorCode: 'BIND_FAIL' }, residualOk: false,
    });

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'DI' }]);

    expect(dtUpdate.stats.updated).toBe(0);
    expect(dtUpdate.errors.some((e: any) => e.step === 'update_data_items')).toBe(true);
    expect(dtUpdate.processedDataitemIds.has('d1')).toBe(true); // not an orphan-delete target
  });

  it('residualOk:true → counted as updated, no error', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seedDataitems(dtUpdate, ['d1']);
    dtUpdate.dtDataitem.updateDataItem = vi.fn().mockResolvedValue({
      dataItem: { id: 'd1' }, bindingResult: null, residualOk: true,
    });

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'DI' }]);

    expect(dtUpdate.stats.updated).toBe(1);
    expect(dtUpdate.errors.length).toBe(0);
  });

  it('create returning null → error, not silently ignored', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seedDataitems(dtUpdate, []); // route to create branch
    dtUpdate.dtDataitem.createDataItem = vi.fn().mockResolvedValue(null);

    await dtUpdate.updateDataItems([{ id: 'd2', name: 'NEW' }]);

    expect(dtUpdate.stats.created).toBe(0);
    expect(dtUpdate.errors.some((e: any) => e.step === 'update_data_items')).toBe(true);
  });
});

describe('DtUpdate — hard failures route to errors (success reflects them)', () => {
  it('default-boundary write throw → error (was a swallowed warning)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.dtBoundary.updateBoundaryNode = vi.fn().mockRejectedValue(new Error('boom'));

    await dtUpdate.updateDefaultBoundary({ name: 'Root' });

    expect(dtUpdate.errors.some((e: any) => e.step === 'update_default_boundary')).toBe(true);
    expect(dtUpdate.warnings.length).toBe(0);
  });

  it('conduit reconcile throw → error', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.idMapping = new Map([['b1', 'b1']]);
    dtUpdate.existingBoundaryIds = new Set(['b0', 'b1']);
    dtUpdate.processedBoundaryIds = new Set(['b0', 'b1']);
    dtUpdate.existingConduitsByBoundary = new Map();
    dtUpdate.dtBoundary.updateBoundaryNode = vi.fn().mockRejectedValue(new Error('conduit boom'));

    await dtUpdate.writeConduitsForBoundary(
      { name: 'B', conduits: [{ peerId: 'b1', direction: 'OUTBOUND', justification: 'x' }] },
      'b0',
    );

    expect(dtUpdate.errors.some((e: any) => e.step === 'associate_conduits')).toBe(true);
  });

  it('setElementAttributes failure → error', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtClass.setInstantiationAttributes = vi.fn().mockResolvedValue(false);

    await dtUpdate.setElementAttributes('el1', 'cls1', { risk: 'high' }, 'Elem');

    expect(dtUpdate.errors.some((e: any) => e.step === 'set_element_attributes')).toBe(true);
  });

  it('model-property write throw → error (not a swallowed warning)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.dtModel.updateModel = vi.fn().mockRejectedValue(new Error('write boom'));

    await dtUpdate.updateModelProperties({ name: 'M' }, { name: 'M', modules: [], controls: [] });

    expect(dtUpdate.errors.some((e: any) => e.step === 'update_model_properties')).toBe(true);
    expect(dtUpdate.stats.updated).toBe(0);
    expect(dtUpdate.warnings.length).toBe(0);
  });

  it('default-boundary class-bind throw → error', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.dtBoundary.updateBoundaryNode = vi.fn().mockResolvedValue({ id: 'b0' });
    dtUpdate.dtClass.changeElementBinding = vi.fn().mockRejectedValue(new Error('bind boom'));

    await dtUpdate.updateDefaultBoundary({ name: 'Root', classData: { id: 'cls1' } });

    expect(dtUpdate.errors.some((e: any) => e.step === 'update_default_boundary_class')).toBe(true);
  });
});

describe('DtUpdate — a new boundary with no JSON id still parents its subtree', () => {
  it('re-parents children to created.id and never pollutes idMapping with an empty key', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.existingBoundaryIds = new Set(); // route to create
    dtUpdate.processedBoundaryIds = new Set();
    dtUpdate.createBoundary = vi.fn().mockResolvedValue({ id: 'B_SERVER' });
    const componentsSpy = vi.fn().mockResolvedValue(undefined);
    dtUpdate.updateComponents = componentsSpy;

    await dtUpdate.updateBoundariesRecursive(
      [{ name: 'NoId', components: [{ id: 'c1', type: 'STORE', name: 'C' }] }],
      'b0',
    );

    expect(componentsSpy).toHaveBeenCalledTimes(1);
    expect(componentsSpy.mock.calls[0][1]).toBe('B_SERVER'); // children parented to created id, not dropped
    expect(dtUpdate.idMapping.has('')).toBe(false);
  });
});

describe('DtUpdate — nested creates are parented to their ACTUAL parent, not the root', () => {
  // createComponentNode/createBoundaryNode only honour an ARRAY-shaped parentNode;
  // DtUpdate builds a string-shaped one, so the parent must ride in via the
  // defaultBoundaryId argument (the DtImport pattern). Pre-fix these sites passed
  // this.defaultBoundaryId — every nested create landed under the model ROOT and
  // the follow-up write only healed elements that happened to carry controls/dataItems.
  it('createComponent passes the nested parent boundary id into createComponentNode', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'root-b0';
    const spy = vi.fn().mockResolvedValue({ id: 'newC' });
    dtUpdate.dtComponent.createComponentNode = spy;

    await dtUpdate.createComponent({ name: 'C', type: 'PROCESS' }, 'nested-b1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].defaultBoundaryId).toBe('nested-b1');
  });

  it('createBoundary passes the nested parent boundary id into createBoundaryNode', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'root-b0';
    const spy = vi.fn().mockResolvedValue({ id: 'newB' });
    dtUpdate.dtBoundary.createBoundaryNode = spy;

    await dtUpdate.createBoundary({ name: 'B' }, 'nested-b1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].defaultBoundaryId).toBe('nested-b1');
  });

  it('falls back to the model root when no parent is supplied (top-level create)', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    seed(dtUpdate);
    dtUpdate.defaultBoundaryId = 'root-b0';
    const spy = vi.fn().mockResolvedValue({ id: 'newC' });
    dtUpdate.dtComponent.createComponentNode = spy;

    await dtUpdate.createComponent({ name: 'C', type: 'PROCESS' }, '');

    expect(spy.mock.calls[0][0].defaultBoundaryId).toBe('root-b0');
  });
});
