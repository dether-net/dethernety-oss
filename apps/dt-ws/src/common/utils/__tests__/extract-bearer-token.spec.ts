import { extractBearerToken } from '../extract-bearer-token';

describe('extractBearerToken', () => {
  it('should extract a valid bearer token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('should handle case-insensitive Bearer prefix', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
    expect(extractBearerToken('BEARER abc123')).toBe('abc123');
  });

  it('should return undefined for undefined input', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractBearerToken('')).toBeUndefined();
  });

  it('should return undefined for malformed header (no space)', () => {
    expect(extractBearerToken('Bearerabc123')).toBeUndefined();
  });

  it('should return undefined for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeUndefined();
  });

  it('should return undefined for Bearer with no token', () => {
    expect(extractBearerToken('Bearer ')).toBeUndefined();
  });

  it('should reject tokens with spaces (anchored regex)', () => {
    expect(extractBearerToken('Bearer abc 123')).toBeUndefined();
  });
});
