import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { isAdmin, requireAdmin, requireAuthenticated } from '../is-admin';

/**
 * The admin gate is the load-bearing security control for every admin
 * mutation. These tests pin the dual claim-path contract
 * (`roles` || `cognito:groups`) and the helper's defensive checks.
 */

describe('isAdmin()', () => {
  it('returns true when payload.roles includes "admin"', () => {
    expect(isAdmin({ roles: ['admin'] })).toBe(true);
    expect(isAdmin({ roles: ['user', 'admin'] })).toBe(true);
  });

  it('returns true when payload["cognito:groups"] includes "admin"', () => {
    expect(isAdmin({ 'cognito:groups': ['admin'] })).toBe(true);
    expect(isAdmin({ 'cognito:groups': ['users', 'admin', 'devs'] })).toBe(true);
  });

  it('returns true when both claim paths grant admin', () => {
    expect(isAdmin({ roles: ['admin'], 'cognito:groups': ['admin'] })).toBe(true);
  });

  it('returns false when neither claim path grants admin', () => {
    expect(isAdmin({ roles: ['user'] })).toBe(false);
    expect(isAdmin({ 'cognito:groups': ['users'] })).toBe(false);
    expect(isAdmin({ roles: ['user'], 'cognito:groups': ['users'] })).toBe(false);
  });

  it('returns false for empty role/group arrays', () => {
    expect(isAdmin({ roles: [] })).toBe(false);
    expect(isAdmin({ 'cognito:groups': [] })).toBe(false);
    expect(isAdmin({ roles: [], 'cognito:groups': [] })).toBe(false);
  });

  it('returns false for undefined / null user', () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it('returns false when claim values are not arrays (defensive against malformed JWT)', () => {
    // Type-cast to bypass the interface — production JWT decode might
    // hand a string where we expect an array; we should not throw.
    expect(isAdmin({ roles: 'admin' as unknown as string[] })).toBe(false);
    expect(
      isAdmin({ 'cognito:groups': 'admin' as unknown as string[] }),
    ).toBe(false);
  });

  it('does not match other admin-flavored role names — must equal "admin" literally', () => {
    expect(isAdmin({ roles: ['administrator'] })).toBe(false);
    expect(isAdmin({ roles: ['Admin'] })).toBe(false);
    expect(isAdmin({ roles: ['ADMIN'] })).toBe(false);
    expect(isAdmin({ roles: ['superadmin'] })).toBe(false);
  });
});

describe('requireAdmin()', () => {
  it('does not throw when user has admin role', () => {
    expect(() => requireAdmin({ user: { sub: 'u', roles: ['admin'] } })).not.toThrow();
  });

  it('throws ForbiddenException when user lacks admin role', () => {
    expect(() => requireAdmin({ user: { sub: 'u', roles: ['user'] } })).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when ctx is undefined', () => {
    expect(() => requireAdmin(undefined)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when ctx.user is missing', () => {
    expect(() => requireAdmin({})).toThrow(ForbiddenException);
  });
});

describe('requireAuthenticated()', () => {
  it('does not throw when user.sub is present', () => {
    expect(() => requireAuthenticated({ user: { sub: 'u' } })).not.toThrow();
    // Roles not required for read-only authentication.
    expect(() => requireAuthenticated({ user: { sub: 'u', roles: [] } })).not.toThrow();
  });

  it('throws UnauthorizedException when sub is missing', () => {
    expect(() => requireAuthenticated({ user: {} })).toThrow(UnauthorizedException);
    expect(() => requireAuthenticated({})).toThrow(UnauthorizedException);
    expect(() => requireAuthenticated(undefined)).toThrow(UnauthorizedException);
  });
});
