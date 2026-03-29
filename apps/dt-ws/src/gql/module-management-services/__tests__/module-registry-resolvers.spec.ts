import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-registry.service';
import { ModuleManagementService } from '../module-management.service';

const mockNeo4jDriver = {
  session: jest.fn().mockReturnValue({
    run: jest.fn().mockResolvedValue({ records: [] }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'gql') {
      return {
        customModulesPath: 'custom_modules',
        allowedModules: ['*'],
        enableModuleSecurityValidation: false,
        enableModuleHotReload: false,
        moduleLoadTimeout: 30000,
      };
    }
    if (key === 'database.name') return 'neo4j';
    return undefined;
  }),
};

const mockModuleManagementService = {
  updateAllModules: jest.fn().mockResolvedValue(undefined),
  getModuleInfoById: jest.fn(),
  resetSingleModule: jest.fn(),
};

describe('ModuleRegistryService — Resolver Validation', () => {
  let service: ModuleRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleRegistryService,
        { provide: 'NEO4J_DRIVER', useValue: mockNeo4jDriver },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ModuleManagementService, useValue: mockModuleManagementService },
      ],
    }).compile();

    service = module.get<ModuleRegistryService>(ModuleRegistryService);
  });

  describe('validateModuleResolvers', () => {
    const validate = (moduleName: string, sdl: string, resolverMap: any) =>
      (service as any).validateModuleResolvers(moduleName, sdl, resolverMap);

    it('should accept resolvers that match SDL declarations', () => {
      const sdl = 'extend type Query { myField: String }';
      const resolverMap = {
        Query: { myField: jest.fn() },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query).toBeDefined();
      expect(result.Query.myField).toBe(resolverMap.Query.myField);
    });

    it('should accept resolvers for custom types declared in SDL', () => {
      const sdl = `
        type OpaResult { exposures: [String], errors: [String] }
        extend type Query { evaluate: OpaResult }
      `;
      const resolverMap = {
        Query: { evaluate: jest.fn() },
        OpaResult: { exposures: jest.fn() },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query.evaluate).toBeDefined();
      expect(result.OpaResult.exposures).toBeDefined();
    });

    it('should skip resolvers for fields not declared in SDL', () => {
      const sdl = 'extend type Query { myField: String }';
      const resolverMap = {
        Query: {
          myField: jest.fn(),
          undeclaredField: jest.fn(),
        },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query.myField).toBeDefined();
      expect(result.Query.undeclaredField).toBeUndefined();
    });

    it('should skip non-function resolver entries', () => {
      const sdl = 'extend type Query { myField: String }';
      const resolverMap = {
        Query: { myField: 'not a function' },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query).toBeUndefined();
    });

    it('should skip Subscription resolvers entirely', () => {
      const sdl = `
        extend type Query { myField: String }
        extend type Subscription { onUpdate: String }
      `;
      const resolverMap = {
        Query: { myField: jest.fn() },
        Subscription: { onUpdate: jest.fn() },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query.myField).toBeDefined();
      expect(result.Subscription).toBeUndefined();
    });

    it('should return empty map when all entries are invalid', () => {
      const sdl = 'extend type Query { myField: String }';
      const resolverMap = {
        Query: { wrongField: jest.fn() },
        Mutation: { alsoWrong: jest.fn() },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle partial validity — keep valid, skip invalid', () => {
      const sdl = `
        extend type Query { fieldA: String, fieldB: Int }
      `;
      const resolverMap = {
        Query: {
          fieldA: jest.fn(),
          fieldB: 'not a function',
          fieldC: jest.fn(), // not declared
        },
      };

      const result = validate('test-module', sdl, resolverMap);

      expect(result.Query.fieldA).toBeDefined();
      expect(result.Query.fieldB).toBeUndefined();
      expect(result.Query.fieldC).toBeUndefined();
    });
  });

  describe('validateModuleSDL', () => {
    const validateSDL = (moduleName: string, sdl: string) =>
      (service as any).validateModuleSDL(moduleName, sdl);

    it('should accept safe extend type declarations', () => {
      const sdl = `
        type CustomResult { value: String }
        extend type Query { myQuery: CustomResult }
        extend type Mutation { myMutation: Boolean }
      `;

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject redefinition of @authentication directive', () => {
      const sdl = 'directive @authentication on FIELD_DEFINITION';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('@authentication');
    });

    it('should reject redefinition of other protected directives', () => {
      const sdl = 'directive @cypher(statement: String) on FIELD_DEFINITION';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('@cypher');
    });

    it('should allow custom (non-protected) directive definitions', () => {
      const sdl = `
        directive @myCustomDirective on FIELD_DEFINITION
        extend type Query { myField: String }
      `;

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(true);
    });

    it('should reject schema definition/extension', () => {
      const sdl = 'schema { query: MyQuery }';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Schema definition/extension');
    });

    it('should reject bare type Query (non-extension)', () => {
      const sdl = 'type Query { myField: String }';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("'type Query'");
    });

    it('should reject bare type Mutation (non-extension)', () => {
      const sdl = 'type Mutation { myMutation: Boolean }';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("'type Mutation'");
    });

    it('should reject bare type Subscription (non-extension)', () => {
      const sdl = 'type Subscription { onUpdate: String }';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
    });

    it('should allow bare custom type definitions', () => {
      const sdl = 'type MyCustomType { field: String }';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(true);
    });

    it('should return error for unparseable SDL', () => {
      const sdl = 'not valid graphql {{{}}}';

      const result = validateSDL('test-module', sdl);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('SDL parse error');
    });

    it('should reject all resolvers when SDL has directive redefinition', () => {
      const sdl = `
        directive @authentication on FIELD_DEFINITION
        extend type Query { myField: String }
      `;
      const resolverMap = {
        Query: { myField: jest.fn() },
      };

      const result = (service as any).validateModuleResolvers('test', sdl, resolverMap);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('getModuleResolvers', () => {
    it('should return empty array when no modules have resolvers', () => {
      const result = service.getModuleResolvers();
      expect(result).toEqual([]);
    });

    it('should return resolvers sorted by module name', () => {
      // Manually populate customModules for testing
      const modules = (service as any).customModules as Map<string, any>;
      const resolverFn = jest.fn();

      modules.set('zebra-module', {
        isHealthy: true,
        resolverMap: { Query: { zebra: resolverFn } },
      });
      modules.set('alpha-module', {
        isHealthy: true,
        resolverMap: { Query: { alpha: resolverFn } },
      });
      modules.set('middle-module', {
        isHealthy: true,
        // No resolverMap
      });

      const result = service.getModuleResolvers();

      expect(result).toHaveLength(2);
      expect(result[0].moduleName).toBe('alpha-module');
      expect(result[1].moduleName).toBe('zebra-module');
    });

    it('should exclude unhealthy modules', () => {
      const modules = (service as any).customModules as Map<string, any>;
      const resolverFn = jest.fn();

      modules.set('healthy-module', {
        isHealthy: true,
        resolverMap: { Query: { field: resolverFn } },
      });
      modules.set('unhealthy-module', {
        isHealthy: false,
        resolverMap: { Query: { field: resolverFn } },
      });

      const result = service.getModuleResolvers();

      expect(result).toHaveLength(1);
      expect(result[0].moduleName).toBe('healthy-module');
    });
  });
});
