/**
 * `updateDataItem` writes only the fields it was given.
 *
 * Two of the four used to be worse than ungated: an ABSENT `sensitivity` or `regulatoryFlags` did not
 * merely get re-sent, it CLEARED the platform field. That is what a full sync means by an absence and
 * the opposite of what an interactive save means by one — so the dialog, which sent all five of its
 * fields whenever any of them was dirty, reverted a classification another user had just set.
 *
 * The clear is still reachable and now has to be said out loud. Every field is asserted in both
 * directions, because an "omits X when absent" test alone is satisfied by a writer that never sends X.
 *
 * Calls omit `classId` so the class-binding branch is skipped and only the residual mutation fires.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtDataItem } from '../dt-dataitem.js';

const make = () => {
  const dtDataitem = new DtDataItem({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'd1' });
  (dtDataitem as any).dtUtils.performMutation = performMutation;
  return { dtDataitem, performMutation };
};

/** Send EXACTLY the given fields — no defaults, because absence is the thing under test. */
const call = async (args: Record<string, unknown> = {}) => {
  const { dtDataitem, performMutation } = make();
  await dtDataitem.updateDataItem({ dataItemId: 'd1', ...args } as any);
  return performMutation.mock.calls[0][0];
};

const send = async (args: Record<string, unknown> = {}) => (await call(args)).variables.input;

describe('DtDataItem.updateDataItem — a field the caller does not supply is not written', () => {
  it.each([
    ['name', { name: 'D' }, { set: 'D' }],
    ['description', { description: 'd' }, { set: 'd' }],
    ['sensitivity', { sensitivity: 'restricted' }, { set: 'RESTRICTED' }],
    ['regulatoryFlags', { regulatoryFlags: ['PCI cardholder'] }, { set: ['PCI cardholder'] }],
  ])('writes %s when it is supplied', async (key, args, expected) => {
    expect(await send(args)).toHaveProperty(key, expected);
  });

  it.each(['name', 'description', 'sensitivity', 'regulatoryFlags'])(
    'omits %s when it is not supplied',
    async key => {
      expect(await send({})).not.toHaveProperty(key);
    },
  );

  // The far end of the same contract, and a real shape: a save that changes only the class binding
  // leaves the residual with nothing to write. It still goes to the server, because the caller needs
  // the row back to re-pin its own copy of the item.
  it('builds an input with no keys at all for an id on its own', async () => {
    expect(Object.keys(await send({}))).toEqual([]);
  });

  it('writes an empty name, because presence is the test and not truth', async () => {
    expect(await send({ name: '' })).toHaveProperty('name', { set: '' });
  });

  // The control for every omission above: the push path supplies all four and must still write them.
  it('still writes everything when everything is supplied', async () => {
    expect(await send({
      name: 'D', description: 'd', sensitivity: 'restricted', regulatoryFlags: ['PCI cardholder'],
    })).toEqual({
      name: { set: 'D' },
      description: { set: 'd' },
      sensitivity: { set: 'RESTRICTED' },
      regulatoryFlags: { set: ['PCI cardholder'] },
    });
  });
});

// The clear is the half a gate of this shape can break, so it is asserted on its own rather than left
// to fall out of the cases above.
describe('DtDataItem.updateDataItem — a clear is said, not left unsaid', () => {
  it('clears the sensitivity on an explicit null', async () => {
    expect(await send({ sensitivity: null })).toHaveProperty('sensitivity', { set: null });
  });

  it('clears the flags on an explicit empty list', async () => {
    expect(await send({ regulatoryFlags: [] })).toHaveProperty('regulatoryFlags', { set: [] });
  });

  // The pair that makes the distinction real: the same two fields, absent, write nothing.
  it('and neither is touched when neither is named', async () => {
    const input = await send({ name: 'D' });
    expect(input).not.toHaveProperty('sensitivity');
    expect(input).not.toHaveProperty('regulatoryFlags');
  });

  it('still drops an unknown sensitivity to null, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await send({ sensitivity: 'bogus' })).toHaveProperty('sensitivity', { set: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// Deduplication joins an IN-FLIGHT request under the same key and returns its result — right for a
// double submit of one act, wrong for two different ones. A class pick fires a save without awaiting it,
// so a Save pressed during that one would otherwise join it and never be written.
describe('DtDataItem.updateDataItem — the deduplication key says which fields are being written', () => {
  const keyOf = async (args: Record<string, unknown>) => (await call(args)).deduplicationKey;

  it('gives a rename and a sensitivity edit different keys', async () => {
    expect(await keyOf({ name: 'D' })).not.toBe(await keyOf({ sensitivity: 'restricted' }));
  });

  it('gives two renames of the same item the same key, so a double submit still collapses', async () => {
    expect(await keyOf({ name: 'D' })).toBe(await keyOf({ name: 'OTHER' }));
  });

  it('still names the item, so two items never share a key', async () => {
    const { dtDataitem, performMutation } = make();
    await dtDataitem.updateDataItem({ dataItemId: 'd2', name: 'D' } as any);
    expect(performMutation.mock.calls[0][0].deduplicationKey).not.toBe(await keyOf({ name: 'D' }));
  });
});
