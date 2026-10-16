import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// The two things the platform needs from an install to re-evaluate instances after a policy change: the class
// node carries the policy hash the module reported, and listeners hear which modules an install wrote.

const PROFILE = 'nomic-embed-text/3';

const moduleRow = (name: string, contentHash: string | null, lastInstallStatus: string | null) => ({
  get: (k: string) =>
    (({ name, contentHash, lastInstallStatus, embeddingProfile: PROFILE }) as Record<string, unknown>)[k],
});

type ClassHashRow = { name: string; labels: string[]; id: string; policyHash: string | null };

function makeDriver(installRows: ReturnType<typeof moduleRow>[], classHashes: ClassHashRow[] | Error = []) {
  const writeTx = { run: jest.fn(async () => ({ records: [] })) };
  const answer = async (cypher: string) => {
    if (cypher.includes('c.policyHash AS policyHash')) {
      if (classHashes instanceof Error) throw classHashes;
      return { records: classHashes.map(row => ({ get: (k: string) => (row as any)[k] })) };
    }
    return { records: cypher.includes('HAS_CLASS') ? [] : installRows };
  };
  return {
    session: () => ({
      executeRead: jest.fn(async (cb: any) => cb({ run: answer })),
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
  jest.spyOn((eventLog as any).logger, 'warn').mockImplementation(() => {});
  const reconciler = {
    hasIncidentInstances: async () => false,
    orphanClass: async () => undefined,
    reviveClass: async () => undefined,
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
  return mod.get(ModuleManagementService);
}

function stubInstall(svc: ModuleManagementService) {
  jest.spyOn(svc as any, 'resolveVectors').mockResolvedValue(null);
  jest.spyOn(svc as any, 'deleteOldModules').mockResolvedValue(undefined);
  return jest.spyOn(svc as any, 'upsertModule').mockImplementation(async (_tx: any, metadata: any) => ({
    moduleId: 'id',
    moduleName: metadata.name,
    classesProcessed: 0,
    duration: 0,
  }));
}

const fakeModule = (name: string, contentHash?: string) =>
  ({ getMetadata: async () => ({ name, ...(contentHash ? { contentHash } : {}) }) }) as any;

describe('ModuleManagementService.upsertClass — the class policy hash', () => {
  // A tx whose by-name lookup finds the class (case a), so the SET of its properties runs.
  function caseATx(captured: { cypher: string; params: any }[], classId: string) {
    return {
      run: async (cypher: string, params: any) => {
        captured.push({ cypher, params });
        if (/RETURN c\.id AS dbId, type\(r\) AS edgeType/.test(cypher)) {
          return { records: [{ get: (col: string) => (col === 'dbId' ? classId : 'HAS_CLASS') }] };
        }
        return { records: [] };
      },
    };
  }

  const setProperties = async (cls: Record<string, unknown>) => {
    const svc = await buildService(makeDriver([]));
    const captured: { cypher: string; params: any }[] = [];
    await svc.upsertClass(caseATx(captured, 'class-1') as any, 'mod-1', { id: 'class-1', name: 'A', type: 'STORE', ...cls }, 'ComponentClass', [0.1]);
    return captured.find(c => c.cypher.includes('SET c += $nodeProperties'))!.params.nodeProperties;
  };

  it('writes the hash the module reported', async () => {
    expect((await setProperties({ policyHash: 'abc' })).policyHash).toBe('abc');
  });

  it('writes null when the module reported none, so a class whose policy stopped registering loses the old hash', async () => {
    const props = await setProperties({});
    expect(props).toHaveProperty('policyHash', null);
  });

  it('writes null for a hash that is not a string', async () => {
    expect((await setProperties({ policyHash: 42 })).policyHash).toBeNull();
  });
});

describe('ModuleManagementService.onModulesInstalled', () => {
  it('names the modules a full install wrote, after it committed', async () => {
    const svc = await buildService(makeDriver([moduleRow('m1', 'sha256:OLD', 'authoritative')]));
    const upsertModule = stubInstall(svc);
    const heard: string[][] = [];
    svc.onModulesInstalled(names => {
      expect(upsertModule).toHaveBeenCalled();
      heard.push(names);
    });

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:NEW')]]));

    expect(heard).toEqual([['m1']]);
  });

  it('stays quiet when the skip gate skipped every module', async () => {
    const svc = await buildService(makeDriver([moduleRow('m1', 'sha256:x', 'authoritative')]));
    stubInstall(svc);
    const listener = jest.fn();
    svc.onModulesInstalled(listener);

    await svc.updateAllModules(new Map([['m1', fakeModule('m1', 'sha256:x')]]));

    expect(listener).not.toHaveBeenCalled();
  });

  it('leaves out a module whose write failed', async () => {
    const svc = await buildService(makeDriver([]));
    const upsertModule = stubInstall(svc);
    upsertModule.mockImplementationOnce(async () => {
      throw new Error('poisoned');
    });
    jest.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
    const heard: string[][] = [];
    svc.onModulesInstalled(names => heard.push(names));

    await svc.updateAllModules(new Map([['bad', fakeModule('bad')], ['good', fakeModule('good')]]));

    expect(heard).toEqual([['good']]);
  });

  it('names the module a reset wrote', async () => {
    const svc = await buildService(makeDriver([]));
    stubInstall(svc);
    const heard: string[][] = [];
    svc.onModulesInstalled(names => heard.push(names));

    await svc.resetSingleModule(fakeModule('m1'));

    expect(heard).toEqual([['m1']]);
  });

  it('never fails the install when a listener throws', async () => {
    const svc = await buildService(makeDriver([]));
    stubInstall(svc);
    const error = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
    const after = jest.fn();
    svc.onModulesInstalled(() => {
      throw new Error('listener broke');
    });
    svc.onModulesInstalled(after);

    await expect(svc.resetSingleModule(fakeModule('m1'))).resolves.toBe('m1');

    expect(error).toHaveBeenCalledWith('A module-installed listener failed', { error: 'listener broke' });
    expect(after).toHaveBeenCalledWith(['m1']);
  });
});

describe('ModuleManagementService.updateAllModules — class policy hashes in the skip gate', () => {
  const withClass = (policyHash?: string) =>
    ({
      getMetadata: async () => ({
        name: 'm1',
        contentHash: 'sha256:x',
        componentClasses: [{ id: 'c1', name: 'Web', type: 'PROCESS', category: 'c', ...(policyHash ? { policyHash } : {}) }],
      }),
    }) as any;
  const stored = (policyHash: string | null): ClassHashRow[] => [{ name: 'm1', labels: ['ComponentClass'], id: 'c1', policyHash }];

  async function install(module: any, classHashes: ClassHashRow[] | Error) {
    const svc = await buildService(makeDriver([moduleRow('m1', 'sha256:x', 'authoritative')], classHashes));
    const upsertModule = stubInstall(svc);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await svc.updateAllModules(new Map([['m1', module]]));
    return upsertModule;
  }

  it('reinstalls an unchanged module whose class node lacks the hash it reports (the first start after upgrading)', async () => {
    expect(await install(withClass('h1'), stored(null))).toHaveBeenCalledTimes(1);
  });

  it('reinstalls when a stored hash differs from the reported one', async () => {
    expect(await install(withClass('h1'), stored('h0'))).toHaveBeenCalledTimes(1);
  });

  it('skips when every reported hash is stored', async () => {
    expect(await install(withClass('h1'), stored('h1'))).not.toHaveBeenCalled();
  });

  it('skips a class that reports no hash, so a remote or broken class is not reinstalled at every start', async () => {
    expect(await install(withClass(), stored(null))).not.toHaveBeenCalled();
  });

  it('reinstalls in full when the hashes cannot be read', async () => {
    expect(await install(withClass('h1'), new Error('db down'))).toHaveBeenCalledTimes(1);
  });
});
