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
  getRequiredScope
} from './platform-config.js'
import { scopeSatisfies, scopeClaimOf, grantedScopeOf, parseScopes } from './scope.js'
import { generatePKCE, generateState } from './pkce.js'
import { startCallbackServer, DEFAULT_CALLBACK_PORT } from './oauth-server.js'
import { openBrowser, buildAuthorizationUrl } from './browser.js'
import {
  loadStoredTokens,
  saveTokens,
  isTokenExpired,
  isRefreshTokenValid,
  StoredTokens
} from './token-store.js'

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
  redirectUri: string
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
    body: body.toString()
  })

  if (!response.ok) {
    const error = await response.text()
    debug(`Token exchange failed: ${response.status} ${error}`)
    throw new Error(`Token exchange failed: ${response.status} ${error}`)
  }

  const data = (await response.json()) as {
    access_token: string
    id_token: string
    refresh_token: string
    expires_in: number
    token_type: string
    scope?: string
  }

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    // Two sources, in this order and on purpose. `scope` on the token response
    // is optional per RFC 6749 §5.1 and some providers omit it on the
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
 * @returns New auth tokens
 */
export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const platformConfig = getCachedPlatformConfig()
  if (!platformConfig) {
    throw new Error('Platform config not loaded')
  }

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
    body: body.toString()
  })

  if (!response.ok) {
    const error = await response.text()
    debug(`Token refresh failed: ${response.status} ${error}`)
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    id_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope?: string
  }

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

/**
 * Perform the complete login flow
 *
 * 1. Check for cached tokens
 * 2. If expired, try to refresh
 * 3. If no valid tokens, perform browser-based OAuth
 *
 * @param options - Login options
 * @returns Login result with tokens
 */
export async function performLogin(options: {
  timeout?: number
  forceNew?: boolean
} = {}): Promise<LoginResult> {
  const config = getConfig()
  const { timeout = 120000, forceNew = false } = options

  try {
    // Ensure platform config is loaded
    await fetchPlatformConfig()
    const platformConfig = getCachedPlatformConfig()!
    const requiredScope = getRequiredScope(platformConfig)

    // Check for cached tokens unless forcing new login
    if (!forceNew) {
      const storedTokens = await loadStoredTokens(config.baseUrl)

      // A stored session whose grant no longer covers what the platform asks
      // for cannot be repaired in place: the refresh grant carries no scope, so
      // the provider would keep re-issuing the original grant forever. Falling
      // through to the browser login below is the only way to widen it.
      //
      // This guard sits ABOVE the refresh arm deliberately. Inside the
      // `!isTokenExpired` branch it would gate the cache hit only, and an
      // expired-but-refreshable session would go on minting under-scoped tokens
      // indefinitely — which is the same bug, visible an hour later.
      const staleScope =
        storedTokens && !scopeSatisfies(grantedScopeOf(storedTokens), requiredScope)
      if (staleScope) {
        debug(
          `Stored session was granted "${grantedScopeOf(storedTokens!) ?? '(unreadable)'}" but the ` +
            `platform now requires "${requiredScope}" — forcing a fresh login`
        )
      }

      if (storedTokens && !staleScope) {
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
        if (isRefreshTokenValid(storedTokens)) {
          try {
            debug('Access token expired, attempting refresh')
            const newTokens = await refreshTokens(storedTokens.refreshToken)

            // Save the new tokens
            await saveTokens({
              accessToken: newTokens.accessToken,
              idToken: newTokens.idToken,
              refreshToken: newTokens.refreshToken,
              expiresAt: Date.now() + newTokens.expiresIn * 1000,
              baseUrl: config.baseUrl,
              storedAt: Date.now(),
              grantedScope: newTokens.scope
            })

            return {
              success: true,
              tokens: newTokens,
              refreshed: true
            }
          } catch (error) {
            debug(`Token refresh failed: ${error}`)
            // Fall through to browser login
          }
        }
      }
    }

    // Perform browser-based OAuth login
    debug('Starting browser-based OAuth login')

    // Generate PKCE codes and state
    const { codeVerifier, codeChallenge } = generatePKCE()
    const state = generateState()

    // Start callback server
    const server = await startCallbackServer({
      port: DEFAULT_CALLBACK_PORT,
      timeout
    })

    try {
      // Build authorization URL
      const { authorize } = getOAuthUrls(platformConfig)
      const authUrl = buildAuthorizationUrl({
        authorizeEndpoint: authorize,
        clientId: platformConfig.oidcClientId,
        redirectUri: server.callbackUrl,
        scope: requiredScope,
        codeChallenge,
        state
      })

      // Open browser
      await openBrowser(authUrl)

      // Wait for callback
      debug('Waiting for OAuth callback...')
      const callback = await server.waitForCallback()

      // Verify state
      if (callback.state !== state) {
        throw new Error('State mismatch - possible CSRF attack')
      }

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(callback.code, codeVerifier, server.callbackUrl)

      // Save tokens
      await saveTokens({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        baseUrl: config.baseUrl,
        storedAt: Date.now(),
        grantedScope: tokens.scope
      })

      debug('Login successful')

      // A provider is free to grant less than it was asked for. Saying so once,
      // here, is what stops the guard above from re-opening a browser on every
      // subsequent login with nothing to show for it — the design's worst
      // failure mode, and otherwise entirely silent.
      const shortfall = scopeSatisfies(tokens.scope, requiredScope)
        ? undefined
        : parseScopes(requiredScope)
            .filter((s) => !parseScopes(tokens.scope).includes(s))
            .join(' ')
      if (shortfall) {
        debug(`Login granted a narrower scope than requested; missing: ${shortfall}`)
      }

      return {
        success: true,
        tokens,
        scopeShortfall: shortfall
      }
    } finally {
      server.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    debug(`Login failed: ${message}`)
    return {
      success: false,
      error: message
    }
  }
}
