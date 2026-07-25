/**
 * DbOps — neo4j Integer coercion at the graph→policy-engine seam, plus read robustness.
 *
 * The base library is driver-agnostic (driver typed `any`, no `neo4j-driver` dependency), so
 * these tests mock the bolt session directly: `driver.session()` → `{ run, close }`, where
 * `run(cypher, params)` resolves `{ records }` and each record answers `.get(key)`.
 *
 * The load-bearing test is the last block: a lossless neo4j `Integer` reaching Rego uncoerced
 * makes `input.port > 1024` compare object-vs-number and fire for *every* port (an object
 * outranks every number in Rego's total ordering) — a silent misfire the parity gate cannot
 * see because it never crosses db-ops. Coercing at the seam makes port 500 correctly not fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DbOps } from '../db-ops';
import { RegoEngine } from '../rego-engine';

/** A record whose `.get('attributes')` returns a relationship-shaped `{ properties }` bag. */
function attrsRecord(properties: Record<string, unknown>) {
  return { get: (key: string) => (key === 'attributes' ? { properties } : undefined) };
}

/** A bolt session mock. `run` resolves `{ records }`; `session()` can be made to throw. */
function makeDriver(records: unknown[], opts: { sessionThrows?: boolean } = {}) {
  const close = vi.fn(async () => {});
  const run = vi.fn(async () => ({ records }));
  const session = { run, close };
  const driver = {
    session: vi.fn(() => {
      if (opts.sessionThrows) throw new Error('session boom');
      return session;
    }),
  };
  return { driver, session, close };
}

/**
 * A neo4j `Integer` duck-type: `low`/`high` numbers plus `toNumber`/`inSafeRange`/`toString`.
 * `str` lets an out-of-range value express its exact string (a JS number literal would round).
 */
function fakeInt(num: number, opts: { safe?: boolean; str?: string } = {}) {
  const safe = opts.safe ?? true;
  return {
    low: num & 0xffffffff,
    high: Math.floor(num / 2 ** 32),
    toNumber: () => num,
    inSafeRange: () => safe,
    toString: () => opts.str ?? String(num),
  };
}

beforeEach(() => {
  // db-ops logs on the error paths (session-throw, empty-result throw) — keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getInstantiationAttributes — Integer coercion', () => {
  it('coerces a safe-range Integer to a plain number', async () => {
    const { driver } = makeDriver([attrsRecord({ port: fakeInt(8080) })]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({ port: 8080 });
    expect(typeof attrs.port).toBe('number');
  });

  it('preserves an out-of-range Integer losslessly as its exact decimal string, not a lossy number', async () => {
    const big = fakeInt(0, { safe: false, str: '9007199254740993' });
    const { driver } = makeDriver([attrsRecord({ big })]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({ big: '9007199254740993' });
  });

  it('coerces Integers nested under keys and inside arrays', async () => {
    const { driver } = makeDriver([
      attrsRecord({
        'config.timeout': fakeInt(30),
        'ports[0]': fakeInt(8080),
        'ports[1]': fakeInt(9090),
        name: 'web',
      }),
    ]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({ config: { timeout: 30 }, ports: [8080, 9090], name: 'web' });
  });

  it('coerces Integer elements inside a NATIVE list (non-UI writers do not flatten arrays)', async () => {
    // Import / direct-API writes persist `open_ports: [Integer, Integer]` as a native bolt
    // list — the flattened `ports[0]`-style keys only come from the UI. The coercion must
    // recurse into arrays or the object-vs-number misfire survives for array policies.
    const { driver } = makeDriver([
      attrsRecord({ open_ports: [fakeInt(22), fakeInt(443)], tags: ['a', 'b'] }),
    ]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({ open_ports: [22, 443], tags: ['a', 'b'] });
  });

  it('returns {} for an element that exists without an instantiation edge (COALESCE map has no .properties)', async () => {
    // OPTIONAL MATCH misses → COALESCE(r, {}) returns a map literal, which has no
    // `.properties` on either backend; unflattenProperties(undefined) must yield {}.
    const record = { get: (key: string) => (key === 'attributes' ? {} : undefined) };
    const { driver } = makeDriver([record]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({});
  });

  it('leaves non-Integer values untouched (strings, booleans, temporal/spatial and bare {low,high})', async () => {
    const dateLike = { low: 1, high: 2, year: 2020 }; // no toNumber/inSafeRange → not an Integer
    const bareLowHigh = { low: 5, high: 0 }; // POJO without methods → passes through
    const { driver } = makeDriver([
      attrsRecord({ d: dateLike, bare: bareLowHigh, s: 'text', b: true, n: 42 }),
    ]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('id1', 'class1');
    expect(attrs).toEqual({ d: dateLike, bare: bareLowHigh, s: 'text', b: true, n: 42 });
  });
});

describe('db-ops read robustness', () => {
  it('returns null (not a TypeError) when getInstantiationAttributes finds no node', async () => {
    const { driver } = makeDriver([]);
    const attrs = await new DbOps(driver).getInstantiationAttributes('missing', 'class1');
    expect(attrs).toBeNull();
  });

  it('does not mask the original error when driver.session() itself throws', async () => {
    const { driver, close } = makeDriver([], { sessionThrows: true });
    await expect(
      new DbOps(driver).getInstantiationAttributes('id', 'c'),
    ).rejects.toThrow('session boom'); // not "Cannot read properties of null (reading 'close')"
    expect(close).not.toHaveBeenCalled();
  });

  it('throws a descriptive error (not an opaque TypeError) on an empty getAttribute result', async () => {
    const { driver } = makeDriver([]);
    await expect(new DbOps(driver).getAttribute('missing', 'path')).rejects.toThrow(
      'No node found for id "missing"',
    );
  });

  it('throws a descriptive error on an empty getClassId result', async () => {
    const { driver } = makeDriver([]);
    await expect(new DbOps(driver).getClassId('missing')).rejects.toThrow(
      'No class found for node id "missing"',
    );
  });
});

describe('downstream misfire fixed at the real Rego consumer', () => {
  const POLICY = `package fixture.exposures.thing

exposures contains finding if {
	input.port > 1024
	finding := {"name": "high port", "score": 5.0}
}
`;

  function evalPort(input: unknown) {
    const engine = new RegoEngine();
    engine.register('k', POLICY);
    try {
      return engine.evaluate('k', 'exposures', input);
    } finally {
      engine.dispose();
    }
  }

  it('fires correctly for coerced numbers and misfires for a raw Integer object', () => {
    // Coerced numbers evaluate correctly.
    expect(evalPort({ port: 2048 })).toHaveLength(1); // > 1024 → fires
    expect(evalPort({ port: 500 })).toEqual([]); // < 1024 → does not fire

    // A raw {low,high} object outranks the number in Rego total ordering → spuriously fires
    // even for port 500. This is the bug the coercion closes.
    expect(evalPort({ port: { low: 500, high: 0 } })).toHaveLength(1);
  });

  it('end-to-end: a fakeInt(500) piped through db-ops no longer wrongly fires', async () => {
    const { driver } = makeDriver([attrsRecord({ port: fakeInt(500) })]);
    const coerced = await new DbOps(driver).getInstantiationAttributes('id', 'c');
    expect(coerced).toEqual({ port: 500 });
    expect(evalPort(coerced)).toEqual([]); // seam fix: port 500 correctly does not fire
  });
});
