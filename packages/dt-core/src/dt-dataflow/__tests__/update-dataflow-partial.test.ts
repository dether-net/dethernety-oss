/**
 * `updateDataFlow` writes only what the edge defines.
 *
 * The associations already worked this way; these cover the rest of the input, including the two
 * ENDPOINTS. Those are the reason this file matters more than its siblings: `connect` filters on an
 * `eq` built from the endpoint id, an undefined one is a filter with no condition matching every node,
 * and the disconnect beside it has already run unconditionally. An edge that does not name its
 * endpoints must leave them alone rather than re-home itself onto the whole graph.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtDataflow } from '../dt-dataflow.js';

const make = () => {
  const dtDataflow = new DtDataflow({} as any);
  const performMutation = vi.fn().mockResolvedValue({
    id: 'f1', source: [{ id: 'A' }], target: [{ id: 'B' }],
  });
  (dtDataflow as any).dtUtils.performMutation = performMutation;
  return { dtDataflow, performMutation };
};

const send = async (edge: Record<string, unknown>, baselineLinks?: any) => {
  const { dtDataflow, performMutation } = make();
  await dtDataflow.updateDataFlow({ edge: edge as any, updates: {}, baselineLinks });
  return performMutation.mock.calls[0][0].variables.input;
};

/** The shape the import and update passes build. */
const wholeEdge = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  label: 'F',
  source: 'A',
  target: 'B',
  sourceHandle: 'sh',
  targetHandle: 'th',
  data: { description: 'd', ...(over.data as object ?? {}) },
  ...over,
});

describe('DtDataflow.updateDataFlow — a field the edge does not define is not written', () => {
  it.each([
    ['name', { label: 'F' }, { set: 'F' }],
    ['description', { data: { description: 'd' } }, { set: 'd' }],
    ['sourceHandle', { sourceHandle: 'sh' }, { set: 'sh' }],
    ['targetHandle', { targetHandle: 'th' }, { set: 'th' }],
  ])('writes %s when the edge defines it', async (key, edge, expected) => {
    expect(await send({ id: 'f1', ...edge })).toHaveProperty(key, expected);
  });

  it.each(['name', 'description', 'sourceHandle', 'targetHandle', 'source', 'target'])(
    'omits %s when the edge does not define it',
    async (key) => {
      expect(await send({ id: 'f1' })).not.toHaveProperty(key);
    },
  );

  it('writes an empty description, because presence is the test and not truth', async () => {
    expect(await send({ id: 'f1', data: { description: '' } })).toHaveProperty('description', { set: '' });
  });
});

describe('DtDataflow.updateDataFlow — the endpoints are never connected by an empty filter', () => {
  it('leaves both endpoints alone when the edge names neither', async () => {
    // The shape a rename or a description edit produces. Before the endpoints were gated this
    // detached the flow from both ends and re-connected it to everything.
    const input = await send({ id: 'f1', label: 'renamed' });
    expect(input).not.toHaveProperty('source');
    expect(input).not.toHaveProperty('target');
  });

  it('re-homes both endpoints when the edge names them', async () => {
    const input = await send({ id: 'f1', source: 'X', target: 'Y' });
    expect(input.source.connect.where.node.id).toEqual({ eq: 'X' });
    expect(input.target.connect.where.node.id).toEqual({ eq: 'Y' });
  });

  it('moves one end without touching the other', async () => {
    const input = await send({ id: 'f1', source: 'X' });
    expect(input.source.connect.where.node.id).toEqual({ eq: 'X' });
    expect(input).not.toHaveProperty('target');
  });

  it('never builds a connect filter with no condition', async () => {
    for (const edge of [{ id: 'f1' }, { id: 'f1', source: 'X' }, wholeEdge()]) {
      const input = await send(edge);
      for (const end of ['source', 'target'] as const) {
        if (input[end]) expect(input[end].connect.where.node.id.eq).toBeDefined();
      }
    }
  });
});

describe('DtDataflow.updateDataFlow — a whole edge still writes the whole flow', () => {
  it('writes every field the programmatic passes rely on', async () => {
    const input = await send(wholeEdge());
    expect(input).toMatchObject({
      name: { set: 'F' },
      description: { set: 'd' },
      sourceHandle: { set: 'sh' },
      targetHandle: { set: 'th' },
    });
    expect(input.source.connect.where.node.id).toEqual({ eq: 'A' });
    expect(input.target.connect.where.node.id).toEqual({ eq: 'B' });
  });

  it('still omits the associations such a pass leaves out', async () => {
    const input = await send(wholeEdge());
    expect(input).not.toHaveProperty('controls');
    expect(input).not.toHaveProperty('dataItems');
  });

  // The programmatic callers merge `updates` into the edge before any of this is read, and several of
  // them pass keys the writer never reads. Whatever they pass, the edge is what decides the input.
  it('still writes the whole flow when the caller passes no updates at all', async () => {
    const { dtDataflow, performMutation } = make();
    await dtDataflow.updateDataFlow({ edge: wholeEdge() as any, updates: {} });
    expect(performMutation.mock.calls[0][0].variables.input).toHaveProperty('name', { set: 'F' });
  });
});

describe('DtDataflow.updateDataFlow — replace without a baseline, delta with one', () => {
  const ids = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('REPLACES when no baseline is given', async () => {
    const input = await send({ id: 'f1', data: { dataItems: ['di-1'] } });
    expect(input.dataItems.disconnect).toEqual({});
    expect(ids(input.dataItems, 'connect')).toEqual(['di-1']);
  });

  it('DELTAS when a baseline is given, and leaves an unknown attachment alone', async () => {
    const input = await send({ id: 'f1', data: { dataItems: ['di-1', 'di-2'] } }, { dataItems: ['di-1'] });
    expect(input.dataItems).not.toHaveProperty('disconnect');
    expect(ids(input.dataItems, 'connect')).toEqual(['di-2']);
  });

  it('omits the key when the delta finds nothing changed', async () => {
    expect(await send({ id: 'f1', data: { controls: ['ctl-1'] } }, { controls: ['ctl-1'] }))
      .not.toHaveProperty('controls');
  });
});

// An endpoint that is named but empty has nowhere to fall back to. A parent boundary at least has a
// root to mean; a flow's source and target have no such fallback, so an empty one can only be written as
// a filter that matches nothing — after the disconnect beside it has already detached the real endpoint.
// The flow would be left running from nowhere, with a successful save behind it.
describe('DtDataflow.updateDataFlow — an endpoint is never written from an id it cannot use', () => {
  const attempt = async (edge: Record<string, unknown>) => {
    const { dtDataflow, performMutation } = make();
    const call = dtDataflow.updateDataFlow({ edge: edge as any, updates: {} });
    return { call, performMutation };
  };

  it.each([
    ['source', { id: 'f1', source: '', target: 'B' }, /"source"/],
    ['target', { id: 'f1', source: 'A', target: '' }, /"target"/],
    ['a blank source', { id: 'f1', source: '   ', target: 'B' }, /"source"/],
  ])('refuses an empty %s, and writes nothing', async (_label, edge, message) => {
    const { call, performMutation } = await attempt(edge);
    await expect(call).rejects.toThrow(message as RegExp);
    expect(performMutation).not.toHaveBeenCalled();
  });

  // The control: a re-route is an ordinary edit and must still be written.
  it('still connects endpoints it can name', async () => {
    const input = await send({ id: 'f1', source: 'A2', target: 'B2' });
    expect(input.source.connect.where.node.id).toEqual({ eq: 'A2' });
    expect(input.target.connect.where.node.id).toEqual({ eq: 'B2' });
  });
});

// A list may hold an entry that is not an id — the shared types make the id optional — and such an entry
// builds an operand whose filter carries no condition, attaching every control in the deployment.
describe('DtDataflow.updateDataFlow — a list writes the entries it can name', () => {
  const linkIds = (v: any, key: string) => (v?.[key] ?? []).map((o: any) => o.where.node.id.eq);

  it('connects only the nameable entries', async () => {
    const input = await send({ id: 'f1', data: { controls: ['ctl-1', undefined] } });
    expect(linkIds(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('does the same for data items', async () => {
    const input = await send({ id: 'f1', data: { dataItems: ['di-1', ''] } });
    expect(linkIds(input.dataItems, 'connect')).toEqual(['di-1']);
  });

  // The same on the delta path, which builds its connect list separately from the replace path —
  // so a filter applied to only one of the two would leave this open.
  it('connects only the nameable entries when a baseline makes it a delta', async () => {
    const input = await send({ id: 'f1', data: { controls: ['ctl-1', undefined] } }, { controls: [] });
    expect(linkIds(input.controls, 'connect')).toEqual(['ctl-1']);
  });

  it('builds no disconnect from an unnameable baseline entry', async () => {
    const input = await send({ id: 'f1', data: { controls: ['ctl-1'] } }, { controls: ['ctl-1', undefined] });
    expect(input).not.toHaveProperty('controls');
  });
});
