import { Neo4jGraphQL } from '@neo4j/graphql';
import { ApolloServer } from '@apollo/server';
import { buildSchema, GraphQLError, GraphQLSchema, parse } from 'graphql';
import {
  assertRelationshipFiltersWithinLimits,
  buildApolloQueryGuardPlugin,
  buildGraphqlWsOnSubscribe,
  RELATIONSHIP_FILTER_LIMITS,
} from '../query-guards';
// The guard reads the filter types @neo4j/graphql generates (`<Target>Where`, `…ConnectionWhere.node`, `_SINGLE`), so
// it is pinned against the real production schema, built in-process with no database.
import { buildProductionSchema } from '../../../../test/integration/production-schema';

/**
 * A request's relationship filters, refused when Neo4j cannot plan them or should not have to: `single` on a
 * relationship to an interface or union (a XOR across every member type, which exhausts Neo4j's heap while it is
 * planned), and filters whose weighted cost, input objects or nesting exceed the limits. Everything else goes through.
 */

let schema: GraphQLSchema;

beforeAll(async () => {
  schema = await buildProductionSchema('noauth');
}, 60_000);

function check(source: string, variables?: Record<string, unknown>, onSchema: GraphQLSchema = schema): void {
  assertRelationshipFiltersWithinLimits({ schema: onSchema, document: parse(source), variables });
}

const SINGLE_REFUSED = /uses "single" on a relationship to an interface or union type/;
const BUDGET_REFUSED = /filters cost more than the limit/;

/** An OR of `n` copies of `filter`, as a variable value. */
const orOf = (n: number, filter: Record<string, unknown>) => ({ OR: Array.from({ length: n }, () => filter) });
const ELEMENT_SOME = { element: { some: { id: { eq: 'x' } } } };
const CLASS_SOME = { analysisClass: { some: { id: { eq: 'c' } } } };
const BY_VARIABLE = 'query ($c: AnalysisWhere) { analyses(where: $c) { id } }';

describe('single on a relationship to an interface or union', () => {
  it.each([
    ['a relationship filter', '{ analyses(where: { element: { single: { id: { eq: "x" } } } }) { id } }'],
    ['the deprecated _SINGLE form', '{ analyses(where: { element_SINGLE: { id: { eq: "x" } } }) { id } }'],
    ['a connection filter', '{ analyses(where: { elementConnection: { single: { node: { id: { eq: "x" } } } } }) { id } }'],
    ['the deprecated connection form', '{ analyses(where: { elementConnection_SINGLE: { node: { id: { eq: "x" } } } }) { id } }'],
    ['a filter inside AND / OR', '{ analyses(where: { OR: [{ name: { eq: "a" } }, { AND: [{ element: { single: { id: { eq: "x" } } } }] }] }) { id } }'],
    ['another interface relationship (Exposure.element)', '{ exposures(where: { element: { single: { id: { eq: "x" } } } }) { id } }'],
    ['another interface relationship (Model.representedBy)', '{ models(where: { representedBy: { single: { id: { eq: "x" } } } }) { id } }'],
    ['a nested selection\'s filter', '{ models { analyses(where: { element: { single: { id: { eq: "x" } } } }) { id } } }'],
    ['a fragment', '{ models { ...F } } fragment F on Model { analyses(where: { element: { single: { id: { eq: "x" } } } }) { id } }'],
    ['a filter inside another relationship filter', '{ models(where: { analyses: { some: { element: { single: { id: { eq: "x" } } } } } }) { id } }'],
  ])('is refused in %s', (_label, source) => {
    expect(() => check(source)).toThrow(SINGLE_REFUSED);
  });

  it('is refused in a variable, and the error names where it is', () => {
    expect(() => check(BY_VARIABLE, { c: { AND: { element: { single: { id: { eq: 'x' } } } } } })).toThrow(
      /"where\.AND\.element\.single"/,
    );
  });

  // A variable the request leaves out takes its default at execution.
  it.each([
    ['the argument\'s variable', 'query ($c: AnalysisWhere = { element: { single: { id: { eq: "x" } } } }) { analyses(where: $c) { id } }'],
    ['a nested variable', 'query ($e: ElementRelationshipFilters = { single: { id: { eq: "x" } } }) { analyses(where: { element: $e }) { id } }'],
    ['a variable in a list', 'query ($a: AnalysisWhere = { element: { single: { id: { eq: "x" } } } }) { analyses(where: { OR: [$a] }) { id } }'],
    ['a deprecated form\'s variable', 'query ($w: ElementWhere = { id: { eq: "x" } }) { analyses(where: { element_SINGLE: $w }) { id } }'],
  ])('is refused in %s\'s default value', (_label, source) => {
    expect(() => check(source)).toThrow(SINGLE_REFUSED);
    expect(() => check(source, null as never)).toThrow(SINGLE_REFUSED);
  });

  it('is not taken from a default the request overrides', () => {
    const source = 'query ($c: AnalysisWhere = { element: { single: { id: { eq: "x" } } } }) { analyses(where: $c) { id } }';
    expect(() => check(source, { c: { name: { eq: 'a' } } })).not.toThrow();
  });

  it.each([
    ['some', '{ analyses(where: { element: { some: { id: { eq: "x" } } } }) { id } }'],
    ['all', '{ analyses(where: { element: { all: { id: { eq: "x" } } } }) { id } }'],
    ['none', '{ analyses(where: { element: { none: { id: { eq: "x" } } } }) { id } }'],
    ['single: null', '{ analyses(where: { element: { single: null } }) { id } }'],
    ['single on a concrete type (Analysis.analysisClass)', '{ analyses(where: { analysisClass: { single: { id: { eq: "c" } } } }) { id } }'],
    ['single on a concrete type (Folder.parentFolder)', '{ folders(where: { parentFolder: { single: { id: { eq: "f" } } } }) { id } }'],
    ['no filter at all', '{ models { id name } }'],
  ])('lets %s through', (_label, source) => {
    expect(() => check(source)).not.toThrow();
  });

  it('lets through the where dt-core sends when a model is opened', () => {
    expect(() => check(BY_VARIABLE, { c: { AND: { element: { some: { id: { eq: 'model-1' } } } } } })).not.toThrow();
  });

  it('refuses a variable that holds no object where an input object is expected, and leaves a missing one alone', () => {
    expect(() => check(BY_VARIABLE, { c: 'not an object' })).toThrow(/"where" is not an object, where AnalysisWhere is expected/);
    expect(() => check(BY_VARIABLE, { c: [{ name: { eq: 'a' } }] })).toThrow(/is not an object/);
    expect(() => check(BY_VARIABLE, {})).not.toThrow();
  });

  it('refuses a field the input type does not define, naming it', () => {
    expect(() => check(BY_VARIABLE, { c: { nope: 1 } })).toThrow(/"where\.nope" is not a field of AnalysisWhere/);
  });

  it('is refused on a union relationship, plain and in its connection form', async () => {
    const warn = console.warn;
    console.warn = () => undefined;
    const unionSchema = await new Neo4jGraphQL({
      typeDefs: `
        type A @node { id: ID! }
        type B @node { id: ID! }
        union AB = A | B
        type Holder @node { id: ID! ab: [AB!]! @relationship(type: "R", direction: OUT) }
      `,
    })
      .getSchema()
      .finally(() => (console.warn = warn));
    expect(() => check('{ holders(where: { ab: { single: { A: { id: { eq: "x" } } } } }) { id } }', {}, unionSchema)).toThrow(
      SINGLE_REFUSED,
    );
    expect(() =>
      check('{ holders(where: { abConnection: { single: { A: { node: { id: { eq: "x" } } } } } }) { id } }', {}, unionSchema),
    ).toThrow(SINGLE_REFUSED);
    expect(() => check('{ holders(where: { ab: { some: { A: { id: { eq: "x" } } } } }) { id } }', {}, unionSchema)).not.toThrow();
  });
});

describe('the relationship-filter budget', () => {
  const { maxBudget } = RELATIONSHIP_FILTER_LIMITS;

  it('costs a filter on Element its 28 member types, and one on a concrete type 1', () => {
    const onElement = Math.floor(maxBudget / 28);
    const rest = maxBudget - onElement * 28;
    const mixed = (concrete: number) => ({
      OR: [...orOf(onElement, ELEMENT_SOME).OR, ...orOf(concrete, CLASS_SOME).OR],
    });
    expect(() => check(BY_VARIABLE, { c: orOf(onElement, ELEMENT_SOME) })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: orOf(onElement + 1, ELEMENT_SOME) })).toThrow(BUDGET_REFUSED);
    expect(() => check(BY_VARIABLE, { c: mixed(rest) })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: mixed(rest + 1) })).toThrow(BUDGET_REFUSED);
  });

  it('costs `all` twice', () => {
    const elementAll = { element: { all: { id: { eq: 'x' } } } };
    expect(() => check(BY_VARIABLE, { c: orOf(Math.floor(maxBudget / 56), elementAll) })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: orOf(Math.floor(maxBudget / 56) + 1, elementAll) })).toThrow(BUDGET_REFUSED);
  });

  it('refuses the 1000-filter OR on Element', () => {
    expect(() => check(BY_VARIABLE, { c: orOf(1000, ELEMENT_SOME) })).toThrow(BUDGET_REFUSED);
  });

  it('prices an aggregate filter at the member count of what it aggregates', () => {
    const aggregate = { elementAggregate: { count: { eq: 1 } } };
    const n = Math.floor(maxBudget / 28);
    expect(() => check(BY_VARIABLE, { c: orOf(n, aggregate) })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: orOf(n + 1, aggregate) })).toThrow(BUDGET_REFUSED);
    const connectionAggregate = { elementConnection: { aggregate: { count: { nodes: { eq: 1 } } } } };
    expect(() => check(BY_VARIABLE, { c: orOf(n, connectionAggregate) })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: orOf(n + 1, connectionAggregate) })).toThrow(BUDGET_REFUSED);
  });

  it('prices a filter on a @cypher field, more for one that walks a variable-length path', () => {
    const counted = 'query ($c: ComponentClassWhere) { componentClasses(where: $c) { id } }';
    for (const count of [{ incomingInstanceCount: { gt: 0 } }, { incomingInstanceCount_GT: 0 }]) {
      expect(() => check(counted, { c: orOf(Math.floor(maxBudget / 2), count) })).not.toThrow();
      expect(() => check(counted, { c: orOf(Math.floor(maxBudget / 2) + 1, count) })).toThrow(BUDGET_REFUSED);
    }
    const walked = 'query ($c: SecurityBoundaryWhere) { securityBoundaries(where: $c) { id } }';
    const descendants = { allDescendantBoundaries: { some: { name: { eq: 'x' } } } };
    const walkedCost = 10 + 1; // the path walk, and the `some` on a concrete type
    expect(() => check(walked, { c: orOf(Math.floor(maxBudget / walkedCost), descendants) })).not.toThrow();
    expect(() => check(walked, { c: orOf(Math.floor(maxBudget / walkedCost) + 1, descendants) })).toThrow(BUDGET_REFUSED);
  });

  it('does not count scalar `in` lists', () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `id-${i}`);
    expect(() => check(BY_VARIABLE, { c: { element: { some: { id: { in: ids } } } } })).not.toThrow();
  });

  it('counts a fragment once for every place it is spread', () => {
    const n = Math.floor(maxBudget / 28);
    const filter = Array.from({ length: n }, () => '{ element: { some: { id: { eq: "x" } } } }').join(', ');
    const fragment = `fragment F on Model { analyses(where: { OR: [${filter}] }) { id } }`;
    expect(() => check(`{ models { ...F } } ${fragment}`)).not.toThrow();
    expect(() => check(`{ models { ...F } folders { models { ...F } } } ${fragment}`)).toThrow(BUDGET_REFUSED);
  });
});

describe('the input-size limits', () => {
  it('refuses where arguments holding too many input objects', () => {
    const { maxFilterObjects } = RELATIONSHIP_FILTER_LIMITS;
    expect(() => check(BY_VARIABLE, { c: orOf(maxFilterObjects, { name: { eq: 'a' } }) })).toThrow(/input objects/);
  });

  const ASSIGN = `mutation ($controlId: ID!, $input: ControlUpdateInput!) {
    updateControls(where: { id: { eq: $controlId } }, update: $input) { controls { id } }
  }`;
  const ids = Array.from({ length: 2000 }, (_, i) => `element-${i}`);

  it('lets a control be assigned to many elements in one `in` operand per relationship, as dt-core sends it', () => {
    const connect = [{ where: { node: { id: { in: ids } } } }];
    const input = { supportedComponents: { connect }, supportedBoundaries: { connect }, supportedDataFlows: { connect } };
    expect(() => check(ASSIGN, { controlId: 'control-1', input })).not.toThrow();
  });

  it('refuses one connect operand per element, whichever limit it reaches first', () => {
    const connect = ids.map((id) => ({ where: { node: { id: { eq: id } } } }));
    expect(() => check(ASSIGN, { controlId: 'c', input: { supportedComponents: { connect } } })).toThrow(/input objects|relationship operands/);
  });

  it('refuses connect operands past the operand limit', () => {
    // A bare operand is one input object, so on a concrete target only the operand limit holds it.
    const { maxRelationshipOperands } = RELATIONSHIP_FILTER_LIMITS;
    const connect = (n: number) => Array.from({ length: n }, () => ({}));
    expect(() => check(ASSIGN, { controlId: 'c', input: { supportedComponents: { connect: connect(maxRelationshipOperands) } } })).not.toThrow();
    expect(() => check(ASSIGN, { controlId: 'c', input: { supportedComponents: { connect: connect(maxRelationshipOperands + 1) } } })).toThrow(
      /relationship operands/,
    );
  });

  it('counts an operand on Element once per member type', () => {
    const n = Math.floor(RELATIONSHIP_FILTER_LIMITS.maxRelationshipOperands / 28);
    const connect = (count: number) => Array.from({ length: count }, () => ({}));
    expect(() => check(ASSIGN, { controlId: 'c', input: { elements: { connect: connect(n) } } })).not.toThrow();
    expect(() => check(ASSIGN, { controlId: 'c', input: { elements: { connect: connect(n + 1) } } })).toThrow(
      /relationship operands/,
    );
  });

  it('counts the objects under a filter on Element once per member type', () => {
    // 28 per object: an OR of 40 under one `some` on Element renders 40 conditions in each of 28 subqueries.
    const or = Array.from({ length: 40 }, () => ({ name: { eq: 'x' } }));
    expect(() => check(BY_VARIABLE, { c: { element: { some: { OR: or } } } })).toThrow(/where arguments hold more than/);
    expect(() => check(BY_VARIABLE, { c: { element: { some: { OR: or.slice(0, 10) } } } })).not.toThrow();
  });

  it('counts the objects under `all` on Element twice per member type', () => {
    // Under `some`, each `{ name: { eq } }` is 2 objects × 28; under `all`, × 56.
    const or = Array.from({ length: 12 }, () => ({ name: { eq: 'x' } }));
    expect(() => check(BY_VARIABLE, { c: { element: { some: { OR: or } } } })).not.toThrow();
    expect(() => check(BY_VARIABLE, { c: { element: { all: { OR: or } } } })).toThrow(/where arguments hold more than/);
  });

  it('refuses arguments holding too many input objects in all', () => {
    const CREATE = 'mutation ($input: [ModelCreateInput!]!) { createModels(input: $input) { models { id } } }';
    // Each ModelCreateInput is one object.
    const input = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `m-${i}` }));
    const { maxInputObjects } = RELATIONSHIP_FILTER_LIMITS;
    expect(() => check(CREATE, { input: input(maxInputObjects) })).not.toThrow();
    expect(() => check(CREATE, { input: input(maxInputObjects + 1) })).toThrow(/The request.s arguments hold more than/);
  });

  describe('the scalar size', () => {
    const SCALAR_REFUSED = /scalar values come to more than/;
    const { maxScalarSize } = RELATIONSHIP_FILTER_LIMITS;
    const references = (n: number) =>
      `query ($ids: [ID!]) { components(where: { OR: [${Array.from({ length: n }, () => '{ id: { in: $ids } }').join(', ')}] }) { id } }`;
    // 60,000 ids of 8 characters: 480,000 characters each time the list is referenced.
    const list = Array.from({ length: 60_000 }, (_, i) => `id-${String(i).padStart(5, '0')}`);

    it('lets a long `in` list through when it is used once', () => {
      expect(() => check(references(1), { ids: list })).not.toThrow();
    });

    it('counts a variable once for every place it is referenced', () => {
      const fits = Math.floor(maxScalarSize / (list.length * 8));
      expect(() => check(references(fits), { ids: list })).not.toThrow();
      expect(() => check(references(fits + 1), { ids: list })).toThrow(SCALAR_REFUSED);
      // 499 references are about as many as fit in a 1 MB body beside the list.
      expect(() => check(references(499), { ids: list })).toThrow(SCALAR_REFUSED);
    });

    it('counts every entry of a list, an empty string too', () => {
      const empty = Array.from({ length: Math.floor(maxScalarSize / 4) + 1 }, () => '');
      expect(() => check(references(4), { ids: empty })).toThrow(SCALAR_REFUSED);
      expect(() => check(references(3), { ids: empty })).not.toThrow();
    });

    it('refuses a value nested too deep, without overflowing the stack', () => {
      let deep: unknown = 'x';
      for (let i = 0; i < 200_000; i++) deep = [deep];
      expect(() => check(references(1), { ids: deep })).toThrow(/nested deeper than/);
    });

    it('counts a string by its length', () => {
      const source = (n: number) =>
        `query ($s: String) { components(where: { OR: [${Array.from({ length: n }, () => '{ name: { eq: $s } }').join(', ')}] }) { id } }`;
      const text = 'x'.repeat(1_000_000);
      expect(() => check(source(Math.floor(maxScalarSize / text.length)), { s: text })).not.toThrow();
      expect(() => check(source(Math.floor(maxScalarSize / text.length) + 1), { s: text })).toThrow(SCALAR_REFUSED);
    });

    it('counts a value under a filter on Element once per member type', () => {
      const text = 'x'.repeat(Math.floor(maxScalarSize / 28) + 1);
      expect(() => check(BY_VARIABLE, { c: { element: { some: { name: { eq: text } } } } })).toThrow(SCALAR_REFUSED);
      expect(() => check(BY_VARIABLE, { c: { name: { eq: text } } })).not.toThrow();
    });
  });

  it('refuses an input nested too deep, without overflowing the stack', () => {
    let deep: Record<string, unknown> = { name: { eq: 'a' } };
    for (let i = 0; i < 5000; i++) deep = { AND: [deep] };
    expect(() => check(BY_VARIABLE, { c: deep })).toThrow(/nested deeper than/);
  });

  // The walk visits every entry of a list of input objects at every place the list is used, so an entry no limit
  // counted would let one request spend minutes on the walk alone.
  describe('the entries of a list of input objects', () => {
    const ALIASES = 4_999;
    const aliased = (argument: string) =>
      `query ($v: [AnalysisSort!]) { ${Array.from({ length: ALIASES }, (_, i) => `a${i}: analyses(${argument}) { id }`).join(' ')} }`;

    it('refuses an entry that is not an object at once, however long the list and however often it is used', () => {
      const started = Date.now();
      expect(() => check(aliased('sort: $v'), { v: Array.from({ length: 450_000 }, () => 1) })).toThrow(
        /"sort\[0\]" is not an object, where AnalysisSort is expected/,
      );
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('counts a null entry as an input object', () => {
      const started = Date.now();
      expect(() => check(aliased('sort: $v'), { v: Array.from({ length: 450_000 }, () => null) })).toThrow(/input objects/);
      expect(Date.now() - started).toBeLessThan(1000);
      const { maxInputObjects } = RELATIONSHIP_FILTER_LIMITS;
      const nulls = (n: number) => ({ OR: Array.from({ length: n }, () => null) });
      expect(() => check(BY_VARIABLE, { c: nulls(maxInputObjects - 1) })).not.toThrow();
      expect(() => check(BY_VARIABLE, { c: nulls(maxInputObjects) })).toThrow(/input objects/);
    });
  });

  // A literal that does not coerce is refused, as execution refuses it, before any later check reads it again at each
  // spread; an argument whose variable the request leaves out is left out.
  it('refuses a literal that does not coerce, and reads an argument once however often its fragment is spread', () => {
    const ids = Array.from({ length: 50_000 }, () => '"a"').join(', ');
    const source =
      `query ($x: ID!) { ${'...F '.repeat(3_000)}} ` +
      `fragment F on Query { analyses(where: { id: { in: [${ids}, $x] } }) { id } }`;
    const started = Date.now();
    expect(() => check(source, {})).toThrow(/The value of "where" does not match its type, AnalysisWhere/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(() => check('query ($w: AnalysisWhere) { analyses(where: $w) { id } }', {})).not.toThrow();
  });

  // Only the operation the request runs is walked, with only the variables it declares.
  describe('the operation the request runs', () => {
    const TWO = 'query A($w: String) { __typename } query B($w: AnalysisWhere) { analyses(where: $w) { id } }';
    const walk = (operationName: string, variables: Record<string, unknown>) =>
      assertRelationshipFiltersWithinLimits({ schema, document: parse(TWO), operationName, variables });

    it('refuses a request that selects no single operation, so nothing runs unwalked', () => {
      expect(() => assertRelationshipFiltersWithinLimits({ schema, document: parse(TWO), variables: {} })).toThrow(
        /several operations: name the one to run/,
      );
      expect(() => walk('C', {})).toThrow(/no operation named "C"/);
      expect(() =>
        assertRelationshipFiltersWithinLimits({ schema, document: parse('{ __typename }'), operationName: '', variables: {} }),
      ).toThrow(/no operation named ""/);
    });

    it('walks the selected operation and no other', () => {
      expect(() => walk('A', { w: 'x' })).not.toThrow();
      expect(() => walk('B', { w: 'x' })).toThrow(/is not an object/);
      expect(() => walk('B', { w: { element: { single: { id: { eq: 'x' } } } } })).toThrow(SINGLE_REFUSED);
    });

    it('does not copy variables the operation does not declare, for any number of operations', () => {
      const operations = Array.from({ length: 10_000 }, (_, i) => `query q${i} { __typename }`).join(' ');
      const undeclared = Object.fromEntries(Array.from({ length: 80_000 }, (_, i) => [`v${i}`, i]));
      const started = Date.now();
      expect(() =>
        assertRelationshipFiltersWithinLimits({ schema, document: parse(operations), operationName: 'q9999', variables: undeclared }),
      ).not.toThrow();
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it('refuses a document whose fragments expand past the selection limit', () => {
    const fragments = Array.from({ length: 14 }, (_, i) => `fragment F${i} on Model { ...F${i + 1} ...F${i + 1} }`).join(' ');
    expect(() => check(`{ models { ...F0 } } ${fragments} fragment F14 on Model { id }`)).toThrow(/selections/);
  });

  it('is refused as BAD_USER_INPUT, HTTP 400', () => {
    try {
      check('{ analyses(where: { element: { single: { id: { eq: "x" } } } }) { id } }');
      throw new Error('not refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GraphQLError);
      expect((error as GraphQLError).extensions).toEqual({ code: 'BAD_USER_INPUT', http: { status: 400 } });
    }
  });
});

/** The same DoS request on each transport's guard entry point. */
describe('the guards on each transport', () => {
  const DOS = 'query ($c: AnalysisWhere) { analyses(where: $c) { id } }';
  const DOS_VARIABLES = { c: { element: { single: { id: { eq: 'x' } } } } };
  const config = { queryDepthLimit: 10, queryComplexityLimit: 1000 };

  it('HTTP (the Apollo plugin) refuses it', async () => {
    const hooks = await buildApolloQueryGuardPlugin(schema, config).requestDidStart();
    await expect(
      hooks.didResolveOperation({ request: { variables: DOS_VARIABLES }, document: parse(DOS) }),
    ).rejects.toThrow(SINGLE_REFUSED);
  });

  it('graphql-ws (onSubscribe) refuses it, and lets the model-open query through', () => {
    const onSubscribe = buildGraphqlWsOnSubscribe(schema, config);
    const refused = onSubscribe(undefined, '1', { query: DOS, variables: DOS_VARIABLES });
    expect(refused?.[0].message).toMatch(SINGLE_REFUSED);
    expect(onSubscribe(undefined, '2', { query: DOS, variables: { c: { element: { some: { id: { eq: 'x' } } } } } })).toBeUndefined();
  });

  // A document of two operations and no operationName: execution would refuse it too, but the guard refuses first, on
  // the walk's own terms, and nothing executes.
  it('HTTP (Apollo) executes nothing for a request that selects no single operation', async () => {
    const resolve = jest.fn(() => 'ran');
    const tiny = buildSchema('type Query { a: String b: String }');
    const server = new ApolloServer({ schema: tiny, rootValue: { a: resolve, b: resolve }, plugins: [buildApolloQueryGuardPlugin(tiny, config)] });
    await server.start();
    try {
      const response = await server.executeOperation({ query: 'query A { a } query B { b }' });
      const result = response.body.kind === 'single' ? response.body.singleResult : undefined;
      expect(result?.errors?.[0].message).toMatch(/several operations/);
      expect(result?.data).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it('graphql-ws (onSubscribe) refuses a request that selects no single operation', () => {
    const onSubscribe = buildGraphqlWsOnSubscribe(schema, config);
    const refused = onSubscribe(undefined, '1', { query: 'query A { __typename } query B { __typename }' });
    expect(refused?.[0].message).toMatch(/several operations/);
  });

  it('graphql-ws (onSubscribe) runs the depth rules too', () => {
    const onSubscribe = buildGraphqlWsOnSubscribe(schema, { queryDepthLimit: 2, queryComplexityLimit: 0 });
    const refused = onSubscribe(undefined, '1', { query: '{ models { analyses { analysisClass { id } } } }' });
    expect(refused?.length).toBeGreaterThan(0);
  });
});
