// Deployment access allowlist — enforcement (e2e).
//
// A deployment may restrict which authenticated users it serves. A caller whose
// `sub` is not on DEPLOYMENT_ALLOWLIST must reach NOTHING on any transport,
// indistinguishable from an invalid token. The load-bearing subtlety: the
// GraphQL context factory extracts the raw bearer `token` INDEPENDENTLY of the
// validated `user`, and @neo4j/graphql's @authentication falls back to verifying
// `context.token` by SIGNATURE ALONE when `context.jwt` is falsy. So nulling
// user/jwt on a miss is not enough — the residual signed token still authenticates.
// The fix clears `token`. The "load-bearing canary" below proves that necessity.
//
// This suite composes the REAL context factory + REAL JwtAuthGuard.assertAllowlisted
// with a minimal @authentication-gated schema (mirrors graphql-authentication.e2e-spec).
// It runs OFFLINE: the library authorization key is a plain HS256 secret, tokens are
// HS256-signed with it, and the guard's RS256/JWKS validateToken is spied to decode
// the HS256 token — leaving assertAllowlisted + the factory gate as the code under test.
//
// 4 transports = 2 enforcement points: the factory gates HTTP + WS; canActivate
// gates SSE + REST (both controllers are @UseGuards(JwtAuthGuard)).
//
// BUILD NOTE: importing the real JwtAuthGuard drags in jwks-rsa -> jose@6 (ESM-only);
// test/jest-e2e.json un-ignores `jose` in transformIgnorePatterns for exactly this.

import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, GraphQLSchema } from 'graphql';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { createGraphQLContextFactory } from '../../src/gql/utils/graphql-context.factory';

jest.setTimeout(120_000);

const FAKE_JWKS = 'https://jwks.invalid/.well-known/jwks.json';
const SECRET = 'e2e-allowlist-secret';

// HS256 tokens: A is allowlisted, B is a valid token that is NOT allowlisted.
const tokenA = jwt.sign({ sub: 'sub-A' }, SECRET);
const tokenB = jwt.sign({ sub: 'sub-B' }, SECRET);

const typeDefs = `
  type SecretDoc @node @authentication {
    id: ID!
    name: String
  }
`;

function stubConfig(oidcJwksUri: string, accessAllowlist: string[]): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'gql') return { oidcJwksUri, accessAllowlist };
      if (key === 'database.name') return 'memgraph';
      return undefined;
    },
  } as unknown as ConfigService;
}

const QUERY = `query { secretDocs { id name } }`;

describe('deployment allowlist — factory gate across the @authentication boundary (e2e)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;
  let factory: ReturnType<typeof createGraphQLContextFactory>;

  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    mg = await startMemgraph();

    // Library authorization keyed on the SAME HS256 secret — so it will actually
    // verify a residual context.token's signature (the fallback the fix defends).
    const neoSchema = new Neo4jGraphQL({
      typeDefs,
      driver: mg.driver,
      features: { authorization: { key: SECRET } },
    });
    schema = await neoSchema.getSchema();

    const cfg = stubConfig(FAKE_JWKS, ['sub-A']);
    const guard = new JwtAuthGuard(cfg);
    // Stand in for RS256/JWKS validation: decode the HS256 test token to its payload.
    // decodeUserFromAuthHeader (the factory's call) routes through validateToken.
    jest
      .spyOn(guard as any, 'validateToken')
      .mockImplementation(async (t: string) => jwt.verify(t, SECRET) as Record<string, unknown>);

    factory = createGraphQLContextFactory({
      configService: cfg,
      jwtAuthGuard: guard,
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

  it('allowlisted user (A): credential exposed, core @authentication query returns data', async () => {
    const ctx = await factory({ req: { headers: { authorization: `Bearer ${tokenA}` } } });

    expect(ctx.token).toBe(tokenA);
    expect(ctx.jwt).toMatchObject({ sub: 'sub-A' });
    expect(ctx.user).toMatchObject({ sub: 'sub-A' });

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });
    expect(result.errors).toBeUndefined();
    expect((result.data as any)?.secretDocs).toEqual([{ id: 'doc-1', name: 'top secret' }]);
  });

  it('validated-but-unlisted user (B) over HTTP: token/jwt/user all cleared, query rejected', async () => {
    const ctx = await factory({ req: { headers: { authorization: `Bearer ${tokenB}` } } });

    // The load-bearing assertion: token is cleared, not just user/jwt.
    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });
    expect(result.data?.secretDocs ?? null).toBeNull();
    expect(result.errors?.[0]?.message).toBe('Unauthenticated');
  });

  it('validated-but-unlisted user (B) over WebSocket: same all-cleared rejection', async () => {
    const ctx = await factory({
      connection: { context: { Authorization: `Bearer ${tokenB}` } },
    });

    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();

    const result = await graphql({ schema, source: QUERY, contextValue: ctx as any });
    expect(result.data?.secretDocs ?? null).toBeNull();
    expect(result.errors?.[0]?.message).toBe('Unauthenticated');
  });

  // Load-bearing canary: proves WHY the factory must clear `token`. A residual,
  // signature-valid token in context.token (with jwt/user cleared) is authenticated
  // by the library's signature-only fallback — so gating user/jwt alone would leak.
  it('CANARY: a residual signed token in context.token (jwt cleared) still authenticates', async () => {
    const forgedCtx = {
      token: tokenB, // the pre-fix soft-path leftover
      jwt: undefined,
      user: undefined,
      driver: mg.driver,
      sessionConfig: { database: 'memgraph' },
      cypherQueryOptions: { addVersionPrefix: false },
    };

    const result = await graphql({ schema, source: QUERY, contextValue: forgedCtx as any });
    expect(result.errors).toBeUndefined();
    expect((result.data as any)?.secretDocs).toEqual([{ id: 'doc-1', name: 'top secret' }]);
  });
});

describe('deployment allowlist — guard logic (no container)', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = originalEnv; });

  const mockCtx = (authorization?: string): any => ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  });

  it('assertAllowlisted: empty list admits anyone; a populated list keys on sub', () => {
    const unrestricted = new JwtAuthGuard(stubConfig(FAKE_JWKS, []));
    expect(unrestricted.assertAllowlisted({ sub: 'anyone' })).toBe(true);

    const restricted = new JwtAuthGuard(stubConfig(FAKE_JWKS, ['sub-A']));
    expect(restricted.assertAllowlisted({ sub: 'sub-A' })).toBe(true);
    expect(restricted.assertAllowlisted({ sub: 'sub-B' })).toBe(false);
    expect(restricted.assertAllowlisted({})).toBe(false); // no sub → not listed
  });

  it('hard path (canActivate): validated-but-unlisted → UnauthorizedException (401); listed → true', async () => {
    const guard = new JwtAuthGuard(stubConfig(FAKE_JWKS, ['sub-A']));
    const spy = jest.spyOn(guard as any, 'validateToken');

    spy.mockResolvedValueOnce({ sub: 'sub-B' });
    await expect(guard.canActivate(mockCtx('Bearer tokenB'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    spy.mockResolvedValueOnce({ sub: 'sub-A' });
    await expect(guard.canActivate(mockCtx('Bearer tokenA'))).resolves.toBe(true);
  });

  it('hard path dev/NOAUTH: mock admin is structurally exempt (never reaches the allowlist)', async () => {
    // No OIDC configured (non-prod) → canActivate injects the mock admin and returns
    // true BEFORE any allowlist check, even with a populated allowlist.
    const guard = new JwtAuthGuard(stubConfig('', ['sub-A']));
    await expect(guard.canActivate(mockCtx(undefined))).resolves.toBe(true);
  });
});
