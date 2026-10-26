// MITRE vector indexes on a Memgraph release that re-keys a vector index on snapshot recovery.
//
// The MITRE search is exact and does not read these indexes. The resolver keeps one HNSW index per
// healthy MITRE kind for consumers that still search the corpus by index name, and repairs an index
// that Memgraph 3.8.1 recovered under another label or property:
// 1. when it ensures its indexes, and
// 2. when only Memgraph restarted and the platform kept running, at the next search after the
//    precheck expires.
//
// The resolver runs against a real container with stub config, auth, monitoring and embedding
// services.

import { EmbeddingService } from '../../src/gql/services/embedding.service';
import neo4j, { Driver } from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { describeMemgraphContainerOnly } from './test-engine';
import { LOOPBACK_HOST } from './loopback-container';
import { MatchMitreTechniquesResolverService } from '../../src/gql/resolver-services/match-mitre-techniques-resolver.service';
import { VectorSearchService } from '../../src/gql/services/vector-search.service';

jest.setTimeout(180_000);

// The release that re-keys a vector index on snapshot recovery.
const REKEYING_IMAGE = 'memgraph/memgraph:3.8.1';
// The snapshot settings a deployment runs with; a restart recovers from the snapshot.
const DEPLOYMENT_FLAGS = ['--storage-snapshot-interval-sec=300', '--storage-gc-cycle-sec=300'];
const DIMENSIONS = 8;
const MODEL = 'test-embedding-model';
const ATLAS_INDEX = 'mitre_atlas_technique_embeddings';

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
}
/** e0 tilted towards axis `axis` by `amount`. */
function near(axis: number, amount: number): number[] {
  const v = new Array(DIMENSIONS).fill(0);
  v[0] = 1;
  v[axis] += amount;
  return unit(v);
}
const QUERY = near(1, 0);

async function run(driver: Driver, cypher: string, params: Record<string, unknown> = {}) {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

/** The label and property Memgraph reports for a vector index. */
async function indexKey(driver: Driver, index: string): Promise<string> {
  const result = await run(
    driver,
    'CALL vector_search.show_index_info() YIELD index_name, label, property WITH index_name, label, property WHERE index_name = $index RETURN label, property',
    { index },
  );
  const record = result.records[0];
  return `${String(record.get('label')).replace(/^:/, '')}.${record.get('property')}`;
}

/** Take a snapshot, restart the container (it recovers from the snapshot) and connect again. */
async function restartFromSnapshot(mg: MemgraphHandle): Promise<Driver> {
  await run(mg.driver, 'CREATE SNAPSHOT');
  await mg.driver.close();
  await mg.container.restart();
  const driver = neo4j.driver(`bolt://${LOOPBACK_HOST}:${mg.container.getMappedPort(7687)}`, neo4j.auth.basic('', ''));
  for (let i = 0; i < 40; i++) {
    try {
      await run(driver, 'RETURN 1');
      return driver;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('Memgraph did not come back after the restart');
}

/** Ids a search with each technique's own vector returns among its nearest three, through the index. */
async function heldTechniques(driver: Driver): Promise<string[]> {
  const held = await run(
    driver,
    `MATCH (n:MitreAtlasTechnique) CALL vector_search.search('${ATLAS_INDEX}', 3, n.embedding) YIELD node
     WITH n, collect(node.atlas_id) AS nearest WHERE n.atlas_id IN nearest RETURN n.atlas_id AS id ORDER BY id`,
  );
  return held.records.map((r) => r.get('id'));
}

// Memgraph-only, on its own image and flags, with a restart: skipped on the Neo4j leg and in an external run.
describeMemgraphContainerOnly(`MITRE vector indexes on ${REKEYING_IMAGE}, which re-keys a vector index on snapshot recovery`, () => {
  let mg: MemgraphHandle;

  const config: any = { get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined) };
  const auth: any = { extractAuthContext: () => ({}), checkAuthorization: async () => ({ allowed: true }) };
  const monitoring: any = { recordOperation: () => {} };
  const embedding: any = {
    isEnabled: () => true,
    getModel: () => MODEL,
    getDimensions: () => DIMENSIONS,
    getThreshold: () => 0.5,
    embedBatch: async (texts: string[]) => texts.map(() => QUERY),
    /** The service's per-text fallback: one text, through embedBatch. */
    async embedOnce(text: string) {
      return (await this.embedBatch([text]))?.[0] ?? null;
    },
    embedEach(texts: string[], kind: 'query') {
      return EmbeddingService.prototype.embedEach.call(this, texts, kind);
    },
    /** The helpers embedEach calls: no query timeout here, and an overload is not counted. */
    queryEmbedOptions: () => undefined,
    noteOverload: () => {},
  };

  function mitre(driver: Driver): { resolver: MatchMitreTechniquesResolverService; vectorSearch: VectorSearchService } {
    const vectorSearch = new VectorSearchService(driver, config, {
      getEngineInfo: async () => ({ engine: 'memgraph', edition: null, version: null }),
    } as any);
    const resolver = new MatchMitreTechniquesResolverService(driver, config, auth, monitoring, embedding, vectorSearch);
    for (const level of ['log', 'warn', 'debug']) jest.spyOn((resolver as any).logger, level).mockImplementation(() => {});
    return { resolver, vectorSearch };
  }

  const writeTechnique = (driver: Driver, id: string, v: number[]) =>
    run(
      driver,
      'CREATE (n:MitreAtlasTechnique {atlas_id: $id, name: $id, description: $id}) SET n.embedding = $v, n.embeddingModel = $model',
      { id, v, model: MODEL },
    );

  beforeEach(async () => {
    // A fresh container per test: a restart test leaves a recovered database behind.
    mg = await startMemgraph({ image: REKEYING_IMAGE, command: DEPLOYMENT_FLAGS });
    await clearGraph(mg.driver);
    // Another vector index first: the index Memgraph re-keys on recovery is not the first one.
    await run(
      mg.driver,
      'CREATE VECTOR INDEX decoy_idx ON :Decoy(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
    );
  });

  afterEach(async () => {
    await mg?.stop().catch(() => undefined);
  });

  it('rebuilds a re-keyed index when the resolver ensures its indexes', async () => {
    await writeTechnique(mg.driver, 'AML.T0001', near(2, 1));
    await mitre(mg.driver).resolver.ensureMitreVectorIndexes();
    expect(await indexKey(mg.driver, ATLAS_INDEX)).toBe('MitreAtlasTechnique.embedding');

    const driver = await restartFromSnapshot(mg);
    mg = { ...mg, driver };
    expect(await indexKey(driver, ATLAS_INDEX)).not.toBe('MitreAtlasTechnique.embedding');
    // A technique written after the recovery, as a later ingest would.
    await writeTechnique(driver, 'AML.T0002', near(3, 1));

    await mitre(driver).resolver.ensureMitreVectorIndexes();
    expect(await indexKey(driver, ATLAS_INDEX)).toBe('MitreAtlasTechnique.embedding');
    expect(await heldTechniques(driver)).toEqual(['AML.T0001', 'AML.T0002']);
  });

  it('heals an index re-keyed by a database-only restart at the next search after the precheck expires', async () => {
    await writeTechnique(mg.driver, 'AML.T0001', near(2, 1));
    const { resolver, vectorSearch } = mitre(mg.driver);
    const search = () =>
      resolver.getResolvers().Query.matchMitreTechniques(
        null,
        { input: { queries: [{ query: 'a behaviour described in other words' }], kind: 'ATLAS_TECHNIQUE', topN: 3 } },
        {},
      );
    await search();
    await resolver.ensureMitreVectorIndexes();
    expect(await indexKey(mg.driver, ATLAS_INDEX)).toBe('MitreAtlasTechnique.embedding');

    // Memgraph restarts on its own; the platform's services keep their state and reconnect.
    const driver = await restartFromSnapshot(mg);
    mg = { ...mg, driver };
    (resolver as any).neo4jDriver = driver;
    (vectorSearch as any).neo4jDriver = driver;
    expect(await indexKey(driver, ATLAS_INDEX)).not.toBe('MitreAtlasTechnique.embedding');
    await writeTechnique(driver, 'AML.T0002', near(3, 1));

    // The precheck expires (its TTL elapsing, here moved back), and the next search starts the repair.
    (resolver as any).vectorPrecheckResult.checkedAt = 0;
    const result: any = await search();
    expect(result.vectorAvailable).toBe(true);
    await resolver.ensureMitreVectorIndexes();
    expect(await indexKey(driver, ATLAS_INDEX)).toBe('MitreAtlasTechnique.embedding');
    expect(await heldTechniques(driver)).toEqual(['AML.T0001', 'AML.T0002']);
  });
});
