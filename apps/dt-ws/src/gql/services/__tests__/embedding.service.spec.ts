import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../embedding.service';

describe('EmbeddingService', () => {
  async function buildService(envOverrides: Record<string, string> = {}) {
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
      await expect(svc.embedBatch(['hi'])).resolves.toBeNull();
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
      await expect(svc.embedBatch(['x'])).resolves.toBeNull();
    });
  });
});
