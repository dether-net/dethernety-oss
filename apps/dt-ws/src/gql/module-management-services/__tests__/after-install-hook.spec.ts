import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// Unit coverage for the post-commit afterInstall lifecycle hook wired into
// updateAllModules + resetSingleModule. Mock driver; the heavy collaborators
// (upsertModule/resolveVectors/deleteOldModules) are spied so we observe only
// the hook loop's behaviour. Mirrors update-all-modules.skip-gate.spec.ts.

// Record-like stub mirroring neo4j driver records (.get(field)).
const rec = (
  name: string,
  contentHash: string | null,
  lastInstallStatus: string | null,
) => ({
  get: (k: string) =>
    (({ name, contentHash, lastInstallStatus }) as Record<string, unknown>)[k],
});

// A single persistent session whose executeWrite runs the callback against a
// shared writeTx. Both the install write AND the afterInstall partial-downgrade
// write flow through this one writeTx.run — and since upsertModule/deleteOldModules
// are mocked, the only real writeTx.run calls are the downgrade writes.
function makeDriver(installRows: ReturnType<typeof rec>[]) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  const session = {
    executeRead: jest.fn(async (cb: any) =>
      cb({ run: async () => ({ records: installRows }) }),
    ),
    executeWrite: jest.fn(async (cb: any) => cb(writeTx)),
    close: jest.fn(async () => {}),
  };
  const driver = { session: () => session };
  return { driver, session, writeTx };
}

function partialDowngradeCalls(writeTx: { run: jest.Mock }) {
  return writeTx.run.mock.calls.filter(
    ([cypher]) =>
      typeof cypher === 'string' && cypher.includes("lastInstallStatus = 'partial'"),
  );
}

async function buildService(driver: any, gqlConfig?: { moduleLoadTimeout?: number }) {
  const embedding: Partial<EmbeddingService> = {
    isEnabled: jest.fn(() => true),
    getDimensions: jest.fn(() => 3),
    getModel: jest.fn(() => 'nomic-embed-text'),
  };
  const matchClasses: Partial<MatchClassesResolverService> = {
    ensureVectorIndexes: jest.fn(async () => {}),
  };
  const eventLog = new ClassIdentityEventLog();
  const reconciler = {
    hasIncidentInstances: async () => false,
  } as unknown as ClassReconciler;

  const configGet = jest.fn((key: string) =>
    key === 'gql' ? gqlConfig : undefined,
  );

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: { get: configGet } },
      { provide: EmbeddingService, useValue: embedding },
      { provide: MatchClassesResolverService, useValue: matchClasses },
      { provide: 'NEO4J_DRIVER', useValue: driver },
      { provide: ClassReconciler, useValue: reconciler },
      { provide: ClassIdentityEventLog, useValue: eventLog },
    ],
  }).compile();

  const svc = mod.get(ModuleManagementService);
  const resolveVectors = jest
    .spyOn(svc as any, 'resolveVectors')
    .mockResolvedValue(null);
  // Echo the real module name so modulesInstalled carries it (and modules.get(name) resolves).
  const upsertModule = jest
    .spyOn(svc as any, 'upsertModule')
    .mockImplementation(async (_tx: any, metadata: any) => ({
      moduleId: 'id',
      moduleName: metadata.name,
      classesProcessed: 0,
      duration: 0,
    }));
  const deleteOldModules = jest
    .spyOn(svc as any, 'deleteOldModules')
    .mockResolvedValue(undefined);

  return { svc, resolveVectors, upsertModule, deleteOldModules };
}

// A module optionally carrying an afterInstall implementation.
const fakeModule = (
  name: string,
  contentHash?: string,
  afterInstall?: (ctx: any) => Promise<void>,
) =>
  ({
    getMetadata: async () => ({ name, ...(contentHash ? { contentHash } : {}) }),
    ...(afterInstall ? { afterInstall } : {}),
  }) as any;

describe('ModuleManagementService — afterInstall post-commit hook', () => {
  it('invokes afterInstall for a freshly installed module with the right context', async () => {
    const { driver, writeTx } = makeDriver([]); // empty → nothing skipped
    const { svc } = await buildService(driver);
    const hook = jest.fn(async () => {});

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha:x', hook)]]));

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({
      driver,
      moduleName: 'm1',
      // Unset database.name passes through as undefined (server default DB) —
      // the '|| neo4j' fallback split-brained the module plane from the
      // bootstrap DDL target and broke bare Memgraph deployments.
      databaseName: undefined,
    });
    // Happy path: no partial downgrade written.
    expect(partialDowngradeCalls(writeTx)).toHaveLength(0);
  });

  it('invokes afterInstall for a content-hash-SKIPPED module (the modulesInstalled invariant, #H9)', async () => {
    // Row present + authoritative + hash matches → skip gate skips the install.
    const { driver } = makeDriver([rec('m1', 'sha:x', 'authoritative')]);
    const { svc, upsertModule } = await buildService(driver);
    const hook = jest.fn(async () => {});

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha:x', hook)]]));

    expect(upsertModule).not.toHaveBeenCalled(); // proves it was skipped
    expect(hook).toHaveBeenCalledTimes(1); // …yet the hook still fires
  });

  it('isolates a throwing afterInstall and downgrades ONLY that module to partial', async () => {
    const { driver, writeTx } = makeDriver([]);
    const { svc } = await buildService(driver);
    const bad = jest.fn(async () => {
      throw new Error('boom');
    });
    const good = jest.fn(async () => {});

    await svc.updateAllModules(
      new Map([
        ['m1', fakeModule('m1', 'sha:x', bad)],
        ['m2', fakeModule('m2', 'sha:y', good)],
      ]),
    );

    // m2's hook still ran (isolation).
    expect(good).toHaveBeenCalledTimes(1);
    // Exactly one partial downgrade, for m1.
    const downgrades = partialDowngradeCalls(writeTx);
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0][1]).toEqual({ moduleName: 'm1' });
  });

  it('bounds a hanging afterInstall with the timeout and downgrades it', async () => {
    const { driver, writeTx } = makeDriver([]);
    const { svc } = await buildService(driver, { moduleLoadTimeout: 50 });
    const hang = jest.fn(() => new Promise<void>(() => {})); // never resolves

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha:x', hang)]]));

    // Did not wedge; the module was downgraded via the timeout path.
    const downgrades = partialDowngradeCalls(writeTx);
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0][1]).toEqual({ moduleName: 'm1' });
  });

  it('is a no-op for a module without afterInstall', async () => {
    const { driver, writeTx } = makeDriver([]);
    const { svc } = await buildService(driver);

    await expect(
      svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha:x')]])),
    ).resolves.toBeUndefined();

    expect(partialDowngradeCalls(writeTx)).toHaveLength(0);
  });

  it('resetSingleModule fires afterInstall (#H12) and downgrades on failure', async () => {
    const okDriver = makeDriver([]);
    const okSvc = await buildService(okDriver.driver);
    const hook = jest.fn(async () => {});

    await okSvc.svc.resetSingleModule(fakeModule('m1', 'sha:x', hook));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({
      driver: okDriver.driver,
      moduleName: 'm1',
      // Unset database.name passes through as undefined (server default DB) —
      // the '|| neo4j' fallback split-brained the module plane from the
      // bootstrap DDL target and broke bare Memgraph deployments.
      databaseName: undefined,
    });

    const badDriver = makeDriver([]);
    const badSvc = await buildService(badDriver.driver);
    await badSvc.svc.resetSingleModule(
      fakeModule('m1', 'sha:x', async () => {
        throw new Error('boom');
      }),
    );
    const downgrades = partialDowngradeCalls(badDriver.writeTx);
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0][1]).toEqual({ moduleName: 'm1' });
  });
});
