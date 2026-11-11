/**
 * OAuth Flow
 *
 * Implements the complete OAuth 2.0 Authorization Code flow with PKCE.
 * Handles token exchange, refresh, and the full login flow.
 */

import fetch from 'cross-fetch'
import { getConfig, debug } from '../config.js'
import {
  getCachedPlatformConfig,
  getOAuthUrls,
  fetchPlatformConfig,
  getRequiredScope,
  type PlatformConfig
} from './platform-config.js'
import { scopeSatisfies, scopeClaimOf, grantedScopeOf, parseScopes } from './scope.js'
import {
  loadStoredTokens,
  commitRefresh,
  markRefreshRejected,
  isTokenExpired,
  canRefresh,
  getTokenKey,
  StoredTokens
} from './token-store.js'
import { registerSecret } from './redact.js'
import { endpointFailure, TokenEndpointError } from './token-endpoint.js'
import { revokeDetached } from './revoke.js'

/**
 * OAuth tokens returned from Cognito
 */
export interface AuthTokens {
  /** OAuth access token */
  accessToken: string
  /** OIDC identity token */
  idToken: string
  /** OAuth refresh token */
  refreshToken: string
  /** Token lifetime in seconds */
  expiresIn: number
  /** Token type (always "Bearer") */
  tokenType: string
  /** The scope actually granted, as the provider reports it. Absent if it reports none. */
  scope?: string
}

/**
 * Login result
 */
export interface LoginResult {
  /** Whether login was successful */
  success: boolean
  /** Auth tokens if successful */
  tokens?: AuthTokens
  /** Error message if failed */
  error?: string
  /** Whether tokens came from cache */
  fromCache?: boolean
  /** Whether tokens were refreshed */
  refreshed?: boolean
  /**
   * Scopes the platform asked for that the provider did not grant.
   *
   * Set only on a login that otherwise succeeded. The tokens are still valid
   * for the platform itself — this reports that something behind it may refuse
   * them, which is otherwise invisible until a feature quietly stops working.
   */
  scopeShortfall?: string
}

/** Parse a token-endpoint success body; a parser error would quote the body. */
async function tokenEndpointJson<T>(what: string, response: { json(): Promise<unknown> }): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(`${what} failed: the token endpoint returned a malformed response`)
  }
}

/**
 * Exchange authorization code for tokens
 *
 * @param code - Authorization code from OAuth callback
 * @param codeVerifier - PKCE code verifier used in authorization request
 * @param redirectUri - Redirect URI used in authorization request
 * @returns Auth tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  options: { signal?: AbortSignal } = {}
): Promise<AuthTokens> {
  const platformConfig = getCachedPlatformConfig()
  if (!platformConfig) {
    throw new Error('Platform config not loaded')
  }

  const { token: tokenUrl } = getOAuthUrls(platformConfig)

  debug(`Exchanging code for tokens at ${tokenUrl}`)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: platformConfig.oidcClientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString(),
    signal: options.signal,
    // A redirect would re-send the form, secrets included, wherever it points.
    redirect: 'error'
  })

  if (!response.ok) {
    const failure = await endpointFailure('Token exchange', response)
    debug(failure.message)
    throw failure
  }

  const data = await tokenEndpointJson<{
    access_token: string
    id_token: string
    refresh_token: string
    expires_in: number
    token_type: string
    scope?: string
  }>('Token exchange', response)
  registerSecret(data.access_token, data.id_token, data.refresh_token)

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    // Two sources, in this order and on purpose. `scope` on the token response
    // is optional per RFC 6749 section 5.1 and some providers omit it on the
    // authorization-code grant; the access token's own claim is the string a
    // resource server actually tests. Preferring the response when it is there
    // and the claim otherwise makes this a faithful pre-image of the remote
    // check without depending on a field that may never arrive.
    scope: data.scope ?? scopeClaimOf(data.access_token)
  }
}

/**
 * Refresh tokens using refresh token
 *
 * @param refreshToken - Refresh token from previous authentication
 * @param platformConfig - The config whose identity provider receives the
 *   token: the one the caller checked the session's issuer against, never a
 *   fresh read of the cache
 * @param options.signal - Aborts the request (e.g. a timeout)
 * @returns New auth tokens
 */
export async function refreshTokens(
  refreshToken: string,
  platformConfig: PlatformConfig,
  options: { signal?: AbortSignal } = {}
): Promise<AuthTokens> {

  const { token: tokenUrl } = getOAuthUrls(platformConfig)

  debug('Refreshing tokens')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: platformConfig.oidcClientId,
    refresh_token: refreshToken
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString(),
    signal: options.signal,
    // A redirect would re-send the form, secrets included, wherever it points.
    redirect: 'error'
  })

  if (!response.ok) {
    const failure = await endpointFailure('Token refresh', response)
    debug(failure.message)
    throw failure
  }

  const data = await tokenEndpointJson<{
    access_token: string
    id_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope?: string
  }>('Token refresh', response)
  registerSecret(data.access_token, data.id_token, data.refresh_token)

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    // Cognito may return a new refresh token, or we keep the old one
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    // A refresh cannot widen a grant — the refresh grant takes no scope
    // parameter, so what comes back is whatever the original authorization
    // granted. Recording it keeps the stored value honest rather than stale.
    scope: data.scope ?? scopeClaimOf(data.access_token)
  }
}

/** The provider rejected the session's refresh token: only a new sign-in helps. */
export class SessionExpiredError extends Error {
  constructor() {
    super('session expired; sign in again')
    this.name = 'SessionExpiredError'
  }
}

/** The session was signed out while it was being refreshed. */
export class SignedOutError extends Error {
  constructor() {
    super('signed out while the session was being refreshed')
    this.name = 'SignedOutError'
  }
}

/** Refreshes in flight in this process, one per platform and refresh token. */
const refreshing = new Map<string, Promise<AuthTokens>>()

function asAuthTokens(stored: StoredTokens): AuthTokens {
  return {
    accessToken: stored.accessToken,
    idToken: stored.idToken,
    refreshToken: stored.refreshToken,
    expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000),
    tokenType: 'Bearer',
    scope: stored.grantedScope
  }
}

/**
 * Refresh a stored session and persist the result.
 *
 * The request runs without the store's lock; the result is committed only while
 * the store still holds the refresh token it was made with. So a logout during
 * the request stays a logout, and a concurrent refresh by another process wins
 * cleanly (its session is used). Concurrent callers in this process share one
 * request.
 *
 * @param stored - The stored session whose refresh token is used
 * @param baseUrl - Platform the session belongs to
 * @param options.signal - Aborts the token request (e.g. a timeout)
 * @returns The session's tokens after the refresh, already saved
 * @throws SessionExpiredError when the provider rejects the refresh token,
 *   SignedOutError when a logout ran meanwhile
 */
export function refreshStoredSession(
  stored: StoredTokens,
  baseUrl: string,
  options: { signal?: AbortSignal } = {}
): Promise<AuthTokens> {
  const key = `${getTokenKey(baseUrl)}\0${stored.refreshToken}`
  const inFlight = refreshing.get(key)
  if (inFlight) return inFlight
  const attempt = refreshAndCommit(stored, baseUrl, options).finally(() => refreshing.delete(key))
  refreshing.set(key, attempt)
  return attempt
}

async function refreshAndCommit(
  stored: StoredTokens,
  baseUrl: string,
  options: { signal?: AbortSignal }
): Promise<AuthTokens> {
  // One config for the issuer check and the request, captured once.
  const platformConfig = getCachedPlatformConfig()
  if (!platformConfig) throw new Error('Platform config not loaded')
  // A session is refreshed only at the identity provider that issued it. If the
  // platform now names another one, the refresh token is sent nowhere: a new
  // sign-in replaces the session. A session saved before issuers were recorded
  // is refreshed at the current one, which is then recorded.
  if (
    stored.oidcDomain !== undefined &&
    (stored.oidcDomain !== platformConfig.oidcDomain || stored.oidcClientId !== platformConfig.oidcClientId)
  ) {
    debug('Stored session was issued by another identity provider than the platform now names; not refreshing it')
    throw new SessionExpiredError()
  }
  const issuer = {
    oidcDomain: stored.oidcDomain ?? platformConfig.oidcDomain,
    oidcClientId: stored.oidcDomain !== undefined ? stored.oidcClientId : platformConfig.oidcClientId,
  }
  let fresh: AuthTokens
  try {
    fresh = await refreshTokens(stored.refreshToken, platformConfig, options)
  } catch (error) {
    if (error instanceof TokenEndpointError && error.oauthError === 'invalid_grant') {
      await markRefreshRejected(baseUrl, stored.refreshToken)
      throw new SessionExpiredError()
    }
    throw error
  }

  const commit = await commitRefresh(stored.refreshToken, {
    accessToken: fresh.accessToken,
    idToken: fresh.idToken,
    refreshToken: fresh.refreshToken,
    expiresAt: Date.now() + fresh.expiresIn * 1000,
    baseUrl,
    storedAt: Date.now(),
    grantedScope: fresh.scope,
    ...issuer
  })
  switch (commit.kind) {
    case 'saved':
      return fresh
    case 'unknown':
      // The store is unreadable: the tokens serve this call, and nothing is revoked.
      return fresh
    case 'replaced':
      // Another process refreshed, or a new sign-in replaced the session: use theirs.
      if (commit.current && !isTokenExpired(commit.current) && !commit.current.refreshRejected) {
        registerSecret(commit.current.accessToken, commit.current.idToken, commit.current.refreshToken)
        return asAuthTokens(commit.current)
      }
      throw new SessionExpiredError()
    case 'gone':
      // Signed out meanwhile. A refresh token the provider rotated to exists nowhere else.
      if (fresh.refreshToken !== stored.refreshToken) {
        revokeDetached(fresh.refreshToken, platformConfig)
      }
      throw new SignedOutError()
  }
}

/**
 * The session step of a login: reuse a valid stored session, or refresh an expired
 * one. Returns null when only a browser sign-in will do (no session, a grant too
 * narrow for what the platform now asks, or a refresh that failed).
 *
 * @param options.signal - Bounds the network work (platform config and refresh)
 */
export async function sessionLogin(options: { signal?: AbortSignal } = {}): Promise<LoginResult | null> {
  const config = getConfig()
  await fetchPlatformConfig(undefined, { signal: options.signal })
  const platformConfig = getCachedPlatformConfig()!
  const requiredScope = getRequiredScope(platformConfig)
  const storedTokens = await loadStoredTokens(config.baseUrl)

  // A stored session whose grant no longer covers what the platform asks
  // for cannot be repaired in place: the refresh grant carries no scope, so
  // the provider would keep re-issuing the original grant forever. Falling
  // through to the browser login is the only way to widen it.
  //
  // This guard sits ABOVE the refresh arm deliberately. Inside the
  // `!isTokenExpired` branch it would gate the cache hit only, and an
  // expired-but-refreshable session would go on minting under-scoped tokens
  // indefinitely — which is the same bug, visible an hour later.
  const staleScope = storedTokens && !scopeSatisfies(grantedScopeOf(storedTokens), requiredScope)
  if (staleScope) {
    debug(
      `Stored session was granted "${grantedScopeOf(storedTokens!) ?? '(unreadable)'}" but the ` +
        `platform now requires "${requiredScope}" — forcing a fresh login`
    )
  }
  if (!storedTokens || staleScope) return null

  // Check if access token is still valid
  if (!isTokenExpired(storedTokens)) {
    debug('Using cached tokens (still valid)')
    return {
      success: true,
      tokens: {
        accessToken: storedTokens.accessToken,
        idToken: storedTokens.idToken,
        refreshToken: storedTokens.refreshToken,
        expiresIn: Math.floor((storedTokens.expiresAt - Date.now()) / 1000),
        tokenType: 'Bearer'
      },
      fromCache: true
    }
  }

  // Try to refresh if refresh token is valid
  if (canRefresh(storedTokens)) {
    try {
      debug('Access token expired, attempting refresh')
      const newTokens = await refreshStoredSession(storedTokens, config.baseUrl, { signal: options.signal })
      return { success: true, tokens: newTokens, refreshed: true }
    } catch (error) {
      debug(`Token refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  return null
}

/** Scopes the platform asked for that `tokens` were not granted, if any. */
export function scopeShortfallOf(tokens: AuthTokens, requiredScope: string): string | undefined {
  if (scopeSatisfies(tokens.scope, requiredScope)) return undefined
  const granted = parseScopes(tokens.scope)
  const shortfall = parseScopes(requiredScope).filter((s) => !granted.includes(s)).join(' ')
  if (shortfall) debug(`Login granted a narrower scope than requested; missing: ${shortfall}`)
  return shortfall || undefined
}

/**
 * Sign in, waiting for the browser for at most `timeout` milliseconds.
 *
 * A thin wrapper over the login manager for callers that want a single answer:
 * a pending sign-in that does not finish in time is reported as a failure.
 */
export async function performLogin(options: { timeout?: number; forceNew?: boolean } = {}): Promise<LoginResult> {
  const { login } = await import('./login-manager.js')
  const answer = await login({ waitMs: options.timeout ?? 120000, forceNew: options.forceNew ?? false })
  switch (answer.status) {
    case 'authenticated':
      return answer.result
    case 'pending':
      return { success: false, error: 'The sign-in did not finish in time' }
    case 'busy':
      return { success: false, error: answer.message }
    case 'auth-disabled':
      return { success: false, error: 'Authentication is disabled on this platform' }
    case 'failed':
      return { success: false, error: answer.error }
  }
}
