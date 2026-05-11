import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';
import { ClassReconciler } from '../class-reconciler.service';
import { ClassIdentityEventLog } from '../class-identity-event-log.service';

// The embedding REMOVE semantic lives in `applySetProperties` (the
// shared SET path for case-a/b/c updates). This spec targets case (a)
// — found-by-name, same-id, idempotent update — the only path where
// `applySetProperties` runs against an existing node.

describe('ModuleManagementService.upsertClass — embedding REMOVE semantic', () => {
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
        {
          provide: EmbeddingService,
          useValue: { getModel: () => 'nomic-embed-text' },
        },
        { provide: MatchClassesResolverService, useValue: {} },
        { provide: 'NEO4J_DRIVER', useValue: { session: () => ({ close: async () => {}, run: async () => ({ records: [] }) }) } },
        { provide: ClassReconciler, useValue: reconciler },
        { provide: ClassIdentityEventLog, useValue: eventLog },
      ],
    }).compile();
    return mod.get(ModuleManagementService);
  }

  // Fake tx that returns a "case-a hit" for the lookup (existing node with
  // same id, edge=HAS_CLASS) so applySetProperties is the path exercised.
  function fakeTxCaseA(captured: { cypher: string; params: any }[], cls: { id: string }) {
    return {
      run: async (cypher: string, params: any) => {
        captured.push({ cypher, params });
        // Lookup returns a matching record → case (a)
        if (/RETURN c\.id AS dbId, type\(r\) AS edgeType/.test(cypher)) {
          return {
            records: [
              {
                get: (col: string) => (col === 'dbId' ? cls.id : 'HAS_CLASS'),
              },
            ],
          };
        }
        return { records: [] };
      },
    };
  }

  it('SETs embedding/embeddingModel when a vector is provided (no REMOVE)', async () => {
    const svc = await buildService();
    const captured: { cypher: string; params: any }[] = [];
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE' };
    await svc.upsertClass(
      fakeTxCaseA(captured, cls) as any,
      'mod-1',
      cls,
      'ComponentClass',
      [0.1, 0.2, 0.3],
    );
    // Find the applySetProperties call (the SET that happens after lookup).
    const setCall = captured.find((c) => c.cypher.includes('SET c += $nodeProperties'));
    expect(setCall).toBeDefined();
    expect(setCall!.cypher).not.toContain('REMOVE');
    expect(setCall!.params.nodeProperties.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(setCall!.params.nodeProperties.embeddingModel).toBe('nomic-embed-text');
  });

  it('REMOVEs stale embedding when no vector is provided (case-a idempotent update)', async () => {
    const svc = await buildService();
    const captured: { cypher: string; params: any }[] = [];
    const cls = { id: 'class-1', name: 'ClassA', type: 'STORE' };
    await svc.upsertClass(
      fakeTxCaseA(captured, cls) as any,
      'mod-1',
      cls,
      'ComponentClass',
      undefined,
    );
    const setCall = captured.find((c) => c.cypher.includes('SET c += $nodeProperties'));
    expect(setCall).toBeDefined();
    expect(setCall!.cypher).toContain('REMOVE c.embedding, c.embeddingModel');
    expect(setCall!.params.nodeProperties.embedding).toBeUndefined();
    expect(setCall!.params.nodeProperties.embeddingModel).toBeUndefined();
  });
});
