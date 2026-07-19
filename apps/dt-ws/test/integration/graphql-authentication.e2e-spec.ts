// Integration regression for the authentication bypass.
//
// The bug: the GraphQL context factory put the raw, unverified bearer string
// into `context.jwt`. @neo4j/graphql treats a truthy `context.jwt` as
// already-verified claims (`if (context.jwt) { isAuthenticated = true }`), so
// any non-empty "Bearer <anything>" satisfied every @authentication directive.
//
// This spec composes the REAL extracted context factory (via a real
// JwtAuthGuard in OIDC-configured mode) with a minimal @authentication-gated
// Neo4jGraphQL schema, and asserts that a bogus/absent token is now rejected
// while the dev NOAUTH path still returns data (no lockout). It follows the
// repo's in-process `graphql()` + Memgraph-testcontainer convention
// (mirrors mitre-verb-edges-graphql.e2e-spec) rather than booting the full app.
//
// NOTE: the negative tokens are deliberately NOT well-formed 3-part JWTs —
// jose fails at compact-JWS parse before any JWKS network fetch, so the suite
// stays fully offline. FAKE_JWKS is never actually contacted.
//
// BUILD NOTE: importing the real JwtAuthGuard drags in jwks-rsa -> jose@6
// (ESM-only), which Jest's default transformIgnorePatterns won't transpile.
// test/jest-e2e.json carries a `transformIgnorePatterns` entry that un-ignores
// `jose` specifically for this reason — don't remove it while this spec exists.

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { createGraphQLContextFactory } from '../../src/gql/utils/graphql-context.factory';

jest.setTimeout(120_000);

const FAKE_JWKS = 'https://jwks.invalid/.well-known/jwks.json';

// A node type gated by a bare @authentication directive, mirroring the ~73
// @authentication directives on the production schema's node types.
const typeDefs = `
  type SecretDoc @node @authentication {
    id: ID!
    name: String
  }
`;

function stubConfig(oidcJwksUri: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'gql') return { oidcJwksUri };
      if (key === 'database.name') return 'memgraph';
      return undefined;
    },
  } as unknown as ConfigService;
}

describe('GraphQL authentication — @authentication enforcement (e2e)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;
  // The real production factory, wired with a real OIDC-configured guard.
  let factory: ReturnType<typeof createGraphQLContextFactory>;

  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    mg = await startMemgraph();

    const neoSchema = new Neo4jGraphQL({
      typeDefs,
      driver: mg.driver,
      features: {
        authorization: { key: { url: FAKE_JWKS } },
      },
    });
    schema = await neoSchema.getSchema();

    const cfg = stubConfig(FAKE_JWKS);
    factory = createGraphQLContextFactory({
      configService: cfg,
      jwtAuthGuard: new JwtAuthGuard(cfg),
      neo4jDriver: mg.driver,
    });
  }, 120_000);

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    await clearGraph(mg.driver);
    const session = mg.driver.session();
    try {
      await session.run(`CREATE (:SecretDoc { id: 'doc-1', name: 'top secret' })`);
    } finally {
      await session.close();
    }
  });

  const QUERY = `query { secretDocs { id name } }`;

  it('rejects a bogus bearer token — no data returned', async () => {
    const ctx = await factory({ req: { headers: { authorization: 'Bearer not-a-real-token' } } });

    // Factory-level guarantee: the raw string never reaches context.jwt.
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();
    expect(ctx.token).toBe('not-a-real-token');

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });

    expect(result.data?.secretDocs ?? null).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).toBe('Unauthenticated');
  });

  it('rejects a request with no Authorization header — no data returned', async () => {
    const ctx = await factory({ req: { headers: {} } });

    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });

    expect(result.data?.secretDocs ?? null).toBeNull();
    expect(result.errors?.[0]?.message).toBe('Unauthenticated');
  });

  it('dev no-OIDC (non-prod) still returns data — proves no lockout', async () => {
    const noauthCfg = stubConfig('');
    const noauthFactory = createGraphQLContextFactory({
      configService: noauthCfg,
      jwtAuthGuard: new JwtAuthGuard(noauthCfg),
      neo4jDriver: mg.driver,
    });

    const ctx = await noauthFactory({ req: { headers: {} } });
    // In the no-OIDC non-prod dev mode, decodeUserFromAuthHeader returns the
    // mock admin — a truthy object — which the library trust path authenticates
    // (the intended dev behavior). NB this does not depend on ENABLE_NOAUTH.
    expect(ctx.jwt).toMatchObject({ sub: 'dev-user' });

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });

    expect(result.errors).toBeUndefined();
    expect((result.data as any)?.secretDocs).toEqual([{ id: 'doc-1', name: 'top secret' }]);
  });

  // Library-behavior canary: documents WHY the raw string is dangerous.
  // @neo4j/graphql@7.2.0 trusts ANY truthy context.jwt as pre-verified, so a
  // raw string in context.jwt returns data. If a future upgrade changes this
  // semantics, this canary flags it.
  it('CANARY: a raw string in context.jwt is trusted by the library (returns data)', async () => {
    const forgedCtx = {
      token: 'not-a-real-token',
      jwt: 'not-a-real-token' as unknown as Record<string, unknown>, // the vulnerable shape
      driver: mg.driver,
      sessionConfig: { database: 'memgraph' },
      cypherQueryOptions: { addVersionPrefix: false },
    };

    const result = await graphql({ schema, source: QUERY, contextValue: forgedCtx as any });

    expect(result.errors).toBeUndefined();
    expect((result.data as any)?.secretDocs).toEqual([{ id: 'doc-1', name: 'top secret' }]);
  });
});
