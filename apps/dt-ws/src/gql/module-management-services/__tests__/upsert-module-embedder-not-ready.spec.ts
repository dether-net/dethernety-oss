import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService, type ResolvedVectors } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// A module install while the embedder is enabled but not ready keeps the class vectors already stored and is
// marked partial, so the content-hash skip lets the next install embed. Disabled embedding still removes them.

describe('ModuleManagementService.upsertModule — embedder not ready', () => {
  async function buildService() {
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
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EmbeddingService, useValue: { getModel: () => 'embeddinggemma' } },
        { provide: 'NEO4J_DRIVER', useValue: { session: () => ({ close: async () => {}, run: async () => ({ records: [] }) }) } },
        { provide: ClassReconciler, useValue: reconciler },
        { provide: ClassIdentityEventLog, useValue: eventLog },
      ],
    }).compile();
    const svc = mod.get(ModuleManagementService);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((svc as any).logger, 'debug').mockImplementation(() => {});
    return svc;
  }

  const cls = { id: 'class-1', name: 'ClassA', type: 'STORE' };
  const metadata = { name: 'test-module', version: '1.0.0', componentClasses: [cls] } as any;

  /** A transaction where the module exists and its one class is already installed (same id, same name). */
  function fakeTx() {
    const calls: { cypher: string; params: any }[] = [];
    const tx = {
      run: async (cypher: string, params: any) => {
        calls.push({ cypher, params });
        if (/MERGE \(p:Module \{name: \$name\}\)/.test(cypher)) {
          return { records: [{ get: (k: string) => (k === 'moduleId' ? 'module-1' : 'test-module') }] };
        }
        if (/RETURN c\.id AS dbId, type\(r\) AS edgeType/.test(cypher)) {
          return { records: [{ get: (k: string) => (k === 'dbId' ? cls.id : 'HAS_CLASS') }] };
        }
        return { records: [] };
      },
    };
    return { tx, calls };
  }

  async function install(vectors: ResolvedVectors) {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    await svc.upsertModule(tx as any, metadata, { skipValidation: true }, vectors);
    const classSet = calls.find((c) => c.cypher.includes('SET c += $nodeProperties'));
    const status = calls.find((c) => c.cypher.includes('lastInstallStatus = $status'));
    return { classSet, status: status?.params.status };
  }

  it('keeps the stored vectors and marks the install partial while the embedder is not ready', async () => {
    const { classSet, status } = await install('pending');
    expect(classSet?.cypher).not.toContain('REMOVE');
    expect(classSet?.params.nodeProperties.embedding).toBeUndefined();
    expect(status).toBe('partial');
  });

  it('removes stale vectors and stays authoritative when embedding is disabled', async () => {
    const { classSet, status } = await install(null);
    expect(classSet?.cypher).toContain('REMOVE c.embedding, c.embeddingModel');
    expect(status).toBe('authoritative');
  });

  it('writes the vector and stays authoritative when the embedder is ready', async () => {
    const { classSet, status } = await install(new Map([['ClassA', [0.1, 0.2]]]));
    expect(classSet?.cypher).not.toContain('REMOVE');
    expect(classSet?.params.nodeProperties.embedding).toEqual([0.1, 0.2]);
    expect(status).toBe('authoritative');
  });
});
