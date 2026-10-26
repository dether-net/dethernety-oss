// The bootstrap drop of the Memgraph vector indexes earlier versions kept on the class labels.
//
// Class matching is exact and reads no vector index, so at bootstrap the platform drops the ones a
// database still has. Only those five go: a MITRE vector index (still searched by name on
// Memgraph) and any other vector index stay, and a second bootstrap finds nothing to do.
//
// Runs against a real Memgraph container, through a DatabaseService stand-in over its driver that
// reads in an explicit read transaction, as DatabaseService.executeRead does.

import { probeEngine } from '@dethernety/dt-module';
import { Driver } from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { describeMemgraphOnly } from './test-engine';
import {
  DropLegacyVectorIndexesService,
  LEGACY_VECTOR_INDEXES,
} from '../../src/bootstrap/drop-legacy-vector-indexes.service';

jest.setTimeout(180_000);

const LABEL_BY_INDEX: Record<string, string> = {
  component_class_embeddings: 'ComponentClass',
  control_class_embeddings: 'ControlClass',
  dataflow_class_embeddings: 'DataFlowClass',
  boundary_class_embeddings: 'SecurityBoundaryClass',
  data_class_embeddings: 'DataClass',
};

async function run(driver: Driver, cypher: string) {
  const session = driver.session();
  try {
    return await session.run(cypher);
  } finally {
    await session.close();
  }
}

async function vectorIndexNames(driver: Driver): Promise<string[]> {
  const result = await run(driver, 'CALL vector_search.show_index_info() YIELD index_name RETURN index_name');
  return result.records.map((r) => String(r.get('index_name'))).sort();
}

async function readInTransaction(driver: Driver, cypher: string) {
  const session = driver.session();
  try {
    return await session.executeRead((tx) => tx.run(cypher));
  } finally {
    await session.close();
  }
}

function databaseService(driver: Driver): any {
  return {
    getEngineInfoStrict: () => probeEngine(driver),
    executeRead: (cypher: string) => readInTransaction(driver, cypher),
    executeSchemaWrite: (cypher: string) => run(driver, cypher),
  };
}

const bootstrapped: any = { whenBootstrapped: async () => {} };

function service(driver: Driver) {
  return new DropLegacyVectorIndexesService(databaseService(driver), bootstrapped, bootstrapped);
}

// Memgraph-only (Memgraph vector indexes): skipped on the Neo4j leg (DT_TEST_ENGINE=neo4j).
describeMemgraphOnly('dropping the legacy vector indexes at bootstrap (Memgraph)', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();
  });

  afterAll(async () => {
    await mg?.stop().catch(() => undefined);
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    for (const name of await vectorIndexNames(mg.driver)) await run(mg.driver, `DROP VECTOR INDEX ${name}`);
  });

  it('drops the five class indexes and leaves a MITRE index and an unrelated one alone; a second run does nothing', async () => {
    for (const name of LEGACY_VECTOR_INDEXES) {
      await run(
        mg.driver,
        `CREATE VECTOR INDEX ${name} ON :${LABEL_BY_INDEX[name]}(embedding) ` +
          'WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
      );
    }
    await run(
      mg.driver,
      'CREATE VECTOR INDEX mitre_attack_technique_embeddings ON :MitreAttackTechnique(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
    );
    await run(
      mg.driver,
      'CREATE VECTOR INDEX other_embeddings ON :Other(embedding) WITH CONFIG {"dimension": 8, "capacity": 16, "metric": "cos"}',
    );

    const drop = service(mg.driver);
    await drop.onApplicationBootstrap();
    expect(await vectorIndexNames(mg.driver)).toEqual(['mitre_attack_technique_embeddings', 'other_embeddings']);

    await drop.onApplicationBootstrap();
    expect(await vectorIndexNames(mg.driver)).toEqual(['mitre_attack_technique_embeddings', 'other_embeddings']);
  });

  it('does nothing on a database that never had them', async () => {
    await service(mg.driver).onApplicationBootstrap();
    expect(await vectorIndexNames(mg.driver)).toEqual([]);
  });
});
