/**
 * A data item's control references survive both conversions between the split and the monolithic formats, and an
 * item with no controls key gets none: the push reads an absent key as "leave the controls alone", so the conversion
 * must not invent one.
 */
import { describe, it, expect } from 'vitest';
import { monolithicToSplit, splitToMonolithic } from '../model.schema.js';
import type { MonolithicModel } from '../index.js';

const model = (dataItems: MonolithicModel['dataItems']): MonolithicModel => ({
  id: 'm1',
  name: 'M',
  description: '',
  defaultBoundary: { id: 'b0', name: 'root', components: [] },
  dataFlows: [],
  dataItems,
} as MonolithicModel);

describe('data item controls across the split/monolithic conversions', () => {
  it('keeps the references both ways', () => {
    const controls = [{ id: 'c-enc', name: 'Field encryption' }];
    const split = monolithicToSplit(model([{ id: 'd1', name: 'Cards', controls }]));
    expect(split.dataItems[0].controls).toEqual(controls);
    expect(splitToMonolithic(split).dataItems?.[0].controls).toEqual(controls);
  });

  it('keeps an explicit empty list, which the push reads as a clear', () => {
    const split = monolithicToSplit(model([{ id: 'd1', name: 'Cards', controls: [] }]));
    expect(splitToMonolithic(split).dataItems?.[0].controls).toEqual([]);
  });

  it('adds no list to an item that has none', () => {
    const split = monolithicToSplit(model([{ id: 'd1', name: 'Cards' }]));
    expect(splitToMonolithic(split).dataItems?.[0].controls).toBeUndefined();
  });
});
