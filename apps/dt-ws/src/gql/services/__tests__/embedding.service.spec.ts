import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const ensureWeightsWithRetry = jest.fn(async () => undefined);
const embedVectors = async (_kind: string, items: Array<{ text: string; title?: string }>) => items.map(() => [1, 0]);
const embed = jest.fn(embedVectors);
const release = jest.fn(async () => undefined);
const createOnnxEmbedder = jest.fn(async () => ({ profileId: 'p', dimensions: 768, embed, release }));
jest.mock('@dethernety/embedder', () => ({ ensureWeightsWithRetry, createOnnxEmbedder }), { virtual: false });

import { EmbeddingService, describeError } from '../embedding.service';

const EG1 = 'embeddinggemma-300m-retrieval-v1';
const EG2 = 'embeddinggemma-2-text-retrieval-v1';

/** An Ollama-shaped answer: one vector of `dims` per input. */
function answer(dims: number) {
  return jest.fn(async (_url: string, init: { body: string }) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ embeddings: (JSON.parse(init.body).input as string[]).map(() => Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0))) }),
  }));
}

describe('EmbeddingService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    embed.mockImplementation(embedVectors);
    fetchMock = answer(768);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  /** Builds the service; an enabled HTTP embedder also runs its start-up check unless `start` is false. */
  async function buildService(envOverrides: Record<string, string | undefined> = {}, { start = true } = {}) {
    const svc = await compile(envOverrides);
    if (start && svc.getStatus().enabled && svc.getStatus().runtime === 'http') {
      svc.onModuleInit();
      await svc.whenStartupChecked();
    }
    return svc;
  }

  async function compile(envOverrides: Record<string, string | undefined>) {
    const defaults: Record<string, string> = {
      EMBEDDING_ENABLED: 'true',
      EMBEDDING_URL: 'http://localhost:11434/api/embed',
      EMBEDDING_MODEL: 'nomic-embed-text',
      EMBEDDING_DIMENSIONS: '768',
      EMBEDDING_SIMILARITY_THRESHOLD: '0.75',
    };
    const env = { ...defaults, ...envOverrides };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    return moduleRef.get(EmbeddingService);
  }

  describe('the HTTP embedder', () => {
    it('serves a model that is not a built-in profile, under the legacy thresholds', async () => {
      const svc = await buildService({ EMBEDDING_SIMILARITY_THRESHOLD: undefined });
      expect(svc.isEnabled()).toBe(true);
      expect(svc.getModel()).toBe('nomic-embed-text');
      expect(svc.getStatus()).toMatchObject({ runtime: 'http', profileId: 'embeddinggemma', state: 'ready' });
      expect(svc.getThreshold('classes')).toBe(0.4);
      expect(svc.getThreshold('mitre')).toBe(0.4);
      expect(svc.getThreshold('components')).toBeNull();
    });

    it('defaults to the legacy embeddinggemma model when EMBEDDING_MODEL is unset', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: undefined, EMBEDDING_SIMILARITY_THRESHOLD: undefined });
      expect(svc.getModel()).toBe('embeddinggemma');
      expect(svc.getThreshold('classes')).toBe(0.4);
    });

    it('takes EMBEDDING_SIMILARITY_THRESHOLD for classes and MITRE, not components', async () => {
      const svc = await buildService({ EMBEDDING_SIMILARITY_THRESHOLD: '0.55' });
      expect(svc.getThreshold('classes')).toBe(0.55);
      expect(svc.getThreshold('mitre')).toBe(0.55);
      expect(svc.getThreshold('components')).toBeNull();
    });

    it.each([
      ['EMBEDDING_SIMILARITY_THRESHOLD', 'high'],
      ['EMBEDDING_SIMILARITY_THRESHOLD', '1.5'],
      ['EMBEDDING_THRESHOLD_MITRE', 'NaN'],
      ['EMBEDDING_THRESHOLD_CLASSES', '-2'],
    ])('refuses to start with %s=%s, a floor that is not a cosine value', async (name, value) => {
      await expect(buildService({ [name]: value })).rejects.toThrow(`${name} must be a number from -1 to 1`);
    });

    it('takes a floor the validated configuration already turned into a number', async () => {
      const svc = await buildService({ EMBEDDING_SIMILARITY_THRESHOLD: 0.6 as unknown as string });
      expect(svc.getThreshold('classes')).toBe(0.6);
    });

    it('lets a per-corpus override win over EMBEDDING_SIMILARITY_THRESHOLD', async () => {
      const svc = await buildService({ EMBEDDING_SIMILARITY_THRESHOLD: '0.55', EMBEDDING_THRESHOLD_MITRE: '0.3' });
      expect(svc.getThreshold('classes')).toBe(0.55);
      expect(svc.getThreshold('mitre')).toBe(0.3);
    });

    it('takes EMBEDDING_DIMENSIONS', async () => {
      fetchMock = answer(384);
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = await buildService({ EMBEDDING_DIMENSIONS: '384' });
      expect(svc.getDimensions()).toBe(384);
      expect(svc.getState()).toBe('ready');
    });

    it('is loading, not ready, until its endpoint has answered a check', async () => {
      const svc = await buildService({}, { start: false });
      expect([svc.getState(), svc.isEnabled(), svc.isPending()]).toEqual(['loading', false, true]);

      svc.onModuleInit();
      await svc.whenStartupChecked();

      expect([svc.getState(), svc.isEnabled()]).toEqual(['ready', true]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/embed');
      expect(JSON.parse(init.body)).toEqual({ model: 'nomic-embed-text', input: ['warm-up'] });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('fails with the reason when the endpoint does not answer, and becomes ready once it does', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      const checked = svc.whenStartupChecked();
      await jest.advanceTimersByTimeAsync(1_000 + 3_000);
      await checked;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:11434' });
      expect(svc.isPending()).toBe(true);

      await jest.advanceTimersByTimeAsync(60_000);
      expect(svc.getState()).toBe('failed');

      fetchMock.mockImplementation(answer(768));
      await jest.advanceTimersByTimeAsync(60_000);
      expect([svc.getState(), svc.isEnabled(), svc.getStatus().error]).toEqual(['ready', true, undefined]);

      const calls = fetchMock.mock.calls.length;
      await jest.advanceTimersByTimeAsync(180_000);
      expect(fetchMock.mock.calls.length).toBe(calls);
      await svc.onModuleDestroy();
    });

    it('reports why fetch failed, from its cause, as Node\'s fetch gives it', async () => {
      jest.useFakeTimers();
      const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
      fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: refused }));
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(4_000);
      await svc.whenStartupChecked();
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'fetch failed (connect ECONNREFUSED 127.0.0.1:11434)' });
      await svc.onModuleDestroy();
    });

    it('fails when the endpoint answers with other dimensions than EMBEDDING_DIMENSIONS', async () => {
      jest.useFakeTimers();
      fetchMock = answer(384);
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      const checked = svc.whenStartupChecked();
      await jest.advanceTimersByTimeAsync(4_000);
      await checked;
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'the endpoint returned 384 dimensions; EMBEDDING_DIMENSIONS is 768' });
      await svc.onModuleDestroy();
    });

    it('shutting down while a check request is in flight cancels it, starts no other and leaves no timer', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
      );
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await svc.onModuleDestroy();
      await svc.whenStartupChecked();
      await jest.advanceTimersByTimeAsync(300_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(svc.getState()).not.toBe('failed');
    });

    it('shutting down during the back-off pause ends it at once, with no further attempt and no timer', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(new Error('down'));
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await svc.onModuleDestroy();
      await svc.whenStartupChecked();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(300_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops checking again on shutdown', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(new Error('down'));
      const svc = await buildService({}, { start: false });
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(4_000);
      await svc.whenStartupChecked();
      await svc.onModuleDestroy();
      const calls = fetchMock.mock.calls.length;
      await jest.advanceTimersByTimeAsync(300_000);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('never loads the in-process embedder', async () => {
      const svc = await buildService();
      await svc.whenSettled();
      expect(createOnnxEmbedder).not.toHaveBeenCalled();
    });
  });

  describe('an ONNX profile', () => {
    it('does not hold the start-up install while the weights download', async () => {
      let release!: () => void;
      ensureWeightsWithRetry.mockImplementationOnce(() => new Promise<undefined>((resolve) => (release = () => resolve(undefined))) as never);
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await expect(svc.whenStartupChecked()).resolves.toBeUndefined();
      expect(svc.getState()).toBe('downloading');
      release();
      await svc.whenSettled();
    });

    it('is not enabled until the weights are verified and the session is warm', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_MODEL_DIR: '/models' });
      expect(svc.getStatus()).toMatchObject({ runtime: 'onnx', profileId: EG1, state: 'downloading' });
      expect(svc.isEnabled()).toBe(false);
      await expect(svc.embedBatch(['x'], 'query')).resolves.toBeNull();

      svc.onModuleInit();
      await svc.whenSettled();
      expect(ensureWeightsWithRetry).toHaveBeenCalledWith(expect.objectContaining({ id: EG1 }), '/models', expect.anything());
      expect(createOnnxEmbedder).toHaveBeenCalledWith(expect.objectContaining({ id: EG1 }), '/models', { threads: 4 });
      expect(embed).toHaveBeenCalledWith('query', [{ text: 'warm-up' }]);
      expect(svc.getStatus().state).toBe('ready');
      expect(svc.isEnabled()).toBe(true);
    });

    it('stores the profile id as the model and takes the profile dimensions', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG2, EMBEDDING_DIMENSIONS: '384' });
      expect(svc.getModel()).toBe(EG2);
      expect(svc.getDimensions()).toBe(768);
    });

    it('passes the kind and the titles to the embedder', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await svc.whenSettled();
      await svc.embedBatch(['a', 'b'], 'document', ['A', 'B']);
      expect(embed).toHaveBeenLastCalledWith('document', [
        { text: 'a', title: 'A' },
        { text: 'b', title: 'B' },
      ]);
    });

    it('uses the profile thresholds and ignores EMBEDDING_SIMILARITY_THRESHOLD', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_SIMILARITY_THRESHOLD: '0.75' });
      expect(svc.getThreshold('classes')).toBe(0.35);
      expect(svc.getThreshold('mitre')).toBe(0.301);
      expect(svc.getThreshold('components')).toBeNull();
    });

    it('takes a per-corpus override', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG2, EMBEDDING_THRESHOLD_CLASSES: '0.7', EMBEDDING_THRESHOLD_COMPONENTS: '0.5' });
      expect(svc.getThreshold('classes')).toBe(0.7);
      expect(svc.getThreshold('mitre')).toBe(0.658);
      expect(svc.getThreshold('components')).toBe(0.5);
    });

    it('reports a failed acquisition and stays off', async () => {
      ensureWeightsWithRetry.mockRejectedValueOnce(new Error('onnx/model.onnx_data: sha256 differs from the profile') as never);
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await svc.whenSettled();
      expect(svc.isEnabled()).toBe(false);
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'onnx/model.onnx_data: sha256 differs from the profile' });
    });

    it('does nothing when EMBEDDING_ENABLED is not true', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_ENABLED: 'false' });
      svc.onModuleInit();
      await svc.whenSettled();
      expect(ensureWeightsWithRetry).not.toHaveBeenCalled();
      expect(svc.getStatus().state).toBe('disabled');
    });

    it('releases the session on shutdown', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await svc.whenSettled();
      await svc.onModuleDestroy();
      expect(release).toHaveBeenCalled();
    });
  });

  describe('isPending: enabled, but not able to embed yet', () => {
    it('is pending while an onnx model downloads, and after it failed; not once ready', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      expect([svc.getState(), svc.isPending()]).toEqual(['downloading', true]);
      svc.onModuleInit();
      await svc.whenSettled();
      expect([svc.getState(), svc.isPending()]).toEqual(['ready', false]);

      ensureWeightsWithRetry.mockRejectedValueOnce(new Error('download failed') as never);
      const failed = await buildService({ EMBEDDING_MODEL: EG1 });
      failed.onModuleInit();
      await failed.whenSettled();
      expect([failed.getState(), failed.isPending()]).toEqual(['failed', true]);
    });

    it('is not pending when embedding is disabled by configuration', async () => {
      const off = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_ENABLED: 'false' });
      expect([off.getState(), off.isPending()]).toEqual(['disabled', false]);
    });
  });

  describe('no switch-off for the session', () => {
    it('has no disableForSession, and nothing in dt-ws calls one', async () => {
      const svc = await buildService();
      expect('disableForSession' in svc).toBe(false);
      const { readdirSync, readFileSync } = await import('fs');
      const { join } = await import('path');
      // A walk that steps over a directory another suite removes mid-walk, rather than readdirSync's recursive mode.
      const walk = (dir: string): string[] => {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return [];
        }
        return entries.flatMap((e) =>
          e.isDirectory() ? (e.name === '__tests__' ? [] : walk(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
        );
      };
      const sources = walk(join(__dirname, '..', '..', '..'));
      expect(sources.length).toBeGreaterThan(50);
      const calls = sources.filter((f) => {
        try {
          return readFileSync(f, 'utf8').includes('disableForSession');
        } catch {
          return false;
        }
      });
      expect(calls).toEqual([]);
    });

    it('reports disabled only from the configuration, so /health shows the embedder as it is', async () => {
      const on = await buildService();
      expect([on.getState(), on.getStatus().state, on.isEnabled()]).toEqual(['ready', 'ready', true]);
      const off = await buildService({ EMBEDDING_ENABLED: 'false' });
      expect([off.getState(), off.getStatus()]).toEqual(['disabled', expect.objectContaining({ enabled: false, state: 'disabled' })]);
    });
  });

  describe('embedEach: one call per request, one vector per text', () => {
    it('embeds the texts in one call and returns their vectors in order', async () => {
      const svc = await buildService();
      const spy = jest.spyOn(svc, 'embedBatch');
      const { vectors, failures } = await svc.embedEach(['a', 'b', 'c'], 'query');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(['a', 'b', 'c'], 'query');
      expect([vectors.length, failures]).toEqual([3, []]);
    });

    /** An ONNX embedder, warmed up, whose embed calls the test then counts. */
    async function readyOnnx() {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await svc.whenSettled();
      embed.mockClear();
      return svc;
    }

    it('falls back to one text at a time when the in-process embedder throws, so only the bad text loses its vector', async () => {
      const svc = await readyOnnx();
      // A TypeError from the in-process embedder is a bug on some text, not an unreachable endpoint.
      embed.mockImplementation(async (_kind, items) => {
        if (items.some((it) => it.text === 'bad')) throw new TypeError('cannot embed');
        return items.map(() => [1, 0]);
      });
      const { vectors, failures } = await svc.embedEach(['good', 'bad', 'fine'], 'query');
      expect(vectors).toEqual([[1, 0], null, [1, 0]]);
      expect(failures).toEqual([{ index: 1, error: new TypeError('cannot embed') }]);
      expect(embed).toHaveBeenCalledTimes(4);
    });

    it('falls back too when the batch returns another number of vectors', async () => {
      const svc = await readyOnnx();
      embed.mockImplementation(async (_kind, items) => (items.length > 1 ? [[1, 0]] : [[0, 1]]));
      expect((await svc.embedEach(['a', 'b'], 'query')).vectors).toEqual([[0, 1], [0, 1]]);
      expect(embed).toHaveBeenCalledTimes(3);
    });

    describe('through the HTTP embedder, counting requests', () => {
      const unreachable = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
      /** Runs `work` while the embedder's 1 s and 3 s retry back-off elapses on fake timers. */
      async function settle<T>(work: Promise<T>): Promise<T> {
        let done = false;
        const p = work.finally(() => (done = true));
        while (!done) await jest.advanceTimersByTimeAsync(1_000);
        return p;
      }

      it('does not try a single text again after the embedder gave up on it', async () => {
        const svc = await buildService();
        jest.useFakeTimers();
        fetchMock.mockClear();
        fetchMock.mockRejectedValue(unreachable());
        const { vectors, failures } = await settle(svc.embedEach(['steal cached passwords'], 'query'));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect([vectors, failures.map((f) => f.index)]).toEqual([[null], [0]]);
      });

      it('fails every text at once when the endpoint cannot be reached, without one request per text', async () => {
        const svc = await buildService();
        jest.useFakeTimers();
        fetchMock.mockClear();
        fetchMock.mockRejectedValue(unreachable());
        const { vectors, failures } = await settle(svc.embedEach(['a', 'b', 'c'], 'query'));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(vectors).toEqual([null, null, null]);
        expect(failures.map((f) => [f.index, (f.error as Error).message])).toEqual([
          [0, 'fetch failed'],
          [1, 'fetch failed'],
          [2, 'fetch failed'],
        ]);
      });

      it('falls back to one text at a time when the endpoint answers the batch with an error', async () => {
        const svc = await buildService();
        jest.useFakeTimers();
        fetchMock.mockClear();
        const ok = answer(768);
        fetchMock.mockImplementation(async (url: string, init: { body: string }) =>
          (JSON.parse(init.body).input as string[]).includes('bad') ? { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) } : ok(url, init),
        );
        const { vectors, failures } = await settle(svc.embedEach(['good', 'bad'], 'query'));
        // The batch (three tries), then 'good' and 'bad' once each.
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect([vectors[0]?.length, vectors[1], failures.map((f) => f.index)]).toEqual([768, null, [1]]);
      });

      it('tries each text once when every request is answered with an error, not three times more', async () => {
        const svc = await buildService();
        jest.useFakeTimers();
        fetchMock.mockClear();
        fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) });
        const started = Date.now();
        const { vectors, failures } = await settle(svc.embedEach(['a', 'b', 'c'], 'query'));
        // The batch (three tries), then one request per text with no back-off of its own.
        expect(fetchMock).toHaveBeenCalledTimes(6);
        expect(Date.now() - started).toBeLessThanOrEqual(5_000);
        expect(vectors).toEqual([null, null, null]);
        expect(failures.map((f) => [f.index, (f.error as Error).message])).toEqual([
          [0, 'Embedding API returned 503: Service Unavailable'],
          [1, 'Embedding API returned 503: Service Unavailable'],
          [2, 'Embedding API returned 503: Service Unavailable'],
        ]);
      });
    });

    it('makes no call for no text, and gives nulls when the embedder is not enabled', async () => {
      const svc = await buildService();
      const spy = jest.spyOn(svc, 'embedBatch');
      expect(await svc.embedEach([], 'query')).toEqual({ vectors: [], failures: [] });
      expect(spy).not.toHaveBeenCalled();
      const off = await buildService({ EMBEDDING_ENABLED: 'false' });
      expect(await off.embedEach(['a', 'b'], 'query')).toEqual({ vectors: [null, null], failures: [] });
    });
  });

  describe('describeError', () => {
    it('adds a cause\'s message, or its code, and leaves a plain error as it is', () => {
      expect(describeError(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND ollama') }))).toBe('fetch failed (getaddrinfo ENOTFOUND ollama)');
      expect(describeError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))).toBe('fetch failed (UND_ERR_CONNECT_TIMEOUT)');
      expect(describeError(new Error('Embedding API returned 500: Internal Server Error'))).toBe('Embedding API returned 500: Internal Server Error');
      expect(describeError('down')).toBe('down');
    });
  });

  describe('composeClassText delegation', () => {
    it('matches the shared helper output', async () => {
      const svc = await buildService();
      expect(
        svc.composeClassText({
          name: 'X',
          description: 'd',
          category: 'Storage',
          type: 'STORE',
        }),
      ).toBe('X. d. Category: Storage. Type: STORE.');
    });
  });

  describe('EMBEDDING_ENABLED=false', () => {
    it('starts disabled', async () => {
      const svc = await buildService({ EMBEDDING_ENABLED: 'false' });
      expect(svc.isEnabled()).toBe(false);
      await expect(svc.embedBatch(['x'], 'query')).resolves.toBeNull();
    });
  });
});
