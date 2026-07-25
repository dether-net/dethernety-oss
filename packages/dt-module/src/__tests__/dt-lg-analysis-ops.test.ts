/**
 * DtLgAnalysisOps run durability.
 *
 * The create-and-stream run endpoint defaults `on_disconnect` to "cancel", so a
 * dropped observation stream (browser refresh / navigation / a transient blip on
 * the dt-ws consumer) would CANCEL the underlying run — a long analysis would die
 * the moment the user refreshed. `startStream` must therefore pass
 * `onDisconnect: "continue"` to `client.runs.stream` so the run lifecycle is
 * decoupled from the observation stream.
 *
 * Strategy: construct the ops against a fake Client whose `runs.stream` records its
 * arguments and yields nothing, then assert every run-starting entrypoint
 * (runAnalysis / resumeAnalysis / startChat) sends `onDisconnect: "continue"`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DtLgAnalysisOps } from '../dt-lg-analysis-ops';

function makeOps() {
  const streamCalls: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async function* emptyStream() {
    /* yields nothing — startStream's for-await exits immediately */
  }
  const client: any = {
    threads: {
      create: vi.fn(async () => ({ thread_id: 't1' })),
      delete: vi.fn(async () => undefined),
      get: vi.fn(async () => ({ status: 'idle', created_at: '', updated_at: '', metadata: {} })),
      getState: vi.fn(async () => ({ values: {} })),
    },
    runs: {
      stream: vi.fn((sessionId: string, assistantId: string, payload: any) => {
        streamCalls.push({ sessionId, assistantId, payload });
        return emptyStream();
      }),
      list: vi.fn(async () => []),
    },
  };
  const config: any = {
    graphs: {
      'Analysis Copilot': {
        input: async (scope: string, analysisId?: string) => ({
          analysis_id: analysisId,
          model_id: scope,
        }),
      },
    },
  };
  const logger: any = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const pubSub: any = { publish: vi.fn() };
  const ops = new DtLgAnalysisOps(client, config, logger);
  return { ops, client, pubSub, streamCalls };
}

// startStream is fire-and-forget (.catch); let its async body reach client.runs.stream.
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * A signal-aware stream: yields one content chunk, then blocks until its run's AbortSignal
 * fires (mimicking the real SDK, whose loop ends when the signal aborts). Lets a test hold a
 * run "in flight" and then cancel it. Returns the payload's captured signal via a shared ref.
 */
function makeBlockingStream(captured: { signal?: AbortSignal }) {
  return (_sessionId: string, _assistantId: string, payload: any) => {
    captured.signal = payload.signal;
    async function* stream() {
      yield { event: 'updates', data: { messages: [{ content: 'partial', type: 'AIMessage' }] } };
      await new Promise<void>((resolve) => {
        if (payload.signal?.aborted) resolve();
        else payload.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    return stream();
  };
}

const typesPublished = (pubSub: any): string[] =>
  pubSub.publish.mock.calls.map((c: any[]) => c[1].streamResponse.type);

describe('DtLgAnalysisOps run durability', () => {
  let h: ReturnType<typeof makeOps>;
  beforeEach(() => {
    h = makeOps();
  });

  it('runAnalysis streams with onDisconnect: continue', async () => {
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(h.client.runs.stream).toHaveBeenCalled();
    expect(h.streamCalls[0].payload.onDisconnect).toBe('continue');
  });

  it('resumeAnalysis streams with onDisconnect: continue', async () => {
    await h.ops.resumeAnalysis('s1', 'a1', 'some-input', h.pubSub);
    await flush();
    expect(h.streamCalls[0]?.payload?.onDisconnect).toBe('continue');
  });

  it('startChat streams with onDisconnect: continue', async () => {
    await h.ops.startChat('s1', 'a1', 'hello?', 'model-1', h.pubSub);
    await flush();
    expect(h.streamCalls[0]?.payload?.onDisconnect).toBe('continue');
  });

  it('does not default on_disconnect to cancel (the run-killing behaviour)', async () => {
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(h.streamCalls[0].payload.onDisconnect).not.toBe('cancel');
  });
});

describe('DtLgAnalysisOps terminal stream events', () => {
  let h: ReturnType<typeof makeOps>;
  beforeEach(() => {
    h = makeOps();
  });

  it('publishes a terminal complete event when the stream ends normally', async () => {
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(h.pubSub.publish).toHaveBeenCalledWith('streamResponse', {
      streamResponse: expect.objectContaining({ type: 'complete', content: '' }),
      sessionId: 's1',
    });
  });

  it('publishes a terminal error event carrying the message when the stream throws', async () => {
    h.client.runs.stream = vi.fn(() => {
      throw new Error('boom');
    });
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    // Terminal content is EMPTY so a content-only subscriber ignores it; the
    // error detail rides on additional_kwargs.error.
    expect(h.pubSub.publish).toHaveBeenCalledWith('streamResponse', {
      streamResponse: expect.objectContaining({
        type: 'error',
        content: '',
        additional_kwargs: { error: 'boom' },
      }),
      sessionId: 's1',
    });
  });

  it('emits content chunks before the terminal complete event', async () => {
    async function* oneMessage() {
      yield { event: 'updates', data: { messages: [{ content: 'hi', type: 'AIMessage' }] } };
    }
    h.client.runs.stream = vi.fn(() => oneMessage());
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    const types = h.pubSub.publish.mock.calls.map((c: any[]) => c[1].streamResponse.type);
    expect(types.length).toBeGreaterThanOrEqual(2);
    expect(types[types.length - 1]).toBe('complete');
  });

  it('publishes a terminal error (not complete) when the run fails in-graph via a yielded error event', async () => {
    async function* erroredRun() {
      yield { event: 'error', data: { error: 'GraphError', message: 'graph blew up' } };
    }
    h.client.runs.stream = vi.fn(() => erroredRun());
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(h.pubSub.publish).toHaveBeenCalledWith('streamResponse', {
      streamResponse: expect.objectContaining({
        type: 'error',
        content: '',
        additional_kwargs: { error: 'graph blew up' },
      }),
      sessionId: 's1',
    });
    const types = h.pubSub.publish.mock.calls.map((c: any[]) => c[1].streamResponse.type);
    expect(types).toContain('error');
    expect(types).not.toContain('complete');
  });
});

describe('DtLgAnalysisOps run registry — cancellation', () => {
  let h: ReturnType<typeof makeOps>;
  beforeEach(() => {
    h = makeOps();
  });

  it('passes an AbortSignal to runs.stream', async () => {
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(h.streamCalls[0].payload.signal).toBeInstanceOf(AbortSignal);
    expect(h.streamCalls[0].payload.signal.aborted).toBe(false);
  });

  it('stopRun aborts the in-flight run, clears the registry, and suppresses the terminal', async () => {
    const captured: { signal?: AbortSignal } = {};
    h.client.runs.stream = vi.fn(makeBlockingStream(captured));
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush(); // run is now in flight (blocked awaiting abort)

    expect(h.ops.stopRun('s1')).toBe(true);
    expect(captured.signal?.aborted).toBe(true);
    await flush(); // let the aborted stream unwind

    // A cancelled run must NOT publish a terminal complete/error to a torn-down session.
    expect(typesPublished(h.pubSub)).not.toContain('complete');
    expect(typesPublished(h.pubSub)).not.toContain('error');
    // Registry cleared — a second stop finds nothing.
    expect(h.ops.stopRun('s1')).toBe(false);
  });

  it('deleteSession aborts the run BEFORE deleting the thread (no publish-after-delete)', async () => {
    const captured: { signal?: AbortSignal } = {};
    h.client.runs.stream = vi.fn(makeBlockingStream(captured));
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();

    const ok = await h.ops.deleteSession('s1');
    expect(ok).toBe(true);
    expect(captured.signal?.aborted).toBe(true);
    expect(h.client.threads.delete).toHaveBeenCalledWith('s1');
    await flush();
    expect(typesPublished(h.pubSub)).not.toContain('complete');
  });

  it('a second run on the same session supersedes (aborts) the first — no interleave', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    h.client.runs.stream = vi.fn((_s: string, _a: string, payload: any) => {
      signals.push(payload.signal);
      async function* stream() {
        yield { event: 'updates', data: { messages: [{ content: 'x', type: 'AIMessage' }] } };
        await new Promise<void>((resolve) => {
          if (payload.signal?.aborted) resolve();
          else payload.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      return stream();
    });

    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();

    expect(signals[0]?.aborted).toBe(true); // first run superseded
    expect(signals[1]?.aborted).toBe(false); // second run still live
    // Clean up the still-live second run so its generator settles.
    h.ops.stopRun('s1');
    await flush();
  });

  it('does not publish a content chunk that arrives after the run was aborted', async () => {
    // Mimics the SDK resolving a buffered read() just as the abort fires: yield one chunk,
    // block until aborted, then yield a second chunk. The loop must break before publishing it.
    let captured: AbortSignal | undefined;
    h.client.runs.stream = vi.fn((_s: string, _a: string, payload: any) => {
      captured = payload.signal;
      async function* stream() {
        yield { event: 'updates', data: { messages: [{ content: 'before', type: 'AIMessage' }] } };
        await new Promise<void>((resolve) => {
          if (payload.signal?.aborted) resolve();
          else payload.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { event: 'updates', data: { messages: [{ content: 'after-abort', type: 'AIMessage' }] } };
      }
      return stream();
    });
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();
    expect(captured).toBeDefined();

    h.ops.stopRun('s1');
    await flush();

    const contents = h.pubSub.publish.mock.calls.map((c: any[]) => c[1].streamResponse.content);
    expect(contents).toContain('before'); // published before the abort
    expect(contents).not.toContain('after-abort'); // buffered post-abort chunk suppressed
    expect(typesPublished(h.pubSub)).not.toContain('complete'); // no terminal either
  });

  it('abortAll aborts every in-flight run and empties the registry', async () => {
    const c1: { signal?: AbortSignal } = {};
    const c2: { signal?: AbortSignal } = {};
    let call = 0;
    h.client.runs.stream = vi.fn((s: string, a: string, payload: any) => {
      (call++ === 0 ? c1 : c2).signal = payload.signal;
      async function* stream() {
        yield { event: 'updates', data: { messages: [{ content: 'x', type: 'AIMessage' }] } };
        await new Promise<void>((resolve) => {
          if (payload.signal?.aborted) resolve();
          else payload.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      return stream();
    });
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await h.ops.runAnalysis('s2', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();

    h.ops.abortAll();
    expect(c1.signal?.aborted).toBe(true);
    expect(c2.signal?.aborted).toBe(true);
    await flush();
    expect(h.ops.stopRun('s1')).toBe(false);
    expect(h.ops.stopRun('s2')).toBe(false);
  });
});

describe('DtLgAnalysisOps getStatus — read-only (no zombie thread)', () => {
  let h: ReturnType<typeof makeOps>;
  beforeEach(() => {
    h = makeOps();
  });

  it('does not create the thread and returns a benign status when the session is absent', async () => {
    h.client.threads.get = vi.fn(async () => {
      throw new Error('404: thread not found');
    });
    const status = await h.ops.getStatus('missing');
    expect(h.client.threads.create).not.toHaveBeenCalled(); // the zombie regression
    expect(status.status).not.toBe('failed'); // 'failed' would misfire the UI into an error state
    expect(status.status).toBe('');
    expect(status.hasDocument).toBe(false);
  });

  it('still reports failed when the thread exists but reading its state errors', async () => {
    h.client.threads.get = vi.fn(async () => ({ status: 'idle', created_at: '', updated_at: '', metadata: {} }));
    h.client.threads.getState = vi.fn(async () => {
      throw new Error('state read boom');
    });
    const status = await h.ops.getStatus('s1');
    expect(status.status).toBe('failed');
    expect(h.client.threads.create).not.toHaveBeenCalled();
  });
});

describe('DtLgAnalysisOps message projection — trust boundary', () => {
  let h: ReturnType<typeof makeOps>;
  beforeEach(() => {
    h = makeOps();
  });

  it('drops response_metadata and other non-whitelisted fields from published content chunks', async () => {
    async function* rich() {
      yield {
        event: 'updates',
        data: {
          messages: [
            {
              content: 'hi',
              type: 'AIMessage',
              additional_kwargs: { tool: 'x' },
              response_metadata: { model_name: 'secret-model', token_usage: { total: 99 } },
              secret_backend_field: 'leak',
            },
          ],
        },
      };
    }
    h.client.runs.stream = vi.fn(() => rich());
    await h.ops.runAnalysis('s1', 'a1', 'Analysis Copilot', 'model-1', h.pubSub);
    await flush();

    const contentPublish = h.pubSub.publish.mock.calls.find(
      (c: any[]) => c[1].streamResponse.content === 'hi',
    );
    expect(contentPublish).toBeDefined();
    const msg = contentPublish![1].streamResponse;
    expect(msg).not.toHaveProperty('response_metadata');
    expect(msg).not.toHaveProperty('secret_backend_field');
    expect(msg.additional_kwargs).toEqual({ tool: 'x' }); // legitimate field preserved
  });
});
