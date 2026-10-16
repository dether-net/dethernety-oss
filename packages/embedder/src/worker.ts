/**
 * The embedder's worker thread. It opens the profile's files, creates the onnxruntime session and answers embed
 * requests by message, so tokenising, the session load and every session run happen off the main thread's event loop.
 * The main thread side is `createWorkerEmbedder` (worker-embedder.ts); the messages are `WorkerRequest` and
 * `WorkerReply` there.
 */

import { isMainThread, parentPort, workerData } from 'worker_threads';

import { seedVerifiedFiles } from './acquire';
import { createOnnxEmbedder, type Embedder } from './embedder';
import { WORKER_DATA_KIND, type WorkerInit, type WorkerReply, type WorkerRequest } from './worker-embedder';

/** The part of a MessagePort the worker uses. */
export interface PortLike {
  postMessage(message: WorkerReply): void;
  on(event: 'message', listener: (message: WorkerRequest) => void): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Load the embedder, say `ready` (or `failed`, and stop), then answer each request. Requests are served one at a
 * time, in arrival order: onnxruntime already uses its intra-op threads for one run.
 */
export async function serveEmbedder(port: PortLike, load: () => Promise<Embedder>): Promise<void> {
  let embedder: Embedder;
  try {
    embedder = await load();
  } catch (error) {
    port.postMessage({ type: 'failed', message: messageOf(error) });
    return;
  }
  let queue = Promise.resolve();
  port.on('message', (request) => {
    queue = queue.then(async () => {
      if (request.type === 'embed') {
        try {
          port.postMessage({ type: 'result', id: request.id, vectors: await embedder.embed(request.kind, request.items) });
        } catch (error) {
          port.postMessage({ type: 'error', id: request.id, message: messageOf(error) });
        }
      } else if (request.type === 'release') {
        await embedder.release().catch(() => undefined);
        port.postMessage({ type: 'released' });
      }
    });
  });
  port.postMessage({ type: 'ready' });
}

if (!isMainThread && parentPort && (workerData as WorkerInit | undefined)?.kind === WORKER_DATA_KIND) {
  const init = workerData as WorkerInit;
  // The main thread verified these files just before starting the worker; a file changed since is hashed again.
  seedVerifiedFiles(init.verified ?? []);
  void serveEmbedder(parentPort as unknown as PortLike, () => createOnnxEmbedder(init.profile, init.modelDir, init.options));
}
