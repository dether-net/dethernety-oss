/**
 * The embedder on a worker thread: the main thread's side against a real worker_threads Worker running a stand-in
 * (fixtures/fake-worker.cjs) that speaks the same messages, and the worker's side (serveEmbedder) against a fake port.
 * The stand-in does its work synchronously, as onnxruntime's load and runs do, so these show what the event loop sees.
 */

import { join } from 'path';
import { monitorEventLoopDelay } from 'perf_hooks';
import { Worker } from 'worker_threads';

import { describe, expect, it, vi } from 'vitest';

import { getProfile, type EmbeddingProfile } from '@dethernety/dt-module/embedding';

import { forgetVerifiedFiles, profileRoot, seedVerifiedFiles } from '../acquire';
import type { Embedder } from '../embedder';
import { serveEmbedder, type PortLike } from '../worker';
import {
  createWorkerEmbedder,
  EmbedderBusyError,
  EmbedTimeoutError,
  type WorkerInit,
  type WorkerReply,
  type WorkerRequest,
} from '../worker-embedder';

const PROFILE: EmbeddingProfile = getProfile('embeddinggemma-300m-retrieval-v1');
const FAKE = join(__dirname, 'fixtures', 'fake-worker.cjs');

/** Spawns the stand-in with its mode, and records the worker so a test can watch it exit. */
function stand(mode: 'ok' | 'hang' | 'fail', extra: Record<string, unknown> = {}) {
  const spawned: Worker[] = [];
  const spawn = (init: WorkerInit) => {
    const worker = new Worker(FAKE, { workerData: { ...init, mode, ...extra } });
    spawned.push(worker);
    return worker;
  };
  return { spawn, spawned };
}

const exited = (worker: Worker) => new Promise<number>((resolve) => worker.once('exit', resolve));

describe('createWorkerEmbedder', () => {
  it('answers each call with its own vectors, whatever the order the calls were made in', async () => {
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    expect(embedder.profileId).toBe(PROFILE.id);
    expect(embedder.dimensions).toBe(PROFILE.runtime.dimensions);
    const [a, b, c] = await Promise.all([
      embedder.embed('query', [{ text: 'a' }]),
      embedder.embed('document', [{ text: 'bbb' }, { text: 'cc' }]),
      embedder.embed('query', []),
    ]);
    expect(a).toEqual([[1, 0]]);
    expect(b).toEqual([[3, 0], [2, 1]]);
    expect(c).toEqual([]);
    await embedder.release();
  });

  it('matches a reply to its call by id when replies arrive out of order', async () => {
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    const [late, early] = await Promise.all([embedder.embed('query', [{ text: 'late-xx' }]), embedder.embed('query', [{ text: 'e' }])]);
    expect(late).toEqual([[7, 0]]);
    expect(early).toEqual([[1, 0]]);
    await embedder.release();
  });

  it('passes the profile, the model directory and the session options to the worker', async () => {
    let seen: WorkerInit | undefined;
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models/x', {
      threads: 3,
      batchSize: 8,
      loadTimeoutMs: 5_000,
      spawn: (init) => ((seen = init), spawn(init)),
    });
    // The profile itself travels, and no verification records for files this thread never verified.
    expect(seen).toEqual({ kind: 'dethernety-embedder', profile: PROFILE, modelDir: '/models/x', options: { threads: 3, batchSize: 8 }, verified: [] });
    await embedder.release();
  });

  it('hands the worker the files this thread verified, so it does not hash them again', async () => {
    const config = join(profileRoot(PROFILE, '/models/y'), 'config.json');
    seedVerifiedFiles([[config, { stat: '1:2:3:4:5', sha256: 'f'.repeat(64) }]]);
    let seen: WorkerInit | undefined;
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models/y', { spawn: (init) => ((seen = init), spawn(init)) });
    expect(seen?.verified).toEqual([[config, { stat: '1:2:3:4:5', sha256: 'f'.repeat(64) }]]);
    await embedder.release();
    forgetVerifiedFiles();
  });

  it('rejects one call the worker could not embed, and keeps serving', async () => {
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    await expect(embedder.embed('query', [{ text: 'throw' }])).rejects.toThrow('cannot embed that');
    await expect(embedder.embed('query', [{ text: 'ok' }])).resolves.toEqual([[2, 0]]);
    await embedder.release();
  });

  it('a worker that exits rejects every pending call, refuses new ones and reports the failure once', async () => {
    const onFailure = vi.fn();
    const { spawn } = stand('ok', { busyMs: 50 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, onFailure });
    const slow = embedder.embed('query', [{ text: 'slow' }]);
    const crash = embedder.embed('query', [{ text: 'crash' }]);
    const after = embedder.embed('query', [{ text: 'never' }]);
    await expect(slow).resolves.toEqual([[4, 0]]);
    await expect(crash).rejects.toThrow('embedder worker exited (code 3)');
    await expect(after).rejects.toThrow('embedder worker exited (code 3)');
    await expect(embedder.embed('query', [{ text: 'later' }])).rejects.toThrow('embedder worker exited (code 3)');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].message).toBe('embedder worker exited (code 3)');
  });

  it('bounds the start: a worker stuck in a synchronous JavaScript call fails it, and is ended', async () => {
    // A JavaScript loop can be interrupted; a worker inside a native call (onnxruntime's load) ends only when the call
    // returns, but the start still fails on time and the worker no longer holds the process open.
    const { spawn, spawned } = stand('hang');
    const t = Date.now();
    await expect(createWorkerEmbedder(PROFILE, '/models', { spawn, loadTimeoutMs: 300 })).rejects.toThrow(
      'the embedding model did not load within 0.3 s',
    );
    expect(Date.now() - t).toBeLessThan(5_000);
    await exited(spawned[0]);
  });

  it('a worker stopped on the load timeout no longer holds the process open, even if it cannot end yet', async () => {
    // A worker inside a native call ends only when the call returns: it must not keep the process alive meanwhile.
    const unref = vi.fn();
    const terminate = vi.fn(() => new Promise<number>(() => undefined));
    const fake = { postMessage: vi.fn(), on: vi.fn(), terminate, unref };
    await expect(createWorkerEmbedder(PROFILE, '/models', { spawn: () => fake, loadTimeoutMs: 50 })).rejects.toThrow('did not load within 0.1 s');
    expect(unref).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('fails the start with the worker\'s own reason when the load fails', async () => {
    const onFailure = vi.fn();
    const { spawn } = stand('fail', { message: 'tokenizer.json is not valid JSON' });
    await expect(createWorkerEmbedder(PROFILE, '/models', { spawn, onFailure })).rejects.toThrow('tokenizer.json is not valid JSON');
    // A failure before ready is the start's, reported by the rejection, not by onFailure.
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('a release stops waiting for the worker\'s answer once the worker dies', async () => {
    const { spawn, spawned } = stand('ok', { busyMs: 2_000 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, releaseTimeoutMs: 30_000 });
    // Busy for 2 s, so the release request is not answered before the worker is killed.
    void embedder.embed('query', [{ text: 'busy' }]).catch(() => undefined);
    const t = Date.now();
    const released = embedder.release();
    await spawned[0].terminate();
    await released;
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it('release asks the worker to free the session, then ends it; later calls are refused and nothing is reported', async () => {
    const onFailure = vi.fn();
    const { spawn, spawned } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, onFailure });
    const exit = exited(spawned[0]);
    await embedder.release();
    await exit;
    await expect(embedder.embed('query', [{ text: 'x' }])).rejects.toThrow('the embedder was released');
    await embedder.release();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('keeps the event loop free while the worker embeds', async () => {
    // The stand-in holds its thread for 150 ms per call, as a session run does. In the worker, the main loop's worst
    // delay stays far below that; the same work on the main thread delays it by the whole call.
    const histogram = monitorEventLoopDelay({ resolution: 5 });
    const { spawn } = stand('ok', { busyMs: 150 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    histogram.enable();
    for (let i = 0; i < 4; i++) await embedder.embed('query', [{ text: 'x' }]);
    histogram.disable();
    const inWorkerMs = histogram.max / 1e6;
    await embedder.release();

    histogram.reset();
    histogram.enable();
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      const end = Date.now() + 150;
      while (Date.now() < end);
    }
    await new Promise((r) => setTimeout(r, 20));
    histogram.disable();
    const inThreadMs = histogram.max / 1e6;

    // Relative, so a loaded machine does not fail it: in the worker the loop waits a fraction of what it waits in-thread.
    expect(inThreadMs).toBeGreaterThan(120);
    expect(inWorkerMs).toBeLessThan(inThreadMs / 2);
  });
});

describe('the query backlog and the timeout', () => {
  const items = (n: number, text = 'q') => Array.from({ length: n }, () => ({ text }));
  const backlogOf = (embedder: unknown) => (embedder as { queryBacklog: number }).queryBacklog;

  it('a query embed past its timeout rejects with EmbedTimeoutError, and its late result is dropped', async () => {
    const { spawn } = stand('ok', { busyMs: 300 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    const t = Date.now();
    const late = embedder.embed('query', [{ text: 'slow' }], { timeoutMs: 50 });
    await expect(late).rejects.toBeInstanceOf(EmbedTimeoutError);
    await expect(late).rejects.toThrow('the embedder did not answer within 0.1 s');
    // dt-ws tells the two overload errors apart by name, without loading this package.
    await expect(late).rejects.toMatchObject({ name: 'EmbedTimeoutError' });
    expect(Date.now() - t).toBeLessThan(250);
    // The worker's answer to it comes later and settles nothing; the next call gets its own vectors.
    await expect(embedder.embed('query', [{ text: 'next' }])).resolves.toEqual([[4, 0]]);
    expect(backlogOf(embedder)).toBe(0);
    await embedder.release();
  });

  it('an embed without a timeout waits for the worker, however long it takes', async () => {
    const { spawn } = stand('ok', { busyMs: 300 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    await expect(embedder.embed('query', [{ text: 'slow' }])).resolves.toEqual([[4, 0]]);
    await expect(embedder.embed('document', [{ text: 'slow' }], {})).resolves.toEqual([[4, 0]]);
    await embedder.release();
  });

  it('keeps a timed-out call in the backlog until the worker answers it', async () => {
    const { spawn } = stand('ok', { busyMs: 300 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, queryBacklogItems: 3 });
    const first = embedder.embed('query', items(3), { timeoutMs: 30 });
    await expect(first).rejects.toBeInstanceOf(EmbedTimeoutError);
    // The worker still holds those three items: a new query embed is refused, not queued behind them.
    expect(backlogOf(embedder)).toBe(3);
    await expect(embedder.embed('query', items(1), { timeoutMs: 30 })).rejects.toBeInstanceOf(EmbedderBusyError);
    await vi.waitFor(() => expect(backlogOf(embedder)).toBe(0), { timeout: 2_000 });
    await expect(embedder.embed('query', items(3))).resolves.toHaveLength(3);
    await embedder.release();
  });

  it('refuses a query embed over the limit at once, counting items, and still accepts a document embed', async () => {
    const { spawn } = stand('ok', { busyMs: 200 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, queryBacklogItems: 3 });
    const held = embedder.embed('query', items(2));
    // Two items are waiting: one more fits, two more do not.
    const t = Date.now();
    const refused = embedder.embed('query', items(2));
    await expect(refused).rejects.toBeInstanceOf(EmbedderBusyError);
    await expect(refused).rejects.toThrow('the embedder is busy: 2 query items are waiting, and 2 more would pass the limit of 3');
    await expect(refused).rejects.toMatchObject({ name: 'EmbedderBusyError' });
    expect(Date.now() - t).toBeLessThan(100);
    const fits = embedder.embed('query', items(1));
    // The backlog is full; a document embed is neither counted nor refused.
    await expect(embedder.embed('query', items(1))).rejects.toBeInstanceOf(EmbedderBusyError);
    const documents = embedder.embed('document', items(5));
    expect(backlogOf(embedder)).toBe(3);
    await expect(held).resolves.toHaveLength(2);
    await expect(fits).resolves.toHaveLength(1);
    await expect(documents).resolves.toHaveLength(5);
    await embedder.release();
  });

  it('accepts one maximum request (100 items) on an idle worker by default, and refuses what passes 200', async () => {
    const { spawn } = stand('ok', { busyMs: 100 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn });
    const a = embedder.embed('query', items(100));
    const b = embedder.embed('query', items(100));
    await expect(embedder.embed('query', items(1))).rejects.toBeInstanceOf(EmbedderBusyError);
    await expect(a).resolves.toHaveLength(100);
    await expect(b).resolves.toHaveLength(100);
    await embedder.release();
  });

  it('the backlog drops on a reply and on an error', async () => {
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, queryBacklogItems: 2 });
    await expect(embedder.embed('query', items(2))).resolves.toHaveLength(2);
    expect(backlogOf(embedder)).toBe(0);
    await expect(embedder.embed('query', [{ text: 'throw' }, { text: 'x' }])).rejects.toThrow('cannot embed that');
    expect(backlogOf(embedder)).toBe(0);
    await expect(embedder.embed('query', items(2))).resolves.toHaveLength(2);
    await embedder.release();
  });

  it('the backlog drops when the worker fails, and every call then gets the failure', async () => {
    const { spawn } = stand('ok', { busyMs: 50 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, queryBacklogItems: 5 });
    const waiting = embedder.embed('query', items(3), { timeoutMs: 5_000 });
    const crash = embedder.embed('query', [{ text: 'crash' }]);
    crash.catch(() => undefined);
    expect(backlogOf(embedder)).toBe(4);
    await expect(waiting).resolves.toHaveLength(3);
    await expect(crash).rejects.toThrow('embedder worker exited (code 3)');
    expect(backlogOf(embedder)).toBe(0);
    await expect(embedder.embed('query', items(1))).rejects.toThrow('embedder worker exited (code 3)');
  });

  it('a release still rejects whatever is pending, timed or not', async () => {
    const { spawn } = stand('ok', { busyMs: 2_000 });
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { spawn, releaseTimeoutMs: 100 });
    const calls = Promise.allSettled([
      embedder.embed('query', [{ text: 'busy' }]),
      embedder.embed('query', [{ text: 'timed' }], { timeoutMs: 60_000 }),
      embedder.embed('document', [{ text: 'doc' }]),
    ]);
    await embedder.release();
    const reasons = (await calls).map((c) => (c.status === 'rejected' ? (c.reason as Error).message : c.status));
    expect(reasons).toEqual(['the embedder was released', 'the embedder was released', 'the embedder was released']);
    expect(backlogOf(embedder)).toBe(0);
  });

  it('keeps its own option out of the worker\'s session options', async () => {
    let seen: WorkerInit | undefined;
    const { spawn } = stand('ok');
    const embedder = await createWorkerEmbedder(PROFILE, '/models', { threads: 2, queryBacklogItems: 7, spawn: (init) => ((seen = init), spawn(init)) });
    expect(seen?.options).toEqual({ threads: 2 });
    await embedder.release();
  });
});

/** A port that records what the worker posts and lets a test send it requests. */
function fakePort() {
  const posted: WorkerReply[] = [];
  let listener: ((m: WorkerRequest) => void) | undefined;
  const port: PortLike = {
    postMessage: (m) => posted.push(m),
    on: (_event, l) => (listener = l),
  };
  const send = (m: WorkerRequest) => listener?.(m);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { port, posted, send, settle };
}

function fakeEmbedder(over: Partial<Embedder> = {}): Embedder {
  return {
    profileId: 'p',
    dimensions: 2,
    embed: async (_kind, items) => items.map((it) => [it.text.length, 0]),
    release: async () => undefined,
    ...over,
  };
}

describe('serveEmbedder (the worker side)', () => {
  it('says ready after the load, then answers each request by its id', async () => {
    const { port, posted, send, settle } = fakePort();
    await serveEmbedder(port, async () => fakeEmbedder());
    expect(posted).toEqual([{ type: 'ready' }]);
    send({ type: 'embed', id: 7, kind: 'query', items: [{ text: 'abc' }] });
    await settle();
    expect(posted[1]).toEqual({ type: 'result', id: 7, vectors: [[3, 0]] });
  });

  it('says failed with the reason when the load throws, and serves nothing', async () => {
    const { port, posted, send, settle } = fakePort();
    await serveEmbedder(port, async () => {
      throw new Error('weights do not verify');
    });
    expect(posted).toEqual([{ type: 'failed', message: 'weights do not verify' }]);
    send({ type: 'embed', id: 1, kind: 'query', items: [{ text: 'x' }] });
    await settle();
    expect(posted).toHaveLength(1);
  });

  it('answers an error for a request that throws, and serves the next one', async () => {
    const { port, posted, send, settle } = fakePort();
    let n = 0;
    await serveEmbedder(port, async () =>
      fakeEmbedder({
        embed: async () => {
          if (n++ === 0) throw new Error('bad input');
          return [[1, 1]];
        },
      }),
    );
    send({ type: 'embed', id: 1, kind: 'query', items: [{ text: 'x' }] });
    send({ type: 'embed', id: 2, kind: 'query', items: [{ text: 'y' }] });
    await settle();
    await settle();
    expect(posted.slice(1)).toEqual([
      { type: 'error', id: 1, message: 'bad input' },
      { type: 'result', id: 2, vectors: [[1, 1]] },
    ]);
  });

  it('serves requests one at a time, in arrival order', async () => {
    const { port, posted, send } = fakePort();
    const order: string[] = [];
    await serveEmbedder(port, async () =>
      fakeEmbedder({
        embed: async (_k, items) => {
          order.push(`start ${items[0].text}`);
          await new Promise((r) => setTimeout(r, items[0].text === 'slow' ? 30 : 1));
          order.push(`end ${items[0].text}`);
          return [[0, 0]];
        },
      }),
    );
    send({ type: 'embed', id: 1, kind: 'query', items: [{ text: 'slow' }] });
    send({ type: 'embed', id: 2, kind: 'query', items: [{ text: 'fast' }] });
    await vi.waitFor(() => expect(posted).toHaveLength(3));
    expect(order).toEqual(['start slow', 'end slow', 'start fast', 'end fast']);
    expect(posted.slice(1).map((p) => (p as { id: number }).id)).toEqual([1, 2]);
  });

  it('releases the session on request and says released', async () => {
    const { port, posted, send, settle } = fakePort();
    const release = vi.fn(async () => undefined);
    await serveEmbedder(port, async () => fakeEmbedder({ release }));
    send({ type: 'release' });
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(posted.at(-1)).toEqual({ type: 'released' });
  });
});
