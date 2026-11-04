/**
 * Flattened attribute keys, rebuilt into the nested value a policy reads.
 *
 * An element's answers are stored as flat properties on its IS_INSTANCE_OF edge: `name`, `name.part` and `name[3]`.
 * A key is author input, so the rebuild has fixed limits and touches nothing it did not create: a key that breaks a
 * limit, or that disagrees with what an earlier key built, is left out whole and reads as unanswered. The save path
 * (dt-ws setInstantiationAttributes) refuses a request with such keys, on its own and merged into the answers already
 * stored, so a key left out here comes from data written before the limits, or around the API. Well-formed answers
 * never reach a limit: class schemas only produce `name[i]` keys for short lists of scalars.
 *
 * Keep in step: dt-module flat-keys.ts and dt-core flat-keys.ts hold the same code (dt-module is CommonJS and cannot
 * load ESM-only dt-core at run time; a dt-module test runs both on one table), and dt-core-py flat_keys.py the same
 * rule.
 */

/** The largest list index a key may use. */
export const FLAT_KEY_MAX_INDEX = 10_000;
/** The most list entries one rebuild may create, over all keys together. */
export const FLAT_KEY_MAX_LIST_SLOTS = 100_000;
/** The most parts (names and indexes) one key may have. */
export const FLAT_KEY_MAX_SEGMENTS = 32;

/** Why a key was left out. */
export type FlatKeyProblem = 'empty' | 'index' | 'depth' | 'reserved' | 'conflict' | 'budget';

export interface DroppedFlatKey {
  key: string;
  problem: FlatKeyProblem;
}

export interface UnflattenOptions {
  /** Fill lists with null up to each index rather than leave holes (the model export does). */
  padLists?: boolean;
  /** Maps each value as it is written (DbOps coerces graph integers here). */
  leaf?: (value: unknown) => unknown;
}

/** One part of a flat key: a name (`tags`, `x`) or a list index (`[3]`). */
export type FlatKeySegment = { name: string } | { index: number };
type Segment = FlatKeySegment;

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

// A name runs up to the next dot or bracket; an index is ASCII digits in brackets. Which group matched decides the
// kind, so `a.5` is a name and only `a[5]` is an index.
const SEGMENT = /([^.[\]]+)|\[([0-9]+)\]/g;

function parseFlatKey(key: string): Segment[] | FlatKeyProblem {
  const segments: Segment[] = [];
  for (const m of key.matchAll(SEGMENT)) {
    if (m[1] !== undefined) {
      if (RESERVED.has(m[1])) return 'reserved';
      segments.push({ name: m[1] });
    } else {
      // Compare the digits before converting: a long run would become Infinity, or lose precision.
      const digits = m[2].replace(/^0+(?=[0-9])/, '');
      if (digits.length > String(FLAT_KEY_MAX_INDEX).length || Number(digits) > FLAT_KEY_MAX_INDEX) return 'index';
      segments.push({ index: Number(digits) });
    }
    if (segments.length > FLAT_KEY_MAX_SEGMENTS) return 'depth';
  }
  return segments.length > 0 ? segments : 'empty';
}

/** A key's parts, as the rebuild reads them, or why the rebuild leaves the key out on its own. */
export function flatKeySegments(key: string): FlatKeySegment[] | FlatKeyProblem {
  return parseFlatKey(key);
}

const isIndex = (s: Segment): s is { index: number } => 'index' in s;
const absent = (v: unknown) => v === undefined || v === null;

/** A container's own entry, never an inherited member such as `toString`. */
function own(container: any, seg: Segment): unknown {
  if (isIndex(seg)) return container[seg.index];
  return Object.hasOwn(container, seg.name) ? container[seg.name] : undefined;
}

/**
 * How many list entries writing the key would create, or why it cannot be written. Only containers this rebuild
 * created may be entered — an index needs a list, a name a plain object — so a value from the input (a list answer)
 * is never extended. The leaf must be free; the first key to claim a place keeps it.
 */
function growthOf(root: object, segments: Segment[], created: Set<object>): number | 'conflict' {
  let current: unknown = root;
  let growth = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (absent(current)) {
      // Built by this key from here on: only new lists add entries.
      if (isIndex(seg)) growth += seg.index + 1;
      continue;
    }
    if (typeof current !== 'object' || current === null || !created.has(current)) return 'conflict';
    if (isIndex(seg) !== Array.isArray(current)) return 'conflict';
    if (isIndex(seg)) growth += Math.max(0, seg.index + 1 - (current as unknown[]).length);
    const child = own(current, seg);
    if (i === segments.length - 1 && !absent(child)) return 'conflict';
    current = child;
  }
  return growth;
}

function write(root: object, segments: Segment[], value: unknown, created: Set<object>, padLists: boolean): void {
  let current: any = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const k = isIndex(seg) ? seg.index : seg.name;
    if (padLists && Array.isArray(current)) {
      while (current.length <= (k as number)) current.push(null);
    }
    if (i === segments.length - 1) {
      current[k] = value;
    } else {
      let next = own(current, seg);
      if (absent(next)) {
        next = isIndex(segments[i + 1]) ? [] : {};
        created.add(next as object);
        current[k] = next;
      }
      current = next;
    }
  }
}

/**
 * Rebuilds flat keys into a nested value within the limits above. Keys are taken in sorted order, so the result and
 * the left-out keys do not depend on the order the properties arrive in. The input is never modified.
 */
export function unflattenFlatKeys(
  flat: Record<string, unknown>,
  { padLists = false, leaf = (v: unknown) => v }: UnflattenOptions = {},
): { value: Record<string, any>; dropped: DroppedFlatKey[] } {
  const value: Record<string, any> = {};
  const created = new Set<object>([value]);
  const dropped: DroppedFlatKey[] = [];
  let slots = 0;
  for (const key of Object.keys(flat).sort()) {
    const segments = parseFlatKey(key);
    if (typeof segments === 'string') {
      dropped.push({ key, problem: segments });
      continue;
    }
    const growth = growthOf(value, segments, created);
    if (growth === 'conflict') {
      dropped.push({ key, problem: 'conflict' });
      continue;
    }
    if (slots + growth > FLAT_KEY_MAX_LIST_SLOTS) {
      dropped.push({ key, problem: 'budget' });
      continue;
    }
    slots += growth;
    write(value, segments, leaf(flat[key]), created, padLists);
  }
  return { value, dropped };
}
