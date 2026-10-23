import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as zlib from 'zlib';
import {
  FrontendRegistryEntry,
  ModuleFrontendAsset,
  bundleResponse,
  chooseEncoding,
  bundleUrl,
  listFrontendManifests,
  loadModuleFrontend,
  lookupBundle,
} from '../module-frontend';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtws-module-frontend-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const MANIFEST = {
  manifestVersion: 1,
  components: ['report_dashboard'],
  hostApi: { min: 1, max: 1 },
};
const BUNDLE = 'export default { install() {} };\n'.repeat(50);
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');

let n = 0;
function moduleDir(files: { bundle?: string; manifest?: string } = {}): string {
  const dir = path.join(root, `m${n++}`);
  fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
  if (files.bundle !== undefined)
    fs.writeFileSync(path.join(dir, 'frontend', 'bundle.js'), files.bundle);
  if (files.manifest !== undefined)
    fs.writeFileSync(
      path.join(dir, 'frontend', 'frontend-manifest.json'),
      files.manifest,
    );
  return dir;
}
const both = () =>
  moduleDir({ bundle: BUNDLE, manifest: JSON.stringify(MANIFEST) });

async function loaded(dir: string): Promise<ModuleFrontendAsset> {
  const load = await loadModuleFrontend(dir);
  if (load.kind !== 'loaded')
    throw new Error(`expected a loaded frontend, got ${JSON.stringify(load)}`);
  return load.asset;
}

describe('loadModuleFrontend', () => {
  it('finds no frontend when neither file exists', async () => {
    expect(await loadModuleFrontend(moduleDir())).toEqual({ kind: 'none' });
    expect(await loadModuleFrontend(path.join(root, 'no-such-module'))).toEqual(
      { kind: 'none' },
    );
  });

  it('refuses a bundle without its manifest', async () => {
    expect(await loadModuleFrontend(moduleDir({ bundle: BUNDLE }))).toEqual({
      kind: 'refused',
      reason: 'frontend/bundle.js without frontend/frontend-manifest.json',
    });
  });

  it('refuses a manifest without its bundle', async () => {
    expect(
      await loadModuleFrontend(
        moduleDir({ manifest: JSON.stringify(MANIFEST) }),
      ),
    ).toEqual({
      kind: 'refused',
      reason: 'frontend/frontend-manifest.json without frontend/bundle.js',
    });
  });

  it('refuses an invalid or unparseable manifest, naming the problem', async () => {
    const invalid = await loadModuleFrontend(
      moduleDir({
        bundle: BUNDLE,
        manifest: JSON.stringify({ ...MANIFEST, manifestVersion: 2 }),
      }),
    );
    expect(invalid).toEqual({
      kind: 'refused',
      reason: expect.stringMatching(/manifestVersion must be 1/),
    });
    const garbled = await loadModuleFrontend(
      moduleDir({ bundle: BUNDLE, manifest: '{ not json' }),
    );
    expect(garbled).toEqual({
      kind: 'refused',
      reason: expect.stringMatching(/not valid JSON/),
    });
  });

  it('refuses a manifest over 64 KiB without reading it', async () => {
    const big = JSON.stringify({ ...MANIFEST, $schema: 'x'.repeat(70 * 1024) });
    expect(
      await loadModuleFrontend(moduleDir({ bundle: BUNDLE, manifest: big })),
    ).toEqual({
      kind: 'refused',
      reason: expect.stringMatching(
        /frontend-manifest\.json is over 65536 bytes/,
      ),
    });
  });

  it('refuses a symlinked frontend/ directory', async () => {
    const dir = path.join(root, `m${n++}`);
    fs.mkdirSync(dir);
    fs.symlinkSync(path.join(both(), 'frontend'), path.join(dir, 'frontend'));
    expect(await loadModuleFrontend(dir)).toEqual({
      kind: 'refused',
      reason: 'frontend/ is not a directory',
    });
  });

  it('refuses symlinked files', async () => {
    const target = both();
    for (const file of ['bundle.js', 'frontend-manifest.json']) {
      const dir = both();
      fs.rmSync(path.join(dir, 'frontend', file));
      fs.symlinkSync(
        path.join(target, 'frontend', file),
        path.join(dir, 'frontend', file),
      );
      expect(await loadModuleFrontend(dir)).toEqual({
        kind: 'refused',
        reason: `frontend/${file} is not a regular file`,
      });
    }
  });

  it('refuses a FIFO without blocking on it', async () => {
    const dir = both();
    const bundlePath = path.join(dir, 'frontend', 'bundle.js');
    fs.rmSync(bundlePath);
    execFileSync('mkfifo', [bundlePath]);
    expect(await loadModuleFrontend(dir)).toEqual({
      kind: 'refused',
      reason: 'frontend/bundle.js is not a regular file',
    });
  });

  it('refuses a file that grows past the cap after its size was checked', async () => {
    const dir = both();
    const realOpen = fsp.open;
    const open = jest
      .spyOn(fsp, 'open')
      .mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
        const handle = await realOpen(...args);
        if (!String(args[0]).endsWith('frontend-manifest.json')) return handle;
        // The real handle's stat (a small size) and close, but a read that never reaches the end.
        return Object.assign(Object.create(handle), {
          stat: () => handle.stat(),
          close: () => handle.close(),
          read: async (buffer: Buffer, offset: number, length: number) => {
            buffer.fill(0x20, offset, offset + length);
            return { bytesRead: length, buffer };
          },
        });
      });
    try {
      expect(await loadModuleFrontend(dir)).toEqual({
        kind: 'refused',
        reason: 'frontend/frontend-manifest.json is over 65536 bytes',
      });
    } finally {
      open.mockRestore();
    }
  });

  it('holds the bundle, its sha256 and compressed copies that decompress to the same bytes', async () => {
    const asset = await loaded(both());
    expect(asset.hash).toBe(sha256(BUNDLE));
    expect(asset.size).toBe(Buffer.byteLength(BUNDLE));
    expect(asset.manifest.components).toEqual(['report_dashboard']);
    expect(asset.bodies.identity.toString()).toBe(BUNDLE);
    expect(zlib.gunzipSync(asset.bodies.gzip).toString()).toBe(BUNDLE);
    expect(zlib.brotliDecompressSync(asset.bodies.br).toString()).toBe(BUNDLE);
    expect(asset.bodies.br.length).toBeLessThan(asset.size);
    expect(Object.isFrozen(asset) && Object.isFrozen(asset.bodies)).toBe(true);
  });
});

describe('lookupBundle and listFrontendManifests', () => {
  let asset: ModuleFrontendAsset;
  let entries: Map<string, FrontendRegistryEntry>;
  const allowed = (name: string) => name !== 'blocked';

  beforeAll(async () => {
    asset = await loaded(both());
    entries = new Map<string, FrontendRegistryEntry>([
      ['report', { isHealthy: true, version: '2.0.0', frontend: asset }],
      ['another', { isHealthy: true, version: '1.0.0', frontend: asset }],
      ['sick', { isHealthy: false, frontend: asset }],
      ['blocked', { isHealthy: true, frontend: asset }],
      ['backend-only', { isHealthy: true }],
    ]);
  });

  it('serves the current hash of a registered, allowed, healthy module', () => {
    expect(lookupBundle(entries, allowed, 'report', asset.hash)).toEqual({
      status: 200,
      asset,
    });
  });

  it.each([
    ['a malformed hash', 'report', 'ABC'],
    ['an upper-case hash', 'report', 'A'.repeat(64)],
    ['a stale hash', 'report', 'f'.repeat(64)],
    ['an unknown module', 'nope', undefined],
    ['a module outside the module allow-list', 'blocked', undefined],
    ['a module without a frontend', 'backend-only', undefined],
    ['a traversal-shaped name', '../report', undefined],
    ['a prototype name', 'constructor', undefined],
  ])('404 for %s', (_case, name, hash) => {
    expect(lookupBundle(entries, allowed, name, hash ?? asset.hash)).toEqual({
      status: 404,
    });
  });

  it('503 for a registered, allowed module that is unhealthy', () => {
    expect(lookupBundle(entries, allowed, 'sick', asset.hash)).toEqual({
      status: 503,
    });
  });

  it('lists allowed modules with a frontend, by name, unhealthy ones as unavailable, without bundle text', () => {
    const row = (
      name: string,
      version: string | undefined,
      available: boolean,
    ) => ({
      name,
      version,
      available,
      hash: asset.hash,
      size: asset.size,
      url: `/module-bundles/${name}/${asset.hash}/bundle.js`,
      components: ['report_dashboard'],
      hostApi: { min: 1, max: 1 },
    });
    expect(listFrontendManifests(entries, allowed)).toEqual([
      row('another', '1.0.0', true),
      row('report', '2.0.0', true),
      row('sick', undefined, false),
    ]);
  });

  it('builds the bundle URL with the module name encoded', () => {
    expect(bundleUrl('a b/c', 'f'.repeat(64))).toBe(
      `/module-bundles/a%20b%2Fc/${'f'.repeat(64)}/bundle.js`,
    );
  });
});

describe('chooseEncoding', () => {
  it.each([
    [undefined, 'identity'],
    ['', 'identity'],
    ['gzip, deflate, br', 'br'],
    ['gzip', 'gzip'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0, gzip;q=0', 'identity'],
    ['*', 'br'],
    ['*;q=0, gzip', 'gzip'],
    ['identity', 'identity'],
    ['BR', 'br'],
    ['br;q=junk, gzip', 'gzip'],
    ['br ;q=0, *', 'gzip'],
    ['gzip ;q=0.5', 'gzip'],
  ])('%j → %s', (header, expected) => {
    expect(chooseEncoding(header)).toBe(expected);
  });
});

describe('bundleResponse', () => {
  let asset: ModuleFrontendAsset;
  beforeAll(async () => {
    asset = await loaded(both());
  });

  it('sends the held copy for the encoding, cached privately and immutably', () => {
    const r = bundleResponse(asset, 'gzip, br', undefined);
    expect(r.status).toBe(200);
    expect(r.body).toBe(asset.bodies.br);
    expect(r.vary).toBe('Accept-Encoding');
    expect(r.headers).toEqual({
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${asset.hash}-br"`,
      'Content-Encoding': 'br',
      'Content-Length': String(asset.bodies.br.length),
    });
  });

  it('gives each encoding its own ETag, and none a Content-Encoding when uncompressed', () => {
    expect(bundleResponse(asset, 'gzip', undefined).headers.ETag).toBe(
      `"${asset.hash}-gz"`,
    );
    const plain = bundleResponse(asset, undefined, undefined);
    expect(plain.headers.ETag).toBe(`"${asset.hash}"`);
    expect(plain.headers['Content-Encoding']).toBeUndefined();
    expect(plain.body).toBe(asset.bodies.identity);
  });

  it('answers a matching If-None-Match with 304 and no body', () => {
    const r = bundleResponse(asset, 'br', `"other", "${asset.hash}-br"`);
    expect(r.status).toBe(304);
    expect(r.body).toBeUndefined();
    expect(bundleResponse(asset, 'gzip', `"${asset.hash}-br"`).status).toBe(
      200,
    );
  });

  it('compares If-None-Match weakly, and matches *', () => {
    expect(bundleResponse(asset, 'br', `W/"${asset.hash}-br"`).status).toBe(
      304,
    );
    expect(bundleResponse(asset, 'br', '*').status).toBe(304);
  });
});
