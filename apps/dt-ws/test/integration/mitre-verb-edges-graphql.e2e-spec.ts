// Integration coverage for the GraphQL surface of countermeasure verb edges (Slice 2).
//
// AC-8: the `mitigates` @relationship field returns the linked ATT&CK techniques.
// AC-9: a hand-authored countermeasure that `connect`s a technique under `mitigates`
//       is stamped createdBy=USER and survives a subsequent SYSTEM rebuild (the scoped
//       upsert skips USER findings; verb edges are never pruned).
//
// Mirrors provenance.e2e-spec: a minimal Neo4jGraphQL probe schema exercises the same
// @relationship + @populatedBy directives the production schema uses, without booting
// the full NestJS app. The SYSTEM rebuild is driven through the real
// SetInstantiationAttributesService (as set-attributes-staleness.e2e-spec constructs it).

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } from '../../src/gql/populated-by/authored-by';

jest.setTimeout(120_000);

// Minimal probe mirroring the production Countermeasure verb-edge shape.
const typeDefs = `
  type MitreAttackTechnique @node {
    attack_id: String!
    name: String
  }
  type Control @node {
    id: ID!
    name: String
    countermeasures: [Countermeasure!]! @relationship(type: "HAS_COUNTERMEASURE", direction: OUT)
  }
  type ControlClass @node {
    id: ID!
    name: String
  }
  type Countermeasure @node {
    id: ID! @id
    name: String!
    createdBy: String
      @populatedBy(callback: "stampCreatedByUserOnCreate", operations: [CREATE])
      @settable(onUpdate: false)
    authoredBy: String
      @populatedBy(callback: "populateAuthoredByOnCreate", operations: [CREATE])
      @settable(onUpdate: false)
    mitigates: [MitreAttackTechnique!]! @relationship(type: "COUNTERMEASURE_MITIGATES", direction: OUT)
    control: [Control!]! @relationship(type: "HAS_COUNTERMEASURE", direction: IN)
    controlClass: [ControlClass!]! @relationship(type: "IS_COUNTERMEASURE_OF", direction: OUT)
  }
`;

const ctx = (userSub: string | null) => ({
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
  user: userSub ? { sub: userSub } : undefined,
});

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') return { maxQueryDepth: 10, maxQueryComplexity: 1000, queryTimeout: 30000 };
      return undefined;
    },
  } as unknown as ConfigService;
}

describe('Countermeasure verb edges — GraphQL surface (e2e)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;
  let svc: SetInstantiationAttributesService;

  beforeAll(async () => {
    mg = await startMemgraph();
    const neoSchema = new Neo4jGraphQL({
      typeDefs,
      driver: mg.driver,
      features: {
        populatedBy: {
          callbacks: { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } as any,
        },
      },
    });
    schema = await neoSchema.getSchema();
    svc = new SetInstantiationAttributesService(
      mg.driver,
      makeStubConfigService(),
      {} as any,
      { extractAuthContext: () => ({}), checkAuthorization: async () => ({ allowed: true }) } as any,
      { recordOperation: () => {} } as any,
    );
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  async function runWrite(cypher: string, params: any = {}): Promise<any> {
    const session = mg.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  // AC-8
  it('the `mitigates` field returns the techniques linked by COUNTERMEASURE_MITIGATES', async () => {
    await runWrite(
      `CREATE (cm:Countermeasure { id: 'cm-1', name: 'MFA', createdBy: 'SYSTEM' })
       CREATE (t:MitreAttackTechnique { attack_id: 'T1078', name: 'Valid Accounts' })
       CREATE (cm)-[:COUNTERMEASURE_MITIGATES]->(t)`,
    );

    const result = await graphql({
      schema,
      source: `query { countermeasures(where: { name_EQ: "MFA" }) { name mitigates { attack_id } } }`,
      contextValue: ctx('user-1'),
    });

    expect(result.errors).toBeUndefined();
    const cm = (result.data as any)?.countermeasures?.[0];
    expect(cm).toEqual({ name: 'MFA', mitigates: [{ attack_id: 'T1078' }] });
  });

  // AC-9
  it('a hand-authored countermeasure connects a technique under `mitigates`, is USER, and survives a SYSTEM rebuild', async () => {
    // Pre-seed the control, its class, and the technique to connect to.
    await runWrite(
      `CREATE (:Control { id: 'ctrl-1', name: 'Ctrl' })
       CREATE (:ControlClass { id: 'ccls-1', name: 'CtrlClass' })
       CREATE (:MitreAttackTechnique { attack_id: 'T1078', name: 'Valid Accounts' })`,
    );

    // Manual-add via the auto-generated create mutation + nested connect.
    const created = await graphql({
      schema,
      source: `
        mutation {
          createCountermeasures(input: [{
            name: "Analyst MFA"
            mitigates: { connect: { where: { node: { attack_id_EQ: "T1078" } } } }
            control: { connect: { where: { node: { id_EQ: "ctrl-1" } } } }
            controlClass: { connect: { where: { node: { id_EQ: "ccls-1" } } } }
          }]) {
            countermeasures { name createdBy mitigates { attack_id } }
          }
        }
      `,
      contextValue: ctx('analyst-7'),
    });

    expect(created.errors).toBeUndefined();
    const node = (created.data as any)?.createCountermeasures?.countermeasures?.[0];
    expect(node).toEqual({ name: 'Analyst MFA', createdBy: 'USER', mitigates: [{ attack_id: 'T1078' }] });

    // SYSTEM rebuild of the same control+class with a different-named countermeasure.
    const session = mg.driver.session();
    try {
      await session.executeWrite((tx) =>
        svc.upsertCountermeasuresInTx(tx as any, {
          componentId: 'ctrl-1',
          classId: 'ccls-1',
          countermeasures: [{ name: 'System CM', type: 'CONTROL', category: 'identity' }],
        }),
      );
    } finally {
      await session.close();
    }

    // The USER countermeasure and its mitigates edge must survive untouched.
    const after = await runWrite(
      `MATCH (cm:Countermeasure { name: 'Analyst MFA' })
       OPTIONAL MATCH (cm)-[:COUNTERMEASURE_MITIGATES]->(t:MitreAttackTechnique)
       RETURN cm.createdBy AS createdBy, collect(t.attack_id) AS techniques`,
    );
    expect(after.records[0].get('createdBy')).toBe('USER');
    expect(after.records[0].get('techniques')).toEqual(['T1078']);

    // And the SYSTEM rebuild did land its own node (sanity: the rebuild ran).
    const sys = await runWrite(
      `MATCH (cm:Countermeasure { name: 'System CM' }) RETURN cm.createdBy AS createdBy`,
    );
    expect(sys.records[0].get('createdBy')).toBe('SYSTEM');
  });
});
