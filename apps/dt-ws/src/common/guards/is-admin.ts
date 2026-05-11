import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';

// Module-scope logger so the diagnostic emit doesn't require an instance.
// Context name 'AdminGuard' is filter-friendly for log aggregators.
const adminGuardLogger = new Logger('AdminGuard');

/**
 * Admin authz check for admin-gated GraphQL operations.
 *
 * **Production path.** The OIDC IdP (Cognito on the AWS deployment
 * target) emits role membership as a JWT claim. JwtAuthGuard validates
 * the token and stamps `request['user'] = payload`. We accept admin from
 * either `payload.roles` or `payload['cognito:groups']` because Cognito
 * group-mapping varies by deployment — some shops mirror groups into
 * `roles` via a pre-token-generation Lambda, others ship the raw
 * `cognito:groups` claim. Two checks; no env-config knob.
 *
 * **Dev/demo path.** When OIDC is unconfigured (NODE_ENV !== 'production'
 * AND no OIDC_JWKS_URI), JwtAuthGuard short-circuits with a mock user
 * carrying `roles: ['admin']` so unauth'd local installs can exercise
 * admin operations without an IdP. Production paths through actual JWT
 * validation never touch the mock branch.
 */
export interface UserClaims {
  sub?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  ['cognito:groups']?: string[];
}

export const ADMIN_ROLE = 'admin';

export function isAdmin(user?: UserClaims | null): boolean {
  if (!user) return false;
  if (Array.isArray(user.roles) && user.roles.includes(ADMIN_ROLE)) return true;
  const cognitoGroups = user['cognito:groups'];
  if (Array.isArray(cognitoGroups) && cognitoGroups.includes(ADMIN_ROLE)) return true;
  return false;
}

export function requireAdmin(ctx: { user?: UserClaims | null } | undefined | null): void {
  if (!isAdmin(ctx?.user ?? undefined)) {
    // Server-side diagnostic: surface claim-presence flags so a misconfigured
    // Cognito group mapping is self-diagnosable from logs. Don't return the
    // claim shape to the client — the operator-facing error stays terse.
    adminGuardLogger.warn('admin gate denied', {
      sub: ctx?.user?.sub,
      hasRolesArray: Array.isArray(ctx?.user?.roles),
      rolesLength: Array.isArray(ctx?.user?.roles) ? ctx?.user?.roles.length : null,
      hasCognitoGroups: Array.isArray(ctx?.user?.['cognito:groups']),
      cognitoGroupsLength: Array.isArray(ctx?.user?.['cognito:groups'])
        ? ctx?.user?.['cognito:groups']?.length
        : null,
    });
    throw new ForbiddenException('Admin role required');
  }
}

export function requireAuthenticated(ctx: { user?: UserClaims | null } | undefined | null): void {
  if (!ctx?.user?.sub) {
    throw new UnauthorizedException('Authentication required');
  }
}
