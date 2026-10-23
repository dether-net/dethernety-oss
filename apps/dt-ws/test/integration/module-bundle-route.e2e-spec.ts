// Module bundle route — authentication and both allow-lists (e2e).
//
// GET /module-bundles/:name/:hash/bundle.js through the real JwtAuthGuard, the real
// ModuleBundleController and the real ModuleRegistryService, loading a module from a temp
// directory. No database: the registry's driver is never used on this path.
//
// It runs OFFLINE: tokens are HS256-signed, and the guard's RS256/JWKS validateToken is spied to
// verify them with the same secret, leaving canActivate's token, deployment-allowlist and
// no-OIDC branches as the code under test (as in deployment-allowlist.e2e-spec).
//
// BUILD NOTE: importing the real JwtAuthGuard drags in jwks-rsa -> jose@6 (ESM-only);
// test/jest-e2e.json un-ignores `jose` in transformIgnorePatterns for exactly this.

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { ModuleBundleController } from '../../src/modules/module-bundle.controller';
import { ModuleRegistryService } from '../../src/gql/module-management-services/module-registry.service';
import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';

jest.setTimeout(60_000);

const SECRET = 'e2e-module-bundle-secret';
const FAKE_JWKS = 'https://jwks.invalid/.well-known/jwks.json';
const tokenListed = jwt.sign({ sub: 'sub-listed' }, SECRET);
const tokenUnlisted = jwt.sign({ sub: 'sub-unlisted' }, SECRET);

const BUNDLE = 'export default { install() {} };\n';
const HASH = createHash('sha256').update(BUNDLE).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtws-bundle-route-'));

for (const name of ['report-module', 'blocked-module']) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ReportModule.js'),
    `exports.default = class { async getMetadata() { return { name: '${name}', version: '1.0.0' }; } };`,
  );
  fs.writeFileSync(path.join(dir, 'frontend', 'bundle.js'), BUNDLE);
  fs.writeFileSync(
    path.join(dir, 'frontend', 'frontend-manifest.json'),
    JSON.stringify({
      manifestVersion: 1,
      components: [`${name.split('-')[0]}_view`],
      hostApi: { min: 1, max: 1 },
    }),
  );
}

function stubConfig(oidcJwksUri: string | undefined): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'gql') {
        return {
          oidcJwksUri,
          accessAllowlist: ['sub-listed'],
          customModulesPath: root,
          // The module allow-list names report-module only. Security validation is off, so
          // blocked-module still loads: the route itself must refuse it.
          allowedModules: ['report-*'],
          enableModuleSecurityValidation: false,
          enableModuleHotReload: false,
          moduleLoadTimeout: 30000,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

async function startApp(
  oidcJwksUri: string | undefined,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ModuleBundleController],
    providers: [
      JwtAuthGuard,
      ModuleRegistryService,
      { provide: ConfigService, useValue: stubConfig(oidcJwksUri) },
      { provide: 'NEO4J_DRIVER', useValue: { session: jest.fn() } },
      // app.init() runs the registry's onModuleInit, which calls both.
      {
        provide: ModuleManagementService,
        useValue: { updateAllModules: jest.fn(), enableCatchUp: jest.fn() },
      },
    ],
  }).compile();
  await moduleRef.get(ModuleRegistryService).loadModules();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

const url = (name: string, hash = HASH) =>
  `/module-bundles/${name}/${hash}/bundle.js`;

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('module bundle route — OIDC configured (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    jest
      .spyOn(JwtAuthGuard.prototype as any, 'validateToken')
      .mockImplementation(async (token: unknown) =>
        jwt.verify(token as string, SECRET),
      );
    app = await startApp(FAKE_JWKS);
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('401 without a token, whatever the module or hash, so nothing is learned before authentication', async () => {
    for (const target of [
      url('report-module'),
      url('blocked-module'),
      url('no-such-module'),
      url('report-module', 'f'.repeat(64)),
    ]) {
      await request(app.getHttpServer()).get(target).expect(401);
    }
  });

  it('401 for a valid token outside the deployment allow-list, like an invalid one', async () => {
    await request(app.getHttpServer())
      .get(url('report-module'))
      .set('Authorization', `Bearer ${tokenUnlisted}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(url('report-module'))
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  it('404 for a module outside the module allow-list', async () => {
    await request(app.getHttpServer())
      .get(url('blocked-module'))
      .set('Authorization', `Bearer ${tokenListed}`)
      .expect(404);
  });

  it('404 for a stale or malformed hash', async () => {
    const auth = { Authorization: `Bearer ${tokenListed}` };
    await request(app.getHttpServer())
      .get(url('report-module', 'f'.repeat(64)))
      .set(auth)
      .expect(404);
    await request(app.getHttpServer())
      .get(url('report-module', 'latest'))
      .set(auth)
      .expect(404);
  });

  it('200 with the bundle, cached privately and immutably, for an allowed module at its current hash', async () => {
    const res = await request(app.getHttpServer())
      .get(url('report-module'))
      .set('Authorization', `Bearer ${tokenListed}`)
      .set('Accept-Encoding', 'identity')
      .expect(200);
    expect(res.text).toBe(BUNDLE);
    expect(res.headers['content-type']).toBe(
      'application/javascript; charset=utf-8',
    );
    expect(res.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    );
    expect(res.headers['vary']).toContain('Accept-Encoding');
    expect(res.headers['etag']).toBe(`"${HASH}"`);
  });
});

describe('module bundle route — no OIDC configured (e2e)', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('outside production, lets a request without a token through (the documented development bypass)', async () => {
    process.env.NODE_ENV = 'test';
    const app = await startApp(undefined);
    try {
      await request(app.getHttpServer())
        .get(url('report-module'))
        .set('Accept-Encoding', 'identity')
        .expect(200);
      await request(app.getHttpServer()).get(url('blocked-module')).expect(404);
    } finally {
      await app.close();
    }
  });

  it('in production, refuses every request', async () => {
    process.env.NODE_ENV = 'production';
    const app = await startApp(undefined);
    try {
      await request(app.getHttpServer()).get(url('report-module')).expect(401);
    } finally {
      await app.close();
    }
  });
});
