import { graphql, GraphQLSchema } from 'graphql';
// The selections are translated by the platform's schema, built in-process; the driver only records the Cypher.
import { buildProductionSchema, MEMGRAPH_CONTEXT } from '../../../test/integration/production-schema';

/**
 * A selection of a relationship field typed by the Element interface compiles to a CALL subquery holding a UNION with a
 * branch per member type. Each branch must start from the node it hangs off (`WITH this`), not from `WITH *`: Memgraph
 * does not carry the outer variable into a UNION branch through `WITH *`, so such a branch matches every target of the
 * edge type in the database. @neo4j/graphql 7.2.0 emits `WITH *` there; the platform installs it with
 * patches/@neo4j__graphql@7.2.0.patch, which emits the parent node. This spec fails whenever the installed library is
 * unpatched. What the selections return on each engine is pinned by
 * test/integration/interface-relationships.e2e-spec.ts.
 */

let schema: GraphQLSchema;
let statements: string[] = [];

/** The row the library's version check reads before it runs a request. */
const VERSION_ROW = {
  keys: ['version', 'edition'],
  get: (key: string) => (key === 'version' ? '3.13.2' : 'community'),
  toObject: () => ({ version: '3.13.2', edition: 'community' }),
  [Symbol.iterator]: () => ['3.13.2', 'community'][Symbol.iterator](),
};

/** A driver that records each request's statement and returns no rows. */
const driver = {
  session: () => {
    const tx = {
      run: async (statement: string) => {
        if (statement.includes('dbms.components')) return { records: [VERSION_ROW] };
        statements.push(statement);
        return { records: [], summary: { counters: { updates: () => ({}) } } };
      },
    };
    return {
      executeRead: async (fn: (t: typeof tx) => unknown) => fn(tx),
      executeWrite: async (fn: (t: typeof tx) => unknown) => fn(tx),
      beginTransaction: () => tx,
      close: async () => undefined,
    };
  },
};

beforeAll(async () => {
  schema = await buildProductionSchema('noauth', driver);
}, 60_000);

/** The Cypher one request sends. */
async function cypherOf(source: string): Promise<string> {
  statements = [];
  const result = await graphql({ schema, source, contextValue: MEMGRAPH_CONTEXT });
  expect(result.errors).toBeUndefined();
  expect(statements).toHaveLength(1);
  return statements[0];
}

/** Each UNION branch's opening: the variable its `WITH` carries in and the node its `MATCH` starts from. */
function branchHeads(statement: string): Array<{ imported: string; matchedFrom: string }> {
  const heads = [...statement.matchAll(/(?:CALL \{|UNION)\s*\n\s*WITH ([^\n]+)\n\s*MATCH \((\w+)\)/g)];
  return heads.map((m) => ({ imported: m[1].trim(), matchedFrom: m[2] }));
}

describe('selections of the Element-typed relationship fields', () => {
  it.each([
    ['Exposure.element', '{ exposures { element { id } } }'],
    ['Analysis.element', '{ analyses { element { id } } }'],
    ['Control.elements', '{ controls { elements { id } } }'],
    ['Data.elements', '{ data { elements { id } } }'],
    ['Model.representedBy', '{ models { representedBy { id } } }'],
    ['Exposure.element nested under Component.exposures', '{ components { exposures { element { id } } } }'],
  ])('%s: every UNION branch starts from the node it hangs off', async (_field, source) => {
    const statement = await cypherOf(source);
    const heads = branchHeads(statement);

    expect(statement).toContain('UNION');
    expect(heads.length).toBeGreaterThan(1);
    for (const head of heads) expect(head.imported).toBe(head.matchedFrom);
  });
});
