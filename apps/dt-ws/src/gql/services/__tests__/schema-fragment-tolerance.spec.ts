import { SchemaService } from '../schema.service';

/**
 * Pins for the fragment-tolerant composition added in the infrastructure
 * consolidation: a module fragment that would break the whole schema is
 * dropped (log-and-skip), and a composition failure with module
 * contributions falls back to the base schema instead of killing boot.
 */

// Mock @neo4j/graphql so composeSchema is controllable without a real DB.
// (jest.mock factories may only close over `mock`-prefixed variables.)
const mockGetSchema = jest.fn();
const mockNeo4jGraphQLCtor = jest.fn().mockImplementation(() => ({
  getSchema: mockGetSchema,
}));
jest.mock('@neo4j/graphql', () => ({
  Neo4jGraphQL: function (this: any, ...args: any[]) {
    return mockNeo4jGraphQLCtor(...args);
  },
}));

function makeService() {
  const driver = {
    session: () => ({
      run: async () => ({ records: [{}] }),
      close: async () => {},
    }),
  };
  const configService: any = { get: () => ({}) };
  return new SchemaService(configService, driver as any);
}

const BASE = `
  type Query { ping: String }
  type Widget { id: ID! }
`;

describe('SchemaService — per-fragment duplicate-definition filter', () => {
  it('drops a fragment that redefines a base type; keeps a good extend fragment', () => {
    const svc = makeService();
    svc.setModuleSchemaFragments([
      'type Widget { id: ID! rogue: String }', // redefines base type → dropped
      'extend type Query { moduleField: String }', // legal augmentation → kept
    ]);

    const merged = (svc as any).mergeModuleSchemas(BASE) as string;

    expect(merged).toContain('extend type Query { moduleField: String }');
    expect(merged).not.toContain('rogue');
  });

  it('cross-fragment collision: first definition wins, second is dropped', () => {
    const svc = makeService();
    svc.setModuleSchemaFragments([
      'type ModuleThing { a: String }',
      'type ModuleThing { b: String }', // same new name → dropped
    ]);

    const merged = (svc as any).mergeModuleSchemas(BASE) as string;

    expect(merged).toContain('a: String');
    expect(merged).not.toContain('b: String');
  });

  it('syntactically-invalid fragments are still skipped (pre-existing gate)', () => {
    const svc = makeService();
    svc.setModuleSchemaFragments(['type Broken {', 'extend type Query { ok: String }']);

    const merged = (svc as any).mergeModuleSchemas(BASE) as string;

    expect(merged).toContain('ok: String');
    expect(merged).not.toContain('Broken');
  });

  it('non-object kinds are filtered too: a duplicate enum is dropped', () => {
    // Redefinition risk is not object-types-only — compatible dupes MERGE
    // silently in @neo4j/graphql, conflicting ones throw. Pin an enum.
    const svc = makeService();
    const baseWithEnum = `${BASE}\nenum Severity { LOW HIGH }`;
    svc.setModuleSchemaFragments(['enum Severity { LOW MEDIUM }']);

    const merged = (svc as any).mergeModuleSchemas(baseWithEnum) as string;

    expect(merged).not.toContain('MEDIUM');
  });
});

describe('SchemaService — composition fallback', () => {
  beforeEach(() => {
    mockGetSchema.mockReset();
    mockNeo4jGraphQLCtor.mockClear();
  });

  it('HAPPY PATH: the served schema includes module fragments and WRAPPED module resolvers', async () => {
    // The regression this whole consolidation exists to fix: the served
    // schema must actually carry the module contributions. Without this
    // pin, silently composing base-only on the happy path passes the suite.
    mockGetSchema.mockResolvedValueOnce({ __kind: 'full-schema' });

    const svc = makeService();
    jest.spyOn(svc as any, 'loadSchemaFile').mockResolvedValue(BASE);
    svc.setModuleSchemaFragments(['extend type Query { moduleField: String }']);

    const rawModuleResolver = () => 1;
    const schema = await svc.buildSchemaWithResolvers(
      { Query: { ping: () => 'pong' } },
      [{ moduleName: 'mod-a', resolvers: { Query: { moduleField: rawModuleResolver } } }],
    );

    expect(schema).toEqual({ __kind: 'full-schema' });
    expect(mockNeo4jGraphQLCtor).toHaveBeenCalledTimes(1);
    const args = mockNeo4jGraphQLCtor.mock.calls[0][0];
    expect(args.typeDefs).toContain('extend type Query { moduleField: String }');
    expect(args.resolvers.Query.moduleField).toBeDefined();
    // Wrapped (auth/timeout/sanitize), never the raw module function.
    expect(args.resolvers.Query.moduleField).not.toBe(rawModuleResolver);
    expect(args.resolvers.Query.ping).toBeDefined();
    expect((svc as any).isSchemaDegraded()).toBe(false);
  });

  it('fragments-only module contribution (no resolvers) still falls back instead of throwing', async () => {
    // hasModuleContributions must be true on the typeDefs leg alone.
    mockGetSchema
      .mockRejectedValueOnce(new Error('Composition exploded'))
      .mockResolvedValueOnce({ __kind: 'base-only-schema' });

    const svc = makeService();
    jest.spyOn(svc as any, 'loadSchemaFile').mockResolvedValue(BASE);
    svc.setModuleSchemaFragments(['extend type Query { moduleField: String }']);

    await expect(
      svc.buildSchemaWithResolvers({ Query: { ping: () => 'pong' } }),
    ).resolves.toEqual({ __kind: 'base-only-schema' });
    expect(mockNeo4jGraphQLCtor).toHaveBeenCalledTimes(2);
    expect((svc as any).isSchemaDegraded()).toBe(true);
  });

  it('falls back to base-only (platform resolvers only) when module-augmented composition throws', async () => {
    // First compose (base + fragment + module resolvers) explodes at
    // composition time; the retry (base only) succeeds.
    mockGetSchema
      .mockRejectedValueOnce(new Error('Composition exploded'))
      .mockResolvedValueOnce({ __kind: 'base-only-schema' });

    const svc = makeService();
    // Bypass file loading — pin the base type defs directly.
    jest.spyOn(svc as any, 'loadSchemaFile').mockResolvedValue(BASE);
    svc.setModuleSchemaFragments(['extend type Query { moduleField: String }']);

    const platformResolvers = { Query: { ping: () => 'pong' } };
    const moduleResolvers = [
      { moduleName: 'bad-mod', resolvers: { Query: { moduleField: () => 1 } } },
    ];

    const schema = await svc.buildSchemaWithResolvers(
      platformResolvers,
      moduleResolvers,
    );

    expect(schema).toEqual({ __kind: 'base-only-schema' });
    expect(mockNeo4jGraphQLCtor).toHaveBeenCalledTimes(2);

    // Retry must use the BASE type defs and drop the module resolvers —
    // resolvers for types that no longer exist would fail composition too.
    const retryArgs = mockNeo4jGraphQLCtor.mock.calls[1][0];
    expect(retryArgs.typeDefs).toBe(BASE);
    expect(retryArgs.resolvers.Query.moduleField).toBeUndefined();
    expect(retryArgs.resolvers.Query.ping).toBeDefined();

    // The served schema is cached for getSchema()/validateSchema() (health).
    await expect(svc.getSchema()).resolves.toEqual({ __kind: 'base-only-schema' });
  });

  it('a base-only composition failure is genuine and still throws', async () => {
    mockGetSchema.mockRejectedValue(new Error('base is broken'));

    const svc = makeService();
    jest.spyOn(svc as any, 'loadSchemaFile').mockResolvedValue(BASE);
    // No fragments, no module resolvers → no fallback available.

    await expect(svc.buildSchemaWithResolvers({})).rejects.toThrow(
      'Schema build failed',
    );
    expect(mockNeo4jGraphQLCtor).toHaveBeenCalledTimes(1);
  });
});
