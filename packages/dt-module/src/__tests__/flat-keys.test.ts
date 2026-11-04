import { describe, expect, it } from 'vitest';
import * as core from '@dethernety/dt-core/flat-keys';
import { DbOps } from '../db-ops';
import {
  FLAT_KEY_MAX_INDEX,
  FLAT_KEY_MAX_LIST_SLOTS,
  FLAT_KEY_MAX_SEGMENTS,
  unflattenFlatKeys,
} from '../flat-keys';

const unflatten = (flat: Record<string, unknown>) => new DbOps(null).unflattenProperties(flat);
const dropped = (flat: Record<string, unknown>) => unflattenFlatKeys(flat).dropped;

// The total length of every list in a value, holes included: what a JSON encoding of it walks.
function listSlots(v: unknown): number {
  if (Array.isArray(v)) return v.length + Array.from(v).reduce((n: number, x) => n + listSlots(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce((n: number, x) => n + listSlots(x), 0);
  return 0;
}

const deepKey = (parts: number) => Array.from({ length: parts }, (_, i) => `p${i}`).join('.');
const manyLists = () => {
  const flat: Record<string, string> = {};
  for (let i = 0; i < 200; i++) flat[`a${i}[${FLAT_KEY_MAX_INDEX}]`] = 'x';
  for (let i = 0; i < 20; i++) flat[`n[${i}][${FLAT_KEY_MAX_INDEX}]`] = 'x';
  flat[`deep[${FLAT_KEY_MAX_INDEX}][${FLAT_KEY_MAX_INDEX}][${FLAT_KEY_MAX_INDEX}]`] = 'x';
  return flat;
};

// Every case both copies of the rule must agree on.
const CASES: Record<string, Record<string, unknown>> = {
  'well formed': { enabled: true, 'tls.version': '1.3', 'o[0]': 'a', 'o[1]': 'b', 'p[2]': 443, 'd.l[0].n': 'x' },
  'order': { 'l[10]': 'k', 'l[2]': 'c', 'l[0]': 'a', 'g.b': 1, s: 's' },
  'huge index': { 'o[4294967294]': 'x', 'o[0]': 'a' },
  'largest and next index': { [`a[${FLAT_KEY_MAX_INDEX}]`]: 1, [`b[${FLAT_KEY_MAX_INDEX + 1}]`]: 2, 'c[0003]': 3 },
  'long digits': { [`l[${'9'.repeat(400)}]`]: 'x' },
  'many lists': manyLists(),
  'depth': { [deepKey(FLAT_KEY_MAX_SEGMENTS)]: 1, [deepKey(FLAT_KEY_MAX_SEGMENTS + 1)]: 2 },
  'empty': { '': 1, '.': 2, '[]': 3 },
  'reserved': { 'x.__proto__': 1, 'constructor.y': 2, 'z.prototype[0]': 3 },
  'inherited names': { 'hasOwnProperty.call': 1, 'toString.call.apply': 2, 'a.valueOf[0]': 3, 'toString.name': 4 },
  'conflicts': { 'ports[0]': 1, 'ports.length': 9, 'x[0]y': 2, 'x[0][1]': 1, a: 5, 'a.b': 6, '[5]': 'x' },
  'list answer': { a: ['x'], 'a[3]': 'y', g: { q: 1 }, 'g.b': 2 },
};

describe('unflatten: well-formed keys', () => {
  it('rebuilds scalars, groups and lists as before', () => {
    expect(unflatten(CASES['well formed'])).toEqual({
      enabled: true,
      tls: { version: '1.3' },
      o: ['a', 'b'],
      p: [undefined, undefined, 443],
      d: { l: [{ n: 'x' }] },
    });
  });

  it('gives the same result whatever order the keys arrive in', () => {
    const keys = CASES.order;
    expect(unflatten(Object.fromEntries(Object.entries(keys).reverse()))).toEqual(unflatten(keys));
  });

  it('coerces graph integers at the leaf', () => {
    const int = { low: 8080, high: 0, toNumber: () => 8080, inSafeRange: () => true };
    expect(unflatten({ 'ports[0]': int, port: int })).toEqual({ ports: [8080], port: 8080 });
  });

  it('treats null and undefined properties as no keys', () => {
    expect(unflatten(null as any)).toEqual({});
    expect(unflatten(undefined as any)).toEqual({});
  });
});

describe('unflatten: keys over the limits are left out whole', () => {
  it('leaves out an index far above the limit, keeps the rest, and the value stays small', () => {
    const { value, dropped: d } = unflattenFlatKeys(CASES['huge index']);
    expect(value).toEqual({ o: ['a'] });
    expect(d).toEqual([{ key: 'o[4294967294]', problem: 'index' }]);
    expect(JSON.stringify(value).length).toBeLessThan(100);
  });

  it('keeps the largest allowed index, reads leading zeros, and leaves out the next index and long digit runs', () => {
    const { value, dropped: d } = unflattenFlatKeys(CASES['largest and next index']);
    expect(value.a).toHaveLength(FLAT_KEY_MAX_INDEX + 1);
    expect(value.c[3]).toBe(3);
    expect(d).toEqual([{ key: `b[${FLAT_KEY_MAX_INDEX + 1}]`, problem: 'index' }]);
    expect(dropped(CASES['long digits'])[0].problem).toBe('index');
  });

  it('bounds the total list length across many keys, separate or nested', () => {
    const { value, dropped: d } = unflattenFlatKeys(CASES['many lists']);
    expect(listSlots(value)).toBeLessThanOrEqual(FLAT_KEY_MAX_LIST_SLOTS);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.problem === 'budget')).toBe(true);
    expect(JSON.stringify(value).length).toBeLessThan(FLAT_KEY_MAX_LIST_SLOTS * 10);
  });

  it('allows exactly the list total and leaves out the next entry', () => {
    const flat: Record<string, string> = {};
    for (let i = 0; i < 9; i++) flat[`a${i}[${FLAT_KEY_MAX_INDEX}]`] = 'x'; // 9 × 10001 = 90009 entries
    flat[`b[${FLAT_KEY_MAX_LIST_SLOTS - 90009 - 1}]`] = 'y'; // 9991 more: exactly the total
    flat['c[0]'] = 'z';
    const { value, dropped: d } = unflattenFlatKeys(flat);
    expect(listSlots(value)).toBe(FLAT_KEY_MAX_LIST_SLOTS);
    expect(d).toEqual([{ key: 'c[0]', problem: 'budget' }]);
  });

  it(`leaves out a key with more than ${FLAT_KEY_MAX_SEGMENTS} parts, and one that names nothing`, () => {
    expect(dropped(CASES.depth)).toEqual([{ key: deepKey(FLAT_KEY_MAX_SEGMENTS + 1), problem: 'depth' }]);
    expect(dropped(CASES.empty).map((d) => d.problem)).toEqual(['empty', 'empty', 'empty']);
  });

  it('leaves out a key with a reserved part instead of moving its value', () => {
    expect(unflattenFlatKeys(CASES.reserved)).toEqual({
      value: {},
      dropped: ['constructor.y', 'x.__proto__', 'z.prototype[0]'].map((key) => ({ key, problem: 'reserved' })),
    });
  });
});

describe('unflatten: it only writes into what it builds', () => {
  it('treats inherited names as ordinary own keys and never reaches the built-ins', () => {
    const callBefore = Function.prototype.call;
    expect(unflatten(CASES['inherited names'])).toEqual({
      hasOwnProperty: { call: 1 },
      toString: { call: { apply: 2 }, name: 4 },
      a: { valueOf: [3] },
    });
    expect(Object.prototype.hasOwnProperty.call).toBe(callBefore);
    expect(Object.prototype.toString.call).toBe(callBefore);
    expect(Function.prototype.call).toBe(callBefore);
    expect((Object.prototype.valueOf as any)[0]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call({ a: 1 }, 'a')).toBe(true);
  });

  it('never extends or changes a list or object that came in as a value', () => {
    const flat = { a: ['x'], 'a[3]': 'y', g: { q: 1 }, 'g.b': 2 };
    const { value, dropped: d } = unflattenFlatKeys(flat);
    expect(flat.a).toEqual(['x']);
    expect(flat.g).toEqual({ q: 1 });
    expect(value).toEqual({ a: ['x'], g: { q: 1 } });
    expect(d.map((x) => x.key)).toEqual(['a[3]', 'g.b']);
  });
});

describe('unflatten: keys that disagree about a place — the first, in sorted order, wins', () => {
  it('keeps a name and leaves out an index at the same place (a name sorts first), never growing a list', () => {
    for (const name of ['ports.length', 'ports.4294967294', 'ports.x']) {
      const { value, dropped: d } = unflattenFlatKeys({ 'ports[0]': 1, [name]: 9 });
      expect(Array.isArray(value.ports)).toBe(false);
      expect(listSlots(value)).toBe(0);
      expect(d).toEqual([{ key: 'ports[0]', problem: 'conflict' }]);
    }
  });

  it('leaves out a name on a list and an index on an object, below the top', () => {
    expect(unflattenFlatKeys({ 'l[0][1]': 1, 'l[0].b': 2 })).toEqual({
      value: { l: [{ b: 2 }] },
      dropped: [{ key: 'l[0][1]', problem: 'conflict' }],
    });
    expect(unflatten({ 'm[0][0]': 1, 'm[0][0]x': 2 })).toEqual({ m: [[1]] });
    // 'x[0][1]' sorts before 'x[0]y', so the list comes first and the name on it is left out.
    expect(unflattenFlatKeys({ 'x[0]y': 2, 'x[0][1]': 1 })).toEqual({
      value: { x: [[undefined, 1]] },
      dropped: [{ key: 'x[0]y', problem: 'conflict' }],
    });
  });

  it('leaves out a container where a value is, a value where something is, and an index at the top', () => {
    expect(unflatten({ a: 5, 'a.b': 6 })).toEqual({ a: 5 });
    expect(unflatten({ 'l[0]': 1, 'l[0].b': 2 })).toEqual({ l: [1] });
    expect(unflatten({ 'a.b': 1, a: 2 })).toEqual({ a: 2 }); // 'a' sorts first
    expect(unflatten({ 'l[1]': 'x', 'l[01]': 'y' })).toEqual({ l: [undefined, 'y'] }); // 'l[01]' sorts first
    expect(unflatten({ 'l[01]': 'y', 'l[1]': 'x' })).toEqual({ l: [undefined, 'y'] }); // whatever the arrival order
    expect(dropped({ '[4294967294]': 'x' })[0].problem).toBe('index');
    expect(dropped({ '[5]': 'x' })[0].problem).toBe('conflict');
  });
});

describe('dt-core holds the same rule', () => {
  it('has the same limits', () => {
    expect(core.FLAT_KEY_MAX_INDEX).toBe(FLAT_KEY_MAX_INDEX);
    expect(core.FLAT_KEY_MAX_LIST_SLOTS).toBe(FLAT_KEY_MAX_LIST_SLOTS);
    expect(core.FLAT_KEY_MAX_SEGMENTS).toBe(FLAT_KEY_MAX_SEGMENTS);
  });

  it.each(Object.keys(CASES))('rebuilds "%s" the same way, padded or not', (name) => {
    for (const padLists of [false, true]) {
      expect(core.unflattenFlatKeys(CASES[name], { padLists })).toEqual(unflattenFlatKeys(CASES[name], { padLists }));
    }
  });
});
