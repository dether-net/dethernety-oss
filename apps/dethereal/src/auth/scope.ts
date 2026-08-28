/**
 * OAuth scope comparison.
 *
 * A platform can tell clients which scopes to request (`oidcScope` on the
 * platform config). A session minted before that value changed carries the
 * OLD grant, and no amount of refreshing will widen it: the refresh grant
 * takes no scope parameter, so the identity provider re-issues whatever the
 * original authorization granted. The only way to gain a scope is a fresh
 * authorization request.
 *
 * These four functions are what lets the login flow notice that and act. They
 * are pure and dependency-free on purpose — the comparison is the part that
 * has to be exactly right, and it is easier to prove that about a function
 * than about a flow.
 */

/**
 * Split a space-delimited scope string into its members.
 *
 * Whitespace-splitting rather than a single-space split, and empties dropped,
 * because that is what a resource server does when it checks the granted
 * scope. A local check that parsed differently from the remote one would
 * disagree with it at exactly the moment it mattered.
 */
export function parseScopes(scope?: string): string[] {
  return (scope ?? '').split(/\s+/).filter(Boolean)
}

/**
 * Does `granted` carry every scope in `required`?
 *
 * Set membership, in both directions of the trap:
 *
 * - NOT string equality. A provider may return the granted scopes in a
 *   different order from the request, so comparing the strings would report a
 *   mismatch forever and re-open a browser on every login.
 * - NOT `String.includes`. A resource server splits before it compares, so
 *   `"openid profile"` does not carry a scope literally named
 *   `"openid"` + `" profile"`; a raw substring test would accept a grant the
 *   server rejects, which is the failure that looks like it works.
 *
 * Extra granted scopes are fine — this asks whether the grant is sufficient,
 * not whether it is exact. An unreadable or absent grant satisfies nothing: an
 * unprovable grant is not a grant.
 */
export function scopeSatisfies(granted: string | undefined, required: string): boolean {
  const have = new Set(parseScopes(granted))
  return parseScopes(required).every((scope) => have.has(scope))
}

/**
 * Read the `scope` claim out of an access token.
 *
 * Unverified decode — the signature is the platform's business, not ours. This
 * only ever answers "which scopes does this session believe it has", and a
 * forged answer costs the forger a re-login, so there is nothing to gain by
 * lying to it.
 *
 * Returns undefined for anything that is not a JWT carrying a non-empty string
 * `scope`, which the caller must treat as "no provable grant".
 */
export function scopeClaimOf(token?: string): string | undefined {
  if (!token) return undefined
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { scope?: unknown }
    return typeof decoded.scope === 'string' && decoded.scope.length > 0 ? decoded.scope : undefined
  } catch {
    return undefined
  }
}

/**
 * The scope a stored session was granted.
 *
 * This one expression is the entire upgrade path. Sessions written before
 * `grantedScope` existed have no such field, and re-authenticating every
 * operator to learn something already written in their access token would be a
 * gratuitous interruption — so fall back to the token's own claim, and only
 * treat the grant as unprovable when neither is readable.
 */
export function grantedScopeOf(tokens: {
  grantedScope?: string
  accessToken?: string
}): string | undefined {
  return tokens.grantedScope ?? scopeClaimOf(tokens.accessToken)
}
