import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { validateEnvironment } from '../environment.validation';

/**
 * The per-corpus similarity floors are cosine values: anything outside [-1, 1], or not a number, refuses to boot
 * rather than silently filtering everything or nothing. The embedding profile is checked here too, so a refused one
 * stops the start before the database or the modules; the old HTTP embedder's settings are not checked at all.
 */
describe('EnvironmentVariables — embedding settings', () => {
  const baseEnv = { NEO4J_PASSWORD: 'secret' };

  it.each(['EMBEDDING_THRESHOLD_CLASSES', 'EMBEDDING_THRESHOLD_MITRE', 'EMBEDDING_THRESHOLD_COMPONENTS'])(
    '%s accepts a cosine value and refuses one out of range or not a number',
    (name) => {
      expect(validateEnvironment({ ...baseEnv, [name]: '0.35' })[name as 'EMBEDDING_THRESHOLD_MITRE']).toBe(0.35);
      expect(validateEnvironment({ ...baseEnv, [name]: '-1' })[name as 'EMBEDDING_THRESHOLD_MITRE']).toBe(-1);
      expect(validateEnvironment({ ...baseEnv, [name]: '' })[name as 'EMBEDDING_THRESHOLD_MITRE']).toBeUndefined();
      expect(() => validateEnvironment({ ...baseEnv, [name]: '1.5' })).toThrow();
      expect(() => validateEnvironment({ ...baseEnv, [name]: '-2' })).toThrow();
      expect(() => validateEnvironment({ ...baseEnv, [name]: 'high' })).toThrow();
      expect(() => validateEnvironment({ ...baseEnv, [name]: 'NaN' })).toThrow();
    },
  );

  it('leaves the floors unset when they are not given', () => {
    const validated = validateEnvironment({ ...baseEnv });
    expect(validated.EMBEDDING_THRESHOLD_CLASSES).toBeUndefined();
    expect(validated.EMBEDDING_THRESHOLD_MITRE).toBeUndefined();
    expect(validated.EMBEDDING_THRESHOLD_COMPONENTS).toBeUndefined();
  });

  it('never refuses a start over the old HTTP embedder settings, however stale', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        EMBEDDING_ENABLED: 'true',
        EMBEDDING_URL: 'not a url',
        EMBEDDING_API_KEY: '',
        EMBEDDING_DIMENSIONS: 'many',
        EMBEDDING_SIMILARITY_THRESHOLD: 'high',
      }),
    ).not.toThrow();
  });

  describe('the embedding profile', () => {
    it.each([
      ['embeddinggemma', /EMBEDDING_MODEL: EMBEDDING_MODEL "embeddinggemma" is no longer supported: the embedder now runs in the platform\. Remove EMBEDDING_MODEL/],
      ['embeddinggemma-2-text-retrieval-v1', /EMBEDDING_MODEL: EMBEDDING_MODEL "embeddinggemma-2-text-retrieval-v1" is not available in this release/],
      ['nomic-embed-text', /EMBEDDING_MODEL: Unknown EMBEDDING_MODEL "nomic-embed-text"\. This release supports: embeddinggemma-300m-retrieval-v1/],
    ])('refuses %s with embedding on', (model, message) => {
      expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_ENABLED: 'true', EMBEDDING_MODEL: model })).toThrow(message);
      expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_ENABLED: ' TRUE ', EMBEDDING_MODEL: model })).toThrow(message);
    });

    it('accepts the default, set or unset, with embedding on', () => {
      for (const model of [undefined, '', '  ', 'embeddinggemma-300m-retrieval-v1', ' embeddinggemma-300m-retrieval-v1 ']) {
        expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_ENABLED: 'true', EMBEDDING_MODEL: model })).not.toThrow();
      }
    });

    it('refuses nothing with embedding off', () => {
      for (const enabled of [undefined, '', 'false', 'yes']) {
        expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_ENABLED: enabled, EMBEDDING_MODEL: 'embeddinggemma' })).not.toThrow();
      }
    });
  });

  it('refuses a thread count outside 1..64', () => {
    expect(validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '4' }).EMBEDDING_THREADS).toBe(4);
    expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '0' })).toThrow();
    expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: 'many' })).toThrow();
  });

  it('leaves an empty thread count unset, so the default applies', () => {
    expect(validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '' }).EMBEDDING_THREADS).toBeUndefined();
    expect(validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '  ' }).EMBEDDING_THREADS).toBeUndefined();
  });
});
