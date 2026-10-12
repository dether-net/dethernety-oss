import { VectorSearchService } from '../vector-search.service';

/**
 * The exact-search service: the dialect comes from the engine probe, the self-test gates the tier
 * (and is retried after a failure), and rank() runs the built query in a read transaction.
 */

const rec = (row: Record<string, any>) => ({ keys: Object.keys(row), get: (k: string) => row[k] });

function make(engine: 'memgraph' | 'neo4j', answer: (cypher: string, params: any) => Array<Record<string, any>>) {
  const runs: Array<{ cypher: string; params: any }> = [];
  const driver = {
    session: () => ({
      executeRead: async (cb: any) =>
        cb({
          run: async (cypher: string, params: any) => {
            runs.push({ cypher, params });
            return { records: answer(cypher, params).map(rec) };
          },
        }),
      close: async () => undefined,
    }),
  };
  const svc = new VectorSearchService(driver, { get: () => undefined } as any, {
    getEngineInfo: async () => ({ engine, edition: null, version: null }),
  } as any);
  return { svc, runs };
}

describe('VectorSearchService', () => {
  it('passes the self-test when orthogonal scores 0 and opposite -1', async () => {
    const { svc, runs } = make('neo4j', () => [{ orthogonal: 0, opposite: -1 }]);
    await expect(svc.healthy()).resolves.toBe(true);
    expect(runs[0].cypher).toContain('2 * vector.similarity.cosine');
    await svc.healthy();
    expect(runs).toHaveLength(1); // memoized
  });

  it('fails the self-test on an unmapped scale and retries only after the retry interval', async () => {
    const { svc, runs } = make('neo4j', () => [{ orthogonal: 0.5, opposite: 0 }]);
    await expect(svc.healthy()).resolves.toBe(false);
    await expect(svc.healthy()).resolves.toBe(false);
    expect(runs).toHaveLength(1);
    (svc as any).selfTest.at -= VectorSearchService.SELF_TEST_RETRY_MS + 1;
    await svc.healthy();
    expect(runs).toHaveLength(2);
  });

  it('fails the self-test when the cosine function does not exist', async () => {
    const { svc } = make('memgraph', () => {
      throw new Error('There is no procedure named vector_search.cosine_similarity');
    });
    await expect(svc.healthy()).resolves.toBe(false);
  });

  it('ranks in the engine dialect and returns every column', async () => {
    const { svc, runs } = make('memgraph', () => [{ id: 'c1', name: 'Redis', score: 0.8 }]);
    const rows = await svc.rank({ corpus: 'components', vector: [0.6, 0.8], profileId: 'p', k: 5, threshold: null, componentIds: ['c1'] });
    expect(rows).toEqual([{ id: 'c1', name: 'Redis', score: 0.8 }]);
    expect(runs[0].cypher).toContain('vector_search.cosine_similarity(n.embedding, $vector)');
    expect(runs[0].params.k.toNumber()).toBe(5);
  });
});
