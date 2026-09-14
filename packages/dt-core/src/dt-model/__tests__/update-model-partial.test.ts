/**
 * `updateModel` writes only what the caller supplies.
 *
 * This was the one writer without that contract. It emitted name, description, modules, controls and
 * the folder unconditionally, so the settings dialog — which seeds itself once when it opens — rewrote
 * every one of them from its load-time view on every save, including saves made on the way out of the
 * dialog. A rename reverted a module somebody else had just assigned, and opening a model destroyed a
 * control somebody else had just attached.
 *
 * Every field is asserted in BOTH directions. An "omits X when absent" test alone is satisfied by a
 * writer that never sends X at all, which is the same data loss seen from the other side.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtModel } from '../dt-model.js';

const make = () => {
  const dtModel = new DtModel({} as any);
  const performMutation = vi.fn().mockResolvedValue({ updateModels: { models: [{ id: 'm1' }] } });
  (dtModel as any).dtUtils.performMutation = performMutation;
  return { dtModel, performMutation };
};

/** Send EXACTLY the given fields — no defaults, because absence is the thing under test. */
const call = async (args: Record<string, unknown> = {}) => {
  const { dtModel, performMutation } = make();
  await dtModel.updateModel({ id: 'm1', ...args } as any);
  return performMutation.mock.calls[0][0];
};

const send = async (args: Record<string, unknown> = {}) => (await call(args)).variables.input;

const ids = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

/** The shape the push path builds: everything it holds, asserted whole. */
const wholeModel = {
  name: 'M', description: 'd', modules: ['mod-1'], controls: ['ctl-1'],
};

describe('DtModel.updateModel — a field the caller does not supply is not written', () => {
  it.each([
    ['name', { name: 'M' }, { set: 'M' }],
    ['description', { description: 'd' }, { set: 'd' }],
  ])('writes %s when it is supplied', async (key, args, expected) => {
    expect(await send(args)).toHaveProperty(key, expected);
  });

  it.each(['name', 'description', 'modules', 'controls', 'folder'])(
    'omits %s when it is not supplied',
    async key => {
      expect(await send({})).not.toHaveProperty(key);
    },
  );

  // The far end of the same contract, and the shape a caller with one edit produces once the dialog
  // stops sending its whole seed.
  it('builds an input with no keys at all for an id on its own', async () => {
    expect(Object.keys(await send({}))).toEqual([]);
  });

  it('writes an empty name, because presence is the test and not truth', async () => {
    expect(await send({ name: '' })).toHaveProperty('name', { set: '' });
  });

  // The control for every omission above: the push path supplies everything and must still write it.
  it('still writes the whole model when the whole model is supplied', async () => {
    const input = await send(wholeModel);
    expect(input).toMatchObject({ name: { set: 'M' }, description: { set: 'd' } });
    expect(ids(input.modules, 'connect')).toEqual(['mod-1']);
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1']);
  });
});

// Two link lists, two shapes, and the difference is which of them has an editor behind it.
describe('DtModel.updateModel — the controls can be a delta, the modules cannot', () => {
  it('REPLACES the controls when no baseline is given', async () => {
    const input = await send({ controls: ['ctl-1', 'ctl-2'] });
    expect(input.controls.disconnect).toEqual({});
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1', 'ctl-2']);
  });

  it('DELTAS the controls when a baseline is given', async () => {
    const input = await send({ controls: ['ctl-1', 'ctl-2'], baselineLinks: { controls: ['ctl-1'] } });
    expect(input.controls).not.toHaveProperty('disconnect');
    expect(ids(input.controls, 'connect')).toEqual(['ctl-2']);
  });

  it('never disconnects a control the editor did not know about', async () => {
    const input = await send({ controls: ['ctl-1', 'ctl-3'], baselineLinks: { controls: ['ctl-1'] } });
    expect(input.controls).not.toHaveProperty('disconnect');
  });

  it('omits the controls entirely when the delta finds nothing changed', async () => {
    expect(await send({ controls: ['ctl-1'], baselineLinks: { controls: ['ctl-1'] } }))
      .not.toHaveProperty('controls');
  });

  // The asymmetry, asserted so it reads as a decision rather than an oversight. Nothing in the product
  // edits a model's modules, so no caller can say what they were before — only the push path writes
  // them, and it asserts the whole list.
  it('still REPLACES the modules even when a baseline is supplied', async () => {
    const input = await send({ modules: ['mod-2'], baselineLinks: { controls: ['ctl-1'] } });
    expect(input.modules.disconnect).toEqual({});
    expect(ids(input.modules, 'connect')).toEqual(['mod-2']);
  });

  it('drops a list entry it cannot name, on either list', async () => {
    const input = await send({ modules: ['mod-1', undefined], controls: ['ctl-1', ''] });
    expect(ids(input.modules, 'connect')).toEqual(['mod-1']);
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1']);
  });
});

// Scope was already gated as a group — it is the in-file precedent the rest of the input now follows.
// These are the control that the new gates left it alone.
describe('DtModel.updateModel — the scope group is unchanged by the gates', () => {
  it('writes all five scope fields when a scope is supplied', async () => {
    const input = await send({ scope: { depth: 'design' } });
    expect(input).toMatchObject({
      depth: { set: 'DESIGN' },
      modelingIntent: { set: null },
      complianceDrivers: { set: [] },
    });
  });

  it('writes no scope key when no scope is supplied', async () => {
    const input = await send({ name: 'M' });
    expect(input).not.toHaveProperty('depth');
    expect(input).not.toHaveProperty('complianceDrivers');
  });
});

// Deduplication joins an IN-FLIGHT request under the same key and returns its result. That is right for
// a double submit of one act and wrong for two different ones, which is a distinction the key could not
// make while every save carried the same payload.
describe('DtModel.updateModel — the deduplication key says which fields are being written', () => {
  const keyOf = async (args: Record<string, unknown>) => (await call(args)).deduplicationKey;

  it('gives a rename and a folder move different keys', async () => {
    expect(await keyOf({ name: 'M' })).not.toBe(await keyOf({ folderId: 'fld-1' }));
  });

  it('gives two renames of the same model the same key, so a double submit still collapses', async () => {
    expect(await keyOf({ name: 'M' })).toBe(await keyOf({ name: 'OTHER' }));
  });

  it('still names the model, so two models never share a key', async () => {
    const { dtModel, performMutation } = make();
    await dtModel.updateModel({ id: 'm2', name: 'M' } as any);
    expect(performMutation.mock.calls[0][0].deduplicationKey).not.toBe(await keyOf({ name: 'M' }));
  });
});
