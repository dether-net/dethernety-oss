import type { UserInfo } from '@dethernety/dt-core'

/**
 * The name to show for a signed-in user, from the identity provider's user info: the `name` claim,
 * then `preferred_username`, then the email address, which the `email` scope normally carries. Some
 * OIDC providers omit the name claim or send it empty.
 *
 * A claim that is missing, not a string, or only whitespace counts as absent. Returns 'Unknown'
 * when none is present.
 */
export function userDisplayName(
  userInfo: Partial<Pick<UserInfo, 'name' | 'preferred_username' | 'email'>>,
): string {
  for (const claim of [userInfo.name, userInfo.preferred_username, userInfo.email]) {
    const value = typeof claim === 'string' ? claim.trim() : ''
    if (value) return value
  }
  return 'Unknown'
}
