import { describe, it, expect } from 'vitest';
import { buildLinkOps, linkInput } from '../link-delta.js';

/**
 * The delta an element-side link write emits, and the cases that decide its shape.
 *
 * The asymmetry worth keeping in view: a missing connect is a lost attachment the user made, and a
 * missing disconnect is a stale one they removed. Both directions are asserted for every case.
 */

const ids = (ops: ReturnType<typeof buildLinkOps>, key: 'connect' | 'disconnect') =>
  (ops?.[key] ?? []).map(o => o.where.node.id.eq);

describe('buildLinkOps', () => {
  it('connects what is new and disconnects nothing else', () => {
    const ops = buildLinkOps(['c1', 'c2'], ['c1']);
    expect(ids(ops, 'connect')).toEqual(['c2']);
    expect(ops).not.toHaveProperty('disconnect');
  });

  it('disconnects what was removed and connects nothing else', () => {
    const ops = buildLinkOps(['c1'], ['c1', 'c2']);
    expect(ids(ops, 'disconnect')).toEqual(['c2']);
    expect(ops).not.toHaveProperty('connect');
  });

  it('carries both directions when the edit does both', () => {
    const ops = buildLinkOps(['c1', 'c3'], ['c1', 'c2']);
    expect(ids(ops, 'connect')).toEqual(['c3']);
    expect(ids(ops, 'disconnect')).toEqual(['c2']);
  });

  // The whole point, stated as its own case: an id the editor never knew about is not in the baseline
  // and not in the current list, so neither half touches it. That is the other user's attachment.
  it('leaves an id it has never heard of entirely alone', () => {
    const ops = buildLinkOps(['c1', 'c3'], ['c1']);
    expect(ids(ops, 'connect')).toEqual(['c3']);
    expect(ops).not.toHaveProperty('disconnect');
  });

  it('emits nothing at all when the list is unchanged', () => {
    expect(buildLinkOps(['c1', 'c2'], ['c2', 'c1'])).toBeUndefined();
  });

  it('emits nothing for two empty sides', () => {
    expect(buildLinkOps([], [])).toBeUndefined();
    expect(buildLinkOps(undefined, undefined)).toBeUndefined();
  });

  it('connects everything when the element held none before', () => {
    expect(ids(buildLinkOps(['c1', 'c2'], undefined), 'connect')).toEqual(['c1', 'c2']);
    expect(ids(buildLinkOps(['c1'], []), 'connect')).toEqual(['c1']);
  });

  it('disconnects everything when the list is cleared', () => {
    expect(ids(buildLinkOps([], ['c1', 'c2']), 'disconnect')).toEqual(['c1', 'c2']);
    expect(ids(buildLinkOps(undefined, ['c1']), 'disconnect')).toEqual(['c1']);
  });

  // `connect` compiles to a bare relationship CREATE, so a repeated id would append a parallel edge —
  // the defect this whole write path was rebuilt to avoid.
  it('de-duplicates a repeated id rather than connecting it twice', () => {
    expect(ids(buildLinkOps(['c1', 'c1', 'c2'], []), 'connect')).toEqual(['c1', 'c2']);
  });

  it('de-duplicates a repeated baseline id rather than disconnecting it twice', () => {
    expect(ids(buildLinkOps([], ['c1', 'c1']), 'disconnect')).toEqual(['c1']);
  });

  it('emits the operand shape the writers already use', () => {
    expect(buildLinkOps(['c1'], [])).toEqual({ connect: [{ where: { node: { id: { eq: 'c1' } } } }] });
  });
});

describe('linkInput — which shape, and the two different absences', () => {
  const connectIds = (v: any) => (v?.connect ?? []).map((o: any) => o.where.node.id.eq);

  it('omits the key when the element does not define the list', () => {
    // The association is left alone. The import and conduit passes rely on exactly this.
    expect(linkInput(undefined, undefined, 'controls')).toBeUndefined();
    expect(linkInput(undefined, { controls: ['c1'] }, 'controls')).toBeUndefined();
  });

  it('REPLACES when the caller supplies no baselines at all', () => {
    const v: any = linkInput(['c1', 'c2'], undefined, 'controls');
    expect(v.disconnect).toEqual({});
    expect(connectIds(v)).toEqual(['c1', 'c2']);
  });

  it('de-duplicates the asserted list when replacing', () => {
    expect(connectIds(linkInput(['c1', 'c1'], undefined, 'controls'))).toEqual(['c1']);
  });

  it('DELTAS when the caller supplies baselines', () => {
    const v: any = linkInput(['c1', 'c2'], { controls: ['c1'] }, 'controls');
    expect(v).not.toHaveProperty('disconnect');
    expect(connectIds(v)).toEqual(['c2']);
  });

  // The distinction the whole helper exists to keep: baselines present but silent on this key is NOT
  // the same as no baselines. Collapsing them turns a bulk replace into a delta against nothing, which
  // connects the whole list a second time.
  it('treats baselines-without-this-key as a known-empty baseline, not as a replace', () => {
    const v: any = linkInput(['c1'], { dataItems: ['d1'] }, 'controls');
    expect(v).not.toHaveProperty('disconnect');
    expect(connectIds(v)).toEqual(['c1']);
  });

  it('omits the key when a delta finds nothing changed', () => {
    expect(linkInput(['c1'], { controls: ['c1'] }, 'controls')).toBeUndefined();
  });

  it('still replaces with an empty connect when the caller asserts an empty list', () => {
    const v: any = linkInput([], undefined, 'controls');
    expect(v).toEqual({ disconnect: {}, connect: [] });
  });

  it('reads the key it was given, not the other one', () => {
    expect(connectIds(linkInput(['d2'], { controls: ['c1'], dataItems: ['d1'] }, 'dataItems')))
      .toEqual(['d2']);
  });
});

/**
 * An entry that is not a usable id builds a filter with no condition, and a filter with no condition
 * does not match nothing — it matches everything of that label. On the connect side that attaches the
 * element to every control in the deployment; on the DISCONNECT side it clears every edge of that type
 * on this element. The second is the one no prose about this defect mentions, and it arrives through the
 * baseline rather than through the edit.
 *
 * The control for all of it is the rest of this file: a wholly valid pair emits exactly what it always
 * did, so a filter that rejected too much would turn those red first.
 */
describe('an id that cannot be named is not written, on either side', () => {
  it('connects the entries it can name and leaves out the one it cannot', () => {
    expect(ids(buildLinkOps(['c1', undefined, 'c2'], []), 'connect')).toEqual(['c1', 'c2']);
  });

  it('does not disconnect on an unusable BASELINE entry — a filter that would clear every edge', () => {
    const ops = buildLinkOps(['c1'], ['c1', undefined]);
    // Nothing changed that can be expressed, so there is nothing to write at all.
    expect(ops).toBeUndefined();
  });

  it('still disconnects the removals it CAN name beside one it cannot', () => {
    const ops = buildLinkOps(['c1'], ['c1', 'c2', '']);
    expect(ids(ops, 'disconnect')).toEqual(['c2']);
  });

  it('treats whitespace as unnameable, because it matches nothing after the disconnect has run', () => {
    expect(ids(buildLinkOps(['  ', 'c1'], []), 'connect')).toEqual(['c1']);
  });

  it('emits nothing when neither side can name anything', () => {
    // Both lists are built by mapping the same optional id field, so an unreadable id is unreadable on
    // both sides — which is the shape that actually occurs, and it must leave the association alone.
    expect(buildLinkOps([undefined], [undefined])).toBeUndefined();
  });

  it('still removes what the baseline named when the edit names nothing', () => {
    // The tempting reading is that an unnameable entry might BE the baseline id, so removing it is
    // unsafe. It cannot be: both lists come from the same mapping, so an id that is unreadable now was
    // unreadable when the baseline was taken. A baseline id that is missing from the edit was removed,
    // and a clear that stopped clearing would be the defect from the other direction.
    expect(ids(buildLinkOps([undefined, ''], ['c1']), 'disconnect')).toEqual(['c1']);
  });

  it('filters the REPLACE shape too, where the whole list is being asserted', () => {
    const v: any = linkInput(['c1', undefined], undefined, 'controls');
    expect(v.disconnect).toEqual({});
    expect((v.connect ?? []).map((o: any) => o.where.node.id.eq)).toEqual(['c1']);
  });

  it('clears the association when a caller asserts a whole list it cannot name', () => {
    // Replace means "this is the list". If none of it resolves, the list is empty — which is the honest
    // reading, and far short of the alternative, where the same input attached every control there is.
    expect(linkInput([undefined], undefined, 'controls')).toEqual({ disconnect: {}, connect: [] });
  });
});
