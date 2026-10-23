import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { ModuleRegistryService } from '../module-registry.service';
import { ModuleManagementService } from '../module-management.service';

/**
 * The registry reads each module's frontend once, at load and at reload, and serves only what it
 * holds: the manifest query and the bundle lookup never touch the disk, and a reload replaces the
 * bytes and the hash together.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtws-registry-frontend-'));
const sha256 = (data: string) =>
  createHash('sha256').update(data).digest('hex');
const BUNDLE_V1 = 'export default { install() {} };\n';
const BUNDLE_V2 = 'export default { install() { /* v2 */ } };\n';

function writeModule(
  name: string,
  frontend?: { bundle?: string; manifest?: object },
): void {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ReportModule.js'),
    `exports.default = class { async getMetadata() { return { name: '${name}', version: '1.0.0' }; } };`,
  );
  if (frontend?.bundle !== undefined)
    fs.writeFileSync(path.join(dir, 'frontend', 'bundle.js'), frontend.bundle);
  if (frontend?.manifest !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'frontend', 'frontend-manifest.json'),
      JSON.stringify(frontend.manifest),
    );
  }
}

const manifest = (key: string) => ({
  manifestVersion: 1,
  components: [key],
  hostApi: { min: 1, max: 1 },
});

writeModule('report-module', {
  bundle: BUNDLE_V1,
  manifest: manifest('report_dashboard'),
});
writeModule('legacy-module', { bundle: BUNDLE_V1 });
writeModule('blocked-module', {
  bundle: BUNDLE_V1,
  manifest: manifest('blocked_view'),
});
writeModule('backend-module');

function configService(allowedModules: string[]) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'gql') {
        return {
          customModulesPath: root,
          allowedModules,
          enableModuleSecurityValidation: false,
          enableModuleHotReload: true,
          moduleLoadTimeout: 1000,
        };
      }
      if (key === 'database.name') return 'neo4j';
      return undefined;
    }),
  };
}

async function registry(
  allowedModules: string[] = ['*'],
): Promise<ModuleRegistryService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ModuleRegistryService,
      { provide: 'NEO4J_DRIVER', useValue: { session: jest.fn() } },
      { provide: ConfigService, useValue: configService(allowedModules) },
      {
        provide: ModuleManagementService,
        useValue: { updateAllModules: jest.fn() },
      },
    ],
  }).compile();
  const service = moduleRef.get(ModuleRegistryService);
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn((service as any).logger, level).mockImplementation(() => {});
  }
  await service.loadModules();
  return service;
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ModuleRegistryService — module frontends', () => {
  it('lists the modules with a valid frontend, and keeps the others loaded', async () => {
    const service = await registry();
    const row = (name: string, key: string) => ({
      name,
      version: '1.0.0',
      available: true,
      hash: sha256(BUNDLE_V1),
      size: BUNDLE_V1.length,
      url: `/module-bundles/${name}/${sha256(BUNDLE_V1)}/bundle.js`,
      components: [key],
      hostApi: { min: 1, max: 1 },
    });
    expect(service.getFrontendManifests()).toEqual([
      row('blocked-module', 'blocked_view'),
      row('report-module', 'report_dashboard'),
    ]);
    expect([...service.getAllModuleEntries().keys()].sort()).toEqual([
      'backend-module',
      'blocked-module',
      'legacy-module',
      'report-module',
    ]);
  });

  it('logs a bundle without its manifest by module name, and does not serve it', async () => {
    const service = await registry();
    expect((service as any).logger.error).toHaveBeenCalledWith(
      'Module frontend not loaded',
      {
        moduleName: 'legacy-module',
        reason: 'frontend/bundle.js without frontend/frontend-manifest.json',
      },
    );
    expect(
      service.findFrontendBundle('legacy-module', sha256(BUNDLE_V1)),
    ).toEqual({ status: 404 });
  });

  it('refuses a module outside the module allow-list in both the query and the lookup', async () => {
    const service = await registry(['report-*', 'legacy-*', 'backend-*']);
    expect(service.getFrontendManifests().map((m) => m.name)).toEqual([
      'report-module',
    ]);
    expect(
      service.findFrontendBundle('blocked-module', sha256(BUNDLE_V1)),
    ).toEqual({ status: 404 });
    expect(
      service.findFrontendBundle('report-module', sha256(BUNDLE_V1)).status,
    ).toBe(200);
  });

  it('serves 503 while the module is unhealthy, and lists it as unavailable', async () => {
    const service = await registry();
    // getAllModuleEntries copies the map, not the entries: this is the registry's own entry.
    service.getAllModuleEntries().get('report-module')!.isHealthy = false;
    expect(
      service.findFrontendBundle('report-module', sha256(BUNDLE_V1)),
    ).toEqual({ status: 503 });
    expect(
      service.getFrontendManifests().find((m) => m.name === 'report-module')
        ?.available,
    ).toBe(false);
  });

  it('serves the bytes it read at load until a reload, then the new bytes under the new hash only', async () => {
    const service = await registry();
    const bundlePath = path.join(
      root,
      'report-module',
      'frontend',
      'bundle.js',
    );
    fs.writeFileSync(bundlePath, BUNDLE_V2);
    try {
      const before = service.findFrontendBundle(
        'report-module',
        sha256(BUNDLE_V1),
      );
      expect(
        before.status === 200 && before.asset.bodies.identity.toString(),
      ).toBe(BUNDLE_V1);
      expect(
        service.findFrontendBundle('report-module', sha256(BUNDLE_V2)),
      ).toEqual({ status: 404 });

      await service.reloadModule('report-module');

      expect(
        service.findFrontendBundle('report-module', sha256(BUNDLE_V1)),
      ).toEqual({ status: 404 });
      const after = service.findFrontendBundle(
        'report-module',
        sha256(BUNDLE_V2),
      );
      expect(
        after.status === 200 && after.asset.bodies.identity.toString(),
      ).toBe(BUNDLE_V2);
      expect(
        service.getFrontendManifests().find((m) => m.name === 'report-module')
          ?.hash,
      ).toBe(sha256(BUNDLE_V2));
    } finally {
      fs.writeFileSync(bundlePath, BUNDLE_V1);
    }
  });

  it('keeps the old instance and its frontend together when the module itself fails to reload', async () => {
    const service = await registry();
    const modulePath = path.join(root, 'report-module', 'ReportModule.js');
    const hiddenPath = path.join(root, 'report-module', 'Report.js.hidden');
    const bundlePath = path.join(
      root,
      'report-module',
      'frontend',
      'bundle.js',
    );
    const before = service.getAllModuleEntries().get('report-module');
    // The reload finds no module file to load, so it fails before touching the entry.
    fs.renameSync(modulePath, hiddenPath);
    fs.writeFileSync(bundlePath, BUNDLE_V2);
    try {
      expect(await service.reloadModule('report-module')).toBeNull();
      expect(service.getAllModuleEntries().get('report-module')).toBe(before);
      expect(
        service.findFrontendBundle('report-module', sha256(BUNDLE_V1)).status,
      ).toBe(200);
      expect(
        service.findFrontendBundle('report-module', sha256(BUNDLE_V2)),
      ).toEqual({ status: 404 });
    } finally {
      fs.renameSync(hiddenPath, modulePath);
      fs.writeFileSync(bundlePath, BUNDLE_V1);
    }
  });

  it('drops the frontend on a reload that finds it invalid', async () => {
    const service = await registry();
    const manifestPath = path.join(
      root,
      'report-module',
      'frontend',
      'frontend-manifest.json',
    );
    fs.writeFileSync(manifestPath, '{ not json');
    try {
      await service.reloadModule('report-module');
      expect(
        service.findFrontendBundle('report-module', sha256(BUNDLE_V1)),
      ).toEqual({ status: 404 });
      expect(
        service.getAllModuleEntries().get('report-module')?.isHealthy,
      ).toBe(true);
    } finally {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(manifest('report_dashboard')),
      );
    }
  });
});
