// End-to-end test of the content-hash skip gate against a testcontainers
// Memgraph. Drives updateAllModules (which performs the install-state read +
// the skip decision + the write) with a fake DTModule, proving the
// user-visible behaviour: install persists the hash, an unchanged re-run
// skips the write entirely, and a changed hash reinstalls.

import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import type { DTMetadata, DTModule } from '@dethernety/dt-module';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(90_000);

const configStub: any = {
  get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
};
// Embedding disabled → resolveVectors returns null early (no HTTP, no getEmbedding).
const embeddingStub: any = {
  isEnabled: () => false,
  isPending: () => false,
  whenStartupChecked: async () => undefined,
  onReady: () => () => undefined,
  getModel: () => '',
  getDimensions: () => 0,
  composeClassText: () => '',
  embedBatch: async () => null,
};

async function withRead(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

// Minimal DTModule: only getMetadata is exercised (embedding is disabled).
const fakeModule = (name: string, contentHash: string): DTModule =>
  ({
    getMetadata: async (): Promise<DTMetadata> =>
      ({
        name,
        version: '1.0.0',
        description: '',
        contentHash,
        analysisClasses: [{ id: 'c1', name: 'A' }],
      }) as unknown as DTMetadata,
  }) as unknown as DTModule;

const readModule = async (mg: MemgraphHandle, name: string) => {
  const r = await withRead(mg.driver, (tx) =>
    tx.run(
      `MATCH (m:Module {name: $name})
       RETURN m.contentHash AS contentHash, m.lastInstallStatus AS lastInstallStatus`,
      { name },
    ),
  );
  return r.records.length
    ? {
        contentHash: r.records[0].get('contentHash'),
        lastInstallStatus: r.records[0].get('lastInstallStatus'),
      }
    : null;
};

describe('content-hash skip gate — updateAllModules end-to-end', () => {
  let mg: MemgraphHandle;
  let service: ModuleManagementService;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    const log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    const reconciler = new ClassReconciler(mg.driver, log);
    reconciler.setMageAvailableForTesting(null);
    service = new ModuleManagementService(
      mg.driver,
      configStub,
      embeddingStub,
      reconciler,
      log,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => {});
  });

  it('installs (persisting the hash), skips an unchanged re-run, reinstalls on hash change', async () => {
    const name = 'mod-skip';

    // First install — no node yet, so it installs and persists the hash.
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(await readModule(mg, name)).toEqual({
      contentHash: 'sha256:v1',
      lastInstallStatus: 'authoritative',
    });

    // Second run, unchanged — the gate must skip resolveVectors + upsertModule.
    const upsert = jest.spyOn(service as any, 'upsertModule');
    const resolve = jest.spyOn(service as any, 'resolveVectors');
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(resolve).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    // Third run with a changed hash — must reinstall and update the node.
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v2')]]));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(await readModule(mg, name)).toEqual({
      contentHash: 'sha256:v2',
      lastInstallStatus: 'authoritative',
    });
  });

  it('records the embedder on the Module node and reinstalls when the embedding model changes', async () => {
    const name = 'mod-profile';
    const profileOf = async () =>
      (
        await withRead(mg.driver, (tx) =>
          tx.run(`MATCH (m:Module {name: $name}) RETURN m.embeddingProfile AS p`, { name }),
        )
      ).records[0]?.get('p');

    // Installed with embedding off.
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(await profileOf()).toBe('off');

    // Same content, embedding now on: the gate must reinstall so the classes are embedded with the new model.
    const embeddingOn: any = {
      ...embeddingStub,
      isEnabled: () => true,
      getState: () => 'ready',
      getModel: () => 'embeddinggemma-300m-retrieval-v1',
      getDimensions: () => 2,
      composeClassText: (c: any) => c.name ?? '',
      embedBatch: async (texts: string[]) => texts.map(() => [0.6, 0.8]),
    };
    const log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    const reconciler = new ClassReconciler(mg.driver, log);
    reconciler.setMageAvailableForTesting(null);
    const onService = new ModuleManagementService(mg.driver, configStub, embeddingOn, reconciler, log);
    jest.spyOn((onService as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((onService as any).logger, 'debug').mockImplementation(() => {});
    const upsert = jest.spyOn(onService as any, 'upsertModule');
    await onService.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(await profileOf()).toBe('embeddinggemma-300m-retrieval-v1/2');
    const classModel = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c {id: 'c1'}) RETURN c.embeddingModel AS model`, { name }),
    );
    expect(classModel.records[0]?.get('model')).toBe('embeddinggemma-300m-retrieval-v1');

    // Unchanged again under the same embedder: skipped.
    upsert.mockClear();
    await onService.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('installs again, with vectors, a module installed while the embedder was not ready, once it becomes ready', async () => {
    const name = 'mod-catch-up';
    const embedder = { ready: false, listeners: [] as Array<() => void> };
    const waiting: any = {
      ...embeddingStub,
      isEnabled: () => embedder.ready,
      isPending: () => !embedder.ready,
      getState: () => (embedder.ready ? 'ready' : 'loading'),
      getModel: () => 'embeddinggemma-300m-retrieval-v1',
      getDimensions: () => 2,
      composeClassText: (c: any) => c.name ?? '',
      embedBatch: async (texts: string[]) => texts.map(() => [0.6, 0.8]),
      onReady: (listener: () => void) => {
        embedder.listeners.push(listener);
        return () => undefined;
      },
    };
    const log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    const reconciler = new ClassReconciler(mg.driver, log);
    reconciler.setMageAvailableForTesting(null);
    const svc = new ModuleManagementService(mg.driver, configStub, waiting, reconciler, log);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((svc as any).logger, 'debug').mockImplementation(() => {});
    const modules = new Map([[name, fakeModule(name, 'sha256:v1')]]);
    svc.enableCatchUp(() => modules);

    // Installed while the embedder loads: partial, no vector.
    await svc.updateAllModules(modules);
    expect((await readModule(mg, name))?.lastInstallStatus).toBe('partial');

    // The embedder becomes ready: the catch-up installs it again with vectors.
    embedder.ready = true;
    for (const listener of embedder.listeners) listener();
    await (svc as any).installChain;
    expect(await readModule(mg, name)).toEqual({ contentHash: 'sha256:v1', lastInstallStatus: 'authoritative' });
    const classModel = await withRead(mg.driver, (tx) =>
      tx.run(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c {id: 'c1'}) RETURN c.embeddingModel AS model`, { name }),
    );
    expect(classModel.records[0]?.get('model')).toBe('embeddinggemma-300m-retrieval-v1');
  });

  it('reinstalls a module whose declared classes hold vectors of another embedder under a matching record, once', async () => {
    const name = 'mod-stale-vectors';
    const embeddingOn: any = {
      ...embeddingStub,
      isEnabled: () => true,
      getState: () => 'ready',
      getModel: () => 'embeddinggemma-300m-retrieval-v1',
      getDimensions: () => 2,
      composeClassText: (c: any) => c.name ?? '',
      embedBatch: async (texts: string[]) => texts.map(() => [0.6, 0.8]),
    };
    const module: DTModule = {
      getMetadata: async (): Promise<DTMetadata> =>
        ({
          name,
          version: '1.0.0',
          description: '',
          contentHash: 'sha256:v1',
          componentClasses: [
            { id: 'c1', name: 'Web server' },
            { id: 'c2', name: 'Database' },
            { id: 'c3', name: 'Queue' },
          ],
          analysisClasses: [{ id: 'a1', name: 'Report' }],
        }) as unknown as DTMetadata,
    } as unknown as DTModule;
    const log = new ClassIdentityEventLog();
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
    const reconciler = new ClassReconciler(mg.driver, log);
    reconciler.setMageAvailableForTesting(null);
    const svc = new ModuleManagementService(mg.driver, configStub, embeddingOn, reconciler, log);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((svc as any).logger, 'debug').mockImplementation(() => {});
    const write = async (cypher: string) => {
      const session = mg.driver.session({ database: 'memgraph' });
      try {
        await session.executeWrite((tx: any) => tx.run(cypher, { name }));
      } finally {
        await session.close();
      }
    };
    const upsert = jest.spyOn(svc as any, 'upsertModule');

    await svc.updateAllModules(new Map([[name, module]]));
    expect(upsert).toHaveBeenCalledTimes(1);

    // A stale analysis class and a stale orphaned class do not count: no search reads them, and an install does not
    // write an orphan.
    await write(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c:AnalysisClass {id: 'a1'}) SET c.embeddingModel = 'embeddinggemma'`);
    await write(
      `MATCH (m:Module {name: $name})
       CREATE (m)-[:HAS_ORPHANED_CLASS]->(:ComponentClass {id: 'o1', name: 'Retired', embedding: [1.0], embeddingModel: 'embeddinggemma'})`,
    );
    upsert.mockClear();
    await svc.updateAllModules(new Map([[name, module]]));
    expect(upsert).not.toHaveBeenCalled();

    // Another model, no model, another length: each counts, and the module is installed again.
    await write(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c:ComponentClass {id: 'c1'}) SET c.embeddingModel = 'embeddinggemma'`);
    await write(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c:ComponentClass {id: 'c2'}) REMOVE c.embeddingModel`);
    await write(`MATCH (:Module {name: $name})-[:HAS_CLASS]->(c:ComponentClass {id: 'c3'}) SET c.embedding = [0.6, 0.8, 0.0]`);
    await svc.updateAllModules(new Map([[name, module]]));
    expect(upsert).toHaveBeenCalledTimes(1);
    const classes = await withRead(mg.driver, (tx) =>
      tx.run(
        `MATCH (:Module {name: $name})-[:HAS_CLASS]->(c:ComponentClass)
         RETURN c.id AS id, c.embeddingModel AS model, size(c.embedding) AS dims ORDER BY id`,
        { name },
      ),
    );
    expect(classes.records.map((r: any) => [r.get('id'), r.get('model'), Number(r.get('dims'))])).toEqual([
      ['c1', 'embeddinggemma-300m-retrieval-v1', 2],
      ['c2', 'embeddinggemma-300m-retrieval-v1', 2],
      ['c3', 'embeddinggemma-300m-retrieval-v1', 2],
    ]);

    // Healed: the next start skips it.
    upsert.mockClear();
    await svc.updateAllModules(new Map([[name, module]]));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not delete a skipped module (retained as valid)', async () => {
    const name = 'mod-keep';
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    // Re-run unchanged → skipped; the module must still exist afterwards.
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(await readModule(mg, name)).not.toBeNull();
  });
});
