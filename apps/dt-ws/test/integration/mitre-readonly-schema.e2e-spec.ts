// MITRE reference data is read-only through the GraphQL API.
//
// The MITRE nodes are shared by every model and written only by the mitre-frameworks ingest, so
// the production schema gives the MITRE types no generated mutations, lets no nested operation run
// through a MITRE type's own relationship fields, and restricts every field that points at a MITRE
// type, or at the Element interface the MITRE types implement, to CONNECT and DISCONNECT.
//
// What it proves, on the production schema.graphql AND on its no-auth variant (built with the
// generator's own stripAuthentication):
//   1. NO ROOT MUTATION names a MITRE type.
//   2. THE INPUT TYPES carry only connect (create) and connect/disconnect (update) on every field that
//      targets a MITRE type or Element, and a connect/disconnect into a MITRE node carries no nested
//      operation of its own.
//   3. EVERY WRITE SHAPE THAT WOULD TOUCH A MITRE NODE IS REJECTED at validation: a nested create,
//      update and delete under a MITRE field, a MITRE node created through Element, a nested
//      disconnect run through a MITRE node, and the old root mutations.
//   4. THE CLIENT SHAPES STILL WORK on a real graph, for exposures and countermeasures, ATT&CK and
//      ATLAS fields alike. Connect on create (with the edge justification); on update, dt-core's link
//      delta: `connect` for added ids and a where-scoped `disconnect` for removed ones, so a kept link
//      keeps its edge. The delta documents also validate on both schemas, and every MITRE
//      DisconnectFieldInput keeps its `where`. Published clients that predate the delta still send
//      the replace shape (`disconnect: [{}]` plus connect); that keeps working too. The inputs are
//      reproduced by hand from dt-core's writers (dt-exposure.ts, dt-countermeasure.ts, via
//      dt-utils/link-delta.ts) because dt-core is ESM-only and this Jest config cannot import it;
//      change one, revisit the other.
import { graphql, GraphQLInputObjectType, GraphQLSchema, parse, validate } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';

jest.setTimeout(120_000);

const MITRE_TYPES = [
  'MitreAttackTactic',
  'MitreAttackTechnique',
  'MitreAttackMitigation',
  'MitreDefendTactic',
  'MitreDefendTechnique',
  'MitreAtlasTechnique',
  'MitreAtlasTactic',
  'MitreAtlasMitigation',
  'MitreAtlasCaseStudy',
];

// Owner type and field of every relationship that points at a MITRE type or at Element.
const RESTRICTED_FIELDS: Array<[string, string]> = [
  ['Exposure', 'exploitedBy'],
  ['Countermeasure', 'mitigations'],
  ['Countermeasure', 'defendedTechniques'],
  ['Countermeasure', 'mitigates'],
  ['Countermeasure', 'protectsAgainst'],
  ['Countermeasure', 'detects'],
  ['Countermeasure', 'isolates'],
  ['Countermeasure', 'deceives'],
  ['Countermeasure', 'evicts'],
  ['Countermeasure', 'restores'],
  ['Countermeasure', 'respondsTo'],
  ['Exposure', 'exploitedByAtlas'],
  ['Countermeasure', 'mitigationsAtlas'],
  ['Countermeasure', 'mitigatesAtlas'],
  ['Countermeasure', 'protectsAgainstAtlas'],
  ['Countermeasure', 'detectsAtlas'],
  ['Countermeasure', 'isolatesAtlas'],
  ['Countermeasure', 'deceivesAtlas'],
  ['Countermeasure', 'evictsAtlas'],
  ['Countermeasure', 'restoresAtlas'],
  ['Countermeasure', 'respondsToAtlas'],
  ['Model', 'representedBy'],
  ['Data', 'elements'],
  ['Control', 'elements'],
  ['Exposure', 'element'],
  ['Analysis', 'element'],
];

const ELEMENT_FIELDS = ['representedBy', 'elements', 'element'];
const MITRE_TARGETS = RESTRICTED_FIELDS.filter(([, field]) => !ELEMENT_FIELDS.includes(field));

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function inputFields(schema: GraphQLSchema, name: string): string[] {
  const type = schema.getType(name);
  if (!type) return [];
  expect(type).toBeInstanceOf(GraphQLInputObjectType);
  return Object.keys((type as GraphQLInputObjectType).getFields()).sort();
}

// dt-core's update documents: the input is a variable, as UPDATE_EXPOSURE / UPDATE_COUNTERMEASURE send it.
const DELTA_DOCUMENTS = {
  exposure: `mutation ($id: ID!, $input: ExposureUpdateInput!) {
    updateExposures(where: { id: { eq: $id } }, update: $input) { exposures { id } } }`,
  countermeasure: `mutation ($id: ID!, $input: CountermeasureUpdateInput!) {
    updateCountermeasures(where: { id: { eq: $id } }, update: $input) { countermeasures { id } } }`,
};

// One link-delta operand, as dt-utils/link-delta.ts builds it.
const w = (id: string) => ({ where: { node: { id: { eq: id } } } });

function rejected(schema: GraphQLSchema, source: string): void {
  const errors = validate(schema, parse(source));
  expect(errors.length).toBeGreaterThan(0);
}

describe.each(['auth', 'noauth'] as const)('MITRE types are read-only — %s schema', (variant) => {
  let schema: GraphQLSchema;

  beforeAll(async () => {
    schema = await buildProductionSchema(variant);
  });

  it('has no root mutation that names a MITRE type', () => {
    const mutations = Object.keys(schema.getMutationType()!.getFields());
    expect(mutations.filter((m) => MITRE_TYPES.some((t) => m.includes(t)))).toEqual([]);
    // The non-MITRE writes are still there.
    expect(mutations).toEqual(expect.arrayContaining(['createExposures', 'updateCountermeasures']));
  });

  it.each(RESTRICTED_FIELDS)('%s.%s allows only connect and disconnect', (type, field) => {
    const prefix = `${type}${cap(field)}`;
    expect(inputFields(schema, `${prefix}FieldInput`)).toEqual(['connect']);
    expect(inputFields(schema, `${prefix}UpdateFieldInput`)).toEqual(['connect', 'disconnect']);
  });

  it.each(MITRE_TARGETS)('%s.%s runs no nested operation through the MITRE node', (type, field) => {
    const prefix = `${type}${cap(field)}`;
    expect(inputFields(schema, `${prefix}ConnectFieldInput`)).not.toContain('connect');
    expect(inputFields(schema, `${prefix}DisconnectFieldInput`)).not.toContain('disconnect');
  });

  it.each(MITRE_TARGETS)('%s.%s keeps a where filter on disconnect, so a delta removes one link', (type, field) => {
    expect(inputFields(schema, `${type}${cap(field)}DisconnectFieldInput`)).toContain('where');
  });

  it.each(Object.entries(DELTA_DOCUMENTS))('accepts dt-core\'s link delta: %s', (_name, source) => {
    expect(validate(schema, parse(source))).toEqual([]);
  });

  it('offers no MITRE member when creating through the Element interface', () => {
    for (const t of MITRE_TYPES) {
      expect(schema.getType(`${t}CreateInput`)).toBeUndefined();
    }
  });

  it.each([
    [
      'a nested create under exploitedBy',
      `mutation { createExposures(input: [{ name: "x", exploitedBy: { create: [{ node: { attack_id: "T9999", name: "x" } }] } }]) { exposures { id } } }`,
    ],
    [
      'a nested update under exploitedBy',
      `mutation { updateExposures(update: { exploitedBy: [{ update: { node: { name: { set: "x" } } } }] }) { exposures { id } } }`,
    ],
    [
      'a nested delete under exploitedBy',
      `mutation { updateExposures(update: { exploitedBy: [{ delete: [{}] }] }) { exposures { id } } }`,
    ],
    [
      'a nested update under a countermeasure verb',
      `mutation { updateCountermeasures(update: { mitigates: [{ update: { node: { name: { set: "x" } } } }] }) { countermeasures { id } } }`,
    ],
    [
      'a MITRE node created through Element',
      `mutation { createExposures(input: [{ name: "x", element: { create: [{ node: { MitreAttackTechnique: { attack_id: "T9999", name: "x" } } }] } }]) { exposures { id } } }`,
    ],
    [
      'a nested update through Element',
      `mutation { updateExposures(update: { element: [{ update: { node: { name: { set: "x" } } } }] }) { exposures { id } } }`,
    ],
    [
      'a nested disconnect run through a MITRE node',
      `mutation { updateExposures(update: { exploitedBy: [{ disconnect: [{ disconnect: { exposures: [{}] } }] }] }) { exposures { id } } }`,
    ],
    [
      'a nested connect run through a MITRE node',
      `mutation { createExposures(input: [{ name: "x", exploitedBy: { connect: [{ connect: { tactics: [{}] } }] } }]) { exposures { id } } }`,
    ],
    [
      'a nested create under exploitedByAtlas',
      `mutation { createExposures(input: [{ name: "x", exploitedByAtlas: { create: [{ node: { atlas_id: "AML.T9999", name: "x" } }] } }]) { exposures { id } } }`,
    ],
    [
      'a nested disconnect run through an ATLAS mitigation',
      `mutation { updateCountermeasures(update: { mitigationsAtlas: [{ disconnect: [{ disconnect: { countermeasures: [{}] } }] }] }) { countermeasures { id } } }`,
    ],
    ['the ATLAS root create', `mutation { createMitreAtlasTechniques(input: [{ atlas_id: "AML.T9999", name: "x" }]) { mitreAtlasTechniques { id } } }`],
    ['the root create', `mutation { createMitreAttackTechniques(input: [{ attack_id: "T9999", name: "x" }]) { mitreAttackTechniques { id } } }`],
    ['the root update', `mutation { updateMitreAttackTechniques(update: { name: { set: "x" } }) { mitreAttackTechniques { id } } }`],
    ['the root delete', `mutation { deleteMitreAttackTechniques { nodesDeleted } }`],
  ])('rejects %s', (_, source) => {
    rejected(schema, source);
  });
});

describe('MITRE types are read-only — the client write shapes still work (no-auth schema, Memgraph)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  const run = async (source: string, variableValues?: Record<string, unknown>) => {
    const result = await graphql({ schema, source, variableValues, contextValue: MEMGRAPH_CONTEXT });
    expect(result.errors).toBeUndefined();
    return result.data as Record<string, any>;
  };

  const count = async (cypher: string) => {
    const session = mg.driver.session();
    try {
      return (await session.run(cypher)).records[0].get(0).toNumber();
    } finally {
      await session.close();
    }
  };

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await buildProductionSchema('noauth', mg.driver);
  });

  afterAll(async () => {
    await mg?.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    const session = mg.driver.session();
    try {
      await session.run(`
        CREATE (:MitreAttackTechnique {id: 'tech-1', attack_id: 'T1001', name: 'One'}),
               (:MitreAttackTechnique {id: 'tech-2', attack_id: 'T1002', name: 'Two'}),
               (:MitreAttackTechnique {id: 'tech-3', attack_id: 'T1003', name: 'Three'}),
               (:MitreAttackMitigation {id: 'mit-1', attack_id: 'M1001', name: 'Mitigation'}),
               (:MitreAttackMitigation {id: 'mit-2', attack_id: 'M1002', name: 'Mitigation Two'}),
               (:MitreAtlasTechnique {id: 'atlas-1', atlas_id: 'AML.T0051', name: 'Prompt Injection'}),
               (:MitreAtlasTechnique {id: 'atlas-2', atlas_id: 'AML.T0054', name: 'Jailbreak'}),
               (:MitreAtlasMitigation {id: 'atlasm-1', atlas_id: 'AML.M0015', name: 'Input Detection'}),
               (:MitreAtlasMitigation {id: 'atlasm-2', atlas_id: 'AML.M0004', name: 'Restrict Queries'}),
               (:MitreDefendTechnique {id: 'def-1', d3fendId: 'D3-ONE', name: 'Defend'}),
               (:Component {id: 'comp-1', name: 'Component'}),
               (:Control {id: 'ctl-1', name: 'Control'})
      `);
    } finally {
      await session.close();
    }
  });

  const edges = async (id: string) => {
    const session = mg.driver.session();
    try {
      const r = await session.run(
        `MATCH ({id: $id})-[r]->(t) WHERE any(l IN labels(t) WHERE l STARTS WITH 'Mitre')
         RETURN type(r) AS type, t.id AS target, r.justification AS justification ORDER BY type, target`,
        { id },
      );
      return r.records.map((rec) => [rec.get('type'), rec.get('target'), rec.get('justification')]);
    } finally {
      await session.close();
    }
  };
  const mitreNodes = () => count(`MATCH (n) WHERE any(l IN labels(n) WHERE l STARTS WITH 'Mitre') RETURN count(n)`);

  it('exposure: dt-core\'s create, then its link delta, ATT&CK and ATLAS; kept links keep their edge', async () => {
    const created = await run(`
      mutation {
        createExposures(input: [{
          name: "e", description: "d",
          element: { connect: [{ where: { node: { id: { eq: "comp-1" } } } }] },
          exploitedBy: { connect: [
            { where: { node: { id: { eq: "tech-1" } } }, edge: { justification: "one" } },
            { where: { node: { id: { eq: "tech-2" } } }, edge: { justification: "two" } }
          ] },
          exploitedByAtlas: { connect: [{ where: { node: { id: { eq: "atlas-1" } } }, edge: { justification: "pi" } }] }
        }]) { exposures { id } }
      }`);
    const id = created.createExposures.exposures[0].id;

    // Keep tech-2, drop tech-1, add tech-3; swap the ATLAS technique.
    await run(DELTA_DOCUMENTS.exposure, {
      id,
      input: {
        name: { set: 'e2' },
        exploitedBy: { connect: [w('tech-3')], disconnect: [w('tech-1')] },
        exploitedByAtlas: { connect: [w('atlas-2')], disconnect: [w('atlas-1')] },
      },
    });
    expect(await edges(id)).toEqual([
      ['EXPLOITED_BY', 'atlas-2', null],
      ['EXPLOITED_BY', 'tech-2', 'two'],
      ['EXPLOITED_BY', 'tech-3', null],
    ]);

    // A disconnect-only delta removes exactly the named link.
    await run(DELTA_DOCUMENTS.exposure, { id, input: { exploitedBy: { disconnect: [w('tech-3')] } } });
    expect(await edges(id)).toEqual([
      ['EXPLOITED_BY', 'atlas-2', null],
      ['EXPLOITED_BY', 'tech-2', 'two'],
    ]);
    expect(await mitreNodes()).toBe(10);
  });

  it('countermeasure: dt-core\'s create, then its link delta on mitigations, D3FEND and ATLAS', async () => {
    const created = await run(`
      mutation {
        createCountermeasures(input: [{
          name: "c", description: "d", type: "t", category: "c", score: 1, references: "", addressedExposures: [],
          control: { connect: { where: { node: { id: { eq: "ctl-1" } } } } },
          defendedTechniques: { connect: [{ where: { node: { id: { eq: "def-1" } } } }] },
          mitigations: { connect: [{ where: { node: { id: { eq: "mit-1" } } }, edge: { justification: "policy" } }] },
          mitigationsAtlas: { connect: [{ where: { node: { id: { eq: "atlasm-1" } } } }] },
          mitigates: { connect: [{ where: { node: { id: { eq: "tech-1" } } } }] }
        }]) { countermeasures { id } }
      }`);
    const id = created.createCountermeasures.countermeasures[0].id;

    // updateCountermeasure: keep mit-1 and add mit-2; drop def-1 (disconnect only); swap the ATLAS mitigation.
    const updated = await run(DELTA_DOCUMENTS.countermeasure.replace('{ countermeasures { id } }', '{ countermeasures { name } }'), {
      id,
      input: {
        name: { set: 'c2' },
        mitigations: { connect: [w('mit-2')] },
        defendedTechniques: { disconnect: [w('def-1')] },
        mitigationsAtlas: { connect: [w('atlasm-2')], disconnect: [w('atlasm-1')] },
      },
    });
    expect(updated.updateCountermeasures.countermeasures[0].name).toBe('c2');
    expect(await edges(id)).toEqual([
      ['COUNTERMEASURE_MITIGATES', 'tech-1', null],
      ['RESPONDS_WITH', 'atlasm-2', null],
      ['RESPONDS_WITH', 'mit-1', 'policy'],
      ['RESPONDS_WITH', 'mit-2', null],
    ]);
    expect(await mitreNodes()).toBe(10);
  });

  // Published clients that predate the delta replace the list: disconnect every link, connect the kept ones.
  it('the replace shape of earlier clients still works and touches only its own field', async () => {
    const created = await run(`
      mutation {
        createExposures(input: [{
          name: "e", description: "d",
          element: { connect: [{ where: { node: { id: { eq: "comp-1" } } } }] },
          exploitedBy: { connect: [{ where: { node: { id: { eq: "tech-1" } } } }] },
          exploitedByAtlas: { connect: [{ where: { node: { id: { eq: "atlas-1" } } } }] }
        }]) { exposures { id } }
      }`);
    const id = created.createExposures.exposures[0].id;
    await run(`
      mutation ($id: ID!) {
        updateExposures(where: { id: { eq: $id } }, update: {
          exploitedBy: [{ disconnect: [{}], connect: [{ where: { node: { id: { eq: "tech-2" } } } }] }]
        }) { exposures { id } }
      }`, { id });
    expect(await edges(id)).toEqual([
      ['EXPLOITED_BY', 'atlas-1', null],
      ['EXPLOITED_BY', 'tech-2', null],
    ]);
    expect(await mitreNodes()).toBe(10);
  });
});
