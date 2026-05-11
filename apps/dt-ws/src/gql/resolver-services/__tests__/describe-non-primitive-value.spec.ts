/**
 * Pre-validate attribute value shapes against the Memgraph property
 * model. Standalone unit tests for the helper.
 */

import { describeNonPrimitiveValue } from '../set-instantiation-attributes.service';

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
});
