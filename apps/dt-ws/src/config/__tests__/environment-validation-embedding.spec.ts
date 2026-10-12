import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { validateEnvironment } from '../environment.validation';

/**
 * The per-corpus similarity floors are cosine values: anything outside [-1, 1] refuses to boot rather
 * than silently filtering everything or nothing.
 */
describe('EnvironmentVariables — embedding settings', () => {
  const baseEnv = { NEO4J_PASSWORD: 'secret' };

  it.each(['EMBEDDING_THRESHOLD_CLASSES', 'EMBEDDING_THRESHOLD_MITRE', 'EMBEDDING_THRESHOLD_COMPONENTS'])(
    '%s accepts a cosine value and refuses one out of range',
    (name) => {
      expect(validateEnvironment({ ...baseEnv, [name]: '0.35' })[name as 'EMBEDDING_THRESHOLD_MITRE']).toBe(0.35);
      expect(validateEnvironment({ ...baseEnv, [name]: '-1' })[name as 'EMBEDDING_THRESHOLD_MITRE']).toBe(-1);
      expect(() => validateEnvironment({ ...baseEnv, [name]: '1.5' })).toThrow();
      expect(() => validateEnvironment({ ...baseEnv, [name]: 'high' })).toThrow();
    },
  );

  it('leaves the floors unset when they are not given', () => {
    const validated = validateEnvironment({ ...baseEnv });
    expect(validated.EMBEDDING_THRESHOLD_CLASSES).toBeUndefined();
    expect(validated.EMBEDDING_THRESHOLD_MITRE).toBeUndefined();
    expect(validated.EMBEDDING_THRESHOLD_COMPONENTS).toBeUndefined();
  });

  it('refuses a thread count outside 1..64', () => {
    expect(validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '4' }).EMBEDDING_THREADS).toBe(4);
    expect(() => validateEnvironment({ ...baseEnv, EMBEDDING_THREADS: '0' })).toThrow();
  });
});
