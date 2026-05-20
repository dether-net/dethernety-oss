// Companion-flip canary — load-bearing proof for the USER-copy-delete
// staleness companion.
//
// The dt-core companion (`flipSupersededStaleByName` /
// `flipSupersededCountermeasureStaleByName`) flips `dispositionStale` via the
// *generated* `updateExposures` / `updateCountermeasures` mutation. That only
// works if `dispositionStale` is present in the generated `*UpdateInput`.
//
// We dropped `@settable(onCreate:false,onUpdate:false)` from
// `dispositionStale` precisely so the generated update mutation accepts it
// (the prior @settable lock silently broke the exposure companion — the error
// was swallowed fire-and-forget and no test exercised the GraphQL path).
//
// This canary pins the @neo4j/graphql 7.2.0 contract the companion depends on,
// using the real mutation names + filter shape against a real Memgraph:
//   1. updateCountermeasures(where:{dispositionReason CONTAINS "'<name>'"},
//      update:{dispositionStale:{set:true}}) flips the matching SUPERSEDED row
//      and leaves a non-matching row untouched (the fix works end-to-end).
//   2. updateExposures(update:{dispositionStale:{set:true}}) succeeds (positive
//      control for the dropped guard).
//   3. updateExposures(update:{dispositionedBy:{set:...}}) is rejected — the
//      field stays excluded from the input (the guard we deliberately KEPT on
//      the attribution fields).

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

// Mini-schema mirroring the disposition @settable posture: dispositionStale is
// freely settable; dispositionedBy keeps the lock. Types
// kept minimal (String/Boolean) — @settable's effect on the generated input is
// type-agnostic, so this faithfully reproduces the real Exposure/Countermeasure
// input shape without the production schema's callbacks/scalars.
const typeDefs = `
  type Exposure @node {
    id: ID!
    name: String!
    dispositionKind: String
    dispositionReason: String
    dispositionStale: Boolean
    dispositionedBy: String @settable(onCreate: false, onUpdate: false)
  }
  type Countermeasure @node {
    id: ID!
    name: String!
    dispositionKind: String
    dispositionReason: String
    dispositionStale: Boolean
    dispositionedBy: String @settable(onCreate: false, onUpdate: false)
  }
`;

const ctx = {
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
};

jest.setTimeout(30_000);

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function readCmStale(driver: any, id: string): Promise<boolean | null> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (cm:Countermeasure {id: $id}) RETURN cm.dispositionStale AS s`,
      { id },
    );
    return r.records.length === 0 ? null : r.records[0].get('s');
  } finally {
    await session.close();
  }
}

describe('Companion-flip canary — generated update mutation accepts dispositionStale', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await new Neo4jGraphQL({ typeDefs, driver: mg.driver }).getSchema();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('updateCountermeasures flips the bracketed SUPERSEDED match and leaves others untouched', async () => {
    await runWrite(
      mg.driver,
      `CREATE (:Countermeasure {
        id: 'cm-match', name: 'SYSTEM MFA',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Superseded by user-authored countermeasure 'Custom MFA'",
        dispositionStale: false
      })`,
    );
    await runWrite(
      mg.driver,
      `CREATE (:Countermeasure {
        id: 'cm-other', name: 'SYSTEM Other',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Superseded by user-authored countermeasure 'Different Control'",
        dispositionStale: false
      })`,
    );

    const result = await graphql({
      schema,
      source: `
        mutation Flip($where: CountermeasureWhere!, $update: CountermeasureUpdateInput!) {
          updateCountermeasures(where: $where, update: $update) {
            countermeasures { id dispositionStale }
          }
        }
      `,
      variableValues: {
        where: {
          dispositionKind: { eq: 'SUPERSEDED' },
          dispositionReason: { contains: "'Custom MFA'" },
        },
        update: { dispositionStale: { set: true } },
      },
      contextValue: ctx,
    });

    expect(result.errors).toBeUndefined();
    const updated = (result.data as any)?.updateCountermeasures?.countermeasures;
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual({ id: 'cm-match', dispositionStale: true });
    expect(await readCmStale(mg.driver, 'cm-match')).toBe(true);
    expect(await readCmStale(mg.driver, 'cm-other')).toBe(false);
  });

  it('updateExposures accepts dispositionStale on update (the dropped guard)', async () => {
    await runWrite(mg.driver, `CREATE (:Exposure { id: 'e-1', name: 'X', dispositionStale: false })`);
    const result = await graphql({
      schema,
      source: `
        mutation($where: ExposureWhere!, $update: ExposureUpdateInput!) {
          updateExposures(where: $where, update: $update) { exposures { id dispositionStale } }
        }
      `,
      variableValues: {
        where: { id: { eq: 'e-1' } },
        update: { dispositionStale: { set: true } },
      },
      contextValue: ctx,
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any)?.updateExposures?.exposures?.[0]?.dispositionStale).toBe(true);
  });

  it('updateExposures still REJECTS dispositionedBy on update (the kept attribution guard)', async () => {
    const result = await graphql({
      schema,
      source: `
        mutation($where: ExposureWhere!, $update: ExposureUpdateInput!) {
          updateExposures(where: $where, update: $update) { exposures { id } }
        }
      `,
      variableValues: {
        where: { id: { eq: 'e-1' } },
        update: { dispositionedBy: { set: 'forged' } },
      },
      contextValue: ctx,
    });
    // @settable(onUpdate:false) excludes dispositionedBy from ExposureUpdateInput,
    // so variable coercion fails — proving the attribution guard is intact.
    expect(result.errors).toBeDefined();
    expect(JSON.stringify(result.errors)).toContain('dispositionedBy');
  });
});
