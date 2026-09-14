/**
 * What a model update writes for its two link lists, and what an empty folder means.
 *
 * Both lists are asserted whole — disconnect everything, connect what was given — which is correct for a
 * caller that holds the whole list, and is the shape the settings dialog and the push path both use. The
 * hazard is not the shape, it is the entries: an entry that is not a usable id builds an operand whose
 * filter carries no condition, and a filter with no condition matches EVERY node of its label. One such
 * entry in `modules` connects the model to every module in the deployment.
 *
 * The folder half of this file pins a meaning rather than a fix. An empty folder id means the root, and
 * a model's root is the absence of a folder rather than a node to connect to — so it disconnects and
 * connects nothing. That reads as the opposite of an empty parent on the canvas, which connects to the
 * default boundary; the intent is the same in both and only the shape of the root differs.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtModel } from '../dt-model.js';

const makeModel = () => {
  const dtModel = new DtModel({} as any);
  const performMutation = vi.fn().mockResolvedValue({ updateModels: { models: [{ id: 'm1' }] } });
  (dtModel as any).dtUtils.performMutation = performMutation;
  return { dtModel, performMutation };
};

const send = async (over: Record<string, unknown> = {}) => {
  const { dtModel, performMutation } = makeModel();
  await dtModel.updateModel({
    id: 'm1', name: 'M', description: '', modules: [], controls: [], folderId: undefined, ...over,
  } as any);
  return performMutation.mock.calls[0][0].variables.input;
};

const ids = (v: any) => (v?.connect ?? []).map((o: any) => o.where.node.id.eq);

describe('DtModel.updateModel — a link list writes the entries it can name', () => {
  it('connects only the nameable modules', async () => {
    expect(ids((await send({ modules: ['mod-1', undefined, 'mod-2'] })).modules)).toEqual(['mod-1', 'mod-2']);
  });

  it('connects only the nameable controls', async () => {
    expect(ids((await send({ controls: ['ctl-1', ''] })).controls)).toEqual(['ctl-1']);
  });

  // The control for both. A filter that rejected too much would silently unassign every module a model
  // has, and the unconditional disconnect beside it means that loss is immediate.
  it('still connects a wholly valid list', async () => {
    const input = await send({ modules: ['mod-1', 'mod-2'], controls: ['ctl-1'] });
    expect(ids(input.modules)).toEqual(['mod-1', 'mod-2']);
    expect(ids(input.controls)).toEqual(['ctl-1']);
    expect(input.modules.disconnect).toEqual({});
    expect(input.controls.disconnect).toEqual({});
  });
});

describe('DtModel.updateModel — an empty folder is the root', () => {
  it('files the model under a named folder', async () => {
    const input = await send({ folderId: 'fld-1' });
    expect(input.folder.disconnect).toEqual({});
    expect(input.folder.connect.where.node.id).toEqual({ eq: 'fld-1' });
  });

  it('moves the model to the root on an empty folder id, connecting to nothing', async () => {
    const input = await send({ folderId: '' });
    expect(input.folder).toEqual({ disconnect: {} });
  });

  // The third state, which is what a caller that is not moving the model sends. It is NOT the same as
  // the empty string: one says "put it at the root", the other says nothing about the folder at all.
  it('leaves the model where it is when no folder is named', async () => {
    expect(await send({ folderId: undefined })).not.toHaveProperty('folder');
  });

  it('never builds a folder connect with no condition', async () => {
    for (const folderId of ['fld-1', '', undefined]) {
      const input = await send({ folderId });
      if (input.folder?.connect) expect(input.folder.connect.where.node.id.eq).toBeTruthy();
    }
  });

  // A folder id that is neither a usable id nor the root sentinel is junk, and unfiling the model on
  // junk would be a destructive misreading of an edit that cannot be honoured.
  it('refuses a folder id it cannot use rather than unfiling the model', async () => {
    await expect(send({ folderId: '   ' })).rejects.toThrow(/"folder"/);
  });
});
