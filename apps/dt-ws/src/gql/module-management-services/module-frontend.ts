import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { promisify } from 'util';
import * as zlib from 'zlib';
import {
  FRONTEND_MANIFEST_FILE,
  FrontendManifest,
  FrontendManifestError,
  HostApiRange,
  parseFrontendManifest,
} from '@dethernety/dt-module';
import type { ModuleEntry } from '../interfaces/module-registry.interface';

/**
 * A module frontend as dt-ws serves it: read from disk once, when the module is loaded or
 * reloaded, and never again per request. The bundle's bytes, their sha256 and the compressed
 * copies are held together, so a URL carrying an old hash can never be answered with new bytes:
 * a file changed on disk keeps serving the old bytes until a reload replaces the whole asset.
 */
export interface ModuleFrontendAsset {
  readonly manifest: FrontendManifest;
  /** sha256 of the bundle bytes, lowercase hex. */
  readonly hash: string;
  /** The bundle's size in bytes, uncompressed. */
  readonly size: number;
  readonly bodies: Readonly<Record<BundleEncoding, Buffer>>;
}

export type BundleEncoding = 'br' | 'gzip' | 'identity';

export type FrontendLoad =
  | { kind: 'loaded'; asset: ModuleFrontendAsset }
  | { kind: 'refused'; reason: string }
  | { kind: 'none' };

const BUNDLE_FILE = 'bundle.js';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
const rel = (file: string) => `frontend/${file}`;

type FileRead =
  | { kind: 'absent' }
  | { kind: 'refused'; reason: string }
  | { kind: 'read'; bytes: Buffer };

/**
 * Reads a regular file of at most `max` bytes without following a symlink. The type and the size
 * are checked on the open handle, and the read stops past `max`, so a file swapped or grown after
 * the check cannot get past either. O_NONBLOCK keeps a FIFO from blocking the open; `isFile()` then
 * refuses it.
 */
async function readRegularFile(
  filePath: string,
  max: number,
): Promise<FileRead> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    // A symlink: ELOOP on Linux and macOS, EMLINK on FreeBSD.
    if (code === 'ELOOP' || code === 'EMLINK')
      return {
        kind: 'refused',
        reason: `${rel(path.basename(filePath))} is not a regular file`,
      };
    throw error;
  }
  try {
    const name = rel(path.basename(filePath));
    const tooBig: FileRead = {
      kind: 'refused',
      reason: `${name} is over ${max} bytes`,
    };
    const stats = await handle.stat();
    if (!stats.isFile())
      return { kind: 'refused', reason: `${name} is not a regular file` };
    if (stats.size > max) return tooBig;
    const chunks: Buffer[] = [];
    let length = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(
        Math.min(
          Math.max(stats.size + 1 - length, 64 * 1024),
          1024 * 1024,
          max + 1 - length,
        ),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      if (length > max) return tooBig;
    }
    return { kind: 'read', bytes: Buffer.concat(chunks, length) };
  } finally {
    await handle.close();
  }
}

/**
 * Reads a module's frontend from `<moduleDir>/frontend/`: the bundle and its manifest, both
 * required. A bundle without a valid manifest is refused.
 */
export async function loadModuleFrontend(
  moduleDir: string,
): Promise<FrontendLoad> {
  const frontendDir = path.join(moduleDir, 'frontend');
  try {
    if (!(await fs.lstat(frontendDir)).isDirectory()) {
      return { kind: 'refused', reason: 'frontend/ is not a directory' };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { kind: 'none' };
    throw error;
  }

  const manifest = await readRegularFile(
    path.join(frontendDir, FRONTEND_MANIFEST_FILE),
    MAX_MANIFEST_BYTES,
  );
  const bundle = await readRegularFile(
    path.join(frontendDir, BUNDLE_FILE),
    MAX_BUNDLE_BYTES,
  );
  if (bundle.kind === 'absent' && manifest.kind === 'absent')
    return { kind: 'none' };
  if (bundle.kind === 'absent')
    return {
      kind: 'refused',
      reason: `${rel(FRONTEND_MANIFEST_FILE)} without ${rel(BUNDLE_FILE)}`,
    };
  if (manifest.kind === 'absent')
    return {
      kind: 'refused',
      reason: `${rel(BUNDLE_FILE)} without ${rel(FRONTEND_MANIFEST_FILE)}`,
    };
  if (bundle.kind === 'refused') return bundle;
  if (manifest.kind === 'refused') return manifest;

  let parsed: FrontendManifest;
  try {
    parsed = parseFrontendManifest(manifest.bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof FrontendManifestError)
      return { kind: 'refused', reason: error.message };
    throw error;
  }

  const identity = bundle.bytes;
  const [gz, br] = await Promise.all([
    gzip(identity, { level: 9 }),
    brotli(identity, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: identity.length,
      },
    }),
  ]);
  return {
    kind: 'loaded',
    asset: Object.freeze({
      manifest: parsed,
      hash: createHash('sha256').update(identity).digest('hex'),
      size: identity.length,
      bodies: Object.freeze({ identity, gzip: gz, br }),
    }),
  };
}

/** What the registry holds per module, as far as frontends go. */
export type FrontendRegistryEntry = Pick<
  ModuleEntry,
  'isHealthy' | 'version' | 'frontend'
>;

/** One module frontend the UI can load, as the manifest query returns it. */
export interface FrontendModuleManifest {
  name: string;
  version?: string;
  /** False while the module is unhealthy; its bundle route then answers 503. */
  available: boolean;
  hash: string;
  size: number;
  /** The bundle's path on this server. */
  url: string;
  components: readonly string[];
  hostApi: HostApiRange;
}

export const bundleUrl = (moduleName: string, hash: string) =>
  `/module-bundles/${encodeURIComponent(moduleName)}/${hash}/bundle.js`;

/** The allowed modules with a frontend, by name. */
export function listFrontendManifests(
  entries: ReadonlyMap<string, FrontendRegistryEntry>,
  isAllowed: (moduleName: string) => boolean,
): FrontendModuleManifest[] {
  const out: FrontendModuleManifest[] = [];
  for (const [name, entry] of entries) {
    if (!entry.frontend || !isAllowed(name)) continue;
    const { hash, size, manifest } = entry.frontend;
    out.push({
      name,
      version: entry.version,
      available: entry.isHealthy,
      hash,
      size,
      url: bundleUrl(name, hash),
      components: manifest.components,
      hostApi: manifest.hostApi,
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export type BundleLookup =
  | { status: 200; asset: ModuleFrontendAsset }
  | { status: 404 }
  | { status: 503 };

/**
 * The bundle for `GET /module-bundles/:name/:hash/bundle.js`. 404 for anything that does not name
 * the current bundle of a registered, allowed module: a stale or malformed hash fails the exact
 * comparison with the current one. 503 while that module is unhealthy.
 */
export function lookupBundle(
  entries: ReadonlyMap<string, FrontendRegistryEntry>,
  isAllowed: (moduleName: string) => boolean,
  name: string,
  hash: string,
): BundleLookup {
  const entry = entries.get(name);
  if (!entry || !entry.frontend || !isAllowed(name)) return { status: 404 };
  if (!entry.isHealthy) return { status: 503 };
  if (entry.frontend.hash !== hash) return { status: 404 };
  return { status: 200, asset: entry.frontend };
}

/** The best encoding the client accepts: br, then gzip, then none. */
export function chooseEncoding(
  acceptEncoding: string | undefined,
): BundleEncoding {
  const q = new Map<string, number>();
  for (const part of (acceptEncoding ?? '').split(',')) {
    const [token, ...params] = part
      .split(';')
      .map((p) => p.trim().toLowerCase());
    if (!token) continue;
    const qParam = params.find((p) => p.startsWith('q='));
    const value = qParam === undefined ? 1 : Number(qParam.slice(2));
    q.set(token, Number.isFinite(value) ? value : 0);
  }
  const accepts = (coding: string) => (q.get(coding) ?? q.get('*') ?? 0) > 0;
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return 'identity';
}

const ETAG_SUFFIX: Record<BundleEncoding, string> = {
  br: '-br',
  gzip: '-gz',
  identity: '',
};

/** Whether `If-None-Match` matches `etag`, by the weak comparison conditional GETs use. */
function noneMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((tag) => {
    const t = tag.trim();
    return t === '*' || t.replace(/^W\//, '') === etag;
  });
}

/**
 * The response for a found bundle: its status, headers and body. `Vary` is left to the caller to
 * append, since other middleware may already have set it.
 */
export function bundleResponse(
  asset: ModuleFrontendAsset,
  acceptEncoding: string | undefined,
  ifNoneMatch: string | undefined,
): {
  status: 200 | 304;
  headers: Record<string, string>;
  vary: string;
  body?: Buffer;
} {
  const encoding = chooseEncoding(acceptEncoding);
  const etag = `"${asset.hash}${ETAG_SUFFIX[encoding]}"`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: etag,
  };
  const vary = 'Accept-Encoding';
  if (noneMatch(ifNoneMatch, etag)) return { status: 304, headers, vary };
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
  const body = asset.bodies[encoding];
  headers['Content-Length'] = String(body.length);
  return { status: 200, headers, vary, body };
}
