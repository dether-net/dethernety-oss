import * as fs from 'fs';
import * as path from 'path';
import { getVariableValues, GraphQLSchema, OperationDefinitionNode, parse, validate } from 'graphql';
// The documents are validated against the schema the platform serves, built in-process with no database.
import { buildProductionSchema } from '../../../test/integration/production-schema';

/**
 * Every GraphQL document dt-core sends, validated against the platform's schema: a field or argument the schema does
 * not have fails here instead of failing the request. The documents are read from dt-core's source (`*-gql.ts`): dt-core
 * is ESM-only, and this Jest config cannot import it.
 *
 * Validation sees the document, not the variables dt-core builds at run time, so the `where` shapes of its filter
 * builders are checked too, with the same variable coercion the request goes through. Those shapes are copied by hand
 * from dt-core and pinned there by find-analyses.test.ts, find-issues-or.test.ts and Dethereal's manage-controls test.
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
