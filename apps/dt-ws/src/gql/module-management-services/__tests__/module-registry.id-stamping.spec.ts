import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-registry.service';
import { ModuleManagementService } from '../module-management.service';
import { DTMetadata, DTModule, deriveClassId } from '@dethernety/dt-module';

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

/** Builds a stub DTModule whose `getMetadata()` resolves to the supplied metadata. */
function moduleReturning(metadata: DTMetadata): DTModule {
  return {
    getMetadata: jest.fn().mockResolvedValue(metadata),
  } as unknown as DTModule;
}

describe('ModuleRegistryService — id stamping', () => {
  let service: ModuleRegistryService;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleRegistryService,
        { provide: 'NEO4J_DRIVER', useValue: mockNeo4jDriver },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ModuleManagementService, useValue: mockModuleManagementService },
      ],
    }).compile();

    service = moduleRef.get<ModuleRegistryService>(ModuleRegistryService);
    warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  const validate = (mod: DTModule): Promise<boolean> =>
    (service as any).validateModuleInterface(mod);

  describe('happy paths', () => {
    it('passes when every class entry already has id (no stamping)', async () => {
      const metadata: DTMetadata = {
        name: 'fully-typed',
        componentClasses: [
          { id: 'fixed-1', name: 'A', type: 'STORE', category: 'x' } as any,
          { id: 'fixed-2', name: 'B', type: 'PROCESS', category: 'y' } as any,
        ],
      };
      await expect(validate(moduleReturning(metadata))).resolves.toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('passes with no class arrays at all', async () => {
      await expect(validate(moduleReturning({ name: 'bare' }))).resolves.toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('passes with empty class arrays', async () => {
      const metadata: DTMetadata = {
        name: 'empty-arrays',
        componentClasses: [],
        controlClasses: [],
      };
      await expect(validate(moduleReturning(metadata))).resolves.toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('backwards-compat fallback (legacy modules without id)', () => {
    it('stamps deriveClassId on missing-id entries and emits one deprecation warning', async () => {
      const metadata: DTMetadata = {
        name: 'legacy',
        componentClasses: [
          { name: 'NAS Appliance' } as any,
          { name: 'Switch' } as any,
        ],
        controlClasses: [
          { name: 'Some Control' } as any,
        ],
      };

      await expect(validate(moduleReturning(metadata))).resolves.toBe(true);

      expect(metadata.componentClasses![0].id).toBe(
        deriveClassId('legacy', 'componentClasses', 'NAS Appliance'),
      );
      expect(metadata.componentClasses![1].id).toBe(
        deriveClassId('legacy', 'componentClasses', 'Switch'),
      );
      expect(metadata.controlClasses![0].id).toBe(
        deriveClassId('legacy', 'controlClasses', 'Some Control'),
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg, ctx] = warnSpy.mock.calls[0];
      expect(msg).toContain('returned 3 class entries without id');
      expect(ctx).toEqual({ module: 'legacy', stampedCount: 3 });
    });

    it('preserves existing ids when only some entries are missing id', async () => {
      const metadata: DTMetadata = {
        name: 'mixed',
        componentClasses: [
          { id: 'preset-1', name: 'A' } as any,
          { name: 'B' } as any,
        ],
      };

      await expect(validate(moduleReturning(metadata))).resolves.toBe(true);

      expect(metadata.componentClasses![0].id).toBe('preset-1');
      expect(metadata.componentClasses![1].id).toBe(
        deriveClassId('mixed', 'componentClasses', 'B'),
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual({ module: 'mixed', stampedCount: 1 });
    });
  });

  describe('hard failures', () => {
    it('rejects metadata with no name', async () => {
      await expect(validate(moduleReturning({} as DTMetadata))).resolves.toBe(false);
    });

    it('rejects when a class entry omits name (no derivation key)', async () => {
      const metadata: DTMetadata = {
        name: 'broken',
        componentClasses: [
          { name: 'A', id: 'x' } as any,
          { id: 'y' } as any, // missing name
        ],
      };
      await expect(validate(moduleReturning(metadata))).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        'Module class entry missing name',
        expect.objectContaining({ module: 'broken', kind: 'componentClasses' }),
      );
    });

    it('rejects when getMetadata is missing', async () => {
      const broken = {} as DTModule;
      await expect(validate(broken)).resolves.toBe(false);
    });

    it('rejects when getMetadata throws', async () => {
      const exploding = {
        getMetadata: jest.fn().mockRejectedValue(new Error('aegra unreachable')),
      } as unknown as DTModule;
      await expect(validate(exploding)).resolves.toBe(false);
    });
  });
});
