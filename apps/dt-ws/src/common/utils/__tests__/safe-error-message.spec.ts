import { safeErrorMessage } from '../safe-error-message';

describe('safeErrorMessage', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should return default fallback', () => {
      expect(safeErrorMessage(new Error('DB connection failed'))).toBe('Operation failed');
    });

    it('should return custom fallback', () => {
      expect(safeErrorMessage(new Error('secret'), 'Something went wrong')).toBe(
        'Something went wrong',
      );
    });

    it('should return fallback for non-Error values', () => {
      expect(safeErrorMessage('string error')).toBe('Operation failed');
    });
  });

  describe('in development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should return error message', () => {
      expect(safeErrorMessage(new Error('DB connection failed'))).toBe('DB connection failed');
    });

    it('should return fallback for non-Error values', () => {
      expect(safeErrorMessage('string error')).toBe('Operation failed');
      expect(safeErrorMessage(42)).toBe('Operation failed');
      expect(safeErrorMessage(null)).toBe('Operation failed');
    });
  });
});
