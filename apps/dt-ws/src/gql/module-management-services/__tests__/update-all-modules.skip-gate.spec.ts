import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';
import { computedContentHash } from '../module-content-hash';
import { PLATFORM_VERSION } from '../../../common/utils/platform-version';

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
    whenStartupChecked: jest.fn(async () => undefined),
    getDimensions: jest.fn(() => 3),
    getModel: jest.fn(() => 'nomic-embed-text'),
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

  it('skips a module whose metadata is unavailable and keeps it as attempted (no reconcile, no sweep)', async () => {
    const { svc, upsertModule, deleteOldModules } = await buildService(
      makeDriver([rec('lg', null, 'authoritative')]),
    );
    const unavailable = { getMetadata: async () => { throw new Error('Unable to connect to LangGraph server'); } } as any;

    await svc.updateAllModules(new Map([['lg', unavailable], ['m1', fakeModule('m1')]]));

    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect(upsertModule.mock.calls[0][1]).toMatchObject({ name: 'm1' });
    expect(deleteOldModules).toHaveBeenCalledTimes(1);
    expect(deleteOldModules.mock.calls[0][1]).toEqual(expect.arrayContaining(['lg', 'm1']));
  });
});

describe('ModuleManagementService.updateAllModules — a module that ships no content hash', () => {
  const codeModule = (description = 'One report') =>
    ({
      getMetadata: async () => ({
        name: 'm1',
        version: '1.0.0',
        analysisClasses: [{ id: 'a1', name: 'Report', type: 'model_analysis', description }],
      }),
    }) as any;

  /** First start: nothing stored yet. Returns the hash the install stored on the Module node. */
  async function firstInstall(module: any) {
    const { svc, upsertModule } = await buildService(makeDriver([rec('m1', null, null)]));
    await svc.updateAllModules(new Map([['m1', module]]));
    expect(upsertModule).toHaveBeenCalledTimes(1);
    return (upsertModule.mock.calls[0] as any[])[1].contentHash as string;
  }

  it('is installed with a computed hash, and skipped on the next start while nothing changed', async () => {
    const stored = await firstInstall(codeModule());
    expect(stored).toMatch(/^sha256:[0-9a-f]{64}$/);

    const { svc, resolveVectors, upsertModule } = await buildService(makeDriver([rec('m1', stored, 'authoritative')]));
    await svc.updateAllModules(new Map([['m1', codeModule()]]));
    expect(resolveVectors).not.toHaveBeenCalled();
    expect(upsertModule).not.toHaveBeenCalled();
  });

  it('stores the hash of its metadata, the embedder and the platform version, so an upgrade reinstalls it once', async () => {
    const stored = await firstInstall(codeModule());
    const meta = await codeModule().getMetadata();
    expect(stored).toBe(computedContentHash(meta, {}, 'nomic-embed-text/3', PLATFORM_VERSION));
    expect(stored).not.toBe(computedContentHash(meta, {}, 'nomic-embed-text/3', `${PLATFORM_VERSION}-next`));
  });

  it('is reinstalled when its metadata changed', async () => {
    const stored = await firstInstall(codeModule());
    const { svc, upsertModule } = await buildService(makeDriver([rec('m1', stored, 'authoritative')]));
    await svc.updateAllModules(new Map([['m1', codeModule('Another report')]]));
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('is reinstalled when the embedder that makes its class vectors changed', async () => {
    const stored = await firstInstall(codeModule());
    const { svc, upsertModule } = await buildService(makeDriver([rec('m1', stored, 'authoritative')]));
    ((svc as any).embeddingService.getModel as jest.Mock).mockReturnValue('embeddinggemma');
    await svc.updateAllModules(new Map([['m1', codeModule()]]));
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('is installed on every start when it hands the install pre-computed vectors', async () => {
    const withVectors = { ...codeModule(), getEmbedding: () => null };
    const { svc, upsertModule } = await buildService(makeDriver([rec('m1', null, 'authoritative')]));
    await svc.updateAllModules(new Map([['m1', withVectors]]));
    expect((upsertModule.mock.calls[0] as any[])[1].contentHash).toBeUndefined();
  });

  it('keeps a shipped content hash as it is', async () => {
    const { svc, upsertModule } = await buildService(makeDriver([rec('m1', null, null)]));
    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect((upsertModule.mock.calls[0] as any[])[1].contentHash).toBe('sha256:shipped');
  });

  // The computed hash covers what the install reads from a module. If the install starts asking a module for
  // anything else (a template, a guide, exposures, a policy), this fails: that input then belongs in the hash.
  it('reads nothing from a module but its metadata, its pre-computed vectors and its after-install hook', async () => {
    const touched = new Set<string>();
    const target = { ...codeModule(), afterInstall: async () => undefined };
    const recording = new Proxy(target, {
      get(t, key, receiver) {
        if (typeof key === 'string') touched.add(key);
        return Reflect.get(t, key, receiver);
      },
    });
    const { svc, resolveVectors } = await buildService(makeDriver([rec('m1', null, null)]));
    resolveVectors.mockRestore();
    Object.assign((svc as any).embeddingService, {
      composeClassText: () => 'text',
      embedBatch: jest.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
    });

    await svc.updateAllModules(new Map([['m1', recording]]));

    expect([...touched].sort()).toEqual(['afterInstall', 'getEmbedding', 'getMetadata']);
  });
});
