/**
 * `updateComponent` writes only what the node defines.
 *
 * The contract these pin is one sentence: a field the node does not define is not written. It already
 * held for crownJewel, controls and dataItems; these cover the rest of the input, so that a caller can
 * hand over just the field the user edited instead of the component as it last loaded it.
 *
 * Each field is asserted in BOTH directions. An "omits X when absent" test alone is satisfied by a
 * writer that never sends X at all, which would be the same silent data loss from the other side.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtComponent } from '../dt-component.js';

const make = () => {
  const dtComponent = new DtComponent({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'c1' });
  (dtComponent as any).dtUtils.performMutation = performMutation;
  return { dtComponent, performMutation };
};

const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input;

const send = async (updatedNode: Record<string, unknown>, baselineLinks?: any) => {
  const { dtComponent, performMutation } = make();
  await dtComponent.updateComponent({ updatedNode: updatedNode as any, defaultBoundaryId: 'b0', baselineLinks });
  return inputOf(performMutation);
};

/** The shape dt-import and dt-update build: complete but for the associations they mean to omit. */
const wholeNode = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'STORE',
  position: { x: 3, y: 4 },
  parentNode: 'b1',
  data: { label: 'C', description: 'd', ...(over.data as object ?? {}) },
  ...over,
});

describe('DtComponent.updateComponent — a field the node does not define is not written', () => {
  it.each([
    ['name', { data: { label: 'C' } }, { set: 'C' }],
    ['description', { data: { description: 'd' } }, { set: 'd' }],
    ['type', { type: 'STORE' }, { set: 'STORE' }],
  ])('writes %s when the node defines it', async (key, node, expected) => {
    expect(await send({ id: 'c1', ...node })).toHaveProperty(key, expected);
  });

  it.each(['name', 'description', 'type', 'positionX', 'positionY', 'parentBoundary'])(
    'omits %s when the node does not define it',
    async (key) => {
      // A node defining nothing but its id — the far end of the same contract, and the shape a
      // caller sending a single edit produces.
      expect(await send({ id: 'c1' })).not.toHaveProperty(key);
    },
  );

  it('writes an empty description, because presence is the test and not truth', async () => {
    expect(await send({ id: 'c1', data: { description: '' } })).toHaveProperty('description', { set: '' });
  });
});

describe('DtComponent.updateComponent — position is one edit, gated whole', () => {
  it('writes both axes when the node defines a position', async () => {
    const input = await send({ id: 'c1', position: { x: 3, y: 4 } });
    expect(input).toMatchObject({ positionX: { set: 3 }, positionY: { set: 4 } });
  });

  it('does not throw on a node with no position at all', async () => {
    // The guard is what keeps `.x` from being read: a writer that reads the axes first and gates
    // afterwards throws here, which is the failure this shape exists to prevent.
    await expect(send({ id: 'c1', data: { label: 'C' } })).resolves.toBeDefined();
  });

  it('writes a zero origin rather than dropping it', async () => {
    expect(await send({ id: 'c1', position: { x: 0, y: 0 } })).toMatchObject({
      positionX: { set: 0 }, positionY: { set: 0 },
    });
  });
});

// The load-bearing one. `connect` filters on an `eq` built from parentNode; an undefined one is a
// filter with NO condition, which matches every boundary — and the disconnect beside it has already
// run. So the absent case is not "writes the wrong parent", it is "detaches from its own boundary and
// attaches to all of them".
describe('DtComponent.updateComponent — the parent is never connected by an empty filter', () => {
  it('omits parentBoundary entirely when the node does not name a parent', async () => {
    expect(await send({ id: 'c1', data: { description: 'edited' } })).not.toHaveProperty('parentBoundary');
  });

  it('connects the named parent when the node names one', async () => {
    const input = await send({ id: 'c1', parentNode: 'b1' });
    expect(input.parentBoundary.connect.where.node.id).toEqual({ eq: 'b1' });
  });

  it('relocates to the default boundary on an empty string, which is a real edit and not an absence', async () => {
    const input = await send({ id: 'c1', parentNode: '' });
    expect(input.parentBoundary.connect.where.node.id).toEqual({ eq: 'b0' });
  });

  it('never builds a connect filter with no condition', async () => {
    for (const node of [{ id: 'c1' }, { id: 'c1', parentNode: 'b1' }, { id: 'c1', parentNode: '' }]) {
      const input = await send(node);
      if (input.parentBoundary) {
        expect(input.parentBoundary.connect.where.node.id.eq).toBeDefined();
      }
    }
  });
});

// The control for every "omits when absent" above: the complete node the import and update passes
// build must still write every field. Without this, a gate that fired for those callers would be
// invisible — and that is how an association pass would start clearing names.
describe('DtComponent.updateComponent — a whole node still writes the whole component', () => {
  it('writes every field the programmatic passes rely on', async () => {
    expect(await send(wholeNode())).toMatchObject({
      name: { set: 'C' },
      description: { set: 'd' },
      type: { set: 'STORE' },
      positionX: { set: 3 },
      positionY: { set: 4 },
    });
  });

  it('still connects the parent, and still omits the associations such a pass leaves out', async () => {
    const input = await send(wholeNode());
    expect(input.parentBoundary.connect.where.node.id).toEqual({ eq: 'b1' });
    expect(input).not.toHaveProperty('controls');
    expect(input).not.toHaveProperty('dataItems');
  });

  it('carries the associations when the pass does name them', async () => {
    const input = await send(wholeNode({ data: { controls: ['ctl-1'], dataItems: ['di-1'] } }));
    expect(input.controls.connect).toEqual([{ where: { node: { id: { eq: 'ctl-1' } } } }]);
    expect(input.dataItems.connect).toEqual([{ where: { node: { id: { eq: 'di-1' } } } }]);
  });
});

// Two ways to write an association, and the caller chooses by whether it can say what the list held
// before. The bulk passes cannot, so they keep replace; an interactive save can, so it sends a delta and
// stops disconnecting attachments it never knew about.
describe('DtComponent.updateComponent — replace without a baseline, delta with one', () => {
  const ids = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('REPLACES when no baseline is given — the shape the import and update passes rely on', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1', 'ctl-2'] } });
    expect(input.controls.disconnect).toEqual({});
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1', 'ctl-2']);
  });

  it('DELTAS when a baseline is given', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1', 'ctl-2'] } }, { controls: ['ctl-1'] });
    expect(input.controls).not.toHaveProperty('disconnect');
    expect(ids(input.controls, 'connect')).toEqual(['ctl-2']);
  });

  // The case the delta exists for: an id this client never saw is in neither side of it,
  // so nothing disconnects it. Under replace it would have been dropped without a word.
  it('never disconnects an attachment the editor did not know about', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1', 'ctl-3'] } }, { controls: ['ctl-1'] });
    expect(input.controls).not.toHaveProperty('disconnect');
  });

  it('still disconnects what the editor actually removed', async () => {
    const input = await send({ id: 'c1', data: { controls: [] } }, { controls: ['ctl-1'] });
    expect(ids(input.controls, 'disconnect')).toEqual(['ctl-1']);
    expect(input.controls).not.toHaveProperty('connect');
  });

  it('omits the key when the delta finds nothing changed, so a repeat save writes no edge', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1'] } }, { controls: ['ctl-1'] });
    expect(input).not.toHaveProperty('controls');
  });

  it('reads each list against its own baseline', async () => {
    const input = await send(
      { id: 'c1', data: { controls: ['ctl-2'], dataItems: ['di-2'] } },
      { controls: ['ctl-1'], dataItems: ['di-1'] },
    );
    expect(ids(input.controls, 'disconnect')).toEqual(['ctl-1']);
    expect(ids(input.dataItems, 'disconnect')).toEqual(['di-1']);
  });
});

// An empty parent means "put me at the root", and the root is the default boundary. It is a real edit,
// so it cannot be dropped — but it can only be written while the root is known. A caller that saves
// before the default boundary has resolved passes an empty id for it, which matches nothing, and the
// disconnect beside it has already run. The component would be left with no parent at all and the save
// would report success.
describe('DtComponent.updateComponent — an empty parent needs a root to mean', () => {
  const attempt = async (updatedNode: Record<string, unknown>, defaultBoundaryId: any) => {
    const { dtComponent, performMutation } = make();
    const call = dtComponent.updateComponent({ updatedNode: updatedNode as any, defaultBoundaryId });
    return { call, performMutation };
  };

  it.each([['an empty default', ''], ['no default at all', undefined], ['a blank default', '   ']])(
    'refuses to relocate to the root with %s, and writes nothing',
    async (_label, defaultBoundaryId) => {
      const { call, performMutation } = await attempt({ id: 'c1', parentNode: '' }, defaultBoundaryId);
      await expect(call).rejects.toThrow(/parentBoundary/);
      // The refusal has to happen while the payload is being built. A writer that refused after
      // sending would already have run the disconnect.
      expect(performMutation).not.toHaveBeenCalled();
    },
  );

  // The control. Without it, a guard that simply refused whenever the default is unresolved would pass
  // every assertion above while breaking every ordinary save made during a model load.
  it('still writes a NAMED parent when the default has not resolved', async () => {
    const { dtComponent, performMutation } = make();
    await dtComponent.updateComponent({ updatedNode: { id: 'c1', parentNode: 'b1' } as any, defaultBoundaryId: '' });
    expect(performMutation.mock.calls[0][0].variables.input.parentBoundary.connect.where.node.id)
      .toEqual({ eq: 'b1' });
  });

  // The other control, and the one a mutant folding the empty string into "absent" turns red: the
  // relocation itself still works when the root is known. That is drag-to-root.
  it('still relocates to a known root', async () => {
    expect((await send({ id: 'c1', parentNode: '' })).parentBoundary.connect.where.node.id)
      .toEqual({ eq: 'b0' });
  });
});

// The same class one level down. A list may hold an entry that is not an id at all — the shared control
// type makes the id optional — and such an entry builds a second operand whose filter carries no
// condition, attaching every control in the deployment.
describe('DtComponent.updateComponent — a list writes the entries it can name', () => {
  const ids = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('connects only the nameable entries', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1', undefined] } });
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('does the same for data items', async () => {
    const input = await send({ id: 'c1', data: { dataItems: ['di-1', ''] } });
    expect(ids(input.dataItems, 'connect')).toEqual(['di-1']);
  });

  // The same on the delta path, which builds its connect list separately from the replace path —
  // so a filter applied to only one of the two would leave this open.
  it('connects only the nameable entries when a baseline makes it a delta', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1', undefined] } }, { controls: [] });
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('builds no disconnect from an unnameable baseline entry', async () => {
    const input = await send({ id: 'c1', data: { controls: ['ctl-1'] } }, { controls: ['ctl-1', undefined] });
    expect(input).not.toHaveProperty('controls');
  });
});
