/**
 * A data item's controls, written from the item: the link-list contract every element writer shares.
 *
 * - Absent: not written, so a save that did not touch the controls leaves them alone.
 * - With a baseline: the change from it, so two editors' saves compose.
 * - Without one: the whole list, which disconnects everything else.
 *
 * The list may hold the `{ id, name }` objects the platform returns as well as ids. They are mapped to their ids,
 * because the link builder drops every entry that is not a string, and a whole-list write left with nothing usable
 * disconnects every control the item has.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtDataItem } from '../dt-dataitem.js';

const make = () => {
  const dtDataitem = new DtDataItem({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'd1' });
  (dtDataitem as any).dtUtils.performMutation = performMutation;
  return { dtDataitem, performMutation };
};

const update = async (args: Record<string, unknown>) => {
  const { dtDataitem, performMutation } = make();
  await dtDataitem.updateDataItem({ dataItemId: 'd1', ...args } as any);
  return performMutation.mock.calls[0][0].variables.input;
};

const create = async (args: Record<string, unknown>) => {
  const { dtDataitem, performMutation } = make();
  await dtDataitem.createDataItem({ name: 'D', description: '', elementId: 'm1', classId: null, modelId: 'm1', ...args } as any);
  return performMutation.mock.calls[0][0].variables.input[0];
};

const inList = (...ids: string[]) => [{ where: { node: { id: { in: ids } } } }];

describe('DtDataItem.updateDataItem — controls', () => {
  it('does not write the controls when none are supplied', async () => {
    expect(await update({ name: 'D' })).not.toHaveProperty('controls');
  });

  it('replaces the whole list when there is no baseline', async () => {
    expect((await update({ controls: ['c1', 'c2'] })).controls).toEqual({ disconnect: {}, connect: inList('c1', 'c2') });
  });

  it('clears the list on an explicit empty one', async () => {
    expect((await update({ controls: [] })).controls).toEqual({ disconnect: {}, connect: [] });
  });

  it('writes only the change from a baseline', async () => {
    expect((await update({ controls: ['c2', 'c3'], baselineLinks: { controls: ['c1', 'c2'] } })).controls).toEqual({
      connect: inList('c3'),
      disconnect: inList('c1'),
    });
  });

  it('writes nothing for an unchanged list against its baseline', async () => {
    expect(await update({ controls: ['c1'], baselineLinks: { controls: ['c1'] } })).not.toHaveProperty('controls');
  });

  it('maps control objects to their ids, so a list read back from the platform never clears the item', async () => {
    const objects = [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }];
    expect((await update({ controls: objects })).controls).toEqual({ disconnect: {}, connect: inList('c1', 'c2') });
    expect((await update({ controls: objects, baselineLinks: { controls: ['c1'] } })).controls).toEqual({
      connect: inList('c2'),
    });
  });

  it('drops an entry with no usable id instead of building an operand that matches every control', async () => {
    expect((await update({ controls: ['c1', undefined, { id: null }, ''] })).controls).toEqual({
      disconnect: {},
      connect: inList('c1'),
    });
    // With a baseline, an unusable entry on either side is dropped from both: it cannot be disconnected either.
    expect((await update({ controls: ['c1'], baselineLinks: { controls: ['c1', ''] } }))).not.toHaveProperty('controls');
  });
});

describe('DtDataItem.createDataItem — controls', () => {
  it('connects the controls it is given, and nothing else, on a fresh node', async () => {
    expect((await create({ controls: ['c1', { id: 'c2', name: 'Two' }] })).controls).toEqual({ connect: inList('c1', 'c2') });
  });

  it('sends no controls key when there are none', async () => {
    expect(await create({})).not.toHaveProperty('controls');
    expect(await create({ controls: [] })).not.toHaveProperty('controls');
  });
});
