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
  isAuthDisabled,
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
  clearAllTokens,
  isTokenExpired,
  canRefresh,
  getTokenStoragePath
} from './token-store.js'

// Revocation
export { type RevocationResult, revokeSessions } from './revoke.js'

// OAuth flow
export {
  type AuthTokens,
  type LoginResult,
  exchangeCodeForTokens,
  refreshTokens,
  refreshStoredSession,
  SessionExpiredError,
  SignedOutError,
  sessionLogin,
  performLogin
} from './oauth-flow.js'

// Sign-in sessions (one browser sign-in at a time)
export {
  type LoginAnswer,
  login,
  isLoginPending,
  lastLoginSummary,
  cancelPendingLogin,
  LISTENER_LIFETIME_MS
} from './login-manager.js'
