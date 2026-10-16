import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

/**
 * A module installed while the embedder is not ready keeps its stored vectors and is marked partial. When the
 * embedder then becomes ready, the install runs again once, so those modules are embedded without a restart.
 * Installs run one at a time.
 */
const rec = (name: string) => ({ get: (k: string) => (({ name, contentHash: null, lastInstallStatus: null, embeddingProfile: null }) as Record<string, unknown>)[k] });

function makeDriver() {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  return {
    session: () => ({
      executeRead: jest.fn(async (cb: any) => cb({ run: async () => ({ records: [rec('m1')] }) })),
      executeWrite: jest.fn(async (cb: any) => cb(writeTx)),
      close: jest.fn(async () => {}),
    }),
  };
}

async function buildService() {
  const embedder = { ready: false, listeners: [] as Array<() => void> };
  const embedding: Partial<EmbeddingService> = {
    isEnabled: () => embedder.ready,
    isPending: () => !embedder.ready,
    getState: () => (embedder.ready ? 'ready' : 'loading'),
    whenStartupChecked: async () => undefined,
    getDimensions: () => 2,
    getModel: () => 'embeddinggemma-300m-retrieval-v1',
    composeClassText: () => 'text',
    embedBatch: async (texts: string[]) => texts.map(() => [0.6, 0.8]),
    onReady: (listener: () => void) => {
      embedder.listeners.push(listener);
      return () => undefined;
    },
  };
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleManagementService,
      { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
      { provide: EmbeddingService, useValue: embedding },
      { provide: 'NEO4J_DRIVER', useValue: makeDriver() },
      { provide: ClassReconciler, useValue: { hasIncidentInstances: async () => false } as unknown as ClassReconciler },
      { provide: ClassIdentityEventLog, useValue: new ClassIdentityEventLog() },
    ],
  }).compile();
  const svc = mod.get(ModuleManagementService);
  const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  const upsertModule = jest
    .spyOn(svc as any, 'upsertModule')
    .mockImplementation(async (_tx: unknown, metadata: any) => ({ moduleId: 'id', moduleName: metadata.name, classesProcessed: 1, duration: 0 }));
  const sweep = jest.spyOn(svc as any, 'deleteOldModules').mockResolvedValue(undefined);
  const afterInstall = jest.spyOn(svc as any, 'runAfterInstall').mockResolvedValue(undefined);
  const modules = new Map([['m1', { getMetadata: async () => ({ name: 'm1', contentHash: 'sha256:m1', componentClasses: [{ id: 'c1', name: 'Web' }] }) } as any]]);
  svc.enableCatchUp(() => modules);
  const ready = async () => {
    embedder.ready = true;
    for (const listener of embedder.listeners) listener();
    // Let the queued catch-up run.
    await (svc as any).installChain;
  };
  return { svc, upsertModule, modules, ready, embedder, log, sweep, afterInstall };
}

describe('ModuleManagementService — catching up when the embedder becomes ready', () => {
  it('installs again, with vectors, the modules an install left waiting for the embedder', async () => {
    const { svc, upsertModule, modules, ready } = await buildService();
    await svc.updateAllModules(modules);
    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect((upsertModule.mock.calls[0] as any[])[3]).toBe('pending');

    await ready();
    expect(upsertModule).toHaveBeenCalledTimes(2);
    expect((upsertModule.mock.calls[1] as any[])[3]).toBeInstanceOf(Map);
  });

  it('does nothing when the last install left no module waiting', async () => {
    const { svc, upsertModule, modules, ready, embedder } = await buildService();
    embedder.ready = true;
    await svc.updateAllModules(modules);
    await ready();
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('runs one catch-up for several ready signals, after the install that is running', async () => {
    const { svc, upsertModule, modules, embedder, log } = await buildService();
    let release!: () => void;
    upsertModule.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ moduleId: 'id', moduleName: 'm1', classesProcessed: 1, duration: 0 }))) as any,
    );
    const install = svc.updateAllModules(modules);
    await new Promise((r) => setImmediate(r));
    embedder.ready = true;
    for (const listener of embedder.listeners) listener();
    for (const listener of embedder.listeners) listener();
    expect(upsertModule).toHaveBeenCalledTimes(1);
    release();
    await install;
    await (svc as any).installChain;
    expect(upsertModule).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.filter(([m]) => m === 'Embedder ready — installing the modules that were waiting for it')).toHaveLength(1);
  });

  it('only installs again: no obsolescence sweep, and afterInstall only for the modules it installed', async () => {
    const { svc, upsertModule, modules, ready, sweep, afterInstall } = await buildService();
    modules.set('m2', { getMetadata: async () => ({ name: 'm2', contentHash: 'sha256:m2' }) } as any);
    await svc.updateAllModules(modules);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(afterInstall.mock.calls.map((c) => c[1])).toEqual(['m1', 'm2']);

    // m2 is not in the catch-up's set any more, as a module the health check now finds unhealthy would not be:
    // the catch-up must not delete it, and runs afterInstall only for the module it installed again.
    upsertModule.mockClear();
    afterInstall.mockClear();
    modules.delete('m2');
    await ready();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(afterInstall.mock.calls.map((c) => c[1])).toEqual(['m1']);
  });

  it('logs a failed catch-up, and the installs queued after it still run', async () => {
    const { svc, upsertModule, modules, ready } = await buildService();
    const error = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    await svc.updateAllModules(modules);
    jest.spyOn(svc as any, 'runUpdateAllModules').mockRejectedValueOnce(new Error('database unavailable'));
    await ready();
    expect(error).toHaveBeenCalledWith('Catch-up module install failed', { error: 'database unavailable' });
    upsertModule.mockClear();
    await svc.updateAllModules(modules, { force: true });
    expect(upsertModule).toHaveBeenCalledTimes(1);
  });

  it('does not catch up once a shutdown has begun (the embedder is no longer enabled)', async () => {
    const { svc, upsertModule, modules, embedder, log } = await buildService();
    await svc.updateAllModules(modules);
    upsertModule.mockClear();
    // The ready signal was queued, but the shutdown came first: the service no longer reports itself enabled.
    for (const listener of embedder.listeners) listener();
    await (svc as any).installChain;
    expect(upsertModule).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith('Embedder ready — installing the modules that were waiting for it');
  });

  it('never runs a module reset while an install runs', async () => {
    const { svc, upsertModule, modules } = await buildService();
    const order: string[] = [];
    let release!: () => void;
    upsertModule.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          order.push('install starts');
          release = () => {
            order.push('install ends');
            resolve({ moduleId: 'id', moduleName: 'm1', classesProcessed: 1, duration: 0 });
          };
        }) as any,
    );
    jest.spyOn(svc as any, 'runResetSingleModule').mockImplementation(async () => {
      order.push('reset');
      return 'm1';
    });
    const install = svc.updateAllModules(modules);
    await new Promise((r) => setImmediate(r));
    const reset = svc.resetSingleModule(modules.get('m1'));
    await new Promise((r) => setImmediate(r));
    release();
    await Promise.all([install, reset]);
    expect(order).toEqual(['install starts', 'install ends', 'reset']);
  });
});
