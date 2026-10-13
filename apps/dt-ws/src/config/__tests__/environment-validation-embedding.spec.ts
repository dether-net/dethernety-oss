import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { validateEnvironment } from '../environment.validation';

/**
 * The similarity floors — the per-corpus ones and the HTTP embedder's single EMBEDDING_SIMILARITY_THRESHOLD —
 * are cosine values: anything outside [-1, 1], or not a number, refuses to boot rather than silently
 * filtering everything or nothing.
 */
describe('EnvironmentVariables — embedding settings', () => {
  const baseEnv = { NEO4J_PASSWORD: 'secret' };

  it.each(['EMBEDDING_THRESHOLD_CLASSES', 'EMBEDDING_THRESHOLD_MITRE', 'EMBEDDING_THRESHOLD_COMPONENTS', 'EMBEDDING_SIMILARITY_THRESHOLD'])(
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
    expect(validated.EMBEDDING_SIMILARITY_THRESHOLD).toBeUndefined();
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
