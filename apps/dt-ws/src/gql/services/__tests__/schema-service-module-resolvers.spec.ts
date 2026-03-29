import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchemaService } from '../schema.service';
import { GraphQLError } from 'graphql';
import { GraphQLContext } from '../../interfaces/resolver.interface';

/** Minimal context with auth for tests */
const authedContext = { jwt: 'valid-token', driver: {} } as GraphQLContext;
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
    it('should throw UNAUTHENTICATED when context has no jwt or token', async () => {
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

    it('should pass auth check when jwt is present', async () => {
      const innerFn = jest.fn().mockReturnValue('ok');
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);

      const value = await result.Query.f({}, {}, authedContext, {});

      expect(value).toBe('ok');
      expect(innerFn).toHaveBeenCalledWith({}, {}, authedContext, {});
    });

    it('should pass auth check when token is present (no jwt)', async () => {
      const innerFn = jest.fn().mockReturnValue('ok');
      const moduleResolvers = [
        { moduleName: 'test', resolvers: { Query: { f: innerFn } } },
      ];

      const result = service.mergeModuleResolvers({}, moduleResolvers);
      const tokenContext = { token: 'bearer-token', driver: {} } as GraphQLContext;

      const value = await result.Query.f({}, {}, tokenContext, {});

      expect(value).toBe('ok');
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

  describe('wrapModuleResolver — timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
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
