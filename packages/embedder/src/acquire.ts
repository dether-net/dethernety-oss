/**
 * Weight acquisition: puts the files a profile lists into the models directory and proves them.
 *
 * Layout: `<modelDir>/<repo>/<revision>/<file path>`, so profiles and revisions can sit side by side.
 * Only the files the profile lists are ever fetched. Each file is written to a unique temporary name,
 * checked for size and sha256, and only then renamed into place, so a file under its final name is
 * always a verified one. Files already present and verified are not fetched again, which is also how
 * an offline operator works: copy the files in by the same layout.
 *
 * Network rules: redirects are followed by this code, HTTPS only; the token is sent only to the
 * profile's hub origin, never to the CDN a redirect points at; URLs and headers are never logged
 * (a CDN redirect carries a signed URL).
 */

import { createHash, randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'fs/promises';
import { dirname, join, relative, resolve, sep } from 'path';

import type { EmbeddingProfile, ProfileSourceFile } from '@dethernety/dt-module/embedding';

export type FetchLike = (url: string, init: { redirect: 'manual'; headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}>;

export interface AcquireOptions {
  /** HTTP client; the global fetch by default. Injected in tests. */
  fetch?: FetchLike;
  /** Token for a gated source. Sent only to the profile's hub origin. */
  token?: string;
  /** Progress and problem reporting. Never receives a URL or a header. */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

/** A file failed its size or sha256 check, or could not be placed safely. */
export class WeightFileError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'WeightFileError';
  }
}

const MAX_REDIRECTS = 5;
const TEMP_MARKER = '.part-';

function sourceOf(profile: EmbeddingProfile) {
  if (!profile.source) throw new Error(`Profile "${profile.id}" has no weight source`);
  return profile.source;
}

/** The directory holding one profile's files: `<modelDir>/<repo>/<revision>`. */
export function profileRoot(profile: EmbeddingProfile, modelDir: string): string {
  const source = sourceOf(profile);
  return join(modelDir, ...source.repo.split('/'), source.revision);
}

/**
 * The absolute path of one listed file, after proving it stays under the models directory and that
 * no existing component below the models directory is a symbolic link. The models directory itself
 * may be a link or a mount point: operators relocate bulk storage that way.
 */
export async function safeFilePath(profile: EmbeddingProfile, modelDir: string, file: ProfileSourceFile): Promise<string> {
  const base = resolve(modelDir);
  const target = resolve(profileRoot(profile, modelDir), file.path);
  if (!target.startsWith(base + sep)) throw new WeightFileError(file.path, 'resolves outside the models directory');
  let current = base;
  for (const part of relative(base, target).split(sep)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new WeightFileError(file.path, 'a symbolic link is on its path');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw err;
    }
  }
  return target;
}

/** Size and sha256 of a file on disk, streamed. */
export async function digestFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** Whether the file on disk is the listed one. A missing file is not an error, just `false`. */
export async function fileMatches(path: string, file: ProfileSourceFile): Promise<boolean> {
  try {
    const st = await lstat(path);
    if (!st.isFile() || st.size !== file.bytes) return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  return (await digestFile(path)).sha256 === file.sha256;
}

/** Remove temporary files left behind by an interrupted download. */
export async function removeStaleTemporaries(profile: EmbeddingProfile, modelDir: string): Promise<number> {
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.includes(TEMP_MARKER)) {
        await unlink(p);
        removed++;
      }
    }
  };
  await walk(profileRoot(profile, modelDir));
  return removed;
}

async function download(
  profile: EmbeddingProfile,
  file: ProfileSourceFile,
  target: string,
  options: AcquireOptions,
): Promise<void> {
  const source = sourceOf(profile);
  const fetchFn: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const hubOrigin = new URL(source.hub).origin;
  let url = `${source.hub.replace(/\/+$/, '')}/${source.repo}/resolve/${source.revision}/${file.path}`;

  let response: Awaited<ReturnType<FetchLike>> | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new WeightFileError(file.path, 'a redirect left HTTPS');
    const headers: Record<string, string> = {};
    if (options.token && parsed.origin === hubOrigin) headers.Authorization = `Bearer ${options.token}`;
    response = await fetchFn(url, { redirect: 'manual', headers });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new WeightFileError(file.path, `redirect ${response.status} without a location`);
      url = new URL(location, url).toString();
      response = undefined;
      continue;
    }
    break;
  }
  if (!response) throw new WeightFileError(file.path, `more than ${MAX_REDIRECTS} redirects`);
  if (response.status !== 200 || !response.body) throw new WeightFileError(file.path, `download failed with HTTP ${response.status}`);

  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}${TEMP_MARKER}${randomBytes(6).toString('hex')}`;
  const hash = createHash('sha256');
  let bytes = 0;
  const handle = await open(temp, 'wx');
  try {
    for await (const chunk of response.body) {
      if (bytes + chunk.length > file.bytes) throw new WeightFileError(file.path, `larger than the listed ${file.bytes} bytes`);
      hash.update(chunk);
      bytes += chunk.length;
      await handle.write(chunk);
    }
    await handle.close();
    if (bytes !== file.bytes) throw new WeightFileError(file.path, `size ${bytes} differs from the listed ${file.bytes}`);
    if (hash.digest('hex') !== file.sha256) throw new WeightFileError(file.path, 'sha256 differs from the profile');
    await rename(temp, target);
  } catch (err) {
    await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw err;
  }
}

/**
 * Make every file the profile lists present and verified under `modelDir`. Downloads only what is
 * missing or wrong. A wrong file is deleted before it is replaced. Throws on the first file that
 * cannot be placed and verified.
 */
export async function ensureWeights(profile: EmbeddingProfile, modelDir: string, options: AcquireOptions = {}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const removed = await removeStaleTemporaries(profile, modelDir);
  if (removed > 0) log('removed stale temporary weight files', { profile: profile.id, removed });
  for (const file of sourceOf(profile).files) {
    const target = await safeFilePath(profile, modelDir, file);
    if (await fileMatches(target, file)) continue;
    await unlink(target).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
    log('downloading weight file', { profile: profile.id, file: file.path, bytes: file.bytes });
    await download(profile, file, target, options);
    log('weight file verified', { profile: profile.id, file: file.path });
  }
}

/**
 * Prove that every listed file is present and matches its size and sha256, without any network use.
 * Throws a WeightFileError naming the first file that does not.
 */
export async function verifyWeights(profile: EmbeddingProfile, modelDir: string): Promise<void> {
  for (const file of sourceOf(profile).files) {
    const target = await safeFilePath(profile, modelDir, file);
    if (!(await fileMatches(target, file))) throw new WeightFileError(file.path, 'missing or does not match the profile');
  }
}

/**
 * `ensureWeights` with a bounded retry: one attempt, then one per delay. Gives up (rethrows the last
 * error) when the delays run out. A verification failure is retried too: a truncated CDN response
 * looks the same as a bad file until it is downloaded again.
 */
export async function ensureWeightsWithRetry(
  profile: EmbeddingProfile,
  modelDir: string,
  options: AcquireOptions & { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const delays = options.delaysMs ?? [30_000, 120_000, 600_000, 1_800_000];
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms).unref()));
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureWeights(profile, modelDir, options);
      return;
    } catch (err) {
      if (attempt >= delays.length) throw err;
      options.log?.('weight acquisition failed, retrying', {
        profile: profile.id,
        attempt: attempt + 1,
        retryInMs: delays[attempt],
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delays[attempt]);
    }
  }
}
