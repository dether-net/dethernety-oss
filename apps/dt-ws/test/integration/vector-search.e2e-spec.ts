// Exact vector search on both engines, through both match resolvers.
//
// Crafted unit vectors sit at a known cosine to the query: 1, 0, -1, and just above and just below
// the threshold. On Memgraph and on Neo4j 5.26 the resolvers must report the same cosine as
// similarityScore (Neo4j's native score is (1 + cos) / 2 and is mapped back), include exactly the
// candidates at or above the threshold, ignore vectors of another embedding model, and pass the
// dialect self-test.

import { startMemgraph, clearGraph } from './memgraph-container';
import { startNeo4j } from './neo4j-container';
import { MatchClassesResolverService } from '../../src/gql/resolver-services/match-classes-resolver.service';
import { MatchMitreTechniquesResolverService } from '../../src/gql/resolver-services/match-mitre-techniques-resolver.service';
import { VectorSearchService } from '../../src/gql/services/vector-search.service';

jest.setTimeout(240_000);

const DIMENSIONS = 8;
const MODEL = 'test-profile-v1';
const THRESHOLD = { classes: 0.35, mitre: 0.3 } as const;
const TOLERANCE = 5e-5;

/** A unit vector at cosine `c` to e0, in the e0/e1 plane. */
function atCosine(c: number): number[] {
  const v = new Array(DIMENSIONS).fill(0);
  v[0] = c;
  v[1] = Math.sqrt(Math.max(0, 1 - c * c));
  return v;
}
const QUERY = atCosine(1);

const config: any = { get: (key: string) => (key === 'database.name' ? undefined : undefined) };
const auth: any = { extractAuthContext: () => ({}), checkAuthorization: async () => ({ allowed: true }) };
const monitoring: any = { recordOperation: () => {} };
const embedding: any = {
  isEnabled: () => true,
  getModel: () => MODEL,
  getDimensions: () => DIMENSIONS,
  getThreshold: (corpus: 'classes' | 'mitre') => THRESHOLD[corpus],
  composeElementText: (e: { name: string }) => e.name,
  embedBatch: async (texts: string[]) => texts.map(() => QUERY),
  disableForSession: () => {},
};

async function run(driver: any, cypher: string, params: Record<string, unknown> = {}) {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

const engines = [
  // The default harness image (MEMGRAPH_TEST_IMAGE overrides it); MEMGRAPH_TEST_URI serves this suite too.
  ['memgraph', () => startMemgraph()],
  ['neo4j', () => startNeo4j()],
] as const;

describe.each(engines)('exact vector search on %s', (engine, start) => {
  let handle: { driver: any; stop: () => Promise<void> };
  let vectorSearch: VectorSearchService;
  let classes: MatchClassesResolverService;
  let mitre: MatchMitreTechniquesResolverService;

  beforeAll(async () => {
    handle = await start();
  });

  afterAll(async () => {
    await mitre?.ensureMitreVectorIndexes().catch(() => undefined);
    await handle?.stop();
  });

  beforeEach(async () => {
    await clearGraph(handle.driver);
    vectorSearch = new VectorSearchService(handle.driver, config, {
      getEngineInfo: async () => ({ engine, edition: null, version: null }),
    } as any);
    classes = new MatchClassesResolverService(handle.driver, config, auth, monitoring, embedding, vectorSearch);
    mitre = new MatchMitreTechniquesResolverService(handle.driver, config, auth, monitoring, embedding, vectorSearch);
    for (const svc of [classes, mitre]) for (const level of ['log', 'warn', 'debug']) jest.spyOn((svc as any).logger, level).mockImplementation(() => {});
  });

  afterEach(async () => {
    await mitre.ensureMitreVectorIndexes().catch(() => undefined);
  });

  it('passes the dialect self-test', async () => {
    await expect(vectorSearch.healthy()).resolves.toBe(true);
  });

  it('classes: scores are cosines, and the threshold keeps exactly the candidates at or above it', async () => {
    await run(handle.driver, "CREATE (:Module {id: 'm1', name: 'mod'})");
    const seed = [
      ['same', 1],
      ['above', THRESHOLD.classes + 1e-3],
      ['below', THRESHOLD.classes - 1e-3],
      ['orthogonal', 0],
      ['opposite', -1],
    ] as const;
    for (const [name, c] of seed) {
      await run(
        handle.driver,
        `MATCH (m:Module {id: 'm1'}) CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: $id, name: $id, description: 'd', type: 'PROCESS', embedding: $v, embeddingModel: $model})`,
        { id: name, v: atCosine(c), model: MODEL },
      );
    }
    // Another embedding model's vector, identical to the query, must never be compared with it.
    await run(
      handle.driver,
      `MATCH (m:Module {id: 'm1'}) CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: 'foreign', name: 'foreign', description: 'd', type: 'PROCESS', embedding: $v, embeddingModel: 'other-model'})`,
      { v: QUERY },
    );

    const result: any = await classes.getResolvers().Query.matchClasses(
      null,
      { input: { elements: [{ name: 'zz element under test', description: 'semantic' }], classLabel: 'COMPONENT', topN: 10 } },
      {},
    );
    expect(result.vectorAvailable).toBe(true);
    const got = result.matches[0].candidates.map((c: any) => [c.classId, c.matchType, c.similarityScore]);
    expect(got.map((g: any[]) => g[0])).toEqual(['same', 'above']);
    expect(got.every((g: any[]) => g[1] === 'vector_similarity')).toBe(true);
    expect(Math.abs(got[0][2] - 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(got[1][2] - (THRESHOLD.classes + 1e-3))).toBeLessThan(TOLERANCE);
  });

  it('classes: an exact-name hit comes first even below the threshold, then the vector hits', async () => {
    await run(handle.driver, "CREATE (:Module {id: 'm1', name: 'mod'})");
    for (const [name, c] of [['Redis', -1], ['Cache Tier', 0.9], ['Key Value Store', 0.8]] as const) {
      await run(
        handle.driver,
        `MATCH (m:Module {id: 'm1'}) CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: $id, name: $id, description: 'd', type: 'STORE', embedding: $v, embeddingModel: $model})`,
        { id: name, v: atCosine(c), model: MODEL },
      );
    }
    const result: any = await classes.getResolvers().Query.matchClasses(
      null,
      { input: { elements: [{ name: 'Redis', description: 'an in-memory store' }], classLabel: 'COMPONENT', topN: 3 } },
      {},
    );
    expect(result.matches[0].candidates.map((c: any) => [c.classId, c.matchType])).toEqual([
      ['Redis', 'exact_name'],
      ['Cache Tier', 'vector_similarity'],
      ['Key Value Store', 'vector_similarity'],
    ]);
  });

  it('classes: the tier is unavailable when every vector in scope is another model\'s', async () => {
    await run(handle.driver, "CREATE (:Module {id: 'm1', name: 'mod'})");
    await run(
      handle.driver,
      `MATCH (m:Module {id: 'm1'}) CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: 'foreign', name: 'foreign', description: 'd', type: 'PROCESS', embedding: $v, embeddingModel: 'other-model'})`,
      { v: QUERY },
    );
    const result: any = await classes.getResolvers().Query.matchClasses(
      null,
      { input: { elements: [{ name: 'zz element under test', description: 'semantic' }], classLabel: 'COMPONENT' } },
      {},
    );
    expect(result.vectorAvailable).toBe(false);
  });

  it('MITRE: scores are cosines, the threshold holds, and the order is by score then id', async () => {
    const seed = [
      ['T9001', 1],
      ['T9002', THRESHOLD.mitre + 1e-3],
      ['T9003', THRESHOLD.mitre - 1e-3],
      ['T9004', 0],
      ['T9005', -1],
    ] as const;
    for (const [id, c] of seed) {
      await run(
        handle.driver,
        'CREATE (:MitreAttackTechnique {attack_id: $id, name: $id, description: $id, embedding: $v, embeddingModel: $model})',
        { id, v: atCosine(c), model: MODEL },
      );
    }
    const result: any = await mitre.getResolvers().Query.matchMitreTechniques(
      null,
      { input: { queries: [{ query: 'a behaviour described in other words' }], kind: 'ATTACK_TECHNIQUE', topN: 10 } },
      {},
    );
    expect(result.vectorAvailable).toBe(true);
    const got = result.matches[0].candidates.map((c: any) => [c.mitreId, c.similarityScore]);
    expect(got.map((g: any[]) => g[0])).toEqual(['T9001', 'T9002']);
    expect(Math.abs(got[0][1] - 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(got[1][1] - (THRESHOLD.mitre + 1e-3))).toBeLessThan(TOLERANCE);
  });

  it('MITRE: a corpus of another model only reports MODEL_MISMATCH', async () => {
    await run(
      handle.driver,
      "CREATE (:MitreAttackTechnique {attack_id: 'T9001', name: 'x', description: 'x', embedding: $v, embeddingModel: 'other-model'})",
      { v: QUERY },
    );
    const result: any = await mitre.getResolvers().Query.matchMitreTechniques(
      null,
      { input: { queries: [{ query: 'a behaviour described in other words' }], kind: 'ATTACK_TECHNIQUE' } },
      {},
    );
    expect(result.vectorAvailable).toBe(false);
    expect(result.vectorDisabledReason).toBe('MODEL_MISMATCH');
  });
});
