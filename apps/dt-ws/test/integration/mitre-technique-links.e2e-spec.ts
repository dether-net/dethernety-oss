// MITRE links with their justification through the GraphQL API, and the supersede copy.
//
// The instantiation writer creates EXPLOITED_BY, RESPONDS_WITH and all eight COUNTERMEASURE_*
// verb edges, each with an optional `justification`. The API exposes every one of those fields
// with the TechniqueLinkProperties edge type, so a client can read a link with its justification
// and write it back.
//
// What it proves, on the production schema (no-auth variant) against Memgraph:
//   1. EVERY LINK FIELD ROUND-TRIPS: a connect with `edge.justification` stores it, a connect
//      without one stores none, and the `…Connection` read returns both, for exploitedBy,
//      exploitedByAtlas and all nineteen countermeasure fields (ten ATT&CK/D3FEND, nine ATLAS).
//   2. WHAT THE WRITER WROTE IS READABLE: edges written by SetInstantiationAttributesService come
//      back through the API with their justification.
//   3. A SUPERSEDE COPY EQUALS ITS SOURCE: a SYSTEM countermeasure written by the writer with every
//      verb (ATT&CK and ATLAS targets) and RESPONDS_WITH link, each justified, is copied the way dt-core's supersede flow
//      copies it (read the links, create the copy with them), and the copy's outgoing MITRE edges
//      (type, target, justification) equal the source's. The same for an exposure.
//   4. A DISCONNECT IS SCOPED TO ITS FIELD'S LABEL: `disconnect: [{}]` on an ATT&CK field leaves the
//      ATLAS (and regulatory-requirement) targets of the same relationship type in place.
//
// The read and create inputs are reproduced by hand from dt-core (GET_COUNTERMEASURE_TECHNIQUE_LINKS,
// GET_EXPOSURE_TECHNIQUE_LINKS, techniqueLinkConnect in dt-utils/technique-links.ts) because dt-core
// is ESM-only and this Jest config cannot import it; dt-core's technique-links.test.ts pins the
// shapes it sends. Change one, revisit the other.
import { ConfigService } from '@nestjs/config';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';

jest.setTimeout(120_000);

const VERBS = ['mitigates', 'protectsAgainst', 'detects', 'isolates', 'deceives', 'evicts', 'restores', 'respondsTo'];
const ATLAS_FIELDS = ['mitigationsAtlas', ...VERBS.map((v) => `${v}Atlas`)];
const LINK_FIELDS = ['mitigations', 'defendedTechniques', ...VERBS, ...ATLAS_FIELDS];

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') return { maxQueryDepth: 10, maxQueryComplexity: 1000, queryTimeout: 30000 };
      return undefined;
    },
  } as unknown as ConfigService;
}

const techRef = (attackId: string, justification: string) => ({
  label: 'MitreAttackTechnique', property: 'attack_id', value: attackId, attributes: { justification },
});
const atlasRef = (atlasId: string, justification: string) => ({
  label: 'MitreAtlasTechnique', property: 'atlas_id', value: atlasId, attributes: { justification },
});

// The connect entry dt-core's techniqueLinkConnect builds.
const linkConnect = (link: { id: string; justification: string | null }) => ({
  where: { node: { id: { eq: link.id } } },
  ...(link.justification != null ? { edge: { justification: link.justification } } : {}),
});

describe('MITRE technique links with their justification (production schema, Memgraph)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;
  let writer: SetInstantiationAttributesService;

  const run = async (source: string, variableValues?: Record<string, unknown>) => {
    const result = await graphql({ schema, source, variableValues, contextValue: MEMGRAPH_CONTEXT });
    expect(result.errors).toBeUndefined();
    return result.data as Record<string, any>;
  };

  const cypher = async (query: string, params: Record<string, unknown> = {}) => {
    const session = mg.driver.session();
    try {
      return (await session.run(query, params)).records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  };

  // Every outgoing MITRE edge of one node: type, target id, justification.
  const mitreEdges = async (id: string) =>
    (
      await cypher(
        `MATCH ({id: $id})-[r]->(t)
         WHERE any(l IN labels(t) WHERE l STARTS WITH 'Mitre')
         RETURN type(r) AS type, t.id AS target, r.justification AS justification
         ORDER BY type, target`,
        { id },
      )
    ).map((r) => ({ type: r.type, target: r.target, justification: r.justification ?? null }));

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await buildProductionSchema('noauth', mg.driver);
    writer = new SetInstantiationAttributesService(
      mg.driver,
      makeStubConfigService(),
      {} as any, // moduleRegistry: unused by the direct upsert path
      { extractAuthContext: (c: any) => ({ user: c?.user }), checkAuthorization: async () => ({ allowed: true }) } as any,
      { recordOperation: () => undefined } as any,
    );
  }, 90_000);

  afterAll(async () => {
    await mg?.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    await cypher(`
      CREATE (:MitreAttackTechnique {id: 'tech-1', attack_id: 'T1001', name: 'One'}),
             (:MitreAttackTechnique {id: 'tech-2', attack_id: 'T1002', name: 'Two'}),
             (:MitreAttackMitigation {id: 'mit-1', attack_id: 'M1001', name: 'Mitigation'}),
             (:MitreDefendTechnique {id: 'def-1', d3fendId: 'D3-ONE', name: 'Defend'}),
             (:MitreAtlasTechnique {id: 'atlas-1', atlas_id: 'AML.T0051', name: 'LLM Prompt Injection'}),
             (:MitreAtlasMitigation {id: 'atlasm-1', atlas_id: 'AML.M0015', name: 'Adversarial Input Detection'}),
             (:RegulatoryRequirement {id: 'req-1', name: 'Requirement'}),
             (:Component {id: 'comp-1', name: 'Component'}),
             (:Control {id: 'ctl-1', name: 'Control'}),
             (:ControlClass {id: 'ccls-1', name: 'Class'})
    `);
  });

  it('round-trips every link field with and without a justification', async () => {
    const target = (field: string) =>
      field === 'mitigations' ? 'mit-1'
        : field === 'defendedTechniques' ? 'def-1'
          : field === 'mitigationsAtlas' ? 'atlasm-1'
            : field.endsWith('Atlas') ? 'atlas-1'
              : 'tech-1';
    const links = Object.fromEntries(
      LINK_FIELDS.map((f) => [f, { connect: [linkConnect({ id: target(f), justification: `why ${f}` })] }]),
    );
    links.mitigates.connect.push(linkConnect({ id: 'tech-2', justification: null }));
    const created = await run(
      `mutation ($input: [CountermeasureCreateInput!]!) {
        createCountermeasures(input: $input) { countermeasures { id } }
      }`,
      { input: [{ name: 'c', control: { connect: { where: { node: { id: { eq: 'ctl-1' } } } } }, ...links }] },
    );
    const id = created.createCountermeasures.countermeasures[0].id;

    const selection = LINK_FIELDS.map((f) => `${f}Connection { edges { node { id } properties { justification } } }`).join('\n');
    const read = (await run(`query ($id: ID!) { countermeasures(where: { id: { eq: $id } }) { ${selection} } }`, { id }))
      .countermeasures[0];
    for (const f of LINK_FIELDS) {
      const edges = read[`${f}Connection`].edges.map((e: any) => [e.node.id, e.properties.justification]);
      const expected: Array<[string, string | null]> = [[target(f), `why ${f}`]];
      if (f === 'mitigates') expected.push(['tech-2', null]);
      expect(edges.sort()).toEqual(expected.sort());
    }

    const exposure = await run(
      `mutation {
        createExposures(input: [{ name: "e",
          element: { connect: [{ where: { node: { id: { eq: "comp-1" } } } }] },
          exploitedBy: { connect: [{ where: { node: { id: { eq: "tech-1" } } }, edge: { justification: "found" } }] }
          exploitedByAtlas: { connect: [{ where: { node: { id: { eq: "atlas-1" } } }, edge: { justification: "injected" } }] }
        }]) { exposures {
          exploitedByConnection { edges { node { id } properties { justification } } }
          exploitedByAtlasConnection { edges { node { id } properties { justification } } }
        } }
      }`,
    );
    const createdExposure = exposure.createExposures.exposures[0];
    expect(createdExposure.exploitedByConnection.edges).toEqual([
      { node: { id: 'tech-1' }, properties: { justification: 'found' } },
    ]);
    expect(createdExposure.exploitedByAtlasConnection.edges).toEqual([
      { node: { id: 'atlas-1' }, properties: { justification: 'injected' } },
    ]);
  });

  it('copies a SYSTEM countermeasure the way dt-core supersedes it: every link and justification', async () => {
    const session = mg.driver.session();
    try {
      await session.executeWrite((tx) =>
        writer.upsertCountermeasuresInTx(tx as any, {
          componentId: 'ctl-1',
          classId: 'ccls-1',
          countermeasures: [
            {
              name: 'System CM',
              description: 'd',
              respondsWith: [
                { label: 'MitreAttackMitigation', property: 'attack_id', value: 'M1001', attributes: { justification: 'implements M1001' } },
                { label: 'MitreDefendTechnique', property: 'd3fendId', value: 'D3-ONE', attributes: { justification: 'is D3-ONE' } },
              ],
              ...Object.fromEntries(
                VERBS.map((v) => [v, [techRef('T1001', `${v} T1001`), techRef('T1002', `${v} T1002`), atlasRef('AML.T0051', `${v} AML.T0051`)]]),
              ),
            } as any,
          ],
        }),
      );
    } finally {
      await session.close();
    }
    const [{ id: sourceId }] = await cypher(`MATCH (c:Countermeasure {name: 'System CM'}) RETURN c.id AS id`);
    const sourceEdges = await mitreEdges(sourceId);
    expect(sourceEdges).toHaveLength(2 + VERBS.length * 3);
    expect(sourceEdges.every((e) => e.justification)).toBe(true);

    // dt-core: getCountermeasureTechniqueLinks, then createCountermeasure with techniqueLinks.
    const selection = LINK_FIELDS.map((f) => `${f}Connection { edges { node { id } properties { justification } } }`).join('\n');
    const row = (await run(`query ($id: ID!) { countermeasures(where: { id: { eq: $id } }) { ${selection} } }`, { id: sourceId }))
      .countermeasures[0];
    const linkInput = Object.fromEntries(
      LINK_FIELDS.filter((f) => row[`${f}Connection`].edges.length).map((f) => [
        f,
        { connect: row[`${f}Connection`].edges.map((e: any) => linkConnect({ id: e.node.id, justification: e.properties.justification })) },
      ]),
    );
    const copy = await run(
      `mutation ($input: [CountermeasureCreateInput!]!) { createCountermeasures(input: $input) { countermeasures { id } } }`,
      { input: [{ name: 'System CM (custom)', control: { connect: { where: { node: { id: { eq: 'ctl-1' } } } } }, ...linkInput }] },
    );

    expect(await mitreEdges(copy.createCountermeasures.countermeasures[0].id)).toEqual(sourceEdges);
  });

  it('copies a SYSTEM exposure the way dt-core supersedes it: every technique and justification', async () => {
    const session = mg.driver.session();
    try {
      await session.executeWrite((tx) =>
        writer.upsertExposuresInTx(tx as any, {
          componentId: 'comp-1',
          classId: 'ccls-1',
          exposures: [{ name: 'System exposure', description: 'd', exploitedBy: [techRef('T1001', 'via T1001'), techRef('T1002', 'via T1002'), atlasRef('AML.T0051', 'via AML.T0051')] } as any],
        }),
      );
    } finally {
      await session.close();
    }
    const [{ id: sourceId }] = await cypher(`MATCH (e:Exposure {name: 'System exposure'}) RETURN e.id AS id`);
    const sourceEdges = await mitreEdges(sourceId);
    expect(sourceEdges).toHaveLength(3);

    const row = (
      await run(
        `query ($id: ID!) { exposures(where: { id: { eq: $id } }) {
          exploitedByConnection { edges { node { id } properties { justification } } }
          exploitedByAtlasConnection { edges { node { id } properties { justification } } }
        } }`,
        { id: sourceId },
      )
    ).exposures[0];
    const copy = await run(
      `mutation ($input: [ExposureCreateInput!]!) { createExposures(input: $input) { exposures { id } } }`,
      {
        input: [{
          name: 'System exposure (custom)',
          element: { connect: [{ where: { node: { id: { eq: 'comp-1' } } } }] },
          exploitedBy: { connect: row.exploitedByConnection.edges.map((e: any) => linkConnect({ id: e.node.id, justification: e.properties.justification })) },
          exploitedByAtlas: { connect: row.exploitedByAtlasConnection.edges.map((e: any) => linkConnect({ id: e.node.id, justification: e.properties.justification })) },
        }],
      },
    );

    expect(await mitreEdges(copy.createExposures.exposures[0].id)).toEqual(sourceEdges);
  });
  it('a disconnect-all on an ATT&CK field leaves the ATLAS and requirement links of the same edge type', async () => {
    // EXPLOITED_BY and RESPONDS_WITH each carry ATT&CK, ATLAS (and, for RESPONDS_WITH, regulatory
    // requirement) targets. The typed fields must scope a disconnect to their own label.
    await cypher(`
      MATCH (k:Control {id: 'ctl-1'}), (m:MitreAttackMitigation {id: 'mit-1'}), (am:MitreAtlasMitigation {id: 'atlasm-1'}),
            (r:RegulatoryRequirement {id: 'req-1'}), (t:MitreAttackTechnique {id: 'tech-1'}), (at:MitreAtlasTechnique {id: 'atlas-1'}),
            (c:Component {id: 'comp-1'})
      CREATE (k)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure {id: 'cm-x', name: 'cm'}),
             (cm)-[:RESPONDS_WITH]->(m), (cm)-[:RESPONDS_WITH {justification: 'kept'}]->(am), (cm)-[:RESPONDS_WITH]->(r),
             (c)-[:HAS_EXPOSURE]->(e:Exposure {id: 'exp-x', name: 'e'}),
             (e)-[:EXPLOITED_BY]->(t), (e)-[:EXPLOITED_BY {justification: 'kept'}]->(at)
    `);
    await run(`mutation { updateCountermeasures(where: { id: { eq: "cm-x" } }, update: { mitigations: [{ disconnect: [{}] }] }) { countermeasures { id } } }`);
    await run(`mutation { updateExposures(where: { id: { eq: "exp-x" } }, update: { exploitedBy: [{ disconnect: [{}] }] }) { exposures { id } } }`);

    expect(await mitreEdges('cm-x')).toEqual([['RESPONDS_WITH', 'atlasm-1', 'kept']].map(([type, target, justification]) => ({ type, target, justification })));
    expect((await cypher(`MATCH (:Countermeasure {id: 'cm-x'})-[:RESPONDS_WITH]->(r:RegulatoryRequirement) RETURN count(r) AS n`))[0].n.toNumber()).toBe(1);
    expect(await mitreEdges('exp-x')).toEqual([{ type: 'EXPLOITED_BY', target: 'atlas-1', justification: 'kept' }]);
  });
});
