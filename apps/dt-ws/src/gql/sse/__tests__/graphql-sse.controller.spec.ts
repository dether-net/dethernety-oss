import { buildSchema, parse } from 'graphql';
import { GraphQLSseController } from '../graphql-sse.controller';

/**
 * Pins for the SSE transport's schema-sharing consolidation: the handler is
 * built on the INJECTED shared GQL_SCHEMA (the controller no longer owns a
 * SchemaService or performs any schema build — that's structural, its
 * constructor can't reach one), and both requests 503 before init.
 */

// Capture createHandler options instead of exercising the express plumbing.
const mockCreateHandler: jest.Mock = jest.fn((..._args: any[]) => jest.fn());
jest.mock('graphql-sse/lib/use/express', () => ({
  createHandler: (...args: any[]) => mockCreateHandler(...args),
}));

// jose@6 is ESM-only — the guard cannot be imported under Jest's CJS
// transform (established repo pattern: mock it in unit specs).
jest.mock('../../../common/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class {},
}));

function makeController(sentinelSchema: any) {
  const configService: any = {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') return { queryDepthLimit: 5, queryComplexityLimit: 100 };
      return undefined;
    },
  };
  return new GraphQLSseController(configService, sentinelSchema, { __driver: true } as any);
}

describe('GraphQLSseController — shared-schema handler', () => {
  beforeEach(() => mockCreateHandler.mockClear());

  it('builds the handler on the injected shared schema with guards + masked executors wired', async () => {
    const sentinel = { __sharedSchema: true };
    const controller = makeController(sentinel);

    await controller.onModuleInit();

    expect(mockCreateHandler).toHaveBeenCalledTimes(1);
    const options = mockCreateHandler.mock.calls[0][0] as any;
    expect(options.schema).toBe(sentinel); // the ONE schema, not a rebuild
    expect(typeof options.validate).toBe('function'); // depth guard
    expect(typeof options.onSubscribe).toBe('function'); // complexity guard
    expect(typeof options.execute).toBe('function'); // masked executor
    expect(typeof options.subscribe).toBe('function'); // masked executor
    expect(typeof options.context).toBe('function');
  });

  describe('onSubscribe complexity wiring (real schema, invoked directly)', () => {
    // The transport wiring is the point — the guard logic alone lives in
    // query-guards.spec. Config limit is 100 (makeController).
    const schema = buildSchema(`
      type Child { name: String, child: Child }
      type Query { root: Child }
    `);

    async function capturedOnSubscribe() {
      const controller = makeController(schema);
      await controller.onModuleInit();
      return (mockCreateHandler.mock.calls[0][0] as any).onSubscribe;
    }

    // 101 root selections of `root { name }` → complexity 202 > 100.
    const OVER_LIMIT =
      '{ ' +
      Array.from({ length: 101 }, (_, i) => `f${i}: root { name }`).join(' ') +
      ' }';

    it('over-limit query returns a structured 400 Response tuple naming the limit (never an opaque 500)', async () => {
      const onSubscribe = await capturedOnSubscribe();

      const response = onSubscribe({} as any, { query: OVER_LIMIT });

      expect(Array.isArray(response)).toBe(true); // graphql-sse Response tuple
      const [body, init] = response;
      expect(init.status).toBe(400);
      expect(JSON.parse(body).errors[0].message).toContain('Maximum allowed: 100');
    });

    it('under-limit query passes through (returns undefined → handler continues)', async () => {
      const onSubscribe = await capturedOnSubscribe();
      expect(onSubscribe({} as any, { query: '{ root { name } }' })).toBeUndefined();
    });

    it('accepts a pre-parsed DocumentNode query shape', async () => {
      const onSubscribe = await capturedOnSubscribe();
      const response = onSubscribe({} as any, { query: parse(OVER_LIMIT) });
      expect(Array.isArray(response)).toBe(true);
      expect(response[1].status).toBe(400);
    });

    it('a syntactically-invalid query falls through to the handler own parse (no throw)', async () => {
      const onSubscribe = await capturedOnSubscribe();
      expect(onSubscribe({} as any, { query: '{ broken' })).toBeUndefined();
    });

    it('refuses a request that selects no single operation with a structured 400', async () => {
      const onSubscribe = await capturedOnSubscribe();
      const response = onSubscribe({} as any, { query: 'query A { root { name } } query B { root { name } }' });
      expect(response[1].status).toBe(400);
      expect(JSON.parse(response[0]).errors[0].message).toMatch(/several operations/);
    });

    // graphql-sse calls onSubscribe before its own validation: the guards must not walk a document validation refuses.
    it('leaves a document validation refuses to graphql-sse, without running the guards', async () => {
      const onSubscribe = await capturedOnSubscribe();
      // Over the complexity limit too, so a guard that ran would answer a 400 naming it.
      const tooDeep = '{ ' + Array.from({ length: 101 }, (_, i) => `f${i}: root { child { child { child { child { child { name } } } } } }`).join(' ') + ' }';
      expect(onSubscribe({} as any, { query: tooDeep })).toBeUndefined();
      expect(onSubscribe({} as any, { query: OVER_LIMIT.replace('f0: root { name }', 'f0: root { nope }') })).toBeUndefined();
    });
  });

  describe('onSubscribe relationship-filter wiring (invoked directly)', () => {
    // The smallest schema with the shape @neo4j/graphql generates for a relationship to an interface: the guard logic
    // itself is pinned against the production schema in query-guards.relationship-filters.spec.
    const schema = buildSchema(`
      interface E { id: ID }
      type A implements E { id: ID }
      input EWhere { id: ID }
      input ERelationshipFilters { single: EWhere, some: EWhere }
      input AWhere { e: ERelationshipFilters }
      type Query { as(where: AWhere): [A] }
    `);

    it('refuses `single` on a relationship to an interface, in the variables, with a structured 400', async () => {
      const controller = makeController(schema);
      await controller.onModuleInit();
      const onSubscribe = (mockCreateHandler.mock.calls[0][0] as any).onSubscribe;

      const query = 'query ($w: AWhere) { as(where: $w) { id } }';
      const response = onSubscribe({} as any, { query, variables: { w: { e: { single: { id: 'x' } } } } });

      expect(Array.isArray(response)).toBe(true);
      expect(response[1].status).toBe(400);
      expect(JSON.parse(response[0]).errors[0].message).toMatch(/uses "single" on a relationship to an interface/);
      expect(onSubscribe({} as any, { query, variables: { w: { e: { some: { id: 'x' } } } } })).toBeUndefined();
    });
  });

  it.each(['streamGet', 'streamPost'] as const)(
    '%s responds 503 before the handler exists',
    async (method) => {
      const controller = makeController({});
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        headersSent: false,
      };

      await (controller as any)[method]({} as any, res);

      expect(res.status).toHaveBeenCalledWith(503);
    },
  );
});
