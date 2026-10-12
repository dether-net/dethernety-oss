import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const ensureWeightsWithRetry = jest.fn(async () => undefined);
const embed = jest.fn(async (_kind: string, items: Array<{ text: string; title?: string }>) => items.map(() => [1, 0]));
const release = jest.fn(async () => undefined);
const createOnnxEmbedder = jest.fn(async () => ({ profileId: 'p', dimensions: 768, embed, release }));
jest.mock('@dethernety/embedder', () => ({ ensureWeightsWithRetry, createOnnxEmbedder }), { virtual: false });

import { EmbeddingService } from '../embedding.service';

const EG1 = 'embeddinggemma-300m-retrieval-v1';
const EG2 = 'embeddinggemma-2-text-retrieval-v1';

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function buildService(envOverrides: Record<string, string | undefined> = {}) {
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

    it('lets a per-corpus override win over EMBEDDING_SIMILARITY_THRESHOLD', async () => {
      const svc = await buildService({ EMBEDDING_SIMILARITY_THRESHOLD: '0.55', EMBEDDING_THRESHOLD_MITRE: '0.3' });
      expect(svc.getThreshold('classes')).toBe(0.55);
      expect(svc.getThreshold('mitre')).toBe(0.3);
    });

    it('takes EMBEDDING_DIMENSIONS', async () => {
      const svc = await buildService({ EMBEDDING_DIMENSIONS: '384' });
      expect(svc.getDimensions()).toBe(384);
    });

    it('never loads the in-process embedder', async () => {
      const svc = await buildService();
      svc.onModuleInit();
      await svc.whenSettled();
      expect(createOnnxEmbedder).not.toHaveBeenCalled();
    });
  });

  describe('an ONNX profile', () => {
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

    it('is not pending when embedding is disabled by configuration or for the session', async () => {
      const off = await buildService({ EMBEDDING_MODEL: EG1, EMBEDDING_ENABLED: 'false' });
      expect([off.getState(), off.isPending()]).toEqual(['disabled', false]);
      const session = await buildService({ EMBEDDING_MODEL: EG1 });
      session.disableForSession('dim mismatch');
      expect([session.getState(), session.isPending()]).toEqual(['disabled', false]);
    });
  });

  describe('disableForSession', () => {
    it('flips isEnabled() to false and is idempotent', async () => {
      const svc = await buildService();
      expect(svc.isEnabled()).toBe(true);

      svc.disableForSession('dim mismatch');
      expect(svc.isEnabled()).toBe(false);

      // Calling again is a no-op (checked by spy on logger not re-firing)
      svc.disableForSession('another reason');
      expect(svc.isEnabled()).toBe(false);
    });

    it('embedBatch returns null once disabled mid-session', async () => {
      const svc = await buildService();
      svc.disableForSession('dim mismatch');
      await expect(svc.embedBatch(['hi'], 'query')).resolves.toBeNull();
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
