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
    threads: { create: vi.fn(async () => ({ thread_id: 't1' })) },
    runs: {
      stream: vi.fn((sessionId: string, assistantId: string, payload: any) => {
        streamCalls.push({ sessionId, assistantId, payload });
        return emptyStream();
      }),
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
