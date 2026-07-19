// jose@6 is ESM-only — mock the guard module per repo pattern (the factory
// imports it for typing/DI; the fallback branch under test never calls it).
jest.mock('../../../common/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));

import { createGraphQLContextFactory } from '../graphql-context.factory';

/**
 * Pin the database-name passthrough at the MOST load-bearing of the swept
 * session-config sites: the per-request GraphQL context that targets every
 * @neo4j/graphql query/mutation. An unset database.name must reach the
 * driver as `undefined` (server default DB — valid on both engines), never
 * a resurrected `|| 'neo4j'` fallback, which Memgraph rejects and which
 * would split-brain the query plane away from the bootstrap DDL target.
 */
describe('createGraphQLContextFactory — sessionConfig.database', () => {
  function makeFactory(databaseName: string | undefined) {
    return createGraphQLContextFactory({
      configService: { get: (key: string) => (key === 'database.name' ? databaseName : undefined) } as any,
      jwtAuthGuard: {} as any,
      neo4jDriver: {},
    });
  }

  it('unset database.name passes through as undefined (server default DB)', async () => {
    const context = await makeFactory(undefined)({});
    expect(context.sessionConfig).toEqual({ database: undefined });
  });

  it('an explicit database.name passes through unchanged', async () => {
    const context = await makeFactory('memgraph')({});
    expect(context.sessionConfig).toEqual({ database: 'memgraph' });
  });
});
