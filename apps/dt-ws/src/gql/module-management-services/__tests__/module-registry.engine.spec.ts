import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../../../database/database.service';
import { ModuleRegistryService } from '../module-registry.service';
import { ModuleManagementService } from '../module-management.service';

/**
 * The engine a module reads from its resolver context is the platform's own
 * strict probe: every module gets its answer, and a failed probe reaches the
 * module as a rejection — never a silent Memgraph default.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtws-module-engine-'));

for (const name of ['engine-module-a', 'engine-module-b']) {
  const field = name.replace(/-/g, '_');
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'EngineModule.js'), `
    exports.default = class {
      async getMetadata() { return { name: '${name}', version: '1.0.0' }; }
      async getSchemaExtension() { return 'extend type Query { ${field}: String }'; }
      async getResolvers(context) {
        (globalThis.__engineContexts ||= []).push(context);
        return { Query: { ${field}: () => 'ok' } };
      }
    };
  `);
}

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
    return undefined;
  }),
};

const mockModuleManagementService = {
  updateAllModules: jest.fn().mockResolvedValue(undefined),
  getModuleInfoById: jest.fn(),
  resetSingleModule: jest.fn(),
};

describe('ModuleRegistryService — engine in the resolver context', () => {
  const getEngineInfoStrict = jest.fn();
  let contexts: any[];

  beforeEach(async () => {
    (globalThis as any).__engineContexts = [];
    getEngineInfoStrict.mockReset();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleRegistryService,
        { provide: 'NEO4J_DRIVER', useValue: { session: jest.fn() } },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ModuleManagementService, useValue: mockModuleManagementService },
        { provide: DatabaseService, useValue: { getEngineInfoStrict } },
      ],
    }).compile();
    const service = moduleRef.get<ModuleRegistryService>(ModuleRegistryService);
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn((service as any).logger, level).mockImplementation(() => {});
    }
    await service.loadModules();
    contexts = (globalThis as any).__engineContexts;
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("answers every module from the platform's probe", async () => {
    const info = Object.freeze({ engine: 'neo4j', edition: 'community', version: '5.26.0' });
    getEngineInfoStrict.mockResolvedValue(info);
    expect(contexts).toHaveLength(2);

    await expect(contexts[0].getEngine()).resolves.toBe(info);
    await expect(contexts[1].getEngine()).resolves.toBe(info);
  });

  it('passes a failed probe through as a rejection', async () => {
    getEngineInfoStrict.mockRejectedValue(new Error('db unreachable'));
    await expect(contexts[0].getEngine()).rejects.toThrow('db unreachable');
  });
});
