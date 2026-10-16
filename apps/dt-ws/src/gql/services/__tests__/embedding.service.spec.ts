import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const ensureWeightsWithRetry = jest.fn(async () => undefined);
const embedVectors = async (_kind: string, items: Array<{ text: string; title?: string }>, _options?: { timeoutMs?: number }) =>
  items.map(() => [1, 0]);
const embed = jest.fn(embedVectors);
const release = jest.fn(async () => undefined);
const createWorkerEmbedder = jest.fn(async (..._args: unknown[]) => ({ profileId: 'p', dimensions: 768, embed, release }));
const weightsPlaced = jest.fn(async () => false);
jest.mock('@dethernety/embedder', () => ({ ensureWeightsWithRetry, createWorkerEmbedder, weightsPlaced }), { virtual: false });

import { EmbeddingService, describeError, embedderOverload } from '../embedding.service';

/** The embedder package's two overload errors, by the names the service reads them by. */
const overload = (name: 'EmbedderBusyError' | 'EmbedTimeoutError', message = 'busy') => Object.assign(new Error(message), { name });

const EG1 = 'embeddinggemma-300m-retrieval-v1';
const EG2 = 'embeddinggemma-2-text-retrieval-v1';

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    embed.mockImplementation(embedVectors);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Builds the service, not started: embedding on and EMBEDDING_MODEL unset unless overridden. */
  async function buildService(envOverrides: Record<string, string | undefined> = {}) {
    const env: Record<string, string | undefined> = { EMBEDDING_ENABLED: 'true', ...envOverrides };

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

  /** A service whose in-process embedder has started and is ready. */
  async function readyService(envOverrides: Record<string, string | undefined> = {}) {
    const svc = await buildService(envOverrides);
    svc.onModuleInit();
    await svc.whenSettled();
    return svc;
  }

  describe('the profile', () => {
    it('is the default profile when EMBEDDING_MODEL is unset or blank, run in process', async () => {
      for (const model of [undefined, '', '  ']) {
        const svc = await buildService({ EMBEDDING_MODEL: model });
        expect(svc.getModel()).toBe(EG1);
        expect(svc.getDimensions()).toBe(768);
        expect(svc.getStatus()).toMatchObject({ enabled: true, runtime: 'onnx', profileId: EG1, state: 'downloading' });
      }
    });

    it.each([
      ['embeddinggemma', 'is no longer supported'],
      [EG2, 'is not available in this release'],
      ['nomic-embed-text', 'Unknown EMBEDDING_MODEL'],
    ])('refuses %s with embedding on', async (model, message) => {
      await expect(buildService({ EMBEDDING_MODEL: model })).rejects.toThrow(message);
    });

    it('refuses nothing with embedding off, and stays disabled on the default profile', async () => {
      const svc = await buildService({ EMBEDDING_ENABLED: 'false', EMBEDDING_MODEL: 'embeddinggemma' });
      expect(svc.getStatus()).toMatchObject({ enabled: false, profileId: EG1, state: 'disabled' });
    });

    it('reads EMBEDDING_ENABLED ignoring case and space, as the environment validation does', async () => {
      expect((await buildService({ EMBEDDING_ENABLED: ' TRUE ' })).getStatus().enabled).toBe(true);
      expect((await buildService({ EMBEDDING_ENABLED: 'yes' })).getStatus().enabled).toBe(false);
    });

    it('warns once about each old HTTP embedder setting it ignores, and changes nothing for them', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const svc = await buildService({
        EMBEDDING_URL: 'http://ollama:11434/api/embed',
        EMBEDDING_API_KEY: 'k',
        EMBEDDING_DIMENSIONS: '384',
        EMBEDDING_SIMILARITY_THRESHOLD: '0.75',
      });
      const messages = warn.mock.calls.map((c) => String(c[0]));
      for (const name of ['EMBEDDING_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_DIMENSIONS', 'EMBEDDING_SIMILARITY_THRESHOLD']) {
        expect(messages.filter((m) => m.startsWith(`${name} is ignored by the platform's embedder`))).toHaveLength(1);
      }
      expect([svc.getDimensions(), svc.getThreshold('classes'), svc.getThreshold('mitre')]).toEqual([768, 0.35, 0.301]);
    });

    it('says nothing about them when they are blank, or when embedding is off', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await buildService({ EMBEDDING_URL: ' ', EMBEDDING_SIMILARITY_THRESHOLD: '' });
      await buildService({ EMBEDDING_ENABLED: 'false', EMBEDDING_URL: 'http://ollama:11434/api/embed' });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('the start-up wait and the ready signal', () => {
    it('waits for an in-process embedder whose files are in place, until it is ready', async () => {
      weightsPlaced.mockResolvedValueOnce(true);
      let finish!: () => void;
      ensureWeightsWithRetry.mockImplementationOnce(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))) as never);
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      let checked = false;
      const wait = svc.whenStartupChecked().then(() => (checked = true));
      await new Promise((r) => setImmediate(r));
      expect(checked).toBe(false);
      finish();
      await wait;
      expect(svc.getState()).toBe('ready');
    });

    it('stops waiting after 60 s and says so, so the install goes on and catches up later', async () => {
      jest.useFakeTimers();
      weightsPlaced.mockResolvedValueOnce(true);
      ensureWeightsWithRetry.mockImplementationOnce(() => new Promise<undefined>(() => undefined) as never);
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
      svc.onModuleInit();
      let checked = false;
      const wait = svc.whenStartupChecked().then(() => (checked = true));
      await jest.advanceTimersByTimeAsync(59_000);
      expect(checked).toBe(false);
      await jest.advanceTimersByTimeAsync(1_000);
      await wait;
      expect(svc.getState()).toBe('downloading');
      expect(warn).toHaveBeenCalledWith(
        'Embedder not ready after the start-up wait; the module install continues and catches up when it is',
        { profile: EG1, waitedMs: 60_000 },
      );
    });

    it('tells its listeners when the in-process embedder becomes ready, and not after one is removed', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      const first = jest.fn();
      const second = jest.fn();
      svc.onReady(first);
      const remove = svc.onReady(second);
      remove();
      svc.onModuleInit();
      await svc.whenSettled();
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });

    it('a failing listener does not stop the others', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
      const after = jest.fn();
      svc.onReady(() => {
        throw new Error('boom');
      });
      svc.onReady(after);
      svc.onModuleInit();
      await svc.whenSettled();
      expect(after).toHaveBeenCalledTimes(1);
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
      expect(createWorkerEmbedder).toHaveBeenCalledWith(expect.objectContaining({ id: EG1 }), '/models', {
        threads: 4,
        onFailure: expect.any(Function),
      });
      expect(embed).toHaveBeenCalledWith('query', [{ text: 'warm-up' }]);
      expect(svc.getStatus().state).toBe('ready');
      expect(svc.isEnabled()).toBe(true);
    });

    it('a warm-up that fails releases the worker it started and leaves the embedder failed', async () => {
      const failingEmbed = jest.fn(async (_kind: string, _items: Array<{ text: string; title?: string }>): Promise<number[][]> => {
        throw new Error('embedding has 0 dimensions, expected 768');
      });
      const releaseWarm = jest.fn(async () => undefined);
      createWorkerEmbedder.mockImplementationOnce(async () => ({ profileId: 'p', dimensions: 768, embed: failingEmbed, release: releaseWarm }));
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_MODEL_DIR: '/models' });
      svc.onModuleInit();
      await svc.whenSettled();
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'embedding has 0 dimensions, expected 768' });
      expect(releaseWarm).toHaveBeenCalledTimes(1);
      // A failure the released worker reports later changes nothing.
      const { onFailure } = createWorkerEmbedder.mock.calls.at(-1)![2] as { onFailure: (error: Error) => void };
      onFailure(new Error('embedder worker exited (code 1)'));
      expect(svc.getStatus().error).toBe('embedding has 0 dimensions, expected 768');
    });

    it('a worker that fails after it was ready turns the embedder failed with the reason, and the vector tier off', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_MODEL_DIR: '/models' });
      svc.onModuleInit();
      await svc.whenSettled();
      expect(svc.isEnabled()).toBe(true);
      const { onFailure } = createWorkerEmbedder.mock.calls.at(-1)![2] as { onFailure: (error: Error) => void };
      onFailure(new Error('embedder worker exited (code 134)'));
      expect(svc.getStatus()).toMatchObject({ state: 'failed', error: 'embedder worker exited (code 134)' });
      expect(svc.isEnabled()).toBe(false);
      await expect(svc.embedBatch(['x'], 'query')).resolves.toBeNull();
    });

    it('stores the profile id as the model and takes the profile dimensions', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      expect(svc.getModel()).toBe(EG1);
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
      const svc = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_THRESHOLD_CLASSES: '0.7', EMBEDDING_THRESHOLD_COMPONENTS: '0.5' });
      expect(svc.getThreshold('classes')).toBe(0.7);
      expect(svc.getThreshold('mitre')).toBe(0.301);
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

  describe('a shutdown during the start', () => {
    it('aborts a download in flight and returns at once, without reporting a failure', async () => {
      let received: AbortSignal | undefined;
      ensureWeightsWithRetry.mockImplementationOnce(((_p: unknown, _d: unknown, options: { signal?: AbortSignal }) => {
        received = options.signal;
        return new Promise<undefined>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason)));
      }) as never);
      const svc = await buildService();
      const error = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      svc.onModuleInit();
      await new Promise((r) => setImmediate(r));
      expect(received?.aborted).toBe(false);
      await svc.onModuleDestroy();
      expect(received?.aborted).toBe(true);
      expect(error).not.toHaveBeenCalled();
      expect(createWorkerEmbedder).not.toHaveBeenCalled();
    });

    it('releases a worker in its warm-up at once, so the warm-up ends, and announces nothing', async () => {
      let rejectWarmUp!: (error: Error) => void;
      const releaseWarming = jest.fn(async () => rejectWarmUp(new Error('the embedder was released')));
      createWorkerEmbedder.mockImplementationOnce((async () => ({
        profileId: 'p',
        dimensions: 768,
        embed: jest.fn(() => new Promise<number[][]>((_resolve, reject) => (rejectWarmUp = reject))),
        release: releaseWarming,
      })) as never);
      const svc = await buildService();
      const ready = jest.fn();
      svc.onReady(ready);
      const error = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      svc.onModuleInit();
      while (!rejectWarmUp) await new Promise((r) => setImmediate(r));
      await svc.onModuleDestroy();
      expect(releaseWarming).toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(svc.isEnabled()).toBe(false);
    });

    it('waits for a model load in progress at most a few seconds, and releases the worker it delivers later', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      let deliver!: () => void;
      const releaseLate = jest.fn(async () => undefined);
      createWorkerEmbedder.mockImplementationOnce(
        () =>
          new Promise((resolve) => (deliver = () => resolve({ profileId: 'p', dimensions: 768, embed, release: releaseLate }))) as never,
      );
      const svc = await buildService();
      svc.onModuleInit();
      while (!deliver) await new Promise((r) => setImmediate(r));
      let stopped = false;
      const stopping = svc.onModuleDestroy().then(() => (stopped = true));
      await jest.advanceTimersByTimeAsync(4_000);
      expect(stopped).toBe(false);
      await jest.advanceTimersByTimeAsync(1_500);
      await stopping;
      expect(stopped).toBe(true);
      deliver();
      await svc.whenSettled();
      expect(releaseLate).toHaveBeenCalledTimes(1);
      expect(embed).not.toHaveBeenCalled();
      expect(svc.isEnabled()).toBe(false);
    });

    it('is no longer enabled once a shutdown begins, though it was ready', async () => {
      const svc = await readyService();
      expect(svc.isEnabled()).toBe(true);
      const stopping = svc.onModuleDestroy();
      expect(svc.isEnabled()).toBe(false);
      expect(svc.isPending()).toBe(true);
      await stopping;
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not load the model when the shutdown came as the download finished, and announces nothing', async () => {
      let finish!: () => void;
      ensureWeightsWithRetry.mockImplementationOnce((() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined)))) as never);
      const svc = await buildService();
      const ready = jest.fn();
      svc.onReady(ready);
      svc.onModuleInit();
      await new Promise((r) => setImmediate(r));
      const stopping = svc.onModuleDestroy();
      finish();
      await stopping;
      expect(createWorkerEmbedder).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      expect(svc.isEnabled()).toBe(false);
    });

    it('says once, before a download, what it downloads and under which licence', async () => {
      const svc = await buildService();
      const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
      svc.onModuleInit();
      await svc.whenSettled();
      const said = log.mock.calls.filter((c) => c[0] === 'Downloading the embedding model once; it stays in the models directory');
      expect(said).toHaveLength(1);
      expect(said[0][1]).toMatchObject({ profile: EG1, licence: 'Gemma Terms of Use', licenceUrl: 'https://ai.google.dev/gemma/terms' });
      expect((said[0][1] as { bytes: number }).bytes).toBeGreaterThan(1_000_000_000);
    });

    it('says nothing about a download when the weights are already in place', async () => {
      weightsPlaced.mockResolvedValueOnce(true);
      const svc = await buildService();
      const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
      svc.onModuleInit();
      await svc.whenSettled();
      expect(log.mock.calls.map((c) => c[0])).not.toContain('Downloading the embedding model once; it stays in the models directory');
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
      const on = await readyService();
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
      expect(spy).toHaveBeenCalledWith(['a', 'b', 'c'], 'query', undefined, { timeoutMs: 10_750 });
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

    it('does not try a single text again after the batch failed on it', async () => {
      const svc = await readyOnnx();
      embed.mockRejectedValue(new Error('cannot embed'));
      const { vectors, failures } = await svc.embedEach(['steal cached passwords'], 'query');
      expect(embed).toHaveBeenCalledTimes(1);
      expect([vectors, failures.map((f) => f.index)]).toEqual([[null], [0]]);
    });

    it('gives a query embed a timeout that grows with its texts, configurable', async () => {
      const svc = await readyOnnx();
      await svc.embedEach(['a', 'b', 'c'], 'query');
      await svc.embedEach(['a'], 'query');
      expect(embed.mock.calls.map((c) => c[2])).toEqual([{ timeoutMs: 10_750 }, { timeoutMs: 10_250 }]);

      const tuned = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_QUERY_TIMEOUT_MS: '2000', EMBEDDING_QUERY_TIMEOUT_PER_ITEM_MS: '100' });
      tuned.onModuleInit();
      await tuned.whenSettled();
      embed.mockClear();
      await tuned.embedEach(['a', 'b', 'c'], 'query');
      expect(embed.mock.calls.map((c) => c[2])).toEqual([{ timeoutMs: 2_300 }]);
    });

    it('gives no timeout to a document embed or to the warm-up', async () => {
      const svc = await buildService({ EMBEDDING_MODEL: EG1 });
      svc.onModuleInit();
      await svc.whenSettled();
      expect(embed.mock.calls[0]).toEqual(['query', [{ text: 'warm-up' }]]);
      await svc.embedBatch(['a'], 'document', ['A']);
      expect(embed.mock.calls.at(-1)).toEqual(['document', [{ text: 'a', title: 'A' }]]);
      await svc.embedEach(['a', 'b'], 'document');
      expect(embed.mock.calls.at(-1)).toEqual(['document', [{ text: 'a' }, { text: 'b' }]]);
    });

    it.each(['EmbedTimeoutError', 'EmbedderBusyError'] as const)(
      'gives every text null on a %s, without trying them one at a time, and says so once',
      async (name) => {
        const svc = await readyOnnx();
        const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
        const error = overload(name);
        embed.mockRejectedValue(error);
        const { vectors, failures } = await svc.embedEach(['a', 'b', 'c'], 'query');
        expect(embed).toHaveBeenCalledTimes(1);
        expect(vectors).toEqual([null, null, null]);
        expect(failures).toEqual([0, 1, 2].map((index) => ({ index, error })));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][1]).toEqual({ kind: 'query', texts: 3, embedded: 0 });
        expect(svc.getStatus()).toMatchObject(name === 'EmbedTimeoutError' ? { queryTimeouts: 1, queryRefusals: 0 } : { queryTimeouts: 0, queryRefusals: 1 });
      },
    );

    it.each(['EmbedTimeoutError', 'EmbedderBusyError'] as const)(
      'after a plain batch error, tries the texts one at a time and stops at the first %s',
      async (name) => {
        const svc = await readyOnnx();
        const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
        const error = overload(name);
        embed.mockImplementation(async (_kind, items) => {
          if (items.length > 1) throw new TypeError('cannot embed');
          if (items[0].text === 'b') throw error;
          return [[1, 0]];
        });
        const { vectors, failures } = await svc.embedEach(['a', 'b', 'c', 'd'], 'query');
        expect(embed.mock.calls.map((c) => c[1].map((it) => it.text))).toEqual([['a', 'b', 'c', 'd'], ['a'], ['b']]);
        // Each single text has its own timeout.
        expect(embed.mock.calls.slice(1).map((c) => c[2])).toEqual([{ timeoutMs: 10_250 }, { timeoutMs: 10_250 }]);
        expect(vectors).toEqual([[1, 0], null, null, null]);
        expect(failures).toEqual([1, 2, 3].map((index) => ({ index, error })));
        expect(warn.mock.calls.map((c) => c[1])).toEqual([{ kind: 'query', texts: 4, embedded: 1 }]);
      },
    );

    it('makes no call for no text, and gives nulls when the embedder is not enabled', async () => {
      const svc = await buildService();
      const spy = jest.spyOn(svc, 'embedBatch');
      expect(await svc.embedEach([], 'query')).toEqual({ vectors: [], failures: [] });
      expect(spy).not.toHaveBeenCalled();
      const off = await buildService({ EMBEDDING_ENABLED: 'false' });
      expect(await off.embedEach(['a', 'b'], 'query')).toEqual({ vectors: [null, null], failures: [] });
    });
  });

  describe('embedderOverload', () => {
    it('reads the busy refusal and the timeout by name, and nothing else', () => {
      expect(embedderOverload(overload('EmbedderBusyError'))).toBe('busy');
      expect(embedderOverload(overload('EmbedTimeoutError'))).toBe('timeout');
      expect(embedderOverload(new Error('cannot embed'))).toBeNull();
      expect(embedderOverload('EmbedderBusyError')).toBeNull();
    });
  });

  describe('the query backlog', () => {
    it('passes EMBEDDING_QUERY_BACKLOG to the worker embedder, and leaves its default when unset', async () => {
      await readyService({ EMBEDDING_MODEL: EG1, EMBEDDING_QUERY_BACKLOG: '300' });
      expect(createWorkerEmbedder.mock.calls.at(-1)![2]).toMatchObject({ queryBacklogItems: 300 });
      await readyService({ EMBEDDING_MODEL: EG1, EMBEDDING_QUERY_BACKLOG: '' });
      expect(createWorkerEmbedder.mock.calls.at(-1)![2]).not.toHaveProperty('queryBacklogItems');
    });

    it('starts its counters at zero', async () => {
      expect((await readyService()).getStatus()).toMatchObject({ queryTimeouts: 0, queryRefusals: 0 });
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
