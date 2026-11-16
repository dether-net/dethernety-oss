/**
 * The context a tool call runs with: the platform client built from the stored session (or an unauthenticated one
 * when the platform has authentication disabled). The server builds it for every call that reaches the platform; the
 * live test suites build theirs the same way, so they never handle a session themselves.
 */
import { getConfig, debug, originOf } from '../config.js'
import { createApolloClient } from './apollo-client.js'
import {
  fetchPlatformConfig,
  loadStoredTokens,
  isTokenExpired,
  canRefresh,
  refreshStoredSession,
  getCachedPlatformConfig,
  isAuthDisabled,
} from '../auth/index.js'
import type { ToolContext } from '../tools/index.js'

/** Upper bound on a transparent refresh's network work (platform config and token request). */
const REFRESH_TIMEOUT_MS = 10_000

/**
 * Resolve the session's two tokens: the bearer, and the identity token behind it.
 *
 * They are not interchangeable and each is used for exactly one thing:
 *
 * - `bearer` is the ACCESS token. Only it carries the `scope` claim, and anything
 *   sitting behind the platform is entitled to require one — presenting the
 *   identity token works until a request leaves the platform, then fails opaquely.
 * - `identity` is the ID token. Only it carries the profile claims (`email`), which
 *   is what audit attribution records. Reading identity off the bearer would silently
 *   demote every attributed entry to an opaque subject id.
 *
 * Resolution order:
 * 1. Stored tokens from the local session store (if not expired)
 * 2. Transparent refresh (if the access token expired and the provider has not
 *    rejected the refresh token), bounded by REFRESH_TIMEOUT_MS
 * 3. undefined (tool will fail if requiresClient=true)
 *
 * @returns the bearer and identity tokens, or undefined if there is no usable session
 */
async function getSessionTokens(): Promise<{ bearer: string; identity: string } | undefined> {
  const config = getConfig()
  debug(`Loading stored tokens for ${originOf(config.baseUrl)}`)
  const storedTokens = await loadStoredTokens(config.baseUrl)

  if (!storedTokens) {
    debug('No stored tokens found')
    return undefined
  }

  // Valid token: use it directly
  if (!isTokenExpired(storedTokens)) {
    debug('Using stored accessToken for authentication')
    return { bearer: storedTokens.accessToken, identity: storedTokens.idToken }
  }

  // Expired: attempt transparent refresh. Only the provider knows whether the
  // refresh token is still good; a rejection marks the session for a new sign-in.
  if (canRefresh(storedTokens)) {
    try {
      debug('Token expired, attempting transparent refresh')
      const signal = AbortSignal.timeout(REFRESH_TIMEOUT_MS)
      await fetchPlatformConfig(undefined, { signal })
      // The session's tokens after the refresh: ours, or another process's if it refreshed first.
      const newTokens = await refreshStoredSession(storedTokens, config.baseUrl, { signal })
      debug('Transparent token refresh succeeded')
      return { bearer: newTokens.accessToken, identity: newTokens.idToken }
    } catch (error) {
      debug(`Transparent refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  debug(`Stored tokens expired. expiresAt: ${storedTokens.expiresAt}, now: ${Date.now()}`)
  return undefined
}

/**
 * Build tool context for execution
 */
export async function buildToolContext(): Promise<ToolContext> {
  const config = getConfig()
  // Startup does not wait for the platform; the first tool call does, so a no-auth
  // platform is recognised as one before the call is refused for want of a session.
  if (!getCachedPlatformConfig()) {
    try {
      await fetchPlatformConfig()
    } catch (error) {
      debug(`Platform config unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const authDisabled = isAuthDisabled()

  // In auth-disabled mode, create an unauthenticated Apollo client directly
  if (authDisabled) {
    debug('Auth disabled — creating unauthenticated Apollo client')
    let apolloClient = undefined
    let clientUnavailableReason: string | undefined
    try {
      if (!getCachedPlatformConfig()) {
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient()
      debug('Unauthenticated Apollo client created successfully')
      clientUnavailableReason = undefined
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
      clientUnavailableReason =
        `auth is DISABLED on this platform, so this is not an authentication problem — ` +
        `the client could not be built: ${error instanceof Error ? error.message : String(error)}. ` +
        `Calling "login" will not help (it answers "No login needed"). Check the platform URL and that ` +
        `its /config endpoint is reachable and well-formed.`
    }
    return { apolloClient, token: undefined, debug: config.debug, clientUnavailableReason }
  }

  // Get the best available token (stored → transparent refresh → undefined)
  const session = await getSessionTokens()
  const accessToken = session?.bearer
  debug(`Token available: ${accessToken ? 'yes' : 'no'}`)

  // Create Apollo client if we have a token
  let apolloClient = undefined
  let tokenPathFailure: string | undefined
  if (accessToken) {
    try {
      // Ensure platform config is loaded before creating Apollo client
      if (!getCachedPlatformConfig()) {
        debug('Platform config not cached, fetching...')
        await fetchPlatformConfig()
      }
      apolloClient = createApolloClient(accessToken)
      debug('Apollo client created successfully')
    } catch (error) {
      debug(`Failed to create Apollo client: ${error}`)
      // Don't throw - let the tool handle the missing client. Keep the reason:
      // the token was present and usable here, so reporting this as an auth
      // failure sends the operator to re-login for a problem re-login cannot fix.
      tokenPathFailure =
        `a stored token WAS available, so this is not an authentication problem — ` +
        `the GraphQL client could not be built: ${error instanceof Error ? error.message : String(error)}. ` +
        `This usually means the platform's /config endpoint is unreachable or malformed.`
    }
  }

  return {
    apolloClient,
    token: accessToken,
    identityToken: session?.identity,
    debug: config.debug,
    clientUnavailableReason: tokenPathFailure
  }
}
