import { ENUMERATE_MODEL_ANALYSES, ModelResolverService } from '../model-resolver.service';

/**
 * Model delete, through a fake transaction: the enumeration runs first, every module hook gets its ids on the same
 * transaction, and the structural delete runs last. The enumeration's reach (which analyses are the model's) is pinned
 * on the query here and on a real graph in test/integration/delete-model.e2e-spec.ts.
 *
 * Pure in-process — no DB, no Nest TestingModule (mirrors analysis-resolver.lifecycle.spec.ts).
 */

const int = (n: number) => ({ toNumber: () => n });

function makeService(modules: Record<string, unknown>) {
  const asked: string[] = [];
  const tx = {
    run: jest.fn(async (query: string) => {
      asked.push(query);
      if (query === ENUMERATE_MODEL_ANALYSES) {
        return { records: [{ get: () => ['an-model', 'an-exposure'] }] };
      }
      return { records: [{ get: (k: string) => (k === 'nodesDeleted' ? int(10) : int(20)) }] };
    }),
  };
  const session = { executeWrite: jest.fn(async (work: (t: unknown) => unknown) => work(tx)), close: jest.fn() };
  const neo4jDriver: any = { session: jest.fn(() => session) };
  const configService: any = { get: jest.fn().mockReturnValue(undefined) };
  const moduleRegistry: any = { getAllModules: jest.fn(() => new Map(Object.entries(modules))) };
  const authorizationService: any = { checkAuthorization: jest.fn().mockResolvedValue({ allowed: true }) };
  const svc = new ModelResolverService(neo4jDriver, configService, moduleRegistry, authorizationService);
  return { svc, tx, asked, session };
}

describe('ModelResolverService.deleteModel — hook dispatch', () => {
  it('hands every hook the enumerated ids on the same transaction, then deletes the structure', async () => {
    const onModelDeleted = jest.fn().mockResolvedValue({ nodesDeleted: 2, relationshipsDeleted: 4 });
    const { svc, tx, asked, session } = makeService({ 'analysis-mod': { onModelDeleted }, 'no-hook-mod': {} });

    const stats = await svc.deleteModel('m1', {} as any);

    expect(onModelDeleted).toHaveBeenCalledWith(tx, 'm1', ['an-model', 'an-exposure']);
    expect(asked[0]).toBe(ENUMERATE_MODEL_ANALYSES);
    expect(asked).toHaveLength(2);
    expect(stats).toEqual({ nodesDeleted: 12, relationshipsDeleted: 24 });
    expect(session.close).toHaveBeenCalled();
  });
});

describe('ENUMERATE_MODEL_ANALYSES', () => {
  it("follows ANALYZED_BY from the model's elements and from their exposures", () => {
    expect(ENUMERATE_MODEL_ANALYSES).toContain('OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(exp:Exposure)');
    expect(ENUMERATE_MODEL_ANALYSES).toContain('UNWIND (owned + exps) AS n');
    expect(ENUMERATE_MODEL_ANALYSES).toContain('OPTIONAL MATCH (n)-[:ANALYZED_BY]->(a:Analysis)');
  });

  it('leaves controls and countermeasures out: they are not the model\'s', () => {
    expect(ENUMERATE_MODEL_ANALYSES).not.toMatch(/Control|Countermeasure|SUPPORTS/);
  });
});
