import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// Record-like stub mirroring neo4j driver records (.get(field)).
const rec = (
  name: string,
  contentHash: string | null,
  lastInstallStatus: string | null,
) => ({
  get: (k: string) =>
    (({ name, contentHash, lastInstallStatus }) as Record<string, unknown>)[k],
});

// Driver whose read returns the given :Module rows and whose write just runs
// the callback (upsertModule/deleteOldModules are spied/mocked on the service).
function makeDriver(installRows: ReturnType<typeof rec>[]) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  return {
    session: () => ({
      executeRead: jest.fn(async (cb: any) =>
        cb({ run: async () => ({ records: installRows }) }),
      ),
      executeWrite: jest.fn(async (cb: any) => cb(writeTx)),
      close: jest.fn(async () => {}),
    }),
  };
}

async function buildService(driver: any) {
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

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      { provide: EmbeddingService, useValue: embedding },
      { provide: MatchClassesResolverService, useValue: matchClasses },
      { provide: 'NEO4J_DRIVER', useValue: driver },
      { provide: ClassReconciler, useValue: reconciler },
      { provide: ClassIdentityEventLog, useValue: eventLog },
    ],
  }).compile();

  const svc = mod.get(ModuleManagementService);
  // Stub the heavy collaborators so we observe only the gate's decision.
  const resolveVectors = jest
    .spyOn(svc as any, 'resolveVectors')
    .mockResolvedValue(null);
  const upsertModule = jest.spyOn(svc as any, 'upsertModule').mockResolvedValue({
    moduleId: 'id',
    moduleName: 'm1',
    classesProcessed: 0,
    duration: 0,
  });
  const deleteOldModules = jest
    .spyOn(svc as any, 'deleteOldModules')
    .mockResolvedValue(undefined);

  return { svc, resolveVectors, upsertModule, deleteOldModules };
}

const fakeModule = (name: string, contentHash?: string) =>
  ({ getMetadata: async () => ({ name, ...(contentHash ? { contentHash } : {}) }) }) as any;

describe('ModuleManagementService.updateAllModules — content-hash skip gate', () => {
  it('skips an unchanged, authoritatively-installed module', async () => {
    const { svc, resolveVectors, upsertModule, deleteOldModules } =
      await buildService(makeDriver([rec('m1', 'sha256:x', 'authoritative')]));

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:x')]]));

    expect(resolveVectors).not.toHaveBeenCalled();
    expect(upsertModule).not.toHaveBeenCalled();
    // The skipped module is retained: passed to deleteOldModules as "valid".
    expect(deleteOldModules).toHaveBeenCalledTimes(1);
    expect(deleteOldModules.mock.calls[0][1]).toContain('m1');
  });

  it('reinstalls when the content hash differs', async () => {
    const { svc, resolveVectors, upsertModule } = await buildService(
      makeDriver([rec('m1', 'sha256:OLD', 'authoritative')]),
    );

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:NEW')]]));

    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('reinstalls when the last install was partial (hash matches)', async () => {
    const { svc, resolveVectors, upsertModule } = await buildService(
      makeDriver([rec('m1', 'sha256:x', 'partial')]),
    );

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:x')]]));

    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('reinstalls when force is set even though the hash matches', async () => {
    const { svc, resolveVectors, upsertModule } = await buildService(
      makeDriver([rec('m1', 'sha256:x', 'authoritative')]),
    );

    await svc.updateAllModules(
      new Map([['m1', fakeModule('m1', 'sha256:x')]]),
      { force: true },
    );

    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('reinstalls a legacy module that ships no contentHash', async () => {
    const { svc, resolveVectors, upsertModule } = await buildService(
      makeDriver([rec('m1', null, 'authoritative')]),
    );

    await svc.updateAllModules(new Map([['m1', fakeModule('m1')]]));

    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });
});
