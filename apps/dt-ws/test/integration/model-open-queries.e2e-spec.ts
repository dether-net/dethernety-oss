// The queries the UI sends when a model is opened, run through the production schema on the engine the suites run
// against: the model's analyses (dt-core findAnalyses with the model's id) and the model itself (dt-core's
// DumpModelData). Both documents are read from dt-core's source rather than copied, so they cannot drift: dt-core is
// ESM-only, and this Jest config cannot import it.
//
// findAnalyses filters the analyses' Element relationship with `some`. `single` there renders as a XOR across
// Element's 28 member types, which Neo4j's planner cannot plan, and query-guards.ts refuses it. Each query must answer
// within the test's timeout, so a planner blow-up fails the suite instead of hanging it.

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

const FIND_ANALYSES = dtCoreOperation('dt-analysis/dt-analysis-gql.ts', 'FIND_ANALYSES');
const DUMP_MODEL_DATA = dtCoreOperation('dt-model/dt-model-gql.ts', 'DUMP_MODEL_DATA');

/** The condition dt-core's findAnalyses sends for an element (pinned by its find-analyses.test.ts). */
const forElement = (elementId: string) => ({ AND: { element: { some: { id: { eq: elementId } } } } });

const QUERY_TIMEOUT_MS = 15_000;

async function run(driver: any, cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  const session = driver.session({ database: 'memgraph' });
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

describe('the queries a model open sends', () => {
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
    await run(
      mg.driver,
      `CREATE (m:Model {id: 'model-open-1', name: 'opened'})
       CREATE (m)-[:ANALYZED_BY]->(:Analysis {id: 'analysis-1', name: 'on the model'})
       CREATE (:Model {id: 'model-open-2', name: 'other'})-[:ANALYZED_BY]->(:Analysis {id: 'analysis-2', name: 'elsewhere'})`,
    );
  });

  it("finds the model's analyses, and only those", async () => {
    const result = await graphql({
      schema,
      source: FIND_ANALYSES,
      variableValues: { condition: forElement('model-open-1') },
      contextValue: MEMGRAPH_CONTEXT,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).analyses.map((a: { id: string }) => a.id)).toEqual(['analysis-1']);
  }, QUERY_TIMEOUT_MS);

  it('loads the model', async () => {
    const result = await graphql({
      schema,
      source: DUMP_MODEL_DATA,
      variableValues: { modelId: 'model-open-1' },
      contextValue: MEMGRAPH_CONTEXT,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).models.map((m: { id: string }) => m.id)).toEqual(['model-open-1']);
  }, QUERY_TIMEOUT_MS);
});
