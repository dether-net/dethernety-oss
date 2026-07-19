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

function buildFactory(decodeReturn: any) {
  const jwtAuthGuard = { decodeUserFromAuthHeader: jest.fn().mockResolvedValue(decodeReturn) } as any;
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

    expect(ctx.token).toBe('not-a-real-token'); // raw string retained on `token`
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
