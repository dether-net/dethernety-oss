import { ConfigService } from '@nestjs/config';
import { createGraphQLContextFactory } from '../graphql-context.factory';

/**
 * Unit coverage for the auth-bypass fix at the factory's own contract:
 * the factory wires whatever `decodeUserFromAuthHeader` returns into BOTH
 * `context.jwt` and `context.user`, while the raw bearer string lives ONLY on
 * `context.token`. So `context.jwt` can never be the raw string — the exact
 * property @neo4j/graphql relies on when it trusts context.jwt as pre-verified.
 *
 * The real guard's decode behavior (bogus token -> undefined, NOAUTH -> mock
 * admin) is exercised end-to-end in test/integration/graphql-authentication.e2e-spec.ts;
 * here the guard is mocked so this stays a true unit test (importing the real
 * JwtAuthGuard would pull in jose — ESM-only, via jwks-rsa — which the unit
 * Jest config does not transpile).
 */

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'database.name' ? 'neo4j' : undefined),
  } as unknown as ConfigService;
}

function buildFactory(decodeReturn: any, allowlisted = true) {
  const jwtAuthGuard = {
    decodeUserFromAuthHeader: jest.fn().mockResolvedValue(decodeReturn),
    // The factory gates on the allowlist as well as the decode (see its own
    // comment). The stub predates that gate and omitted this, which made every
    // decode-succeeds case throw rather than assert.
    assertAllowlisted: jest.fn().mockReturnValue(allowlisted),
  } as any;
  const neo4jDriver = { marker: 'driver' } as any;
  const factory = createGraphQLContextFactory({
    configService: makeStubConfigService(),
    jwtAuthGuard,
    neo4jDriver,
  });
  return { factory, jwtAuthGuard, neo4jDriver };
}

describe('createGraphQLContextFactory', () => {
  it('an unverified token (guard returns undefined) keeps the raw string OFF jwt', async () => {
    const { factory } = buildFactory(undefined);

    const ctx = await factory({ req: { headers: { authorization: 'Bearer not-a-real-token' } } });

    // `token` is cleared too, not just jwt/user. This assertion previously
    // expected the raw string to be retained, which was the pre-allowlist
    // behaviour. (The allowlist gate itself is exercised below; here the
    // decode simply fails, so all three are empty either way.)
    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined(); // MUST NOT be the raw string
    expect(ctx.jwt).not.toBe('not-a-real-token');
    expect(ctx.user).toBeUndefined();
  });

  it('wires the verified payload into BOTH jwt and user (same reference)', async () => {
    const payload = { sub: 'real-user', roles: ['viewer'] };
    const { factory } = buildFactory(payload);

    const ctx = await factory({ req: { headers: { authorization: 'Bearer good.token.here' } } });

    expect(ctx.jwt).toBe(payload);
    expect(ctx.user).toBe(payload);
    expect(ctx.token).toBe('good.token.here'); // stripped raw string
  });

  it('a validated-but-unlisted caller has token, jwt AND user all cleared', async () => {
    // The gate that makes DEPLOYMENT_ALLOWLIST real on the GraphQL path. The
    // decode succeeds here, so only assertAllowlisted can clear the context —
    // without this test, deleting the allowlist check entirely leaves every
    // other case in this file green.
    const payload = { sub: 'unlisted-user' };
    const { factory, jwtAuthGuard } = buildFactory(payload, false);

    const ctx = await factory({ req: { headers: { authorization: 'Bearer good.token.here' } } });

    expect(jwtAuthGuard.assertAllowlisted).toHaveBeenCalledWith(payload);
    // `token` in particular: @authentication re-verifies a raw bearer by
    // signature alone as a fallback, so leaving it would authenticate the
    // caller the allowlist just rejected.
    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();
  });

  it('no Authorization header yields token/jwt/user undefined but a usable driver context', async () => {
    const { factory, neo4jDriver } = buildFactory(undefined);

    const ctx = await factory({ req: { headers: {} } });

    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();
    expect(ctx.driver).toBe(neo4jDriver);
    expect(ctx.sessionConfig).toEqual({ database: 'neo4j' });
  });

  it('the fallback branch (neither req nor connection) returns a driver-only context', async () => {
    const { factory, neo4jDriver } = buildFactory(undefined);

    const ctx = await factory({});

    expect(ctx.driver).toBe(neo4jDriver);
    expect(ctx.token).toBeUndefined();
    expect(ctx.jwt).toBeUndefined();
    expect(ctx.user).toBeUndefined();
  });

  it('a NOAUTH-style mock admin payload flows into jwt === user', async () => {
    const mockAdmin = { sub: 'dev-user', email: 'dev@example.com', roles: ['admin'], permissions: [] };
    const { factory } = buildFactory(mockAdmin);

    const ctx = await factory({ req: { headers: {} } });

    expect(ctx.user).toBe(mockAdmin);
    expect(ctx.jwt).toBe(ctx.user); // the intended dev trust path
  });

  it('the WebSocket connection branch also carries the verified payload into jwt', async () => {
    const payload = { sub: 'ws-user' };
    const { factory, jwtAuthGuard } = buildFactory(payload);

    const ctx = await factory({ connection: { context: { Authorization: 'Bearer ws.token' } } });

    expect(jwtAuthGuard.decodeUserFromAuthHeader).toHaveBeenCalledWith('Bearer ws.token');
    expect(ctx.jwt).toBe(payload);
    expect(ctx.user).toBe(payload);
    expect(ctx.token).toBe('ws.token');
  });
});
