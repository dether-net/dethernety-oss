/**
 * The in-process embedder on a worker thread. `createWorkerEmbedder` starts `worker.js`, which loads the profile's
 * session there, and returns an `Embedder` whose calls are messages to it. The main thread's event loop only posts
 * and receives, so a request that does not embed never waits for one that does.
 *
 * It also bounds the start: onnxruntime opens a session in one synchronous native call, which no timer on the thread
 * that makes it can interrupt. Here that call runs in the worker, so the main thread stops waiting when the load
 * outlasts `loadTimeoutMs`, asks the worker to stop and no longer lets it hold the process open. A worker stuck inside
 * a native call ends only when the call returns. A worker that exits or errors later rejects every pending call,
 * refuses new ones and reports through `onFailure`; it is never restarted here.
 */

// Before anything can load onnxruntime: a worker thread's own process.env is not seen by native code, so the opt-out
// must be set on this thread before the worker starts.
import './no-telemetry';

import { join } from 'path';
import { Worker } from 'worker_threads';

import type { EmbeddingProfile, ProfileKind } from '@dethernety/dt-module/embedding';

import { verifiedRecordsFor, type VerifiedRecord } from './acquire';
import type { EmbedItem, Embedder, OnnxEmbedderOptions } from './embedder';

/** Marks the worker data, so `worker.js` serves only a worker started for it. */
export const WORKER_DATA_KIND = 'dethernety-embedder';

export interface WorkerInit {
  kind: typeof WORKER_DATA_KIND;
  /** The profile itself (plain data), so the worker runs exactly the one the caller passed. */
  profile: EmbeddingProfile;
  modelDir: string;
  options: OnnxEmbedderOptions;
  /** The files this thread already verified, so the worker does not hash them again (see verifiedRecordsFor). */
  verified: VerifiedRecord[];
}

export type WorkerRequest = { type: 'embed'; id: number; kind: ProfileKind; items: EmbedItem[] } | { type: 'release' };

export type WorkerReply =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'result'; id: number; vectors: number[][] }
  | { type: 'error'; id: number; message: string }
  | { type: 'released' };

/** The part of a worker_threads Worker this uses. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: WorkerReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number> | void;
  /** Lets the process exit while the worker still runs (a worker stuck in a native call). */
  unref?(): void;
}

export interface WorkerEmbedderOptions extends OnnxEmbedderOptions {
  /** How long the worker may take to open the files and create the session. Default 120 s. */
  loadTimeoutMs?: number;
  /** How long `release()` waits for the worker to free its session, and then to end. Default 5 s each. */
  releaseTimeoutMs?: number;
  /** Called once when the worker fails after it was ready (exit, error), with the reason. */
  onFailure?: (error: Error) => void;
  /** Starts the worker. Injected in tests; the default runs worker.js next to this file. */
  spawn?: (init: WorkerInit) => WorkerLike;
}

const LOAD_TIMEOUT_MS = 120_000;
const seconds = (ms: number) => (Number.isInteger(ms / 1000) ? String(ms / 1000) : (ms / 1000).toFixed(1));
const RELEASE_TIMEOUT_MS = 5_000;

const defaultSpawn = (init: WorkerInit): WorkerLike => new Worker(join(__dirname, 'worker.js'), { workerData: init });

/** Start the worker, wait for its session (bounded), and return the embedder that talks to it. */
export async function createWorkerEmbedder(
  profile: EmbeddingProfile,
  modelDir: string,
  options: WorkerEmbedderOptions = {},
): Promise<Embedder> {
  if (profile.runtime.engine !== 'onnx' || !profile.source) throw new Error(`Profile "${profile.id}" is not an onnx profile`);
  const { loadTimeoutMs = LOAD_TIMEOUT_MS, releaseTimeoutMs = RELEASE_TIMEOUT_MS, onFailure, spawn = defaultSpawn, ...embedderOptions } = options;
  const verified = await verifiedRecordsFor(profile, modelDir);
  const worker = spawn({ kind: WORKER_DATA_KIND, profile, modelDir, options: embedderOptions, verified });
  const embedder = new WorkerEmbedder(profile, worker, releaseTimeoutMs, onFailure);
  await embedder.loaded(loadTimeoutMs);
  return embedder;
}

class WorkerEmbedder implements Embedder {
  readonly profileId: string;
  readonly dimensions: number;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (vectors: number[][]) => void; reject: (error: Error) => void }>();
  private ready = false;
  private failure: Error | null = null;
  private released = false;
  private settleLoad: ((error: Error | null) => void) | null = null;
  private onReleased: (() => void) | null = null;

  constructor(
    profile: EmbeddingProfile,
    private readonly worker: WorkerLike,
    private readonly releaseTimeoutMs: number,
    private readonly onFailure?: (error: Error) => void,
  ) {
    this.profileId = profile.id;
    this.dimensions = profile.runtime.dimensions;
    worker.on('message', (reply) => this.receive(reply));
    worker.on('error', (error) => this.fail(new Error(`embedder worker error: ${error.message}`)));
    worker.on('exit', (code) => {
      if (!this.released) this.fail(new Error(`embedder worker exited (code ${code})`));
      // A release waiting for the worker's answer stops waiting: the worker is gone.
      this.onReleased?.();
      this.onReleased = null;
    });
  }

  /** Resolves once the worker says ready; rejects on `failed`, an exit, or the timeout (which terminates it). */
  loaded(timeoutMs: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`the embedding model did not load within ${seconds(timeoutMs)} s`));
        this.stop();
      }, timeoutMs);
      timer.unref?.();
      this.settleLoad = (error) => {
        clearTimeout(timer);
        this.settleLoad = null;
        if (error) reject(error);
        else resolve();
      };
    });
  }

  embed(kind: ProfileKind, items: EmbedItem[]): Promise<number[][]> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.released) return Promise.reject(new Error('the embedder was released'));
    if (items.length === 0) return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'embed', id, kind, items });
    });
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (!this.failure) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.releaseTimeoutMs);
        timer.unref?.();
        this.onReleased = () => {
          clearTimeout(timer);
          resolve();
        };
        this.worker.postMessage({ type: 'release' });
      });
    }
    this.rejectPending(new Error('the embedder was released'));
    await this.stop(this.releaseTimeoutMs);
  }

  /**
   * Ends the worker: terminate, waited for at most `waitMs`, and unref so it never holds the process open. A worker
   * inside a native call (a session load or run) ends only when that call returns.
   */
  private async stop(waitMs = 0): Promise<void> {
    this.worker.unref?.();
    const ended = Promise.resolve(this.worker.terminate()).catch(() => undefined);
    if (waitMs <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([ended, new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
      timer.unref?.();
    })]);
    clearTimeout(timer);
  }

  private receive(reply: WorkerReply): void {
    switch (reply.type) {
      case 'ready':
        this.ready = true;
        this.settleLoad?.(null);
        return;
      case 'failed':
        this.fail(new Error(reply.message));
        void this.stop();
        return;
      case 'result':
        this.pending.get(reply.id)?.resolve(reply.vectors);
        this.pending.delete(reply.id);
        return;
      case 'error':
        this.pending.get(reply.id)?.reject(new Error(reply.message));
        this.pending.delete(reply.id);
        return;
      case 'released':
        this.onReleased?.();
        this.onReleased = null;
    }
  }

  /** The first failure wins: it settles the load or, once ready, rejects what is pending and reports it. */
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.rejectPending(error);
    // A release waiting for the worker's answer stops waiting: there will be none.
    this.onReleased?.();
    this.onReleased = null;
    if (this.settleLoad) {
      this.settleLoad(error);
      return;
    }
    if (this.ready && !this.released) this.onFailure?.(error);
  }

  private rejectPending(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
