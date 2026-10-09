import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleRegistryService } from '../module-registry.service';
import { ModuleManagementService } from '../module-management.service';

/**
 * A module whose getMetadata() throws at load (a LangGraph-backed module with LangGraph unreachable)
 * is still loaded: its schema fragment and resolvers are registered under its directory name, without
 * retries. Class install stays skipped (the install path re-calls getMetadata() and skips on a throw).
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtws-metadata-unavailable-'));

function writeModule(dir: string, file: string, source: string): string {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  const filePath = path.join(root, dir, file);
  fs.writeFileSync(filePath, source);
  return filePath;
}

const UNAVAILABLE = writeModule('lg-down-module', 'LgDownModule.js', `
  globalThis.__lgDownMetadataCalls = 0;
  exports.default = class {
    async getMetadata() {
      globalThis.__lgDownMetadataCalls++;
      throw new Error('Unable to connect to LangGraph server');
    }
    async getSchemaExtension() { return 'extend type Query { lgDownPing: String }'; }
    async getResolvers() { return { Query: { lgDownPing: () => 'pong' } }; }
  };
`);

const HEALTHY = writeModule('healthy-module', 'HealthyModule.js', `
  exports.default = class {
    async getMetadata() { return { name: 'healthy-module', version: '1.2.3' }; }
  };
`);

const NO_METADATA = writeModule('no-metadata-module', 'NoMetadataModule.js', `
  exports.default = class {};
`);

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
        customModulesPath: root,
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

describe('ModuleRegistryService — module metadata unavailable at load', () => {
  let service: ModuleRegistryService;

  beforeEach(async () => {
    (globalThis as any).__lgDownMetadataCalls = 0;
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleRegistryService,
        { provide: 'NEO4J_DRIVER', useValue: mockNeo4jDriver },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ModuleManagementService, useValue: mockModuleManagementService },
      ],
    }).compile();

    service = moduleRef.get<ModuleRegistryService>(ModuleRegistryService);
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn((service as any).logger, level).mockImplementation(() => {});
    }
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('loads the module with fallback metadata named after its directory', async () => {
    const loaded = await (service as any).loadModuleInternal(UNAVAILABLE, true, false);

    expect(loaded.metadata).toEqual({ name: 'lg-down-module', version: 'unknown' });
    expect(loaded.metadataUnavailable).toBe(true);
  });

  it('does not retry: getMetadata() is called once', async () => {
    const result = await (service as any).loadModuleWithRetry(UNAVAILABLE, { skipSecurityValidation: true });

    expect(result.success).toBe(true);
    expect(result.metadataUnavailable).toBe(true);
    expect((globalThis as any).__lgDownMetadataCalls).toBe(1);
  });

  it('registers its schema fragment and resolvers, and marks the entry', async () => {
    await service.loadModules();

    const entry = (service as any).customModules.get('lg-down-module');
    expect(entry).toBeDefined();
    expect(entry.metadataUnavailable).toBe(true);
    expect(entry.schemaFragment).toContain('lgDownPing');
    expect(Object.keys(entry.resolverMap?.Query ?? {})).toEqual(['lgDownPing']);
  });

  it('still rejects a module without getMetadata()', async () => {
    await expect((service as any).loadModuleInternal(NO_METADATA, true, false))
      .rejects.toThrow('Module does not implement required DTModule interface');
  });

  it('leaves a module whose metadata resolves unchanged', async () => {
    const loaded = await (service as any).loadModuleInternal(HEALTHY, true, false);

    expect(loaded.metadata).toEqual({ name: 'healthy-module', version: '1.2.3' });
    expect(loaded.metadataUnavailable).toBeUndefined();
  });
});
