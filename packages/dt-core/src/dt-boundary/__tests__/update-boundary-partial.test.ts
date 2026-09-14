/**
 * `updateBoundaryNode` writes only what the node defines.
 *
 * The zoning scalars and the associations already worked this way; these cover the rest of the input,
 * so a caller can hand over just the field the user edited instead of the boundary as it last loaded
 * it. Every field is asserted in both directions — "omits X when absent" alone is satisfied by a
 * writer that never sends X, which is the same loss seen from the other side.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtBoundary } from '../dt-boundary.js';

const make = () => {
  const dtBoundary = new DtBoundary({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'b1', parentBoundary: [], dataItems: [] });
  (dtBoundary as any).dtUtils.performMutation = performMutation;
  return { dtBoundary, performMutation };
};

const send = async (updatedNode: Record<string, unknown>, baselineLinks?: any) => {
  const { dtBoundary, performMutation } = make();
  await dtBoundary.updateBoundaryNode({ updatedNode: updatedNode as any, defaultBoundaryId: 'b0', baselineLinks });
  return performMutation.mock.calls[0][0].variables.input;
};

/** The shape the import and update passes build. */
const wholeNode = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  type: 'BOUNDARY',
  position: { x: 3, y: 4 },
  width: 300,
  height: 200,
  parentNode: 'b-parent',
  data: { label: 'B', description: 'd', minWidth: 200, minHeight: 150, ...(over.data as object ?? {}) },
  ...over,
});

describe('DtBoundary.updateBoundaryNode — a field the node does not define is not written', () => {
  it.each([
    ['name', { data: { label: 'B' } }, { set: 'B' }],
    ['description', { data: { description: 'd' } }, { set: 'd' }],
    ['dimensionsWidth', { width: 300 }, { set: 300 }],
    ['dimensionsHeight', { height: 200 }, { set: 200 }],
    ['dimensionsMinWidth', { data: { minWidth: 200 } }, { set: 200 }],
    ['dimensionsMinHeight', { data: { minHeight: 150 } }, { set: 150 }],
  ])('writes %s when the node defines it', async (key, node, expected) => {
    expect(await send({ id: 'b1', ...node })).toHaveProperty(key, expected);
  });

  it.each([
    'name', 'description', 'positionX', 'positionY',
    'dimensionsWidth', 'dimensionsHeight', 'dimensionsMinWidth', 'dimensionsMinHeight',
  ])('omits %s when the node does not define it', async (key) => {
    expect(await send({ id: 'b1' })).not.toHaveProperty(key);
  });

  it('writes a zero dimension rather than dropping it', async () => {
    expect(await send({ id: 'b1', width: 0 })).toHaveProperty('dimensionsWidth', { set: 0 });
  });
});

describe('DtBoundary.updateBoundaryNode — position is one edit, gated whole', () => {
  it('writes both axes when the node defines a position', async () => {
    expect(await send({ id: 'b1', position: { x: 3, y: 4 } })).toMatchObject({
      positionX: { set: 3 }, positionY: { set: 4 },
    });
  });

  it('does not throw on a node with no position at all', async () => {
    await expect(send({ id: 'b1', data: { zone: 'PUBLIC' } })).resolves.toBeDefined();
  });
});

// A boundary that defines no data at all reaches this writer once the caller sends only a position or
// a size. Reading the zoning buffer off it must not throw — a guard that throws is not a guard.
describe('DtBoundary.updateBoundaryNode — a node with no data at all', () => {
  it('writes the size and nothing else', async () => {
    const input = await send({ id: 'b1', width: 300, height: 200 });
    expect(input).toMatchObject({ dimensionsWidth: { set: 300 }, dimensionsHeight: { set: 200 } });
    for (const key of ['name', 'description', 'zone', 'domains', 'planes', 'controls', 'dataItems']) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it('emits no conduit operations', async () => {
    const input = await send({ id: 'b1', position: { x: 1, y: 1 } });
    expect(input).not.toHaveProperty('outboundConduits');
    expect(input).not.toHaveProperty('inboundConduits');
  });
});

describe('DtBoundary.updateBoundaryNode — a whole node still writes the whole boundary', () => {
  it('writes every field the programmatic passes rely on', async () => {
    expect(await send(wholeNode())).toMatchObject({
      name: { set: 'B' },
      description: { set: 'd' },
      positionX: { set: 3 },
      positionY: { set: 4 },
      dimensionsWidth: { set: 300 },
      dimensionsHeight: { set: 200 },
      dimensionsMinWidth: { set: 200 },
      dimensionsMinHeight: { set: 150 },
    });
  });

  it('still connects the parent and still omits the associations such a pass leaves out', async () => {
    const input = await send(wholeNode());
    expect(input.parentBoundary.connect.where.node.id).toEqual({ eq: 'b-parent' });
    expect(input).not.toHaveProperty('controls');
    expect(input).not.toHaveProperty('dataItems');
  });
});

describe('DtBoundary.updateBoundaryNode — replace without a baseline, delta with one', () => {
  const ids = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('REPLACES when no baseline is given', async () => {
    const input = await send({ id: 'b1', data: { controls: ['ctl-1'] } });
    expect(input.controls.disconnect).toEqual({});
    expect(ids(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('DELTAS when a baseline is given, and leaves an unknown attachment alone', async () => {
    const input = await send({ id: 'b1', data: { controls: ['ctl-1', 'ctl-2'] } }, { controls: ['ctl-1'] });
    expect(input.controls).not.toHaveProperty('disconnect');
    expect(ids(input.controls, 'connect')).toEqual(['ctl-2']);
  });

  // The conduit delta already worked this way; the two now travel on the same save without interfering.
  it('carries a conduit delta and a link delta on the same save', async () => {
    const input = await send(
      { id: 'b1', data: { controls: ['ctl-2'], conduits: [{ peerId: 'p1', direction: 'OUTBOUND' }] } },
      { controls: ['ctl-1'] },
    );
    expect(ids(input.controls, 'disconnect')).toEqual(['ctl-1']);
    expect(input.outboundConduits).toBeDefined();
  });
});

// An empty parent means "put me at the root", which is the default boundary — a real edit, so it cannot
// be dropped. It can only be written while the root is known: a save made before the default boundary
// resolves carries an empty id for it, which matches nothing, and the disconnect beside it has already
// run. The boundary would be left hanging outside the model with a successful save behind it.
describe('DtBoundary.updateBoundaryNode — an empty parent needs a root to mean', () => {
  it.each([['an empty default', ''], ['no default at all', undefined], ['a blank default', '   ']])(
    'refuses to relocate to the root with %s, and writes nothing',
    async (_label, defaultBoundaryId) => {
      const { dtBoundary, performMutation } = make();
      const call = dtBoundary.updateBoundaryNode({
        updatedNode: { id: 'b1', parentNode: '' } as any,
        defaultBoundaryId: defaultBoundaryId as any,
      });
      await expect(call).rejects.toThrow(/parentBoundary/);
      // Refusing after the send would already have run the disconnect.
      expect(performMutation).not.toHaveBeenCalled();
    },
  );

  // The control: an unresolved default is only fatal to the relocation itself.
  it('still writes a NAMED parent when the default has not resolved', async () => {
    const { dtBoundary, performMutation } = make();
    await dtBoundary.updateBoundaryNode({
      updatedNode: { id: 'b1', parentNode: 'b-parent' } as any,
      defaultBoundaryId: '',
    });
    expect(performMutation.mock.calls[0][0].variables.input.parentBoundary.connect.where.node.id)
      .toEqual({ eq: 'b-parent' });
  });

  // The root itself has no parent to write, and its branch is reached before either of the two above.
  // Renaming the root sends an empty parentNode like any other node, and without this ordering the
  // empty string would resolve to the default boundary — parenting the root to itself.
  it('omits the parent for the root boundary rather than resolving its empty parent', async () => {
    const { dtBoundary, performMutation } = make();
    await dtBoundary.updateBoundaryNode({
      updatedNode: { id: 'b0', parentNode: '', data: { label: 'Root' } } as any,
      defaultBoundaryId: 'b0',
    });
    expect(performMutation.mock.calls[0][0].variables.input).not.toHaveProperty('parentBoundary');
  });

  // The other control, and the one a mutant folding the empty string into "absent" turns red.
  it('still relocates to a known root', async () => {
    expect((await send({ id: 'b1', parentNode: '' })).parentBoundary.connect.where.node.id)
      .toEqual({ eq: 'b0' });
  });
});

// A list may hold an entry that is not an id — the shared types make the id optional — and such an entry
// builds an operand whose filter carries no condition, attaching every control in the deployment.
describe('DtBoundary.updateBoundaryNode — a list writes the entries it can name', () => {
  const linkIds = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('connects only the nameable entries', async () => {
    const input = await send({ id: 'b1', data: { controls: ['ctl-1', undefined] } });
    expect(linkIds(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('does the same for data items', async () => {
    const input = await send({ id: 'b1', data: { dataItems: ['di-1', ''] } });
    expect(linkIds(input.dataItems, 'connect')).toEqual(['di-1']);
  });

  // The same on the delta path, which builds its connect list separately from the replace path —
  // so a filter applied to only one of the two would leave this open.
  it('connects only the nameable entries when a baseline makes it a delta', async () => {
    const input = await send({ id: 'b1', data: { controls: ['ctl-1', undefined] } }, { controls: [] });
    expect(linkIds(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('builds no disconnect from an unnameable baseline entry', async () => {
    const input = await send({ id: 'b1', data: { controls: ['ctl-1'] } }, { controls: ['ctl-1', undefined] });
    expect(input).not.toHaveProperty('controls');
  });
});
