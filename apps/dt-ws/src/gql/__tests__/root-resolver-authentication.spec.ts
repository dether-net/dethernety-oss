import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getNamedType,
  graphql,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLSchema,
  isCompositeType,
  isNonNullType,
  Kind,
  ObjectTypeDefinitionNode,
  parse,
} from 'graphql';

import { ResolverMap } from '../interfaces/resolver.interface';
import { SchemaService } from '../services/schema.service';
import { PRODUCTION_SDL } from '../../../test/integration/production-schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stripAuthentication } = require('../../../../../scripts/generate-noauth-schema.js');

/**
 * A request without a verified user is refused before any root resolver runs: SchemaService puts the gate module
 * resolvers get in front of every Query and Mutation field of the composed schema, generated ones included, so a field
 * added later is covered without a change here.
 * With authentication off, every field runs without a user.
 */

type Root = 'Query' | 'Mutation';

/** The root fields the platform resolves itself: every field of the SDL's Query and Mutation types without @cypher. */
const FIELDS: Record<Root, string[]> = (() => {
  const out: Record<Root, string[]> = { Query: [], Mutation: [] };
  for (const def of parse(PRODUCTION_SDL).definitions) {
    if (def.kind !== Kind.OBJECT_TYPE_DEFINITION || (def.name.value !== 'Query' && def.name.value !== 'Mutation')) continue;
    for (const field of (def as ObjectTypeDefinitionNode).fields ?? []) {
      if (!field.directives?.some((d) => d.name.value === 'cypher')) out[def.name.value as Root].push(field.name.value);
    }
  }
  return out;
})();

/** Every statement a request sends; the row is what the library's version check reads before it runs a request. */
const statements: string[] = [];
const executionContext = {
  run: async (statement: string) => {
    statements.push(statement);
    return { records: [['5.20.0', 'enterprise']] };
  },
};
const USER = { sub: 'test-user' };
const withoutUser = { executionContext, cypherQueryOptions: { addVersionPrefix: false } };
const withUser = { ...withoutUser, jwt: USER, user: USER };

/** A resolver for every platform root field that records the fields it ran. */
function recorders(reached: string[]): ResolverMap {
  const map: ResolverMap = { Query: {}, Mutation: {} };
  for (const root of ['Query', 'Mutation'] as const) {
    for (const f of FIELDS[root]) {
      map[root][f] = () => {
        reached.push(`${root}.${f}`);
        return null;
      };
    }
  }
  return map;
}

function literal(type: GraphQLInputType): string {
  if (type instanceof GraphQLNonNull) return literal(type.ofType);
  if (type instanceof GraphQLList) return `[${literal(type.ofType)}]`;
  if (type instanceof GraphQLEnumType) return type.getValues()[0].name;
  if (type instanceof GraphQLInputObjectType) {
    const required = Object.values(type.getFields()).filter((f) => isNonNullType(f.type));
    return `{${required.map((f) => `${f.name}: ${literal(f.type)}`).join(', ')}}`;
  }
  const name = (type as GraphQLScalarType).name;
  if (name === 'Int' || name === 'Float') return '1';
  if (name === 'Boolean') return 'true';
  if (name === 'JSON') return '{}';
  return '"x"';
}

/** Every Query and Mutation field of a composed schema. */
function rootFieldsOf(schema: GraphQLSchema): Record<Root, string[]> {
  return { Query: Object.keys(schema.getQueryType()!.getFields()), Mutation: Object.keys(schema.getMutationType()!.getFields()) };
}

/** One request per root field: which platform fields ran, and each refused field's error codes and messages. */
async function requestEach(schema: GraphQLSchema, reached: string[], contextValue: object, fields = FIELDS) {
  reached.length = 0;
  statements.length = 0;
  const refused: Record<string, string> = {};
  for (const root of ['Query', 'Mutation'] as const) {
    const type = root === 'Query' ? schema.getQueryType()! : schema.getMutationType()!;
    for (const name of fields[root]) {
      const field = type.getFields()[name];
      const args = field.args.filter((a) => isNonNullType(a.type)).map((a) => `${a.name}: ${literal(a.type)}`);
      const selection = isCompositeType(getNamedType(field.type)) ? ' { __typename }' : '';
      const source = `${root === 'Query' ? 'query' : 'mutation'} { ${name}${args.length ? `(${args.join(', ')})` : ''}${selection} }`;
      const before = reached.length;
      const result = await graphql({ schema, source, contextValue: { ...contextValue } });
      if (reached.length === before) {
        refused[`${root}.${name}`] = (result.errors ?? []).map((e) => `${e.extensions?.code ?? ''} ${e.message}`).join(' | ');
      }
    }
  }
  return { ran: [...reached], refused };
}

const ALL = [...FIELDS.Query.map((f) => `Query.${f}`), ...FIELDS.Mutation.map((f) => `Mutation.${f}`)];

/**
 * A SchemaService built from a schema file without @authentication, as generate-noauth-schema writes it, so the gate
 * is tested on its own.
 */
function schemaService(gql: { oidcJwksUri: string; enableNoauth: boolean }): SchemaService {
  const config = { get: (key: string) => (key === 'gql' ? gql : undefined) } as unknown as ConfigService;
  const driver = { session: () => ({ run: async () => ({ records: [] }), close: async () => undefined }) };
  const service = new SchemaService(config, driver);
  jest.spyOn(service as unknown as { loadSchemaFile: () => Promise<string> }, 'loadSchemaFile').mockResolvedValue(stripAuthentication(PRODUCTION_SDL));
  return service;
}

let warn: typeof console.warn;
beforeAll(() => {
  // The library's "Custom resolver … has not been provided" for the @customResolver fields and the Subscription root
  // fields, which get no resolver here, and the gates' own warnings.
  warn = console.warn;
  console.warn = () => undefined;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  console.warn = warn;
  jest.restoreAllMocks();
});

it('finds the root fields the platform resolves itself in the schema file', () => {
  expect(FIELDS.Query).toEqual(expect.arrayContaining(['getFrontendModuleManifest', 'getDocument', 'listClasses']));
  expect(FIELDS.Mutation).toEqual(expect.arrayContaining(['deleteModel', 'runAnalysis', 'resetModule', 'sweepOrphans']));
  expect(ALL.length).toBeGreaterThan(25);
});

describe('SchemaService: authentication required, a schema file without @authentication', () => {
  const reached: string[] = [];
  let schema: GraphQLSchema;

  beforeAll(async () => {
    schema = await schemaService({ oidcJwksUri: '', enableNoauth: false }).buildSchemaWithResolvers(recorders(reached));
  }, 60_000);

  it('refuses every Query and Mutation field without a verified user, generated ones included, before anything runs', async () => {
    const fields = rootFieldsOf(schema);
    expect(fields.Query).toEqual(expect.arrayContaining(['models', 'modelsConnection', ...FIELDS.Query]));
    expect(fields.Mutation).toEqual(expect.arrayContaining(['createModels', 'deleteComponents', ...FIELDS.Mutation]));
    const { ran, refused } = await requestEach(schema, reached, withoutUser, fields);
    expect(ran).toEqual([]);
    expect(statements).toEqual([]);
    expect(Object.keys(refused)).toEqual([...fields.Query.map((f) => `Query.${f}`), ...fields.Mutation.map((f) => `Mutation.${f}`)]);
    for (const [field, errors] of Object.entries(refused)) expect([field, errors]).toEqual([field, 'UNAUTHENTICATED Authentication required']);
  });

  it('runs every one of them for a verified user', async () => {
    expect((await requestEach(schema, reached, withUser)).ran).toEqual(ALL);
  });

  it('serves no top-level query for the Element interface', () => {
    expect(Object.keys(schema.getQueryType()!.getFields()).filter((f) => /^elements/.test(f))).toEqual([]);
  });
});

describe('authentication off (non-production, no OIDC, ENABLE_NOAUTH)', () => {
  const nodeEnv = process.env.NODE_ENV;
  afterAll(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('runs every platform root field without a user', async () => {
    process.env.NODE_ENV = 'test';
    const reached: string[] = [];
    const schema = await schemaService({ oidcJwksUri: '', enableNoauth: true }).buildSchemaWithResolvers(recorders(reached));
    expect((await requestEach(schema, reached, withoutUser)).ran).toEqual(ALL);
  }, 60_000);
});
