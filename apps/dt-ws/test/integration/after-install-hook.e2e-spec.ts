// End-to-end proof of the post-commit afterInstall lifecycle hook against a
// testcontainers Memgraph. Drives updateAllModules with synthetic modules and
// verifies the load-bearing guarantee: when afterInstall runs, the module's own
// :Module node is already committed and VISIBLE to a fresh session — so a hook
// that MATCHes (:Module {name}) and links a node succeeds. Also proves failure
// isolation (a sibling without a hook is unaffected) and the self-heal downgrade
// (a throwing hook leaves the node at lastInstallStatus='partial').
//
// Mirrors skip-gate.e2e-spec.ts for service construction.

import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import type { DTMetadata, DTModule, ModuleInstallContext } from '@dethernety/dt-module';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(90_000);

const configStub: any = {
  get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
};
const embeddingStub: any = {
  isEnabled: () => false,
  getModel: () => '',
  getDimensions: () => 0,
  composeClassText: () => '',
  embedBatch: async () => null,
};
const matchStub: any = { ensureVectorIndexes: async () => undefined };

function num(v: any): number {
  return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
}

async function withRead(driver: any, fn: (tx: any) => Promise<any>): Promise<any> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}

// A synthetic module carrying one analysis class (so upsertModule persists a
// :Module node) plus an optional afterInstall.
const fakeModule = (
  name: string,
  contentHash: string,
  afterInstall?: (ctx: ModuleInstallContext) => Promise<void>,
): DTModule =>
  ({
    getMetadata: async (): Promise<DTMetadata> =>
      ({
        name,
        version: '1.0.0',
        description: '',
        contentHash,
        analysisClasses: [{ id: `c-${name}`, name: 'A' }],
      }) as unknown as DTMetadata,
    ...(afterInstall ? { afterInstall } : {}),
  }) as unknown as DTModule;

// A hook that links its own :Module node to a probe — the visibility proof.
const linkingHook = async (ctx: ModuleInstallContext): Promise<void> => {
  const session = ctx.driver.session({ database: ctx.databaseName });
  try {
    await session.executeWrite((tx: any) =>
      tx.run(
        `MATCH (m:Module {name: $n})
         MERGE (m)-[:AFTER_INSTALL_MARKER]->(:_AfterInstallProbe {n: $n})`,
        { n: ctx.moduleName },
      ),
    );
  } finally {
    await session.close();
  }
};

const readModule = async (mg: MemgraphHandle, name: string) => {
  const r = await withRead(mg.driver, (tx) =>
    tx.run(
      `MATCH (m:Module {name: $name})
       RETURN m.lastInstallStatus AS lastInstallStatus`,
      { name },
    ),
  );
  return r.records.length
    ? { lastInstallStatus: r.records[0].get('lastInstallStatus') }
    : null;
};

const markerCount = async (mg: MemgraphHandle, name: string): Promise<number> => {
  const r = await withRead(mg.driver, (tx) =>
    tx.run(
      `MATCH (:Module {name: $name})-[:AFTER_INSTALL_MARKER]->(:_AfterInstallProbe {n: $name})
       RETURN count(*) AS c`,
      { name },
    ),
  );
  return num(r.records[0].get('c'));
};

describe('afterInstall post-commit hook — updateAllModules end-to-end', () => {
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

  it('runs afterInstall post-commit so the hook sees its own :Module node; a hookless sibling is unaffected', async () => {
    await service.updateAllModules(
      new Map<string, DTModule>([
        ['mod-hook', fakeModule('mod-hook', 'sha256:v1', linkingHook)],
        ['mod-plain', fakeModule('mod-plain', 'sha256:v1')],
      ]),
    );

    // The hook matched its own node (proving post-commit visibility) and linked the probe.
    expect(await markerCount(mg, 'mod-hook')).toBe(1);
    // The hookless sibling installed fine and has no marker (isolation / no-op).
    expect(await markerCount(mg, 'mod-plain')).toBe(0);
    expect(await readModule(mg, 'mod-plain')).toEqual({ lastInstallStatus: 'authoritative' });
    expect(await readModule(mg, 'mod-hook')).toEqual({ lastInstallStatus: 'authoritative' });
  });

  it('downgrades a module to partial when its afterInstall throws (self-heal on next boot)', async () => {
    const throwingHook = async (): Promise<void> => {
      throw new Error('boom');
    };
    await service.updateAllModules(
      new Map<string, DTModule>([
        ['mod-bad', fakeModule('mod-bad', 'sha256:v1', throwingHook)],
      ]),
    );

    // Node persisted (classes installed authoritatively) but the hook failure
    // downgraded it → the skip gate will reinstall + re-run the hook next boot.
    expect(await readModule(mg, 'mod-bad')).toEqual({ lastInstallStatus: 'partial' });
  });
});
