/**
 * Pre-validate property value shapes against what both supported databases
 * store. Standalone unit tests for the helpers.
 */

import {
  assertStorableProperties,
  describeNonPrimitiveValue,
  propertyViolations,
} from '../property-values';

describe('describeNonPrimitiveValue', () => {
  it('accepts primitives', () => {
    expect(describeNonPrimitiveValue('hello')).toBeNull();
    expect(describeNonPrimitiveValue(42)).toBeNull();
    expect(describeNonPrimitiveValue(true)).toBeNull();
    expect(describeNonPrimitiveValue(null)).toBeNull();
    expect(describeNonPrimitiveValue(undefined)).toBeNull();
  });

  it('accepts homogeneous primitive arrays', () => {
    expect(describeNonPrimitiveValue(['a', 'b', 'c'])).toBeNull();
    expect(describeNonPrimitiveValue([1, 2, 3])).toBeNull();
    expect(describeNonPrimitiveValue([true, false])).toBeNull();
    expect(describeNonPrimitiveValue([])).toBeNull();
  });

  it('rejects nested objects', () => {
    const violation = describeNonPrimitiveValue({ inner: 'value' });
    expect(violation).toMatch(/nested object/);
  });

  it('rejects arrays containing objects', () => {
    const violation = describeNonPrimitiveValue([{ k: 'v' }]);
    expect(violation).toMatch(/nested object/);
  });

  it('rejects arrays containing arrays', () => {
    const violation = describeNonPrimitiveValue([[1, 2]]);
    expect(violation).toMatch(/nested array/);
  });

  it('rejects mixed-type arrays', () => {
    const violation = describeNonPrimitiveValue(['a', 1]);
    expect(violation).toMatch(/homogeneous/);
  });

  it('rejects functions and symbols', () => {
    expect(describeNonPrimitiveValue(() => 1)).toMatch(/function/);
  });

  it('rejects a list holding null, naming the element', () => {
    expect(describeNonPrimitiveValue(['a', null])).toMatch(/list element 1 is null/);
  });

  it('rejects a list holding undefined', () => {
    expect(describeNonPrimitiveValue([undefined])).toMatch(/list element 0 is undefined/);
  });

  it('rejects a list with a hole', () => {
    const sparse: string[] = ['a'];
    sparse[2] = 'c';
    expect(describeNonPrimitiveValue(sparse)).toMatch(/list element 1 is missing/);
  });

  it('reports the first violation in list order', () => {
    expect(describeNonPrimitiveValue(['a', 1, null])).toMatch(/homogeneous/);
    expect(describeNonPrimitiveValue(['a', null, 1])).toMatch(/list element 1 is null/);
  });

  it('accepts an empty string inside a list, and an empty list', () => {
    expect(describeNonPrimitiveValue(['', 'a'])).toBeNull();
    expect(describeNonPrimitiveValue([''])).toBeNull();
    expect(describeNonPrimitiveValue([])).toBeNull();
  });
});

describe('propertyViolations', () => {
  it('lists every key that cannot be stored, and only those', () => {
    expect(
      propertyViolations({ ok: 'x', none: null, tags: ['a', null], nested: { k: 1 }, list: [1, 2] }),
    ).toEqual([
      { key: 'tags', violation: expect.stringMatching(/list element 1 is null/) },
      { key: 'nested', violation: expect.stringMatching(/nested object/) },
    ]);
  });
});

describe('assertStorableProperties', () => {
  it('passes a storable map, including a numeric vector', () => {
    expect(() => assertStorableProperties({ name: 'n', embedding: [0.1, 0.2], gone: null })).not.toThrow();
  });

  it('throws naming the key and the reason', () => {
    expect(() => assertStorableProperties({ name: 'n', tags: ['a', undefined] })).toThrow(
      /^property tags cannot be stored: list element 1 is undefined/,
    );
  });
});
