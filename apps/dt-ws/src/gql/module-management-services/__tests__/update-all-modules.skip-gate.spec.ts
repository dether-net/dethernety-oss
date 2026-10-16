import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';
import { computedContentHash } from '../module-content-hash';
import { PLATFORM_VERSION } from '../../../common/utils/platform-version';
import neo4j from 'neo4j-driver';

// Record-like stub mirroring neo4j driver records (.get(field)).
// The embedder buildService's stub reports: the fingerprint an install stamps and the gate compares.
const PROFILE = 'nomic-embed-text/3';

const rec = (
  name: string,
  contentHash: string | null,
  lastInstallStatus: string | null,
  embeddingProfile: string | null = PROFILE,
) => ({
  get: (k: string) =>
    (({ name, contentHash, lastInstallStatus, embeddingProfile }) as Record<string, unknown>)[k],
});

// Driver whose :Module read returns the given rows, whose class-vector read finds no stale class, and whose write
// just runs the callback (upsertModule/deleteOldModules are spied/mocked on the service).
function makeDriver(installRows: ReturnType<typeof rec>[]) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  return {
    session: () => ({
      executeRead: jest.fn(async (cb: any) =>
        cb({ run: async (cypher: string) => ({ records: cypher.includes('HAS_CLASS') ? [] : installRows }) }),
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

describe('ModuleManagementService.updateAllModules — the embedder its classes were embedded with', () => {
  it('reinstalls a module with a shipped hash when the embedding model changed', async () => {
    const { svc, resolveVectors, upsertModule } = await buildService(
      makeDriver([rec('m1', 'sha256:shipped', 'authoritative', 'embeddinggemma/768')]),
    );
    const log = jest.spyOn((svc as any).logger, 'log');
    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Embedding model changed — reinstalling the module so its classes are embedded with the active model',
      { moduleName: 'm1', from: 'embeddinggemma/768', to: PROFILE },
    );
  });

  it('reinstalls once a module installed before the embedder was recorded, then skips it', async () => {
    const before = await buildService(makeDriver([rec('m1', 'sha256:shipped', 'authoritative', null)]));
    const log = jest.spyOn((before.svc as any).logger, 'log');
    await before.svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect(before.upsertModule).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Embedding model not recorded for this module yet — reinstalling it once to record it',
      { moduleName: 'm1', from: 'unrecorded', to: PROFILE },
    );

    const after = await buildService(makeDriver([rec('m1', 'sha256:shipped', 'authoritative')]));
    await after.svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect(after.upsertModule).not.toHaveBeenCalled();
  });

  it('reinstalls when embedding is switched on or off', async () => {
    const off = await buildService(makeDriver([rec('m1', 'sha256:shipped', 'authoritative')]));
    ((off.svc as any).embeddingService.isEnabled as jest.Mock).mockReturnValue(false);
    await off.svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect(off.upsertModule).toHaveBeenCalledTimes(1);

    const on = await buildService(makeDriver([rec('m1', 'sha256:shipped', 'authoritative', 'off')]));
    await on.svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:shipped')]]));
    expect(on.upsertModule).toHaveBeenCalledTimes(1);
  });
});

// The class read: one row per searchable class whose vector the active embedder did not make.
const staleRow = (name: string, label: string, id: string | null) => ({
  get: (k: string) => (({ name, labels: [label], id }) as Record<string, unknown>)[k],
});

// Driver that answers the :Module read with `installRows` and the class read with `staleRows` (or throws), and records
// every read's cypher and parameters.
function makeClassAwareDriver(installRows: ReturnType<typeof rec>[], staleRows: ReturnType<typeof staleRow>[] | Error) {
  const reads: Array<{ cypher: string; params: any }> = [];
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  return {
    reads,
    session: () => ({
      executeRead: jest.fn(async (cb: any) =>
        cb({
          run: async (cypher: string, params: any) => {
            reads.push({ cypher, params });
            if (!cypher.includes('HAS_CLASS')) return { records: installRows };
            if (staleRows instanceof Error) throw staleRows;
            return { records: staleRows };
          },
        }),
      ),
      executeWrite: jest.fn(async (cb: any) => cb(writeTx)),
      close: jest.fn(async () => {}),
    }),
  };
}

const classModule = (name: string) =>
  ({
    getMetadata: async () => ({
      name,
      contentHash: 'sha256:x',
      componentClasses: [{ id: 'c1', name: 'Web server' }, { id: 'c2', name: 'Database' }],
      controlClasses: [{ id: 'k1', name: 'Firewall' }],
      analysisClasses: [{ id: 'a1', name: 'Report' }],
    }),
  }) as any;

// The class-vector read (the class policy hash read is policy-change-hooks.spec's).
const classRead = (reads: Array<{ cypher: string; params: any }>) =>
  reads.filter((r) => r.cypher.includes('HAS_CLASS') && !r.cypher.includes('c.policyHash AS policyHash'));

describe('ModuleManagementService.updateAllModules — the class vectors behind the recorded embedder', () => {
  it('reinstalls a module whose declared classes hold vectors of another embedder under a matching record', async () => {
    const driver = makeClassAwareDriver(
      [rec('m1', 'sha256:x', 'authoritative')],
      [staleRow('m1', 'ComponentClass', 'c1'), staleRow('m1', 'ComponentClass', 'c2'), staleRow('m1', 'ControlClass', 'k1')],
    );
    const { svc, resolveVectors, upsertModule } = await buildService(driver);
    const log = jest.spyOn((svc as any).logger, 'log');
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(resolveVectors).toHaveBeenCalledTimes(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Class vectors do not match the recorded embedding model — reinstalling the module so its classes are embedded with the active model',
      { moduleName: 'm1', staleClasses: 3, profile: PROFILE },
    );
  });

  it('skips a module whose declared classes all hold vectors of the active embedder', async () => {
    const driver = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative')], []);
    const { svc, resolveVectors, upsertModule, deleteOldModules } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(classRead(driver.reads)).toHaveLength(1);
    expect(resolveVectors).not.toHaveBeenCalled();
    expect(upsertModule).not.toHaveBeenCalled();
    expect(deleteOldModules.mock.calls[0][1]).toContain('m1');
  });

  it('skips a module with no classes', async () => {
    const driver = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative')], []);
    const { svc, upsertModule } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:x')]]));
    expect(upsertModule).not.toHaveBeenCalled();
  });

  // An install writes only the classes a module declares, so only those count: a stale node it does not write would
  // have it installed again at every start.
  it('does not count stale classes the module does not declare, nor its analysis and issue classes, nor id-less nodes', async () => {
    const driver = makeClassAwareDriver(
      [rec('m1', 'sha256:x', 'authoritative')],
      [
        staleRow('m1', 'ComponentClass', 'gone'),
        staleRow('m1', 'AnalysisClass', 'a1'),
        staleRow('m1', 'ControlClass', 'c1'), // c1 is declared as a component class, not a control class
        staleRow('m1', 'ComponentClass', null),
        staleRow('other', 'ComponentClass', 'c1'),
      ],
    );
    const { svc, upsertModule } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(upsertModule).not.toHaveBeenCalled();
  });

  it('reinstalls only the module with stale classes', async () => {
    const driver = makeClassAwareDriver(
      [rec('m1', 'sha256:x', 'authoritative'), rec('m2', 'sha256:x', 'authoritative')],
      [staleRow('m2', 'ControlClass', 'k1')],
    );
    const { svc, upsertModule } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', classModule('m1')], ['m2', classModule('m2')]]));
    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect(upsertModule.mock.calls[0][1]).toMatchObject({ name: 'm2' });
  });

  it('still reinstalls a module with no recorded embedder', async () => {
    const driver = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative', null)], []);
    const { svc, upsertModule } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('checks the classes while the embedder is loading, so a stale module is installed and left for the catch-up', async () => {
    const driver = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative')], [staleRow('m1', 'ComponentClass', 'c1')]);
    const { svc, upsertModule } = await buildService(driver);
    const embedding = (svc as any).embeddingService;
    embedding.isEnabled.mockReturnValue(false);
    embedding.isPending = jest.fn(() => true);
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(classRead(driver.reads)).toHaveLength(1);
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('reads no classes when embedding is off or the run is forced', async () => {
    const off = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative', 'off')], [staleRow('m1', 'ComponentClass', 'c1')]);
    const offService = await buildService(off);
    ((offService.svc as any).embeddingService.isEnabled as jest.Mock).mockReturnValue(false);
    await offService.svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    expect(classRead(off.reads)).toHaveLength(0);
    expect(offService.upsertModule).not.toHaveBeenCalled();

    const forced = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative')], []);
    const forcedService = await buildService(forced);
    await forcedService.svc.updateAllModules(new Map([['m1', classModule('m1')]]), { force: true });
    expect(classRead(forced.reads)).toHaveLength(0);
    expect(forcedService.upsertModule).toHaveBeenCalledTimes(1);
  });

  it('installs every module in full when the class read fails, and the start goes on', async () => {
    const driver = makeClassAwareDriver(
      [rec('m1', 'sha256:x', 'authoritative'), rec('m2', 'sha256:x', 'authoritative')],
      new Error('read failed'),
    );
    const { svc, upsertModule, deleteOldModules } = await buildService(driver);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await svc.updateAllModules(new Map([['m1', classModule('m1')], ['m2', classModule('m2')]]));
    expect(upsertModule).toHaveBeenCalledTimes(2);
    expect(deleteOldModules).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Class vector check failed — installing every module in full', { error: 'read failed' });
  });

  it('reads the searchable classes a module holds and compares each with the active model and dimensions', async () => {
    const driver = makeClassAwareDriver([rec('m1', 'sha256:x', 'authoritative')], []);
    const { svc } = await buildService(driver);
    await svc.updateAllModules(new Map([['m1', classModule('m1')]]));
    const [read] = classRead(driver.reads);
    const cypher = read.cypher.replace(/\s+/g, ' ');
    expect(cypher).toContain('MATCH (m:Module)-[:HAS_CLASS]->(c)');
    expect(cypher).not.toContain('HAS_ORPHANED_CLASS');
    expect(cypher).toContain('any(l IN labels(c) WHERE l IN $labels)');
    expect(cypher).toContain(
      '(c.embedding IS NULL OR c.embeddingModel IS NULL OR c.embeddingModel <> $model OR size(c.embedding) <> $dims)',
    );
    expect(read.params.labels).toEqual(['ComponentClass', 'ControlClass', 'DataFlowClass', 'SecurityBoundaryClass', 'DataClass']);
    expect(read.params.model).toBe('nomic-embed-text');
    expect(neo4j.isInt(read.params.dims) && read.params.dims.toNumber()).toBe(3);
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

  it('stores the hash of its metadata and the platform version, so an upgrade reinstalls it once', async () => {
    const stored = await firstInstall(codeModule());
    const meta = await codeModule().getMetadata();
    expect(stored).toBe(computedContentHash(meta, {}, PLATFORM_VERSION));
    expect(stored).not.toBe(computedContentHash(meta, {}, `${PLATFORM_VERSION}-next`));
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
