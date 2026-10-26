import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// Module and class metadata is checked before it is written: a value the database cannot store (a map, or a list
// holding null) fails that class, or the module node, before any write, instead of failing at Bolt on one
// engine and taking the install's transaction with it.

describe('ModuleManagementService — property guard on module and class writes', () => {
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
        { provide: EmbeddingService, useValue: { getModel: () => 'embeddinggemma', getDimensions: () => 768, isEnabled: () => true } },
        { provide: 'NEO4J_DRIVER', useValue: { session: () => ({ close: async () => {}, run: async () => ({ records: [] }) }) } },
        { provide: ClassReconciler, useValue: reconciler },
        { provide: ClassIdentityEventLog, useValue: eventLog },
      ],
    }).compile();
    const svc = mod.get(ModuleManagementService);
    for (const level of ['log', 'debug', 'error', 'warn'] as const) {
      jest.spyOn((svc as any).logger, level).mockImplementation(() => {});
    }
    return svc;
  }

  /** A transaction where the module exists; `installed` names a class already on the graph (same id, same name). */
  function fakeTx(installed?: { id: string }) {
    const calls: { cypher: string; params: any }[] = [];
    const tx = {
      run: async (cypher: string, params: any) => {
        calls.push({ cypher, params });
        if (/MERGE \(p:Module \{name: \$name\}\)/.test(cypher)) {
          return { records: [{ get: (k: string) => (k === 'moduleId' ? 'module-1' : 'test-module') }] };
        }
        if (installed && /RETURN c\.id AS dbId, type\(r\) AS edgeType/.test(cypher)) {
          return { records: [{ get: (k: string) => (k === 'dbId' ? installed.id : 'HAS_CLASS') }] };
        }
        return { records: [] };
      },
    };
    return { tx, calls };
  }

  const writes = (calls: { cypher: string }[]) => calls.filter((c) => /\b(SET|CREATE|MERGE|DELETE)\b/.test(c.cypher));

  it('refuses a class whose properties hold a null list element, before any write, naming the key', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE', category: 'c', properties: { feeds: ['nvd', null] } };
    await expect(svc.upsertClass(tx as any, 'mod-1', cls as any, 'ComponentClass', [0.1, 0.2])).rejects.toThrow(
      'Class upsert failed for ComponentClass/ClassA: property properties.feeds cannot be stored: list element 1 is null',
    );
    expect(writes(calls)).toEqual([]);
  });

  it('refuses an update of an installed class too, before its SET', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx({ id: 'class-1' });
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE', category: 'c', properties: { feeds: [undefined] } };
    await expect(svc.upsertClass(tx as any, 'mod-1', cls as any, 'ComponentClass')).rejects.toThrow(
      /property properties\.feeds cannot be stored: list element 0 is undefined/,
    );
    expect(writes(calls)).toEqual([]);
  });

  it('installs the module\'s other classes and marks the install partial when one class is refused', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    const bad = { id: 'class-1', name: 'ClassA', type: 'STORE', category: 'c', properties: { feeds: ['a', null] } };
    const good = { id: 'class-2', name: 'ClassB', type: 'STORE', category: 'c' };
    const metadata = { name: 'test-module', version: '1.0.0', componentClasses: [bad, good] } as any;
    await svc.upsertModule(tx as any, metadata, { skipValidation: true }, null);
    const classWrites = calls.filter((c) => c.cypher.includes('SET c += $nodeProperties'));
    expect(classWrites.map((c) => c.params.nodeProperties.name)).toEqual(['ClassB']);
    expect(calls.find((c) => c.cypher.includes('lastInstallStatus = $status'))?.params.status).toBe('partial');
  });

  it('refuses a class with a map outside `properties`', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE', category: 'c', extra: { k: 1 } };
    await expect(svc.upsertClass(tx as any, 'mod-1', cls as any, 'ComponentClass')).rejects.toThrow(
      /property extra cannot be stored: value must be a primitive/,
    );
    expect(writes(calls)).toEqual([]);
  });

  it('writes a class with a storable list, an empty string in it, and a vector', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE', category: 'c', properties: { feeds: ['', 'nvd'] } };
    await svc.upsertClass(tx as any, 'mod-1', cls as any, 'ComponentClass', [0.1, 0.2]);
    const create = calls.find((c) => c.cypher.includes('SET c += $nodeProperties'));
    expect(create?.params.nodeProperties).toMatchObject({ 'properties.feeds': ['', 'nvd'], embedding: [0.1, 0.2] });
  });

  it('fails the install when the module metadata holds a value that cannot be stored, before the module write', async () => {
    const svc = await buildService();
    const { tx, calls } = fakeTx();
    const metadata = { name: 'test-module', version: '1.0.0', tags: ['a', undefined], componentClasses: [] } as any;
    await expect(svc.upsertModule(tx as any, metadata, { skipValidation: true }, null)).rejects.toThrow(
      'Module upsert failed for test-module: property tags cannot be stored: list element 1 is undefined',
    );
    expect(calls.some((c) => c.cypher.includes('MERGE (p:Module'))).toBe(false);
  });
});
