/**
 * Pre-validate property value shapes against what both supported databases
 * store. Standalone unit tests for the helpers.
 */

import {
  assertStorableProperties,
  capErrorLines,
  changesAnswers,
  describeMalformedFlatKeys,
  describeNonPrimitiveValue,
  describeRefusedFlatKeys,
  flatKeysRefusedByMerge,
  printableFlatKey,
  propertyViolations,
  requestWrites,
  withRequestShapes,
} from '../property-values';
import * as fs from 'fs';
import * as path from 'path';

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

describe('withRequestShapes: the shape a request writes wins, at any depth', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]> = [
    ['entries replace a whole list', { tags: ['a'], o: 1 }, { 'tags[0]': 'b' }, { 'tags[0]': 'b', tags: null }],
    ['a whole list replaces entries', { 'tags[0]': 'a', 'tags[1]': 'b' }, { tags: ['c'] }, { tags: ['c'], 'tags[0]': null, 'tags[1]': null }],
    ['a whole value replaces a group', { 'p.x': 1, 'p.y': 2 }, { p: 'v' }, { p: 'v', 'p.x': null, 'p.y': null }],
    ['a group replaces a whole value', { p: 'v' }, { 'p.x': 1 }, { 'p.x': 1, p: null }],
    ['a list replaces a group', { 'p.x': 1 }, { 'p[0]': 1 }, { 'p[0]': 1, 'p.x': null }],
    ['objects in a list replace strings in it', { 'p[0]': 'a', 'p[1]': 'b' }, { 'p[0].x': 1 }, { 'p[0].x': 1, 'p[0]': null }],
    ['a value replaces a deeper group', { 'c.m.l': 1 }, { 'c.m': 's' }, { 'c.m': 's', 'c.m.l': null }],
    ['same-shape neighbours stay', { 'p.a': 1, 'p[1]': 2 }, { 'p.b': 3 }, { 'p.b': 3, 'p[1]': null }],
    ['other entries of a list stay', { 'p[1]': 'b', q: 1 }, { 'p[0]': 'a' }, { 'p[0]': 'a' }],
    ['the parser decides the shape: p[x] is a group', { 'p.y': 1 }, { 'p[x]': 2 }, { 'p[x]': 2 }],
    ['keys sent as null are left as sent, and supersede nothing', { tags: ['a'] }, { 'tags[0]': null }, { 'tags[0]': null }],
    ['names like built-ins are ordinary names', { toString: ['a'] }, { 'toString[0]': 'b' }, { 'toString[0]': 'b', toString: null }],
  ];
  it.each(cases)('%s', (_, stored, request, expected) => {
    expect(withRequestShapes(stored, request)).toEqual(expected);
    expect(flatKeysRefusedByMerge(stored, withRequestShapes(stored, request))).toEqual([]);
  });
});

describe('flatKeysRefusedByMerge', () => {
  const totalFull = () => {
    const stored: Record<string, string> = {};
    for (let i = 0; i < 9; i++) stored[`b${i}[10000]`] = 'x';
    return stored;
  };

  it('refuses a request key the merge leaves out, and a stored key it pushes out, naming the stored one', () => {
    expect(flatKeysRefusedByMerge(totalFull(), { 'c[10000]': 'y' })).toEqual([
      'attributes: the lists would hold more than 100000 entries in all (1 key(s) over)',
    ]);
    expect(flatKeysRefusedByMerge(totalFull(), { 'a[10000]': 'y' })).toHaveLength(1);
  });

  it('refuses re-writing a key the stored answers already leave out', () => {
    const stored = { ...totalFull(), 'c[10000]': 'z' }; // c sorts last and is over the total already
    expect(flatKeysRefusedByMerge(stored, { 'c[10000]': 'y' })).toHaveLength(1);
    expect(flatKeysRefusedByMerge(stored, { d: 1 })).toEqual([]);
  });

  it('never refuses a request that writes nothing', () => {
    expect(flatKeysRefusedByMerge({ 'a[00].x': 1, 'a[00][0]': 2, 'a[0].z': 3 }, { 'a[00].x': null })).toEqual([]);
    expect(flatKeysRefusedByMerge(totalFull(), {})).toEqual([]);
  });
});

describe('requestWrites and changesAnswers', () => {
  it('tells a request that writes from one that only clears', () => {
    expect(requestWrites({})).toBe(false);
    expect(requestWrites({ a: null, b: undefined })).toBe(false);
    expect(requestWrites({ a: null, b: 0 })).toBe(true);
  });

  it('moving an answer to the other shape changes keys but not answers', () => {
    const int = { low: 2, high: 0, toNumber: () => 2, inSafeRange: () => true };
    expect(changesAnswers({ tags: ['a', 'b'] }, withRequestShapes({ tags: ['a', 'b'] }, { 'tags[0]': 'a', 'tags[1]': 'b' }))).toBe(false);
    expect(changesAnswers({ n: int }, { n: 2 })).toBe(false);
    expect(changesAnswers({ tags: ['a', 'b'] }, withRequestShapes({ tags: ['a', 'b'] }, { 'tags[0]': 'a' }))).toBe(true);
    expect(changesAnswers({ a: 1 }, { a: null })).toBe(true);
    // A sibling that sorts between `tags` and `tags[0]` must not make a pure move look like a change.
    const stored = { tags: ['a', 'b'], tagsEnabled: true, 'tags-x': 1 };
    expect(changesAnswers(stored, withRequestShapes(stored, { 'tags[0]': 'a', 'tags[1]': 'b' }))).toBe(false);
  });
});

describe('error text for flat keys', () => {
  it('marks a stored key, says the list total once, and prints keys short and clean', () => {
    expect(
      describeRefusedFlatKeys(
        [
          { key: 'p[0].x', problem: 'conflict' },
          { key: 'q[1]', problem: 'conflict' },
          { key: 'a[1]', problem: 'budget' },
          { key: 'b[1]', problem: 'budget' },
        ],
        new Set(['p[0].x']),
      ),
    ).toEqual([
      'attributes.p[0].x (already stored): conflicts with another key: one uses this place as a list, the other as an object or a value',
      'attributes.q[1]: conflicts with another key: one uses this place as a list, the other as an object or a value',
      'attributes: the lists would hold more than 100000 entries in all (2 key(s) over)',
    ]);
    expect(printableFlatKey('a\u0000b\u202ec')).toBe('a?b?c');
    expect(printableFlatKey('k'.repeat(500))).toBe(`${'k'.repeat(80)}…`);
    expect(printableFlatKey('😀'.repeat(81))).toBe(`${'😀'.repeat(80)}…`);
  });

  it('caps a long list of reasons at 20 and counts the rest', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `r${i}`);
    expect(capErrorLines(lines)).toEqual([...lines.slice(0, 20), 'and 5 more']);
    expect(capErrorLines(['a'])).toEqual(['a']);
  });
});

describe('describeMalformedFlatKeys: only the plain form of a key is written', () => {
  it.each([
    ['a[]', 'a'],
    ['a[x]', 'a.x'],
    ['d[-1]', 'd.-1'],
    ['l[01]', 'l[1]'],
    ['l[0003]', 'l[3]'],
    ['a..b', 'a.b'],
    ['.a', 'a'],
    ['a.', 'a'],
    ['a]', 'a'],
  ])('refuses %s, naming its plain form %s', (key, plain) => {
    expect(describeMalformedFlatKeys({ [key]: 1 })).toEqual([`attributes.${key}: the key is not in its plain form (${plain})`]);
  });

  it('accepts plain keys, names that are all digits, and keys sent as null', () => {
    expect(describeMalformedFlatKeys({ a: 1, 'a.b': 2, 'l[0]': 3, 'l[10]': 4, 'g[0].x[2]': 5, 'v.5': 6, 'with space': 7 })).toEqual([]);
    expect(describeMalformedFlatKeys({ 'a[]': null, 'l[01]': undefined })).toEqual([]);
  });

  it('accepts every key the dt-core flattener writes: groups, lists, lists of groups, lists of lists', () => {
    // The keys dt-core's flattenProperties writes, pinned by its own test against this same file.
    const fixture = path.join(__dirname, '../../../../../../packages/dt-core/src/dt-utils/__tests__/fixtures/flattened-answers.json');
    const { flat } = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    expect(Object.keys(flat).length).toBeGreaterThan(10);
    expect(describeMalformedFlatKeys(flat)).toEqual([]);
  });

  it('gives a key whose plain form starts with a list index that reason', () => {
    expect(describeMalformedFlatKeys({ '[05]': 1, '.[5]': 2 })).toEqual([
      'attributes.[05]: a key cannot start with a list index',
      'attributes..[5]: a key cannot start with a list index',
    ]);
  });

  it('gives a bracketed name at the top the plain-form reason, not the list-index one', () => {
    expect(describeMalformedFlatKeys({ '[ABC]': 1 })).toEqual(['attributes.[ABC]: the key is not in its plain form (ABC)']);
    expect(describeRefusedFlatKeys([{ key: '[ABC]', problem: 'conflict' }])).not.toContain(
      'attributes.[ABC]: a key cannot start with a list index',
    );
  });

  it('leaves keys the rebuild refuses anyway to that check', () => {
    expect(describeMalformedFlatKeys({ 'x.__proto__': 1, 'l[99999]': 1, '': 1 })).toEqual([]);
  });

  it('says plainly that a key cannot start with a list index', () => {
    expect(describeRefusedFlatKeys([{ key: '[5]', problem: 'conflict' }])).toEqual([
      'attributes.[5]: a key cannot start with a list index',
    ]);
  });
});

