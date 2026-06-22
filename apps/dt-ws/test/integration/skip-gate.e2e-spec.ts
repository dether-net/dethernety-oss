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
  getModel: () => '',
  getDimensions: () => 0,
  composeClassText: () => '',
  embedBatch: async () => null,
};
const matchStub: any = { ensureVectorIndexes: async () => undefined };

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
      matchStub,
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

  it('does not delete a skipped module (retained as valid)', async () => {
    const name = 'mod-keep';
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    // Re-run unchanged → skipped; the module must still exist afterwards.
    await service.updateAllModules(new Map([[name, fakeModule(name, 'sha256:v1')]]));
    expect(await readModule(mg, name)).not.toBeNull();
  });
});
