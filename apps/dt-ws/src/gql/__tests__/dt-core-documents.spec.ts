import * as fs from 'fs';
import * as path from 'path';
import {
  FieldNode,
  getNamedType,
  getVariableValues,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
  TypeInfo,
  validate,
  visit,
  visitWithTypeInfo,
} from 'graphql';
// The documents are validated against the schema the platform serves, built in-process with no database.
import { buildProductionSchema } from '../../../test/integration/production-schema';

/**
 * Every GraphQL document dt-core sends, validated against the platform's schema: a field or argument the schema does
 * not have fails here instead of failing the request. The documents are read from dt-core's source (`*-gql.ts`): dt-core
 * is ESM-only, and this Jest config cannot import it.
 *
 * Validation sees the document, not the variables dt-core builds at run time, so the `where` shapes of its filter
 * builders are checked too, with the same variable coercion the request goes through. Those shapes are copied by hand
 * from dt-core and pinned there by find-analyses.test.ts, find-issues-or.test.ts and Dethereal's manage-controls test;
 * the link inputs of its relationship writers are pinned by assign-control-idempotent.test.ts and
 * dataitem-controls.test.ts.
 */

const DT_CORE_SRC = path.join(__dirname, '../../../../../packages/dt-core/src');

interface Operation {
  file: string;
  name: string;
  source: string;
}

/** Each `export const <NAME> = gql`…`` in dt-core, with `${CONST}` taken from a string constant of the same file. */
function dtCoreOperations(): Operation[] {
  const files = fs
    .readdirSync(DT_CORE_SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('-gql.ts') && !file.includes('__tests__'));
  return files.flatMap((file) => {
    const text = fs.readFileSync(path.join(DT_CORE_SRC, file), 'utf8');
    const constants = new Map<string, string>();
    for (const match of text.matchAll(/const (\w+)\s*=\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g)) {
      constants.set(match[1], match[2] ?? match[3] ?? match[4]);
    }
    return [...text.matchAll(/export const (\w+)\s*=\s*gql`([\s\S]*?)`/g)].map((match) => ({
      file,
      name: match[1],
      source: match[2].replace(/\$\{(\w+)\}/g, (whole, constant: string) => {
        const value = constants.get(constant);
        if (value === undefined) throw new Error(`${file}: ${match[1]} interpolates ${constant}, not a string constant`);
        return value;
      }),
    }));
  });
}

let schema: GraphQLSchema;

beforeAll(async () => {
  schema = await buildProductionSchema('noauth');
}, 60_000);

const operations = dtCoreOperations();

describe('dt-core GraphQL documents', () => {
  it('finds them', () => {
    expect(operations.length).toBeGreaterThan(100);
  });

  it.each(operations.map((op) => [`${op.file} ${op.name}`, op] as const))('%s validates against the schema', (_label, op) => {
    expect(validate(schema, parse(op.source)).map(String)).toEqual([]);
  });
});

/** The variable errors for `variables` on the named dt-core operation, as the request's coercion reports them. */
function variableErrors(name: string, variables: Record<string, unknown>): string[] {
  const op = operations.find((candidate) => candidate.name === name);
  if (!op) throw new Error(`${name} not found in dt-core`);
  const definition = parse(op.source).definitions[0] as OperationDefinitionNode;
  return (getVariableValues(schema, definition.variableDefinitions ?? [], variables).errors ?? []).map(String);
}

describe('the where shapes dt-core builds', () => {
  it.each([
    ['findAnalyses by element', 'FIND_ANALYSES', { condition: { AND: { element: { some: { id: { eq: 'm' } } } } } }],
    [
      'findAnalyses by class and module',
      'FIND_ANALYSES',
      { condition: { AND: { analysisClass: { single: { type: { eq: 't' }, module: { single: { id: { eq: 'mod' } } } } } } } },
    ],
    [
      'findIssues by element',
      'FIND_ISSUES_SUMMARY',
      {
        condition: {
          AND: {
            OR: ['models', 'components', 'dataFlows', 'securityBoundaries', 'controls', 'data', 'analyses', 'exposures', 'countermeasures'].map(
              (field) => ({ [field]: { some: { id: { in: ['e'] } } } }),
            ),
          },
        },
      },
    ],
    [
      'findIssues by class and module',
      'FIND_ISSUES_SUMMARY',
      {
        condition: {
          AND: { issueClass: { single: { type: { eq: 't' }, module: { single: { id: { eq: 'mod' }, name: { eq: 'n' } } } } } },
        },
      },
    ],
    ['Dethereal\'s control-class lookup by module', 'GET_CONTROL_CLASSES', { moduleWhere: { id: { eq: 'mod' } }, classWhere: {} }],
  ])('%s coerces', (_label, name, variables) => {
    expect(variableErrors(name, variables)).toEqual([]);
  });

  it('would refuse the shapes these replaced', () => {
    expect(variableErrors('FIND_ISSUES_SUMMARY', { condition: { AND: { OR: [{ model: { some: { id: { in: ['e'] } } } }] } } })).not.toEqual([]);
    expect(variableErrors('FIND_ANALYSES', { condition: { AND: { module: { single: { id: { eq: 'mod' } } } } } })).not.toEqual([]);
    expect(variableErrors('GET_CONTROL_CLASSES', { moduleWhere: { id: 'mod' }, classWhere: {} })).not.toEqual([]);
  });
});

describe('the link inputs dt-core builds', () => {
  it.each([
    [
      'assignControlToElements on the four typed paths',
      'ASSIGN_CONTROL_TO_ELEMENTS',
      {
        controlId: 'c',
        input: Object.fromEntries(
          ['supportedComponents', 'supportedBoundaries', 'supportedDataFlows', 'supportedData'].map((field) => [
            field,
            { connect: [{ where: { node: { id: { in: ['e'] } } } }] },
          ]),
        ),
      },
    ],
    [
      'a data item\'s controls written whole',
      'UPDATE_DATA_ITEM',
      { dataId: 'd', input: { controls: { disconnect: {}, connect: [{ where: { node: { id: { in: ['c'] } } } }] } } },
    ],
    [
      'a data item\'s controls written as a delta',
      'UPDATE_DATA_ITEM',
      {
        dataId: 'd',
        input: {
          controls: {
            connect: [{ where: { node: { id: { in: ['c2'] } } } }],
            disconnect: [{ where: { node: { id: { in: ['c1'] } } } }],
          },
        },
      },
    ],
    [
      'a data item created with controls',
      'ADD_DATA_ITEM',
      { input: [{ name: 'n', controls: { connect: [{ where: { node: { id: { in: ['c'] } } } }] } }] },
    ],
  ])('%s coerces', (_label, name, variables) => {
    expect(variableErrors(name, variables)).toEqual([]);
  });
});

/**
 * Every selection of type Data in the document that selects more than the id, by the field it sits under, with
 * whether it carries `controls { id }`.
 */
function dataSelections(source: string): Array<{ field: string; hasControls: boolean }> {
  const typeInfo = new TypeInfo(schema);
  const found: Array<{ field: string; hasControls: boolean }> = [];
  const fieldsOf = (node: FieldNode) =>
    (node.selectionSet?.selections ?? []).filter((s): s is FieldNode => s.kind === Kind.FIELD);
  visit(
    parse(source),
    visitWithTypeInfo(typeInfo, {
      Field(node) {
        const type = typeInfo.getType();
        if (!node.selectionSet || !type || getNamedType(type).name !== 'Data') return;
        // A control's own list of the data items it supports names them; it is not a data item's record.
        if (node.name.value === 'supportedData') return;
        // The walk reads a selection's own fields; a fragment there would hide what it selects, so it is refused.
        if (node.selectionSet.selections.some((s) => s.kind !== Kind.FIELD)) {
          found.push({ field: `${node.name.value} (a fragment the check cannot read)`, hasControls: false });
          return;
        }
        const fields = fieldsOf(node);
        if (fields.every((f) => f.name.value === 'id' || f.name.value === '__typename')) return;
        const controls = fields.find((f) => f.name.value === 'controls');
        found.push({ field: node.name.value, hasControls: !!controls && fieldsOf(controls).some((f) => f.name.value === 'id') });
      },
    }),
  );
  return found;
}

/**
 * A client that caches data items replaces each one wholesale with what a mutation returns, so a selection that leaves
 * `controls` out strips the item's controls from the cache after any element edit: the controls disappear from view,
 * re-adding one appends a parallel edge, and removing one cannot be done until a reload. Every selection of a data
 * item beyond its id therefore carries its controls. The exceptions read data items for something else and feed no
 * such cache.
 */
describe('dt-core selections of a data item', () => {
  // The analysis and issue documents list the data items an analysis or an issue is linked to, by name.
  const EXCEPT = new Set(['FIND_ANALYSES', 'FIND_ISSUE_DETAIL', 'CREATE_ISSUE', 'UPDATE_ISSUE']);
  // Built inside the tests: the schema the selections are typed against is built in beforeAll.
  const selecting = () =>
    operations.map((op) => ({ op, selections: dataSelections(op.source) })).filter(({ selections }) => selections.length > 0);

  it('finds them', () => {
    expect(selecting().map(({ op }) => op.name)).toEqual(expect.arrayContaining(['ADD_DATA_ITEM', 'UPDATE_DATA_ITEM', 'DUMP_MODEL_DATA']));
  });

  it('selects the controls of every data item it reads', () => {
    const missing = selecting()
      .filter(({ op }) => !EXCEPT.has(op.name))
      .flatMap(({ op, selections }) => selections.filter((s) => !s.hasControls).map((s) => `${op.file} ${op.name} (${s.field})`));
    expect(missing).toEqual([]);
  });

  it('excepts only documents that select data items', () => {
    const names = new Set(selecting().map(({ op }) => op.name));
    expect([...EXCEPT].filter((name) => !names.has(name))).toEqual([]);
  });
});
