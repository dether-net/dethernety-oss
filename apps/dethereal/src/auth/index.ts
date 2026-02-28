/**
 * Authentication Module
 *
 * Exports all authentication-related utilities and types.
 */

// Platform configuration
export {
  type PlatformConfig,
  fetchPlatformConfig,
  getCachedPlatformConfig,
  getGraphQLEndpoint,
  getOAuthUrls,
  clearPlatformConfigCache
} from './platform-config.js'

// PKCE utilities
export { type PKCECodes, generatePKCE, generateState } from './pkce.js'

// OAuth callback server
export {
  type CallbackResult,
  type CallbackServer,
  startCallbackServer,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_TIMEOUT
} from './oauth-server.js'

// Browser utilities
export { openBrowser, buildAuthorizationUrl } from './browser.js'

// Token storage
export {
  type StoredTokens,
  loadStoredTokens,
  saveTokens,
  clearTokens,
  isTokenExpired,
  isRefreshTokenValid,
  getTokenStoragePath
} from './token-store.js'

// OAuth flow
export {
  type AuthTokens,
  type LoginResult,
  exchangeCodeForTokens,
  refreshTokens,
  performLogin
} from './oauth-flow.js'
