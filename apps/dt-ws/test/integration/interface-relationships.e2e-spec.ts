// The five relationship fields typed by the Element interface — Exposure.element, Analysis.element, Control.elements,
// Data.elements, Model.representedBy — run through the production schema on the engine the suites run against.
//
// A selection of such a field compiles to one CALL subquery holding a UNION with a branch per Element member type.
// @neo4j/graphql 7.2.0 opens each branch with `WITH *`, which on Memgraph does not carry the source node into the
// branch, so a branch matched every target of the edge type in the database instead of the source's own. The platform
// installs the library patched to open each branch with the source node by name (patches/@neo4j__graphql@7.2.0.patch;
// src/gql/__tests__/interface-selection-cypher.spec.ts fails without it). The `where … some` filters, the connects and
// the fields typed by one member (Exposure.component, Control.supportedComponents and the like) compile without that
// UNION. This suite pins what each form returns, on a seed built so that an over-match is visible: every edge type
// also has a second source (a decoy) and some elements have no edge at all, and the seed is repeated for a second
// model with the same names and for an unrelated model.
//
// Every case must be exact on both engines: the selections return the element's own targets, and so do dt-core's
// component delete and exposure create, the analyses filter, and the connection form. dt-core's documents are read
// from its source rather than copied (dt-core is ESM-only, and this Jest config cannot import it); the create input
// carries dt-core's createExposure element connect, which its create-exposure-links.test.ts pins.

import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';

/** The text of `export const <name> = gql`…`` in a dt-core source file. */
function dtCoreOperation(file: string, name: string): string {
  const source = fs.readFileSync(path.join(__dirname, '../../../../packages/dt-core/src', file), 'utf8');
  const match = new RegExp(`export const ${name} = gql\`([\\s\\S]*?)\``).exec(source);
  if (!match) throw new Error(`${name} not found in dt-core ${file}`);
  if (match[1].includes('${')) throw new Error(`${name} in dt-core ${file} interpolates; read it some other way`);
  return match[1];
}

const DELETE_COMPONENT = dtCoreOperation('dt-component/dt-component-gql.ts', 'DELETE_COMPONENT');
const FIND_ANALYSES = dtCoreOperation('dt-analysis/dt-analysis-gql.ts', 'FIND_ANALYSES');
const ADD_EXPOSURE = dtCoreOperation('dt-exposure/dt-exposure-gql.ts', 'ADD_EXPOSURE');

const QUERY_TIMEOUT_MS = 15_000;

/**
 * One model's worth of graph, every id prefixed with `p` (names are shared between models seeded from the same
 * name). Edges and their decoys:
 *   HAS_EXPOSURE      c1, c2, b1, d1 each carry one exposure; c3 and b2 carry none
 *   ANALYZED_BY       the model, c1, c2 and b1 each carry one analysis; c3 and b2 carry none
 *   SUPPORTS          ctl1 → c1, and the decoy ctl2 → c2
 *   HANDLES           c1 → d1, and the decoy f1 → d2
 *   REPRESENTS_MODEL  c2 → sub1, and the decoy b2 → sub2
 */
const SEED = `
CREATE (m:Model {id: $p + '-model', name: $n + ' model'})
CREATE (b1:SecurityBoundary {id: $p + '-b1', name: $n + ' b1'})
CREATE (b2:SecurityBoundary {id: $p + '-b2', name: $n + ' b2'})
CREATE (c1:Component {id: $p + '-c1', name: $n + ' c1'})
CREATE (c2:Component {id: $p + '-c2', name: $n + ' c2'})
CREATE (c3:Component {id: $p + '-c3', name: $n + ' c3'})
CREATE (f1:DataFlow {id: $p + '-f1', name: $n + ' f1'})
CREATE (d1:Data {id: $p + '-d1', name: $n + ' d1'})
CREATE (d2:Data {id: $p + '-d2', name: $n + ' d2'})
CREATE (sub1:Model {id: $p + '-sub1', name: $n + ' sub1'})
CREATE (sub2:Model {id: $p + '-sub2', name: $n + ' sub2'})
CREATE (ctl1:Control {id: $p + '-ctl1', name: $n + ' ctl1'})
CREATE (ctl2:Control {id: $p + '-ctl2', name: $n + ' ctl2'})
CREATE (m)-[:CONTAINS]->(b1), (b2)-[:BELONGS_TO]->(b1)
CREATE (c1)-[:BELONGS_TO]->(b1), (c2)-[:BELONGS_TO]->(b2), (c3)-[:BELONGS_TO]->(b1)
CREATE (c1)-[:FLOWS]->(f1)-[:FLOWS]->(c2)
CREATE (c1)-[:HAS_EXPOSURE]->(:Exposure {id: $p + '-ex-c1', name: 'exposure'})
CREATE (c2)-[:HAS_EXPOSURE]->(:Exposure {id: $p + '-ex-c2', name: 'exposure'})
CREATE (b1)-[:HAS_EXPOSURE]->(:Exposure {id: $p + '-ex-b1', name: 'exposure'})
CREATE (d1)-[:HAS_EXPOSURE]->(:Exposure {id: $p + '-ex-d1', name: 'exposure'})
CREATE (m)-[:ANALYZED_BY]->(:Analysis {id: $p + '-an-model', name: 'analysis'})
CREATE (c1)-[:ANALYZED_BY]->(:Analysis {id: $p + '-an-c1', name: 'analysis'})
CREATE (c2)-[:ANALYZED_BY]->(:Analysis {id: $p + '-an-c2', name: 'analysis'})
CREATE (b1)-[:ANALYZED_BY]->(:Analysis {id: $p + '-an-b1', name: 'analysis'})
CREATE (ctl1)-[:SUPPORTS]->(c1), (ctl2)-[:SUPPORTS]->(c2)
CREATE (c1)-[:HANDLES]->(d1), (f1)-[:HANDLES]->(d2)
CREATE (c2)-[:REPRESENTS_MODEL]->(sub1), (b2)-[:REPRESENTS_MODEL]->(sub2)
`;

/**
 * Every element at the selected end of each edge type in one seeded model: what a selection returns when its branches
 * lose the source node. The seed check asserts the far end of each edge type holds these, so an over-match is visible.
 */
const ALL_TARGETS = {
  exposed: (p: string) => [`${p}-b1`, `${p}-c1`, `${p}-c2`, `${p}-d1`],
  analysed: (p: string) => [`${p}-b1`, `${p}-c1`, `${p}-c2`, `${p}-model`],
  supported: (p: string) => [`${p}-c1`, `${p}-c2`],
  handling: (p: string) => [`${p}-c1`, `${p}-f1`],
  representing: (p: string) => [`${p}-b2`, `${p}-c2`],
};

const exposureIds = (p: string) => [`${p}-ex-b1`, `${p}-ex-c1`, `${p}-ex-c2`, `${p}-ex-d1`];
const analysisIds = (p: string) => [`${p}-an-b1`, `${p}-an-c1`, `${p}-an-c2`, `${p}-an-model`];

/** A model alone; two models from one seed (same names); those two plus an unrelated model. */
const SCENARIOS: Array<{ name: string; models: Array<{ p: string; n: string }> }> = [
  { name: 'one model alone', models: [{ p: 'a', n: 'shop' }] },
  { name: 'two models from one seed', models: [{ p: 'a', n: 'shop' }, { p: 'b', n: 'shop' }] },
  {
    name: 'two models from one seed and an unrelated model',
    models: [{ p: 'a', n: 'shop' }, { p: 'b', n: 'shop' }, { p: 'u', n: 'ledger' }],
  },
];

const sorted = (ids: string[]) => [...ids].sort();

async function cypher(driver: any, statement: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const session = driver.session({ database: 'memgraph' });
  try {
    return (await session.run(statement, params)).records;
  } finally {
    await session.close();
  }
}

async function ids(driver: any, label: 'Exposure' | 'Analysis' | 'Component'): Promise<string[]> {
  const records = await cypher(driver, `MATCH (n:${label}) RETURN n.id AS id`);
  return sorted(records.map((r) => r.get('id')));
}

describe('relationship fields typed by the Element interface', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  const run = async (source: string, variableValues: Record<string, unknown> = {}) => {
    const result = await graphql({ schema, source, variableValues, contextValue: MEMGRAPH_CONTEXT });
    expect(result.errors?.map((e) => e.message)).toBeUndefined();
    return result.data as any;
  };

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await buildProductionSchema('noauth', mg.driver);
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  describe.each(SCENARIOS)('$name', ({ models }) => {
    const prefixes = models.map((m) => m.p);
    const everywhere = (targets: (p: string) => string[]) => sorted(prefixes.flatMap(targets));

    beforeEach(async () => {
      await clearGraph(mg.driver);
      for (const { p, n } of models) await cypher(mg.driver, SEED, { p, n });
    });

    it('seeds what the cases read (by Cypher)', async () => {
      expect(await ids(mg.driver, 'Exposure')).toEqual(everywhere(exposureIds));
      expect(await ids(mg.driver, 'Analysis')).toEqual(everywhere(analysisIds));
      const exposed = await cypher(mg.driver, `MATCH (x)-[:HAS_EXPOSURE]->(:Exposure {id: 'a-ex-c1'}) RETURN x.id AS id`);
      expect(exposed.map((r) => r.get('id'))).toEqual(['a-c1']);

      // The far end of each edge type holds more elements than any one selection returns.
      const ends = async (pattern: string) =>
        sorted((await cypher(mg.driver, `MATCH ${pattern} RETURN DISTINCT x.id AS id`)).map((r) => r.get('id')));
      expect(await ends('(x)-[:HAS_EXPOSURE]->()')).toEqual(everywhere(ALL_TARGETS.exposed));
      expect(await ends('(x)-[:ANALYZED_BY]->()')).toEqual(everywhere(ALL_TARGETS.analysed));
      expect(await ends('()-[:SUPPORTS]->(x)')).toEqual(everywhere(ALL_TARGETS.supported));
      expect(await ends('(x)-[:HANDLES]->()')).toEqual(everywhere(ALL_TARGETS.handling));
      expect(await ends('(x)-[:REPRESENTS_MODEL]->()')).toEqual(everywhere(ALL_TARGETS.representing));
    }, QUERY_TIMEOUT_MS);

    describe('selections return the source node\'s own targets', () => {
      it('Exposure.element', async () => {
        const data = await run(`query { exposures(where: { id: { eq: "a-ex-c1" } }) { element { id } } }`);
        expect(sorted(data.exposures[0].element.map((e: any) => e.id))).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);

      it('Analysis.element', async () => {
        const data = await run(`query { analyses(where: { id: { eq: "a-an-c1" } }) { element { id } } }`);
        expect(sorted(data.analyses[0].element.map((e: any) => e.id))).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);

      it('Control.elements', async () => {
        const data = await run(`query { controls(where: { id: { eq: "a-ctl1" } }) { elements { id } } }`);
        expect(sorted(data.controls[0].elements.map((e: any) => e.id))).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);

      it('Data.elements', async () => {
        const data = await run(`query { data(where: { id: { eq: "a-d1" } }) { elements { id } } }`);
        expect(sorted(data.data[0].elements.map((e: any) => e.id))).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);

      it('Model.representedBy', async () => {
        const data = await run(`query { models(where: { id: { eq: "a-sub1" } }) { representedBy { id } } }`);
        expect(sorted(data.models[0].representedBy.map((e: any) => e.id))).toEqual(['a-c2']);
      }, QUERY_TIMEOUT_MS);

      it('Exposure.element for every exposure in one request', async () => {
        const data = await run(`query { exposures { id element { id } } }`);
        const pairs = data.exposures.map((x: any) => [x.id, x.element.map((e: any) => e.id)]);
        // Each exposure `<p>-ex-<element>` hangs off `<p>-<element>` alone.
        expect(pairs.sort()).toEqual(everywhere(exposureIds).map((id) => [id, [id.replace('-ex-', '-')]]));
      }, QUERY_TIMEOUT_MS);
    });

    it("DELETE_COMPONENT removes that component's exposures and analyses, and no other", async () => {
      await run(DELETE_COMPONENT, { componentId: 'a-c1' });

      expect(await ids(mg.driver, 'Exposure')).toEqual(everywhere(exposureIds).filter((id) => id !== 'a-ex-c1'));
      expect(await ids(mg.driver, 'Analysis')).toEqual(everywhere(analysisIds).filter((id) => id !== 'a-an-c1'));
      expect(await ids(mg.driver, 'Component')).toEqual(
        everywhere((p) => [`${p}-c1`, `${p}-c2`, `${p}-c3`]).filter((id) => id !== 'a-c1'),
      );
    }, QUERY_TIMEOUT_MS);

    it("FIND_ANALYSES for a component returns that component's analysis only", async () => {
      // The condition dt-core's findAnalyses sends for an element (pinned by its find-analyses.test.ts).
      const data = await run(FIND_ANALYSES, { condition: { AND: { element: { some: { id: { eq: 'a-c1' } } } } } });
      expect(data.analyses.map((a: { id: string }) => a.id)).toEqual(['a-an-c1']);
    }, QUERY_TIMEOUT_MS);

    it('ADD_EXPOSURE through the interface connect binds the new exposure to that element alone', async () => {
      // dt-core's createExposure element and technique connects (its other fields do not touch the connect); the
      // element connect is pinned by create-exposure-links.test.ts.
      const input = {
        name: 'created',
        element: { connect: { where: { node: { id: { eq: 'a-c3' } } } } },
        exploitedBy: { connect: [] },
      };
      const data = await run(ADD_EXPOSURE, { input: [input] });
      const created = data.createExposures.exposures[0].id;

      const bound = await cypher(mg.driver, `MATCH (x)-[:HAS_EXPOSURE]->(:Exposure {id: $id}) RETURN x.id AS id`, {
        id: created,
      });
      expect(bound.map((r) => r.get('id'))).toEqual(['a-c3']);
    }, QUERY_TIMEOUT_MS);

    describe('the connection form, whose UNION branches import the source by name', () => {
      it('Exposure.elementConnection returns the exposure\'s own element', async () => {
        const data = await run(
          `query { exposures(where: { id: { eq: "a-ex-c1" } }) { elementConnection { edges { node { id } } } } }`,
        );
        expect(data.exposures[0].elementConnection.edges.map((e: any) => e.node.id)).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);

      it("Control.elementsConnection returns the control's own element", async () => {
        const data = await run(
          `query { controls(where: { id: { eq: "a-ctl1" } }) { elementsConnection { edges { node { id } } } } }`,
        );
        expect(data.controls[0].elementsConnection.edges.map((e: any) => e.node.id)).toEqual(['a-c1']);
      }, QUERY_TIMEOUT_MS);
    });
  });
});
