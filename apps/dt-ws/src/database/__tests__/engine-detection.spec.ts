import { DatabaseService } from '../database.service';

/**
 * Pins for DatabaseService.getEngineInfo(): the single probe both bootstrap
 * DDL services branch on. `CALL dbms.components()` is answered by BOTH
 * engines (verified against live Memgraph 3.8.1: name "Memgraph", compat
 * version "5.9.0", edition "community"); the branch key is `name`.
 */

function makeService(runImpl: () => Promise<any>) {
  const service = new DatabaseService({
    get: () => ({ uri: 'bolt://test:7687', username: '', password: '' }),
  } as any);
  const run = jest.fn(runImpl);
  const close = jest.fn(async () => {});
  (service as any).getSession = jest.fn(() => ({ run, close }));
  return { service, run, close };
}

function componentsRow(name: string, versions: string[], edition: string) {
  return {
    records: [
      {
        get: (key: string) =>
          key === 'name' ? name : key === 'versions' ? versions : edition,
      },
    ],
  };
}

describe('DatabaseService.getEngineInfo', () => {
  it('detects Neo4j from "Neo4j Kernel" and carries the edition', async () => {
    const { service, close } = makeService(async () =>
      componentsRow('Neo4j Kernel', ['5.26.0'], 'enterprise'),
    );
    const info = await service.getEngineInfo();
    expect(info).toEqual({ engine: 'neo4j', edition: 'enterprise', version: '5.26.0' });
    expect(close).toHaveBeenCalled(); // probe session not leaked
  });

  it('detects Memgraph from its compat answer', async () => {
    const { service } = makeService(async () =>
      componentsRow('Memgraph', ['5.9.0'], 'community'),
    );
    const info = await service.getEngineInfo();
    expect(info).toEqual({ engine: 'memgraph', edition: 'community', version: '5.9.0' });
  });

  it('memoizes: two calls, one probe', async () => {
    const { service, run } = makeService(async () =>
      componentsRow('Memgraph', ['5.9.0'], 'community'),
    );
    const [a, b] = await Promise.all([service.getEngineInfo(), service.getEngineInfo()]);
    expect(a).toEqual(b);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('probe failure: memgraph default for that call, NOT memoized (next call re-probes)', async () => {
    let failFirst = true;
    const { service, run, close } = makeService(async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('db unreachable');
      }
      return componentsRow('Neo4j Kernel', ['5.26.0'], 'community');
    });

    // Failed probe: safe default, session still closed, nothing pinned.
    await expect(service.getEngineInfo()).resolves.toEqual({
      engine: 'memgraph',
      edition: null,
      version: null,
    });
    expect(close).toHaveBeenCalledTimes(1);

    // Recovery: the next call re-probes and gets the real engine.
    await expect(service.getEngineInfo()).resolves.toMatchObject({ engine: 'neo4j' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never rejects even when getSession throws synchronously (driver not initialized)', async () => {
    const service = new DatabaseService({
      get: () => ({ uri: 'bolt://test:7687', username: '', password: '' }),
    } as any);
    // Real getSession throws synchronously before initialization — the
    // public API must swallow it into the fallback, not reject.
    await expect(service.getEngineInfo()).resolves.toEqual({
      engine: 'memgraph',
      edition: null,
      version: null,
    });
  });
});
