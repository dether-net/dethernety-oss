/**
 * Engine detection: the component-name classification, the probe's session handling, the memoized
 * resolver (keeps a success, never keeps a failure, never falls back to a guessed engine), and the
 * fallback probe for a context from a platform without `getEngine`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ENGINE_PROBE_CYPHER,
  EngineProbeError,
  createEngineResolver,
  engineFromComponents,
  probeEngine,
  resolveEngine,
} from '../engine';

function row(name: string, versions: string[], edition: string) {
  return { get: (key: string) => (key === 'name' ? name : key === 'versions' ? versions : edition) };
}

function fakeDriver(run: () => Promise<{ records: unknown[] }>) {
  const close = vi.fn(async () => {});
  const runSpy = vi.fn(run);
  const session = vi.fn(() => ({ run: runSpy, close }));
  return { driver: { session }, session, run: runSpy, close };
}

describe('engineFromComponents', () => {
  it('reads Neo4j from "Neo4j Kernel" with its edition and version', () => {
    expect(engineFromComponents('Neo4j Kernel', ['5.26.0'], 'community')).toEqual({
      engine: 'neo4j',
      edition: 'community',
      version: '5.26.0',
    });
  });
  it('reads Memgraph from its compatibility answer', () => {
    expect(engineFromComponents('Memgraph', ['5.9.0'], 'community')).toEqual({
      engine: 'memgraph',
      edition: 'community',
      version: '5.9.0',
    });
  });
  it('keeps a missing edition and version as null', () => {
    expect(engineFromComponents('Memgraph', [], null)).toEqual({ engine: 'memgraph', edition: null, version: null });
  });
  it('returns a frozen answer, so one shared answer cannot be changed by a caller', () => {
    const info = engineFromComponents('Neo4j Kernel', ['5.26.0'], 'community');
    expect(Object.isFrozen(info)).toBe(true);
  });
  it('refuses a component that names neither engine', () => {
    expect(() => engineFromComponents('SomeGraph', ['1.0'], 'x')).toThrow(EngineProbeError);
    expect(() => engineFromComponents(undefined, [], null)).toThrow(EngineProbeError);
  });
});

describe('probeEngine', () => {
  it('runs the probe in its own session, on the named database, and closes it', async () => {
    const { driver, session, run, close } = fakeDriver(async () => ({ records: [row('Neo4j Kernel', ['5.26.0'], 'community')] }));
    await expect(probeEngine(driver, 'neo4j')).resolves.toMatchObject({ engine: 'neo4j' });
    expect(session).toHaveBeenCalledWith({ database: 'neo4j' });
    expect(run).toHaveBeenCalledWith(ENGINE_PROBE_CYPHER);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('uses the server default database when none is named', async () => {
    const { driver, session } = fakeDriver(async () => ({ records: [row('Memgraph', ['5.9.0'], 'community')] }));
    await probeEngine(driver);
    expect(session).toHaveBeenCalledWith({});
  });
  it('keeps the probe error when closing the session also fails', async () => {
    const driver = {
      session: () => ({
        run: async () => {
          throw new Error('probe failed');
        },
        close: async () => {
          throw new Error('close failed');
        },
      }),
    };
    await expect(probeEngine(driver)).rejects.toThrow('probe failed');
  });
  it('keeps the outcome when closing the session throws synchronously', async () => {
    const throwingClose = () => {
      throw new Error('close failed');
    };
    const ok = { session: () => ({ run: async () => ({ records: [row('Memgraph', ['5.9.0'], 'community')] }), close: throwingClose }) };
    await expect(probeEngine(ok)).resolves.toMatchObject({ engine: 'memgraph' });
    const failing = {
      session: () => ({
        run: async () => {
          throw new Error('probe failed');
        },
        close: throwingClose,
      }),
    };
    await expect(probeEngine(failing)).rejects.toThrow('probe failed');
  });
  it('rejects on no rows, and still closes the session', async () => {
    const { driver, close } = fakeDriver(async () => ({ records: [] }));
    await expect(probeEngine(driver)).rejects.toThrow(/no rows/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('createEngineResolver', () => {
  it('probes once and shares the answer', async () => {
    const { driver, run } = fakeDriver(async () => ({ records: [row('Memgraph', ['5.9.0'], 'community')] }));
    const getEngine = createEngineResolver(driver);
    const [a, b] = await Promise.all([getEngine(), getEngine()]);
    await getEngine();
    expect(a).toEqual(b);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects when the probe fails, with no Memgraph fallback, and probes again on the next call', async () => {
    let fail = true;
    const { driver, run } = fakeDriver(async () => {
      if (fail) {
        fail = false;
        throw new Error('db unreachable');
      }
      return { records: [row('Neo4j Kernel', ['5.26.0'], 'community')] };
    });
    const getEngine = createEngineResolver(driver);
    await expect(getEngine()).rejects.toThrow('db unreachable');
    await expect(getEngine()).resolves.toMatchObject({ engine: 'neo4j' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects every caller that shared a failed probe', async () => {
    const { driver } = fakeDriver(async () => {
      throw new Error('db unreachable');
    });
    const getEngine = createEngineResolver(driver);
    const results = await Promise.allSettled([getEngine(), getEngine()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('rejects when the driver throws before the probe runs', async () => {
    const getEngine = createEngineResolver({
      session: () => {
        throw new Error('driver not initialised');
      },
    });
    await expect(getEngine()).rejects.toThrow('driver not initialised');
  });
});

describe('resolveEngine', () => {
  it("uses the context's getEngine when the platform supplies it", async () => {
    const { driver, run } = fakeDriver(async () => ({ records: [] }));
    const getEngine = vi.fn(async () => ({ engine: 'neo4j' as const, edition: 'community', version: null }));
    await expect(resolveEngine({ driver, getEngine })).resolves.toMatchObject({ engine: 'neo4j' });
    expect(run).not.toHaveBeenCalled();
  });
  it('probes the driver when the platform predates getEngine, once per driver', async () => {
    const { driver, session, run } = fakeDriver(async () => ({ records: [row('Memgraph', ['5.9.0'], 'community')] }));
    await expect(resolveEngine({ driver, databaseName: 'memgraph' })).resolves.toMatchObject({ engine: 'memgraph' });
    await resolveEngine({ driver, databaseName: 'memgraph' });
    expect(session).toHaveBeenCalledWith({ database: 'memgraph' });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not keep a failed fallback probe', async () => {
    let fail = true;
    const { driver, run } = fakeDriver(async () => {
      if (fail) {
        fail = false;
        throw new Error('db unreachable');
      }
      return { records: [row('Neo4j Kernel', ['5.26.0'], 'community')] };
    });
    await expect(resolveEngine({ driver })).rejects.toThrow('db unreachable');
    await expect(resolveEngine({ driver })).resolves.toMatchObject({ engine: 'neo4j' });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('rejects, never throws, when the context has no usable driver or getEngine throws', async () => {
    await expect(resolveEngine({ driver: undefined })).rejects.toThrow();
    const getEngine = () => {
      throw new Error('sync failure');
    };
    await expect(resolveEngine({ driver: {}, getEngine: getEngine as any })).rejects.toThrow('sync failure');
  });
  it("passes a rejection from the context's getEngine through", async () => {
    const getEngine = vi.fn(async () => {
      throw new EngineProbeError('probe failed');
    });
    await expect(resolveEngine({ driver: {}, getEngine })).rejects.toThrow('probe failed');
  });
});
