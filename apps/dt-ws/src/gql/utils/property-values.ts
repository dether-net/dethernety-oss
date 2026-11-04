import {
  FLAT_KEY_MAX_INDEX,
  FLAT_KEY_MAX_LIST_SLOTS,
  FLAT_KEY_MAX_SEGMENTS,
  coerceNeoInt,
  flatKeySegments,
  unflattenFlatKeys,
  type DroppedFlatKey,
  type FlatKeyProblem,
} from '@dethernety/dt-module';

/**
 * The values both supported databases store as a property: a primitive (string, number, boolean) or a
 * homogeneous list of primitives. A null value removes the property and is accepted; a null element
 * inside a list is not, because Neo4j refuses a list that holds null. Memgraph would store it, so a write
 * that works on one engine and fails on the other is refused here, before the database sees it.
 *
 * Returns a violation message, or null when the value can be stored. A list's element is named by its
 * index; `undefined` and an array hole count as null, because the driver sends both as null.
 */
export function describeNonPrimitiveValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return null;
  if (Array.isArray(value)) {
    let elemType: string | null = null;
    // An index loop, so a hole (`!(i in value)`) is told apart from an explicit undefined.
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return `list element ${i} is missing; remove the empty entry (a list cannot hold null)`;
      const elem: unknown = value[i];
      if (elem === null || elem === undefined) {
        return `list element ${i} is ${elem === null ? 'null' : 'undefined'}; remove the empty entry (a list cannot hold null)`;
      }
      const et = typeof elem;
      if (et !== 'string' && et !== 'number' && et !== 'boolean') {
        return `list elements must be primitives (string|number|boolean); got ${et === 'object' ? (Array.isArray(elem) ? 'nested array' : 'nested object') : et}`;
      }
      if (elemType === null) {
        elemType = et;
      } else if (elemType !== et) {
        return `list must be homogeneous; saw both ${elemType} and ${et}`;
      }
    }
    return null;
  }
  return `value must be a primitive or a list of primitives; got ${t === 'object' ? 'nested object' : t}`;
}

/** Every key of a property map whose value cannot be stored, with the reason. */
export function propertyViolations(properties: Record<string, unknown>): { key: string; violation: string }[] {
  const out: { key: string; violation: string }[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const violation = describeNonPrimitiveValue(value);
    if (violation) out.push({ key, violation });
  }
  return out;
}

/**
 * Throws, naming the first key that cannot be stored and why, unless every value of the map can be. The callers'
 * error wrappers name the class or module.
 */
export function assertStorableProperties(properties: Record<string, unknown>): void {
  const [first] = propertyViolations(properties);
  if (first) throw new Error(`property ${first.key} cannot be stored: ${first.violation}`);
}

/**
 * A key as it may appear in an error message: control and bidirectional-formatting characters replaced, at most 80
 * characters (never splitting a character).
 */
export function printableFlatKey(key: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = key.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '?');
  const chars = Array.from(clean);
  return chars.length > 80 ? `${chars.slice(0, 80).join('')}…` : clean;
}

const FLAT_KEY_PROBLEM_TEXT: Record<Exclude<FlatKeyProblem, 'budget'>, string> = {
  empty: 'the key holds no name or index',
  index: `a list index is above the maximum of ${FLAT_KEY_MAX_INDEX}`,
  depth: `the key has more than ${FLAT_KEY_MAX_SEGMENTS} parts`,
  reserved: 'the key uses a reserved name (__proto__, constructor or prototype)',
  conflict: 'conflicts with another key: one uses this place as a list, the other as an object or a value',
};

/**
 * Why each key a request may not write was refused, for a validation error: one line per key, and the list total said
 * once. The caller caps the whole message.
 */
export function describeRefusedFlatKeys(dropped: DroppedFlatKey[], stored: ReadonlySet<string> = new Set()): string[] {
  const lines: string[] = [];
  let overTotal = 0;
  for (const d of dropped) {
    if (d.problem === 'budget') overTotal++;
    else {
      const where = stored.has(d.key) ? ' (already stored)' : '';
      lines.push(`attributes.${printableFlatKey(d.key)}${where}: ${FLAT_KEY_PROBLEM_TEXT[d.problem]}`);
    }
  }
  if (overTotal > 0) {
    lines.push(`attributes: the lists would hold more than ${FLAT_KEY_MAX_LIST_SLOTS} entries in all (${overTotal} key(s) over)`);
  }
  return lines;
}

/** Whether a request has a key with a value: one that only clears, or is empty, writes nothing. */
export function requestWrites(request: Record<string, unknown>): boolean {
  return Object.values(request).some((v) => v !== null && v !== undefined);
}

/** Copy of `stored` with the request applied: a value replaces, null removes. Keys stay own keys, `__proto__` too. */
function mergeAttributes(stored: Record<string, unknown>, request: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const put = (key: string, value: unknown) =>
    Object.defineProperty(merged, key, { value, enumerable: true, writable: true, configurable: true });
  for (const [key, value] of Object.entries(stored)) put(key, value);
  for (const [key, value] of Object.entries(request)) {
    if (value === null || value === undefined) delete merged[key];
    else put(key, value);
  }
  return merged;
}

// The places a request writes, as a tree of the parts its keys go through (the rebuild's own parts).
interface Written {
  names: Map<string, Written>;
  indexes: Map<number, Written>;
  leaf: boolean;
}
const place = (): Written => ({ names: new Map(), indexes: new Map(), leaf: false });

function writtenPlaces(request: Record<string, unknown>): Written {
  const root = place();
  for (const [key, value] of Object.entries(request)) {
    if (value === null || value === undefined) continue;
    const segments = flatKeySegments(key);
    if (typeof segments === 'string') continue;
    let at = root;
    for (const seg of segments) {
      const map: Map<string | number, Written> = 'index' in seg ? at.indexes : at.names;
      const k = 'index' in seg ? seg.index : seg.name;
      let next = map.get(k);
      if (!next) map.set(k, (next = place()));
      at = next;
    }
    at.leaf = true;
  }
  return root;
}

/**
 * Whether a stored key's place disagrees with what the request writes — the rebuild's conflict rule, at any depth:
 * one key runs into the other (a value where the other goes deeper), or they part where one has a name and the
 * other an index.
 */
function superseded(written: Written, key: string): boolean {
  const segments = flatKeySegments(key);
  if (typeof segments === 'string') return false;
  let at = written;
  for (const seg of segments) {
    if (at.leaf) return true;
    if ('index' in seg ? at.names.size > 0 : at.indexes.size > 0) return true;
    const next = 'index' in seg ? at.indexes.get(seg.index) : at.names.get(seg.name);
    if (!next) return false;
    at = next;
  }
  return true;
}

/**
 * The request to write, with the stored keys it supersedes cleared: a stored key the request does not send, whose
 * place disagrees with a place the request writes (a whole list against `name[i]` entries, `p[0]` against
 * `p[0].x`, a list against a group), is sent as null. So the request's shape wins at every depth, and an element
 * holding two shapes heals on its next write. Keys the request sends are left as sent.
 */
export function withRequestShapes(stored: Record<string, unknown>, request: Record<string, unknown>): Record<string, unknown> {
  const written = writtenPlaces(request);
  const out: Record<string, unknown> = { ...request };
  for (const key of Object.keys(stored)) {
    if (!Object.hasOwn(out, key) && superseded(written, key)) {
      Object.defineProperty(out, key, { value: null, enumerable: true, writable: true, configurable: true });
    }
  }
  return out;
}

/**
 * Whether writing the request changes the answers as the policies read them. A request that only moves an answer
 * from one shape to the other (a whole list to the same `name[i]` entries) changes keys but not answers.
 */
export function changesAnswers(stored: Record<string, unknown>, request: Record<string, unknown>): boolean {
  // Keys sorted at every level: the rebuild inserts in flat-key order, where `tags` and `tags[0]` may sort apart.
  const sortedKeys = (_: string, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x;
  const rebuilt = (flat: Record<string, unknown>) =>
    JSON.stringify(unflattenFlatKeys(flat, { leaf: coerceNeoInt }).value, sortedKeys);
  return rebuilt(stored) !== rebuilt(mergeAttributes(stored, request));
}

/**
 * Why writing a request into an element's stored answers would leave keys out: a key the request writes that the
 * merged answers leave out, or a stored key the stored answers alone kept. A key sent as null clears its stored
 * property, and a request that only clears is never refused. Keys the stored answers already leave out, and the
 * request does not write, are not held against it. A stored key in the reasons is marked "(already stored)".
 */
export function flatKeysRefusedByMerge(stored: Record<string, unknown>, request: Record<string, unknown>): string[] {
  const writes = (key: string) => Object.hasOwn(request, key) && request[key] !== null && request[key] !== undefined;
  if (!requestWrites(request)) return [];
  const merged = mergeAttributes(stored, request);
  const before = new Set(unflattenFlatKeys(stored).dropped.map((d) => d.key));
  const refused = unflattenFlatKeys(merged).dropped.filter((d) => writes(d.key) || !before.has(d.key));
  const storedOnly = new Set(Object.keys(stored).filter((k) => !Object.hasOwn(request, k)));
  return describeRefusedFlatKeys(refused, storedOnly);
}

/** At most 20 reasons, then a count, so a large request gets a short answer. */
export function capErrorLines(lines: string[]): string[] {
  return lines.length > 20 ? [...lines.slice(0, 20), `and ${lines.length - 20} more`] : lines;
}
