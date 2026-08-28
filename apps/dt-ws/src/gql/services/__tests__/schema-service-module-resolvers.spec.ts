import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchemaService } from '../schema.service';
import { GraphQLError } from 'graphql';
import { GraphQLContext } from '../../interfaces/resolver.interface';
// The real remote-module error taxonomy, imported HERE and never in
// schema.service.ts. The wrapper keys on the wire `code` string on purpose (a
// mounted module may resolve its own copy of the library, so `instanceof` would
// fail silently). Constructing the genuine classes in the spec is what keeps
// that string coupling honest: if a `code` value ever changes upstream, this
// suite goes red instead of the wrapper quietly un-mapping in production.
import {
  CloudSessionExpiredError,
  EvaluationNotEntitledError,
  RemoteModuleUnavailableError,
  ContentRecalledError,
  RemoteModuleMisconfiguredError,
} from '@dethernety/dt-module';

/** Minimal context with a verified identity for tests */
const authedContext = { user: { sub: 'test-user' }, jwt: { sub: 'test-user' }, driver: {} } as GraphQLContext;
/** Minimal context without auth */
const noAuthContext = { driver: {} } as GraphQLContext;

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'gql') {
      return {
        oidcJwksUri: '',
        enableSubscriptions: false,
        enableNoauth: false,
        queryDepthLimit: 10,
        queryComplexityLimit: 1000,
      };
    }
    return undefined;
  }),
};

const mockNeo4jDriver = {};

/**
 * Invoke a wrapped resolver and hand back the error it rejected with.
 *
 * The older cases in this file end their happy path with `fail('Should have
 * thrown')`, but `fail` is not a global under jest-circus — it only ever
 * "works" because the ReferenceError lands in the same catch block. This helper
 * rejects for real when the resolver unexpectedly resolves.
 */
const captureResolverError = async (
  resolver: (...args: any[]) => Promise<unknown>,
): Promise<GraphQLError> => {
  try {
    await resolver({}, {}, authedContext, {});
  } catch (error) {
    return error as GraphQLError;
  }
  throw new Error('Expected the wrapped resolver to reject, but it resolved');
};

describe('SchemaService — Module Resolvers', () => {
  let service: SchemaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'NEO4J_DRIVER', useValue: mockNeo4jDriver },
      ],
    }).compile();

    service = module.get<SchemaService>(SchemaService);
  });

  describe('mergeModuleResolvers', () => {
    it('should add module resolvers to empty existing map', () => {
      const existing = {};
      const moduleResolvers = [
        {
          moduleName: 'test-module',
          resolvers: { Query: { myField: jest.fn() } },
        },
      ];

      const result = service.mergeModuleResolvers(existing, moduleResolvers);

      expect(result.Query).toBeDefined();
      expect(result.Query.myField).toBeDefined();
    });

    it('should preserve hardcoded resolvers and skip conflicting module resolvers', () => {
      const hardcodedFn = jest.fn();
      const moduleFn = jest.fn();
      const existing = { Query: { existingField: hardcodedFn } };
      const moduleResolvers = [
        {
          moduleName: 'test-module',
          resolvers: { Query: { existingField: moduleFn } },
        },
      ];

      const result = service.mergeModuleResolvers(existing, moduleResolvers);

      // The hardcoded resolver should win
      expect(result.Query.existingField).toBe(hardcodedFn);
    });

    it('should allow non-conflicting module resolvers alongside hardcoded ones', () => {
      const hardcodedFn = jest.fn();
      const existing = { Query: { existingField: hardcodedFn } };
      const moduleResolvers = [
        {
          moduleName: 'test-module',
          resolvers: { Query: { newField: jest.fn() } },
        },
      ];

      const result = service.mergeModuleResolvers(existing, moduleResolvers);

      expect(result.Query.existingField).toBe(hardcodedFn);
      expect(result.Query.newField).toBeDefined();
    });

    it('should give first module (alphabetical) priority on cross-module conflict', async () => {
      const alphaFn = jest.fn().mockReturnValue('alpha');
      const betaFn = jest.fn().mockReturnValue('beta');
      const existing = {};
      const moduleResolvers = [
        { moduleName: 'alpha-module', resolvers: { Query: { shared: alphaFn } } },
        { moduleName: 'beta-module', resolvers: { Query: { shared: betaFn } } },
      ];

      const result = service.mergeModuleResolvers(existing, moduleResolvers);

      // Invoke the wrapped resolver and verify alpha's result wins
      const value = await result.Query.shared({}, {}, authedContext, {});
      expect(value).toBe('alpha');
      expect(alphaFn).toHaveBeenCalled();
      expect(betaFn).not.toHaveBeenCalled();
    });

    it('should merge resolvers from multiple non-conflicting modules', () => {
      const existing = {};
      const moduleResolvers = [
        { moduleName: 'module-a', resolvers: { Query: { fieldA: jest.fn() } } },
        { moduleName: 'module-b', resolvers: { Mutation: { fieldB: jest.fn() } } },
        { moduleName: 'module-c', resolvers: { Query: { fieldC: jest.fn() } } },
      ];

      const result = service.mergeModuleResolvers(existing, moduleResolvers);

      expect(result.Query.fieldA).toBeDefined();
      expect(result.Query.fieldC).toBeDefined();
      expect(result.Mutation.fieldB).toBeDefined();
    });

    it('should return existing resolvers unchanged when no module resolvers provided', () => {
      const existingFn = jest.fn();
      const existing = { Query: { field: existingFn } };

      const result = service.mergeModuleResolvers(existing, []);

      expect(result.Query.field).toBe(existingFn);
    });

    it('should not mutate the input existing resolvers map', () => {
      const existing = { Query: { field: jest.fn() } };
      const originalKeys = Object.keys(existing.Query);

      service.mergeModuleResolvers(existing, [
        { moduleName: 'mod', resolvers: { Query: { newField: jest.fn() } } },
      ]);

      // Original map should be unchanged
      expect(Object.keys(existing.Query)).toEqual(originalKeys);
      expect((existing.Query as any).newField).toBeUndefined();
    });
  });

  describe('wrapModuleResolver — auth enforcement', () => {
    it('should throw UNAUTHENTICATED when context has no verified user', async () => {
      const moduleResolvers = [
        {
          moduleName: 'test-module',
          resolvers: { Query: { myField: jest.fn().mockReturnValue('result') } },
        },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const wrappedResolver = result.Query.myField;

      await expect(
        wrappedResolver({}, {}, noAuthContext, {}),
      ).rejects.toThrow('Authentication required');

      try {
        await wrappedResolver({}, {}, noAuthContext, {});
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
      }
    });

    it('should pass auth check when a verified user is present', async () => {
      const innerFn = jest.fn().mockReturnValue('ok');
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);

      const value = await result.Query.f({}, {}, authedContext, {});

      expect(value).toBe('ok');
      expect(innerFn).toHaveBeenCalledWith({}, {}, authedContext, {});
    });

    // Regression: a raw token string alone (no verified user) must NOT pass.
    // context.token still holds the unverified bearer, so gating on it would
    // reopen the bypass.
    it('should REJECT when only a raw token string is present (no verified user)', async () => {
      const innerFn = jest.fn().mockReturnValue('ok');
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const tokenOnlyContext = { token: 'unverified-bearer-string', driver: {} } as GraphQLContext;

      await expect(
        result.Query.f({}, {}, tokenOnlyContext, {}),
      ).rejects.toThrow('Authentication required');
      expect(innerFn).not.toHaveBeenCalled();
    });

    it('should reject when a jwt payload is present but no verified user', async () => {
      const innerFn = jest.fn().mockReturnValue('ok');
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const jwtOnlyContext = { jwt: { sub: 'x' }, driver: {} } as GraphQLContext;

      await expect(
        result.Query.f({}, {}, jwtOnlyContext, {}),
      ).rejects.toThrow('Authentication required');
      expect(innerFn).not.toHaveBeenCalled();
    });

    it('should skip the gate entirely in effective-NOAUTH config (non-prod, no OIDC, ENABLE_NOAUTH)', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const noauthConfigService = {
          get: jest.fn((key: string) =>
            key === 'gql'
              ? {
                  oidcJwksUri: '',
                  enableSubscriptions: false,
                  enableNoauth: true,
                  queryDepthLimit: 10,
                  queryComplexityLimit: 1000,
                }
              : undefined,
          ),
        };
        const noauthModule: TestingModule = await Test.createTestingModule({
          providers: [
            SchemaService,
            { provide: ConfigService, useValue: noauthConfigService },
            { provide: 'NEO4J_DRIVER', useValue: mockNeo4jDriver },
          ],
        }).compile();
        const noauthService = noauthModule.get<SchemaService>(SchemaService);

        const innerFn = jest.fn().mockReturnValue('ok');
        const result = noauthService.mergeModuleResolvers({}, [
          { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
        ]);

        // No verified user in context, but the gate is skipped in NOAUTH mode.
        const value = await result.Query.f({}, {}, noAuthContext, {});
        expect(value).toBe('ok');
        expect(innerFn).toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('wrapModuleResolver — error handling', () => {
    it('should wrap resolver errors in GraphQLError with MODULE_RESOLVER_ERROR code', async () => {
      const failingFn = jest.fn().mockRejectedValue(new Error('boom'));
      const moduleResolvers = [
        { moduleName: 'test-module', resolvers: { Query: { f: failingFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);

      try {
        await result.Query.f({}, {}, authedContext, {});
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).extensions?.code).toBe('MODULE_RESOLVER_ERROR');
        expect((error as GraphQLError).extensions?.moduleName).toBe('test-module');
      }
    });

    it('should include originalMessage in non-production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const failingFn = jest.fn().mockRejectedValue(new Error('internal details'));
        const moduleResolvers = [
          { moduleName: 'test', resolvers: { Query: { f: failingFn } } },
        ];

        const result = service.mergeModuleResolvers({}, moduleResolvers);

        try {
          await result.Query.f({}, {}, authedContext, {});
          fail('Should have thrown');
        } catch (error) {
          expect((error as GraphQLError).extensions?.originalMessage).toBe('internal details');
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should NOT include originalMessage in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const failingFn = jest.fn().mockRejectedValue(new Error('secret info'));
        const moduleResolvers = [
          { moduleName: 'test', resolvers: { Query: { f: failingFn } } },
        ];

        const result = service.mergeModuleResolvers({}, moduleResolvers);

        try {
          await result.Query.f({}, {}, authedContext, {});
          fail('Should have thrown');
        } catch (error) {
          expect((error as GraphQLError).extensions?.originalMessage).toBeUndefined();
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('wrapModuleResolver — upstream refusal mapping', () => {
    const MODULE = 'test-module';

    /** Mount one failing resolver under `MODULE` and return the wrapped field. */
    const wrapRejectingWith = (error: unknown) => {
      const failingFn = jest.fn().mockRejectedValue(error);
      const result = service.mergeModuleResolvers({}, [
        { moduleName: MODULE, resolvers: { Query: { f: failingFn } } },
      ]);
      return result.Query.f;
    };

    // NEW BEHAVIOUR. A module that reaches out to a service of its own can be
    // refused for a reason the caller can act on. In production the extensions
    // code is the only field that survives formatError, so flattening a 401 to
    // MODULE_RESOLVER_ERROR sends an operator to investigate the platform when
    // the caller simply needs to re-authenticate.
    it.each([
      ['token_expired', () => new CloudSessionExpiredError('token_expired')],
      ['invalid_token (the constructor default)', () => new CloudSessionExpiredError()],
    ])(
      'should map a CloudSessionExpiredError carrying %s to UNAUTHENTICATED',
      async (_label, makeError) => {
        const error = await captureResolverError(wrapRejectingWith(makeError()));

        expect(error).toBeInstanceOf(GraphQLError);
        expect(error.extensions?.code).toBe('UNAUTHENTICATED');
        // The module attribution must survive the remap — an operator still
        // needs to know which mount refused.
        expect(error.extensions?.moduleName).toBe(MODULE);
        // The token belongs in extensions.code and NOWHERE ELSE: a downstream
        // helper substring-matches error messages for 'UNAUTHENTICATED', so
        // spelling it in the message would make every module error look like an
        // auth failure.
        expect(error.message).toBe('Authentication required');
        expect(error.message).not.toContain('UNAUTHENTICATED');
      },
    );

    // UNCHANGED BEHAVIOUR. The allowlist is deliberately two codes wide: an
    // entitlement denial, an unreachable service and a bad pin are operator
    // problems, not credential problems. This table is what stops the allowlist
    // being widened by accident — each case constructs the real taxonomy class,
    // so its `code` value is the one production actually sees.
    it.each<[string, () => Error]>([
      ['a plain Error with no code at all', () => new Error('boom')],
      ["EvaluationNotEntitledError ('not_entitled')", () => new EvaluationNotEntitledError()],
      ["RemoteModuleUnavailableError ('unavailable')", () => new RemoteModuleUnavailableError()],
      ["ContentRecalledError ('version_recalled')", () => new ContentRecalledError()],
      [
        "RemoteModuleMisconfiguredError ('internal')",
        () => new RemoteModuleMisconfiguredError(undefined, 'internal'),
      ],
    ])('should still report MODULE_RESOLVER_ERROR for %s', async (_label, makeError) => {
      const error = await captureResolverError(wrapRejectingWith(makeError()));

      expect(error).toBeInstanceOf(GraphQLError);
      expect(error.extensions?.code).toBe('MODULE_RESOLVER_ERROR');
      expect(error.extensions?.moduleName).toBe(MODULE);
    });

    // PROTOTYPE-LOOKUP GUARD. `code` arrives from module code, so it is
    // attacker- or accident-controlled. The allowlist is a Map for exactly this
    // reason: a plain-object lookup on 'constructor' or 'toString' returns a
    // truthy Object.prototype member, and the wrapper would hand a nonsense
    // code the UNAUTHENTICATED mapping. If anyone ever "simplifies" the Map to
    // an object literal, these two cases go red.
    it.each(['constructor', 'toString'])(
      'should still report MODULE_RESOLVER_ERROR for an error whose code is the prototype member %p',
      async (hostileCode) => {
        const error = await captureResolverError(
          wrapRejectingWith(Object.assign(new Error('boom'), { code: hostileCode })),
        );

        expect(error.extensions?.code).toBe('MODULE_RESOLVER_ERROR');
      },
    );

    // ORDERING PIN. The timeout branch is a substring test on a message the
    // upstream service controls. The refusal lookup therefore runs first and
    // short-circuits it (`const isTimeout = !refusalCode && ...`); drop that
    // guard and a 401 whose text happens to mention a timeout gets reported as
    // our own MODULE_RESOLVER_TIMEOUT, telling the caller to retry a request
    // that can only ever succeed after re-authenticating.
    it('should map a refusal whose message mentions a timeout to UNAUTHENTICATED', async () => {
      const error = await captureResolverError(
        wrapRejectingWith(
          new CloudSessionExpiredError('invalid_token', 'upstream timeout while validating the token'),
        ),
      );

      expect(error.extensions?.code).toBe('UNAUTHENTICATED');
      expect(error.extensions?.code).not.toBe('MODULE_RESOLVER_TIMEOUT');
      expect(error.message).toBe('Authentication required');
    });
  });

  describe('wrapModuleResolver — timeout', () => {
    // Snapshot the real timer globals before faking. On Jest 30 + recent Node,
    // jest.useRealTimers() restores setTimeout but not the global clearTimeout,
    // leaking a broken clearTimeout into later suites (the success-path tests
    // call it). Restore both explicitly so the leak can't escape this block.
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
    });

    it('should timeout after MODULE_RESOLVER_TIMEOUT_MS', async () => {
      let rejectHanging: (reason?: any) => void;
      const neverResolves = jest.fn(
        () => new Promise((_resolve, reject) => { rejectHanging = reject; }),
      );
      const moduleResolvers = [
        { moduleName: 'slow-module', resolvers: { Query: { f: neverResolves } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);

      const promise = result.Query.f({}, {}, authedContext, {});

      // Advance past the 30s timeout
      jest.advanceTimersByTime(30_001);

      try {
        await promise;
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GraphQLError);
        expect((error as GraphQLError).extensions?.code).toBe('MODULE_RESOLVER_TIMEOUT');
      }

      // Clean up the hanging promise to avoid worker leak
      rejectHanging!(new Error('cleanup'));
    });
  });

  describe('wrapModuleResolver — success path', () => {
    it('should return the resolver result on success', async () => {
      const innerFn = jest.fn().mockResolvedValue({ data: 'hello' });
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const context = authedContext;
      const args = { id: '123' };
      const parent = { parentField: 'val' };

      const value = await result.Query.f(parent, args, context, {});

      expect(value).toEqual({ data: 'hello' });
      expect(innerFn).toHaveBeenCalledWith(parent, args, context, {});
    });

    it('should handle synchronous return values', async () => {
      const innerFn = jest.fn().mockReturnValue(42);
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const value = await result.Query.f({}, {}, authedContext, {});

      expect(value).toBe(42);
    });
  });
});
