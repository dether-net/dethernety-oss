import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleManagementService } from '../module-management.service';
import { EmbeddingService } from '../../services/embedding.service';
import { MatchClassesResolverService } from '../../resolver-services/match-classes-resolver.service';

describe('ModuleManagementService.upsertClass — embedding REMOVE semantic', () => {
  async function buildService() {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleManagementService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: EmbeddingService,
          useValue: { getModel: () => 'nomic-embed-text' },
        },
        { provide: MatchClassesResolverService, useValue: {} },
        {
          provide: 'NEO4J_DRIVER',
          useValue: {
            session: () => ({
              close: async () => {},
              run: async () => ({ records: [] }),
            }),
          },
        },
      ],
    }).compile();
    return mod.get(ModuleManagementService);
  }

  function fakeTx(captured: { cypher: string; params: any }[]) {
    return {
      run: async (cypher: string, params: any) => {
        captured.push({ cypher, params });
        return { records: [] };
      },
    };
  }

  it('SETs embedding/embeddingModel when a vector is provided', async () => {
    const svc = await buildService();
    const captured: { cypher: string; params: any }[] = [];
    await svc.upsertClass(
      fakeTx(captured) as any,
      'mod-1',
      { name: 'ClassA', type: 'STORE' },
      'ComponentClass',
      [0.1, 0.2, 0.3],
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].cypher).not.toContain('REMOVE');
    expect(captured[0].params.nodeProperties.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(captured[0].params.nodeProperties.embeddingModel).toBe('nomic-embed-text');
  });

  it('REMOVEs stale embedding when no vector is provided', async () => {
    const svc = await buildService();
    const captured: { cypher: string; params: any }[] = [];
    await svc.upsertClass(
      fakeTx(captured) as any,
      'mod-1',
      { name: 'ClassA', type: 'STORE' },
      'ComponentClass',
      undefined,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].cypher).toContain('REMOVE t.embedding, t.embeddingModel');
    expect(captured[0].params.nodeProperties.embedding).toBeUndefined();
    expect(captured[0].params.nodeProperties.embeddingModel).toBeUndefined();
  });
});
