// `@cypher` Mutation canary — load-bearing proof for the
// `createAnalysisIdempotent` pattern.
//
// What this test pins:
//   1. @neo4j/graphql 7.2.0 + Memgraph 3.8.1 + native Cypher (no APOC) +
//      MERGE-by-id resolves an `@cypher` Mutation end-to-end
//   2. A second call with the same id is idempotent (the MERGE-by-id
//      invariant)
//   3. `columnName` mismatch → runtime null result (the directive's
//      published contract — silent failure if mis-spelled)

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

const typeDefs = `
  type _CanaryNode @node {
    id: ID!
    name: String!
  }

  type Mutation {
    _canaryMergeNode(id: ID!, name: String!): _CanaryNode
      @cypher(
        statement: """
        MERGE (n:_CanaryNode {id: $id})
          ON CREATE SET n.name = $name
          ON MATCH  SET n.name = $name
        RETURN n
        """
        columnName: "n"
      )
  }
`;

// Memgraph's database is named `memgraph` (not the @neo4j/graphql default
// `neo4j`); without overriding sessionConfig the executor throws
// "Tried to retrieve an unknown database 'neo4j'". Mirrors the production
// context factory at gql.module.ts.
// addVersionPrefix:false drops the `CYPHER 5` prefix Memgraph doesn't accept.
const ctx = {
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
};

// 30s test timeout: first @neo4j/graphql call against a fresh container
// has schema-build + first-bolt-query overhead that exceeds jest's 5s default.
jest.setTimeout(30_000);

describe('@cypher Mutation canary — proves the MERGE-by-id pattern', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    const neoSchema = new Neo4jGraphQL({ typeDefs, driver: mg.driver });
    schema = await neoSchema.getSchema();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('first call creates the node', async () => {
    const result = await graphql({
      schema,
      source: 'mutation { _canaryMergeNode(id: "x1", name: "first") { id name } }',
      contextValue: ctx,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?._canaryMergeNode).toEqual({ id: 'x1', name: 'first' });
  });

  it('second call with same id is idempotent (no duplicate)', async () => {
    await graphql({
      schema,
      source: 'mutation { _canaryMergeNode(id: "x1", name: "first")  { id } }',
      contextValue: ctx,
    });
    await graphql({
      schema,
      source: 'mutation { _canaryMergeNode(id: "x1", name: "second") { id } }',
      contextValue: ctx,
    });

    const session = mg.driver.session();
    try {
      const r = await session.run(
        'MATCH (n:_CanaryNode {id: $id}) RETURN count(n) AS c, collect(n.name) AS names',
        { id: 'x1' },
      );
      expect(r.records[0].get('c').toNumber()).toBe(1);
      expect(r.records[0].get('names')).toEqual(['second']);
    } finally {
      await session.close();
    }
  });

  it('columnName mismatch produces a runtime null result (negative control)', async () => {
    const badTypeDefs = `
      type _BadCanary @node { id: ID! }
      type Mutation {
        _badCanary(id: ID!): _BadCanary
          @cypher(statement: "MERGE (n:_BadCanary {id: $id}) RETURN n", columnName: "wrong")
      }
    `;
    const badSchema = await new Neo4jGraphQL({ typeDefs: badTypeDefs, driver: mg.driver }).getSchema();
    const result = await graphql({
      schema: badSchema,
      source: 'mutation { _badCanary(id: "y1") { id } }',
      contextValue: ctx,
    });
    expect(result.data?._badCanary).toBeNull();
  });
});
