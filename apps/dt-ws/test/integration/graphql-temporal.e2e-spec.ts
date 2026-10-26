// A DateTime field read through the production GraphQL schema, on the engine the suites run against.
//
// @neo4j/graphql reads every DateTime field through apoc.date.convertFormat, and writes apoc.util.validatePredicate
// into the checks of some mutations. A Neo4j without APOC Core fails every such query ("Unknown function
// 'apoc.date.convertFormat'"), while suites that write and read through Cypher alone still pass. This suite reads an
// Exposure's dispositionedAt through GraphQL, stored the way the disposition resolver stores it (an ISO-8601
// string), and, on Neo4j, lists and calls both functions, loaded as the deployment and the harness load them
// (compose.neo4j.yaml, neo4j-container.ts).

import { graphql, GraphQLSchema } from 'graphql';
import { GRAPHQL_APOC_FUNCTIONS } from '../../src/bootstrap/check-apoc-functions.service';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';
import { itNeo4jOnly } from './test-engine';

jest.setTimeout(30_000);

async function run(driver: any, cypher: string, params: Record<string, unknown> = {}): Promise<any> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

describe('GraphQL DateTime fields (APOC on Neo4j)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await buildProductionSchema('noauth', mg.driver);
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('reads an Exposure\'s dispositionedAt through GraphQL, as the instant that was stored', async () => {
    const at = '2026-10-25T06:09:45.000Z';
    await run(mg.driver, 'CREATE (:Exposure {id: $id, name: $name, dispositionedAt: $at})', {
      id: 'graphql-temporal-1',
      name: 'datetime read',
      at,
    });

    const result = await graphql({
      schema,
      source: 'query ($id: ID!) { exposures(where: { id: { eq: $id } }) { id dispositionedAt } }',
      variableValues: { id: 'graphql-temporal-1' },
      contextValue: MEMGRAPH_CONTEXT,
    });

    expect(result.errors).toBeUndefined();
    const rows = (result.data as any).exposures;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].dispositionedAt).toISOString()).toBe(at);
  });

  itNeo4jOnly('lists and runs the APOC functions the GraphQL layer calls', async () => {
    const listed = await run(mg.driver, 'SHOW FUNCTIONS YIELD name WHERE name IN $names RETURN collect(name) AS found', {
      names: GRAPHQL_APOC_FUNCTIONS,
    });
    expect([...listed.records[0].get('found')].sort()).toEqual([...GRAPHQL_APOC_FUNCTIONS].sort());

    const called = await run(
      mg.driver,
      "RETURN apoc.date.convertFormat('2026-10-25T06:09:45Z', 'iso_zoned_date_time', 'iso_offset_date_time') AS converted, " +
        "apoc.util.validatePredicate(false, 'unused', []) AS validated",
    );
    expect(called.records[0].get('converted')).toBe('2026-10-25T06:09:45Z');
    expect(called.records[0].get('validated')).toBe(true);
  });
});
