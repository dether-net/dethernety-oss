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
 * (a CDN redirect carries a signed URL). A hop that does not answer within the connect timeout, or a
 * body that sends no byte for the idle timeout, fails the download like any other error, so a stalled
 * connection reaches the retry schedule instead of hanging it.
 */

import { createHash, randomBytes } from 'crypto';
import { createReadStream, type Stats } from 'fs';
import { link, lstat, mkdir, open, readdir, readFile, rename, unlink, utimes } from 'fs/promises';
import { dirname, join, relative, resolve, sep } from 'path';

import type { EmbeddingProfile, ProfileSourceFile } from '@dethernety/dt-module/embedding';

export type FetchLike = (url: string, init: { redirect: 'manual'; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}>;

export interface AcquireOptions {
  /** HTTP client; the global fetch by default. Injected in tests. */
  fetch?: FetchLike;
  /** Timings, injected in tests: how often a waiting process looks at another's lock, when a lock is stale, and how often a holder refreshes its own. */
  lockPollMs?: number;
  lockStaleMs?: number;
  lockTouchMs?: number;
  /** Test seam: runs after a stale lock is found and before it is taken over, so a test can act in between. */
  onStaleLock?: () => Promise<void>;
  /** Timings, injected in tests: how long one request may take to answer, and how long a body may send nothing. */
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
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
const LOCK_SUFFIX = '.lock';
/** A temporary untouched this long belongs to no live download, which writes to it all the time. */
const STALE_TEMP_MS = 60 * 60_000;
/** A lock untouched this long is left by a process that died: a live holder refreshes it every LOCK_TOUCH_MS. */
const STALE_LOCK_MS = 5 * 60_000;
const LOCK_TOUCH_MS = 30_000;
const LOCK_POLL_MS = 2_000;
const CONNECT_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

function sourceOf(profile: EmbeddingProfile) {
  if (!profile.source) throw new Error(`Profile "${profile.id}" has no weight source`);
  return profile.source;
}

/** `s` without its trailing slashes, trimmed by character rather than by a `/\/+$/` pattern static analysis flags. */
function withoutTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
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

/**
 * The files this process has verified, by absolute path, with the device, inode, size, mtime and ctime they had
 * then and the sha256 they matched. Acquisition verifies every file and loading verifies them again, and the
 * largest is over a gigabyte: a file whose stat still matches is not read and hashed a second time. The ctime
 * catches a rewrite whose mtime was set back, which no write can avoid changing. Process memory only, so every
 * start verifies afresh.
 */
const verified = new Map<string, { stat: string; sha256: string }>();

/** What a file must still have to count as the one verified. */
const statKey = (st: Stats) => `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;

/** Forgets every file verified so far, so the next check reads and hashes it. */
export function forgetVerifiedFiles(): void {
  verified.clear();
}

async function recordVerified(path: string, sha256: string): Promise<void> {
  verified.set(path, { stat: statKey(await lstat(path)), sha256 });
}

/** Whether the file on disk is the listed one. A missing file is not an error, just `false`. */
export async function fileMatches(path: string, file: ProfileSourceFile): Promise<boolean> {
  let st;
  try {
    st = await lstat(path);
    if (!st.isFile() || st.size !== file.bytes) return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  const known = verified.get(path);
  if (known && known.sha256 === file.sha256 && known.stat === statKey(st)) return true;
  if ((await digestFile(path)).sha256 !== file.sha256) return false;
  verified.set(path, { stat: statKey(st), sha256: file.sha256 });
  return true;
}

/**
 * Remove temporary files left behind by an interrupted download: only those untouched for an hour, so another
 * process's download in progress in a shared models directory keeps its file.
 */
export async function removeStaleTemporaries(profile: EmbeddingProfile, modelDir: string, now = Date.now()): Promise<number> {
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
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile() || !e.name.includes(TEMP_MARKER)) continue;
      let st: Stats;
      try {
        st = await lstat(p);
      } catch (err) {
        // Placed or removed by its own process since the listing.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      if (now - st.mtimeMs <= STALE_TEMP_MS) continue;
      await unlink(p).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
      removed++;
    }
  };
  await walk(profileRoot(profile, modelDir));
  return removed;
}

/** The token written into a lock; undefined when the lock is gone or not one this code wrote. */
async function lockToken(lock: string): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(lock, 'utf-8')) as { token?: string }).token;
  } catch {
    return undefined;
  }
}

/**
 * Takes a stale lock out of the way without deleting a lock by name: moves it to a unique name, and keeps it moved
 * only if it is the lock found stale (same inode and mtime). Another waiter may have taken the stale lock over
 * first and created a fresh one, which is put back; should yet another lock have appeared meanwhile, the moved
 * one's holder finds its lock lost. The moved name carries the temporary marker, so a leftover one is swept.
 */
async function removeStaleLock(lock: string, stale: Stats): Promise<void> {
  const aside = `${lock}${TEMP_MARKER}${randomBytes(6).toString('hex')}`;
  try {
    // A lock this process may not move fails here, rather than being retried at once, over and over.
    await rename(lock, aside);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  let moved: Stats;
  try {
    moved = await lstat(aside);
  } catch (err) {
    // Another process's sweep removed it: the stale lock is gone either way.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (moved.dev !== stale.dev || moved.ino !== stale.ino || moved.mtimeMs !== stale.mtimeMs) {
    await link(aside, lock).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }
  await unlink(aside).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

/**
 * Takes the lock on one target file: `<target>.lock`, created exclusively and holding a token of this call's own.
 * While another process holds a lock it refreshes, this waits; a lock untouched for STALE_LOCK_MS is taken over.
 * Returns a refresh and a release, which act only while the lock still holds this call's token: a holder whose
 * lock was taken over fails its download instead of refreshing the new holder's lock, and never removes it.
 */
async function lockTarget(target: string, file: ProfileSourceFile, options: AcquireOptions) {
  const lock = `${target}${LOCK_SUFFIX}`;
  const pollMs = options.lockPollMs ?? LOCK_POLL_MS;
  const staleMs = options.lockStaleMs ?? STALE_LOCK_MS;
  const touchMs = options.lockTouchMs ?? LOCK_TOUCH_MS;
  const token = randomBytes(16).toString('hex');
  await mkdir(dirname(target), { recursive: true });
  let told = false;
  for (;;) {
    let handle;
    try {
      handle = await open(lock, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (handle) {
      try {
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }));
        } finally {
          await handle.close();
        }
      } catch (err) {
        // A lock that could not be written (a full disk) is not left for other processes to wait on.
        await unlink(lock).catch(() => undefined);
        throw err;
      }
      break;
    }
    let st: Stats;
    try {
      st = await lstat(lock);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (Date.now() - st.mtimeMs > staleMs) {
      await options.onStaleLock?.();
      await removeStaleLock(lock, st);
      continue;
    }
    if (!told) {
      options.log?.('waiting for another process to place a weight file', { file: file.path });
      told = true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const ours = async () => (await lockToken(lock)) === token;
  /** Fails once another process has taken the lock over. */
  const held = async () => {
    if (!(await ours())) throw new WeightFileError(file.path, 'another process took over its lock');
  };
  let touched = Date.now();
  return {
    held,
    /** Keeps the lock fresh while a download runs; fails the download once another process has taken it over. */
    touch: async () => {
      if (Date.now() - touched < touchMs) return;
      touched = Date.now();
      await held();
      await utimes(lock, new Date(), new Date()).catch(() => undefined);
    },
    release: async () => {
      if (await ours()) await unlink(lock).catch(() => undefined);
    },
  };
}

/** `promise`, or a rejection with the signal's reason once it aborts, so a fetch or a body that ignores the signal still ends. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Aborts `controller` with `error` unless cleared within `ms`. */
function abortAfter(controller: AbortController, ms: number, error: () => Error): () => void {
  const timer = setTimeout(() => controller.abort(error()), ms);
  return () => clearTimeout(timer);
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

async function download(
  profile: EmbeddingProfile,
  file: ProfileSourceFile,
  target: string,
  options: AcquireOptions,
  lock: { touch(): Promise<void>; held(): Promise<void> },
): Promise<void> {
  const source = sourceOf(profile);
  const fetchFn: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const hubOrigin = new URL(source.hub).origin;
  let url = `${withoutTrailingSlashes(source.hub)}/${source.repo}/resolve/${source.revision}/${file.path}`;

  const connectMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const idleMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;

  let response: Awaited<ReturnType<FetchLike>> | undefined;
  // One controller per hop; the last one also bounds the body, which belongs to its request.
  let controller = new AbortController();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new WeightFileError(file.path, 'a redirect left HTTPS');
    const headers: Record<string, string> = {};
    if (options.token && parsed.origin === hubOrigin) headers.Authorization = `Bearer ${options.token}`;
    controller = new AbortController();
    const answered = abortAfter(controller, connectMs, () => new WeightFileError(file.path, `no response within ${seconds(connectMs)}`));
    try {
      response = await untilAborted(fetchFn(url, { redirect: 'manual', headers, signal: controller.signal }), controller.signal);
    } finally {
      answered();
    }
    if (response.status >= 300 && response.status < 400) {
      // The redirect's own body is never read: aborting its request frees the connection.
      controller.abort();
      const location = response.headers.get('location');
      if (!location) throw new WeightFileError(file.path, `redirect ${response.status} without a location`);
      url = new URL(location, url).toString();
      response = undefined;
      continue;
    }
    break;
  }
  if (!response) throw new WeightFileError(file.path, `more than ${MAX_REDIRECTS} redirects`);
  if (response.status !== 200 || !response.body) {
    controller.abort();
    throw new WeightFileError(file.path, `download failed with HTTP ${response.status}`);
  }

  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}${TEMP_MARKER}${randomBytes(6).toString('hex')}`;
  const hash = createHash('sha256');
  let bytes = 0;
  const handle = await open(temp, 'wx');
  const chunks = response.body[Symbol.asyncIterator]();
  const { signal } = controller;
  try {
    for (;;) {
      // Only the wait for the next chunk counts as idle; writing it to disk does not.
      const arrived = abortAfter(controller, idleMs, () => new WeightFileError(file.path, `no data for ${seconds(idleMs)}`));
      let next: IteratorResult<Uint8Array>;
      try {
        next = await untilAborted(chunks.next(), signal);
      } finally {
        arrived();
      }
      if (next.done) break;
      const chunk = next.value;
      if (bytes + chunk.length > file.bytes) throw new WeightFileError(file.path, `larger than the listed ${file.bytes} bytes`);
      hash.update(chunk);
      bytes += chunk.length;
      await handle.write(chunk);
      await lock.touch();
    }
    await handle.close();
    if (bytes !== file.bytes) throw new WeightFileError(file.path, `size ${bytes} differs from the listed ${file.bytes}`);
    if (hash.digest('hex') !== file.sha256) throw new WeightFileError(file.path, 'sha256 differs from the profile');
    // A holder that lost its lock does not place a file over the new holder's.
    await lock.held();
    await rename(temp, target);
    // Hashed while it streamed in: loading it next need not read it again.
    await recordVerified(target, file.sha256);
  } catch (err) {
    // Stops the request and its body; not awaited, since a stalled body need not answer a return either.
    controller.abort();
    void chunks.return?.()?.catch(() => undefined);
    await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw err;
  }
}

/**
 * Make every file the profile lists present and verified under `modelDir`. Downloads only what is
 * missing or wrong. A wrong file stays until the verified one replaces it in one rename. Throws on the first file that
 * cannot be placed and verified.
 */
export async function ensureWeights(profile: EmbeddingProfile, modelDir: string, options: AcquireOptions = {}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const removed = await removeStaleTemporaries(profile, modelDir);
  if (removed > 0) log('removed stale temporary weight files', { profile: profile.id, removed });
  for (const file of sourceOf(profile).files) {
    const target = await safeFilePath(profile, modelDir, file);
    if (await fileMatches(target, file)) continue;
    // One process downloads a file at a time, in a models directory replicas share; the others wait for it.
    const lock = await lockTarget(target, file, options);
    try {
      if (await fileMatches(target, file)) continue;
      log('downloading weight file', { profile: profile.id, file: file.path, bytes: file.bytes });
      await download(profile, file, target, options, lock);
      log('weight file verified', { profile: profile.id, file: file.path });
    } finally {
      await lock.release();
    }
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
