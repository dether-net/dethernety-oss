import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

/**
 * A forced reinstall (MODULE_LOAD_FORCE) while the in-process embedder is still loading: every module is installed
 * without vectors and marked partial, and when the embedder becomes ready the catch-up installs them again with
 * vectors, although their content and profile are unchanged, so that no reset (and no ENABLE_MODULE_HOT_RELOAD) is
 * needed to re-embed. The stored :Module row follows what each install writes.
 */
const PROFILE = 'embeddinggemma-300m-retrieval-v1';
// The skip gate's record of the embedder: model and dimensions (embedderFingerprint).
const FINGERPRINT = `${PROFILE}/2`;

function makeDriver(stored: { contentHash: string; lastInstallStatus: string; embeddingProfile: string | null }) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  const rec = { get: (k: string) => ({ name: 'm1', ...stored })[k as 'name'] };
  return {
    session: () => ({
      executeRead: jest.fn(async (cb: any) => cb({ run: async () => ({ records: [rec] }) })),
      executeWrite: jest.fn(async (cb: any) => cb(writeTx)),
      close: jest.fn(async () => {}),
    }),
  };
}

async function buildService() {
  // Installed earlier with the same content and profile: only the force reinstalls it.
  const stored = { contentHash: 'sha256:m1', lastInstallStatus: 'authoritative', embeddingProfile: FINGERPRINT as string | null };
  const embedder = { ready: false, listeners: [] as Array<() => void> };
  const embedding: Partial<EmbeddingService> = {
    isEnabled: () => embedder.ready,
    isPending: () => !embedder.ready,
    getState: () => (embedder.ready ? 'ready' : 'loading'),
    whenStartupChecked: async () => undefined,
    getDimensions: () => 2,
    getModel: () => PROFILE,
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
      { provide: 'NEO4J_DRIVER', useValue: makeDriver(stored) },
      { provide: ClassReconciler, useValue: { hasIncidentInstances: async () => false } as unknown as ClassReconciler },
      { provide: ClassIdentityEventLog, useValue: new ClassIdentityEventLog() },
    ],
  }).compile();
  const svc = mod.get(ModuleManagementService);
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  const upsertModule = jest.spyOn(svc as any, 'upsertModule').mockImplementation(async (_tx: unknown, metadata: any, _m: unknown, vectors: unknown) => {
    // What the install writes: partial while vectors are pending (the profile stamp left as it was), else
    // authoritative under the profile.
    stored.lastInstallStatus = vectors === 'pending' ? 'partial' : 'authoritative';
    if (vectors !== 'pending') stored.embeddingProfile = FINGERPRINT;
    return { moduleId: 'id', moduleName: metadata.name, classesProcessed: 1, duration: 0 };
  });
  jest.spyOn(svc as any, 'deleteOldModules').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'runAfterInstall').mockResolvedValue(undefined);
  const modules = new Map([['m1', { getMetadata: async () => ({ name: 'm1', contentHash: 'sha256:m1', componentClasses: [{ id: 'c1', name: 'Web' }] }) } as any]]);
  svc.enableCatchUp(() => modules);
  const ready = async () => {
    embedder.ready = true;
    for (const listener of embedder.listeners) listener();
    await (svc as any).installChain;
  };
  return { svc, upsertModule, modules, ready, stored };
}

describe('ModuleManagementService — a forced reinstall while the in-process embedder loads', () => {
  it('without the force, an unchanged module is skipped', async () => {
    const { svc, upsertModule, modules } = await buildService();
    await svc.updateAllModules(modules);
    expect(upsertModule).not.toHaveBeenCalled();
  });

  it('installs every module partial, then the catch-up embeds them when the embedder is ready', async () => {
    const { svc, upsertModule, modules, ready, stored } = await buildService();
    await svc.updateAllModules(modules, { force: true });
    expect(upsertModule).toHaveBeenCalledTimes(1);
    expect((upsertModule.mock.calls[0] as any[])[3]).toBe('pending');
    expect(stored.lastInstallStatus).toBe('partial');

    await ready();
    expect(upsertModule).toHaveBeenCalledTimes(2);
    expect((upsertModule.mock.calls[1] as any[])[3]).toBeInstanceOf(Map);
    expect(stored).toMatchObject({ lastInstallStatus: 'authoritative', embeddingProfile: FINGERPRINT });
  });
});
