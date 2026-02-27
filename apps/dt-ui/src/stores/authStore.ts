import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { jwtDecode } from 'jwt-decode'
import { AuthConfig, AuthStoreConfig, User, UserInfo, TokenResponse } from '@dethernety/dt-core'
import { getConfig, type OidcEndpoints } from '@/config/environment'

// Extended AuthConfig with OIDC endpoints
interface ExtendedAuthConfig extends AuthConfig {
  endpoints: OidcEndpoints
  // Cognito hosted UI domain for OAuth2 flows (different from issuer)
  // When set, OAuth2 endpoints use this instead of issuer
  oidcDomain?: string
}

// Default configuration for auth store behavior
// Note: Role/permission claim paths are configured in environment.ts via oidcEndpoints
const DEFAULT_CONFIG: Required<AuthStoreConfig> = {
  tokenRefreshThreshold: 5 * 60 * 1000, // 5 minutes
  pkceCodeVerifierLength: 128,
  stateLength: 32,
  defaultScope: 'openid profile email',
  maxRetryAttempts: 3,
  retryDelay: 1000, // 1 second
  enableDebugLogging: import.meta.env.DEV,
  roleClaimPath: 'roles', // Legacy: now configured via oidcEndpoints.rolesClaim
  permissionClaimPath: 'permissions' // Legacy: now configured via oidcEndpoints.permissionsClaim
}

// Routes
const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  LOGOUT: '/auth/logout'
} as const

// User-friendly error messages
const ERROR_MESSAGES = {
  LOGIN_FAILED: 'Login failed. Please try again.',
  TOKEN_REFRESH_FAILED: 'Session expired. Please log in again.',
  NETWORK_ERROR: 'Network error. Please check your connection and try again.',
  CONFIG_ERROR: 'Authentication configuration error. Please contact support.',
  CSRF_ERROR: 'Security error detected. Please try logging in again.',
  INVALID_TOKEN: 'Invalid authentication token. Please log in again.'
} as const

// Check if we're in a secure context (HTTPS) or development mode
const isSecureContext = typeof window !== 'undefined' && window.isSecureContext
// const isDevelopment = import.meta.env.DEV

// Utility Functions
const validateAuthConfig = async (): Promise<ExtendedAuthConfig> => {
  const config = await getConfig();
  
  if (!config.oidcIssuer || !config.oidcClientId || !config.oidcRedirectUri) {
    throw new Error('Missing required OIDC configuration. Please check your environment variables.')
  }

  // Validate URL formats
  try {
    new URL(config.oidcIssuer)
    new URL(config.oidcRedirectUri)
    if (config.appUrl) new URL(config.appUrl)
  } catch {
    throw new Error('Invalid URL format in OIDC configuration')
  }

  return {
    issuer: config.oidcIssuer,
    clientId: config.oidcClientId,
    redirectUri: config.oidcRedirectUri,
    appUrl: config.appUrl || window.location.origin,
    nodeEnv: config.nodeEnv || 'production',
    endpoints: config.oidcEndpoints,
    // Cognito hosted UI domain (for OAuth2 flows when different from issuer)
    oidcDomain: config.oidcDomain
  }
}

/**
 * Get the base URL for OAuth2 endpoints
 * For Cognito, this is the hosted UI domain (different from issuer)
 * For other providers, this is the same as the issuer
 */
const getOAuth2BaseUrl = (config: ExtendedAuthConfig): string => {
  if (config.oidcDomain) {
    // Cognito hosted UI domain - ensure it has https://
    return config.oidcDomain.startsWith('https://')
      ? config.oidcDomain
      : `https://${config.oidcDomain}`
  }
  // Default: use issuer URL for OAuth2 endpoints
  return config.issuer
}

const generateRandomString = (length: number): string => {
  const array = new Uint8Array(length / 2)
  if (typeof window !== 'undefined' && window.crypto) {
    crypto.getRandomValues(array)
  } else {
    throw new Error(
      'Web Crypto API is required for secure authentication. Please use a modern browser.'
    )
  }
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// For development, we'll use a simpler approach - plain code challenge without hashing
// This is allowed by the OAuth2 PKCE spec when using method "plain" instead of "S256"
const sha256Fallback = async (plain: string): Promise<ArrayBuffer> => {
  // In development, we'll just return the original string as bytes
  // This will be used with code_challenge_method = "plain"
  const encoder = new TextEncoder()
  const uint8Array = encoder.encode(plain)
  // Ensure we always return an ArrayBuffer, not a SharedArrayBuffer
  return uint8Array.buffer instanceof ArrayBuffer
    ? uint8Array.buffer.slice(0)
    : new Uint8Array(uint8Array).buffer
}

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
  const config = await validateAuthConfig()
  if (isSecureContext && crypto.subtle) {
    // Use Web Crypto API in secure contexts (HTTPS)
    const encoder = new TextEncoder()
    const data = encoder.encode(plain)
    return crypto.subtle.digest('SHA-256', data)
  } else if (config.nodeEnv === 'development') {
    // Use fallback in development mode (HTTP)
    console.warn('Using fallback SHA-256 implementation for development. This is NOT secure for production!')
    return sha256Fallback(plain)
  } else {
    throw new Error('Crypto API not available and not in development mode')
  }
}

const base64URLEncode = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// Utility functions for extracting roles and permissions from user info
// These support both simple array claims and nested object claims (like Zitadel's format)
const extractRolesFromUserInfo = (userInfo: UserInfo, rolesClaim: string): string[] => {
  // Support nested claim paths like 'urn:zitadel:iam:org:project:roles' or 'cognito:groups'
  const claimValue = userInfo[rolesClaim as keyof UserInfo]

  if (claimValue && typeof claimValue === 'object' && !Array.isArray(claimValue)) {
    // Zitadel-style: roles are object keys, e.g., { "admin": {...}, "user": {...} }
    return Object.keys(claimValue)
  }

  if (Array.isArray(claimValue)) {
    // Cognito/Auth0-style: roles are an array, e.g., ["admin", "user"]
    return claimValue as string[]
  }

  // Fallback: check standard 'roles' claim
  if (Array.isArray(userInfo.roles)) {
    return userInfo.roles
  }

  return []
}

const extractPermissionsFromUserInfo = (userInfo: UserInfo, permissionsClaim: string): string[] => {
  const claimValue = userInfo[permissionsClaim as keyof UserInfo]

  if (claimValue && typeof claimValue === 'object' && !Array.isArray(claimValue)) {
    // Zitadel-style: permissions are nested in role objects
    return Object.values(claimValue).flat().filter(Boolean) as string[]
  }

  if (Array.isArray(claimValue)) {
    // Auth0-style: permissions are an array
    return claimValue as string[]
  }

  return []
}

// Logging utility
const debugLog = (config: Required<AuthStoreConfig>, message: string, ...args: any[]) => {
  if (config.enableDebugLogging) {
    console.log(`[AuthStore] ${message}`, ...args)
  }
}

// Retry utility with exponential backoff
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  baseDelay: number,
  operationName: string
): Promise<T> => {
  let lastError: Error
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      
      if (attempt === maxAttempts) {
        throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${lastError.message}`)
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1) // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError!
}

/**
 * Creates an authentication store with OIDC/OAuth2 support
 */
const createAuthStore = (config: AuthStoreConfig = {}) => {
  // Merge with defaults
  const authConfig = { ...DEFAULT_CONFIG, ...config }
  
  return defineStore('auth', () => {
  // State
  const token = ref('')
  const user = ref<User | null>(null)
  const roles = ref<string[]>([])
  const permissions = ref<string[]>([])
  const refreshToken = ref('')
  const tokenExpiry = ref(0)
  const isLoading = ref(false)
  const error = ref('')

  // Promise-based mutex for preventing concurrent token refresh attempts
  let refreshPromise: Promise<void> | null = null
  let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Computed
  const isAuthenticated = computed(() => {
    return token.value !== '' && Date.now() < tokenExpiry.value
  })

  const isTokenExpired = computed(() => {
    return Date.now() >= tokenExpiry.value
  })

  const isTokenExpiringSoon = computed(() => {
    return token.value !== '' && (tokenExpiry.value - Date.now()) < authConfig.tokenRefreshThreshold
  })

  const isRefreshInProgress = computed(() => refreshPromise !== null)

  // Helper functions
  const hasRole = (role: string): boolean => {
    return roles.value.includes(role)
  }

  const hasPermission = (permission: string): boolean => {
    return permissions.value.includes(permission)
  }

  const resetLoadingAndError = (): void => {
    isLoading.value = false
    error.value = ''
  }

  const setLoadingState = (loading: boolean, errorMessage = ''): void => {
    isLoading.value = loading
    error.value = errorMessage
  }

  /**
   * Schedules automatic token refresh before expiry
   */
  const scheduleTokenRefresh = (): void => {
    // Clear existing timeout
    if (refreshTimeoutId) {
      clearTimeout(refreshTimeoutId)
      refreshTimeoutId = null
    }
    
    if (!token.value || !tokenExpiry.value) return
    
    const timeUntilRefresh = tokenExpiry.value - Date.now() - authConfig.tokenRefreshThreshold
    
    if (timeUntilRefresh > 0) {
      debugLog(authConfig, `Scheduling token refresh in ${Math.round(timeUntilRefresh / 1000)}s`)
      refreshTimeoutId = setTimeout(() => {
        debugLog(authConfig, 'Automatic token refresh triggered')
        performTokenRefresh().catch(error => {
          console.error('Automatic token refresh failed:', error)
        })
      }, timeUntilRefresh)
    } else if (timeUntilRefresh > -authConfig.tokenRefreshThreshold) {
      // Token is expiring soon, refresh immediately
      debugLog(authConfig, 'Token expiring soon, refreshing immediately')
      performTokenRefresh().catch(error => {
        console.error('Immediate token refresh failed:', error)
      })
    }
  }

  const safeRedirect = (url: string): void => {
    try {
      window.location.href = url
    } catch (redirectError) {
      console.error('Redirect failed:', redirectError)
      // Fallback to home page
      window.location.href = ROUTES.HOME
    }
  }

  /**
   * Converts technical errors to user-friendly messages
   */
  const getUserFriendlyError = (error: Error, context: string): string => {
    const message = error.message.toLowerCase()
    
    if (message.includes('network') || message.includes('fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR
    }
    
    if (message.includes('csrf') || message.includes('state')) {
      return ERROR_MESSAGES.CSRF_ERROR
    }
    
    if (message.includes('token') && message.includes('failed')) {
      return context === 'refresh' ? ERROR_MESSAGES.TOKEN_REFRESH_FAILED : ERROR_MESSAGES.LOGIN_FAILED
    }
    
    if (message.includes('config') || message.includes('environment')) {
      return ERROR_MESSAGES.CONFIG_ERROR
    }
    
    // Default fallback based on context
    switch (context) {
      case 'login':
        return ERROR_MESSAGES.LOGIN_FAILED
      case 'refresh':
        return ERROR_MESSAGES.TOKEN_REFRESH_FAILED
      default:
        return ERROR_MESSAGES.LOGIN_FAILED
    }
  }

  /**
   * Generates PKCE parameters for OAuth2 authorization
   */
  const generatePKCE = async (): Promise<{ codeChallenge: string; challengeMethod: string }> => {
    const codeVerifier = generateRandomString(authConfig.pkceCodeVerifierLength)
    const config = await validateAuthConfig()
    
    let codeChallenge: string
    let challengeMethod: string
    
    if (isSecureContext && crypto.subtle) {
      // Production: Use S256 method with proper SHA-256 hashing
      const hash = await sha256(codeVerifier)
      codeChallenge = base64URLEncode(hash)
      challengeMethod = 'S256'
    } else if (config.nodeEnv === 'development') {
      // Development: Use plain method (allowed by OAuth2 PKCE spec)
      codeChallenge = codeVerifier
      challengeMethod = 'plain'
      console.warn('Using PKCE plain method for development. This is less secure but works without HTTPS.')
    } else {
      throw new Error('Crypto API not available and not in development mode')
    }
    
    sessionStorage.setItem('code_verifier', codeVerifier)
    sessionStorage.setItem('challenge_method', challengeMethod)
    return { codeChallenge, challengeMethod }
  }

  const login = async (): Promise<void> => {
    try {
      setLoadingState(true)
      
      // Validate environment variables
      const config = await validateAuthConfig()
      
      const { codeChallenge, challengeMethod } = await generatePKCE()

      // Use oidcDomain for OAuth2 endpoints (Cognito hosted UI) if available
      const oauth2BaseUrl = getOAuth2BaseUrl(config)
      const authUrl = new URL(`${oauth2BaseUrl}${config.endpoints.authorize}`)
      authUrl.searchParams.set('client_id', config.clientId)
      authUrl.searchParams.set('redirect_uri', config.redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', authConfig.defaultScope)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', challengeMethod)
      
      // Add state parameter for additional security
      const state = generateRandomString(authConfig.stateLength)
      authUrl.searchParams.set('state', state)
      sessionStorage.setItem('auth_state', state)
      
      safeRedirect(authUrl.toString())
    } catch (err) {
      const error = err as Error
      const userFriendlyMessage = getUserFriendlyError(error, 'login')
      setLoadingState(false, userFriendlyMessage)
      debugLog(authConfig, 'Login failed:', error.message)
      throw new Error(userFriendlyMessage)
    }
  }

  const handleCallback = async (code: string, state?: string): Promise<void> => {
    try {
      setLoadingState(true)
      
      // Validate state parameter for CSRF protection
      const storedState = sessionStorage.getItem('auth_state')
      if (state && storedState && state !== storedState) {
        throw new Error('Invalid state parameter - possible CSRF attack')
      }
      
      const codeVerifier = sessionStorage.getItem('code_verifier')
      if (!codeVerifier) throw new Error('No code verifier found')

      // Exchange authorization code for tokens
      const tokens = await exchangeCodeForTokens(code, codeVerifier)
      
      // Clean up stored values
      cleanupStoredAuthData()

      // Set tokens
      setToken(tokens.access_token)
      setRefreshToken(tokens.refresh_token || '')
      
      // Get user info and determine token expiry
      const config = await validateAuthConfig()
      const { userInfo, tokenExpiry } = await getUserInfoAndExpiry(tokens)

      // Set user data
      setUser({
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name || userInfo.preferred_username || 'Unknown',
      })

      // Extract and set roles and permissions using configurable claim paths
      const userRoles = extractRolesFromUserInfo(userInfo, config.endpoints.rolesClaim)
      const userPermissions = extractPermissionsFromUserInfo(userInfo, config.endpoints.permissionsClaim)
      setRoles(userRoles)
      setPermissions(userPermissions)
      
      setTokenExpiry(tokenExpiry)
      resetLoadingAndError()
      
      // Schedule automatic refresh
      scheduleTokenRefresh()
      
      debugLog(authConfig, 'Authentication successful', { roles: userRoles.length, permissions: userPermissions.length })

      // Redirect to home page
      safeRedirect(ROUTES.HOME)
    } catch (err) {
      const error = err as Error
      const userFriendlyMessage = getUserFriendlyError(error, 'login')
      setLoadingState(false, userFriendlyMessage)
      // debugLog(authConfig, 'Authentication failed:', error.message)
      debugLog(authConfig, 'Authentication failed:', err)
      throw new Error(userFriendlyMessage)
    }
  }

  // Helper function to exchange authorization code for tokens
  const exchangeCodeForTokens = async (code: string, codeVerifier: string): Promise<TokenResponse> => {
    const config = await validateAuthConfig()
    const oauth2BaseUrl = getOAuth2BaseUrl(config)

    const tokenResponse = await fetch(`${oauth2BaseUrl}${config.endpoints.token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code: code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      debugLog(authConfig, 'Token response error:', errorText)
      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
    }

    const tokens: TokenResponse = await tokenResponse.json()
    
    if (!tokens.access_token) {
      throw new Error('No access token received from authorization server')
    }

    debugLog(authConfig, 'Token exchange successful')
    return tokens
  }



  // Helper function to get user info and determine token expiry
  const getUserInfoAndExpiry = async (tokens: TokenResponse): Promise<{ userInfo: UserInfo; tokenExpiry: number }> => {
    const config = await validateAuthConfig()
    const oauth2BaseUrl = getOAuth2BaseUrl(config)
    const isJWT = tokens.access_token.split('.').length === 3
    let tokenExpiry: number

    if (isJWT) {
      // For JWT tokens, get expiry from the token itself
      const decodedToken = jwtDecode(tokens.access_token) as { exp: number }
      tokenExpiry = decodedToken.exp * 1000
    } else {
      // For opaque tokens, calculate expiry from expires_in
      tokenExpiry = Date.now() + (tokens.expires_in * 1000)
    }

    // Always fetch complete user info from userinfo endpoint
    const userInfoResponse = await fetch(`${oauth2BaseUrl}${config.endpoints.userinfo}`, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json'
      }
    })
    
    if (!userInfoResponse.ok) {
      throw new Error(`Failed to fetch user info: ${userInfoResponse.status}`)
    }
    
    const userInfo: UserInfo = await userInfoResponse.json()
    debugLog(authConfig, 'User info retrieved successfully')

    return { userInfo, tokenExpiry }
  }

  // Helper function to clean up stored authentication data
  const cleanupStoredAuthData = (): void => {
    sessionStorage.removeItem('code_verifier')
    sessionStorage.removeItem('challenge_method')
    sessionStorage.removeItem('auth_state')
  }

  /**
   * Clears all authentication state and cancels pending operations
   */
  const clearState = (): void => {
    token.value = ''
    user.value = null
    roles.value = []
    permissions.value = []
    refreshToken.value = ''
    tokenExpiry.value = 0
    error.value = ''
    isLoading.value = false
    
    // Clear refresh promise and timeout
    refreshPromise = null
    if (refreshTimeoutId) {
      clearTimeout(refreshTimeoutId)
      refreshTimeoutId = null
    }
    
    debugLog(authConfig, 'Auth state cleared')
  }

  const refreshTokenIfNeeded = async (): Promise<void> => {
    if (isTokenExpired.value && refreshToken.value) {
      try {
        const config = await validateAuthConfig()
        const oauth2BaseUrl = getOAuth2BaseUrl(config)
        const response = await fetch(`${oauth2BaseUrl}${config.endpoints.token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken.value,
            client_id: config.clientId,
          }),
        })

        if (response.status === 400 || response.status === 401) {
          // Refresh token is invalid (session terminated elsewhere)
          console.warn('Refresh token invalid, session terminated elsewhere')
          clearState()
          safeRedirect(ROUTES.LOGIN)
          return
        }

        if (!response.ok) {
          throw new Error(`Refresh token failed: ${response.status}`)
        }
        const tokens: TokenResponse = await response.json()
        setToken(tokens.access_token)
        setTokenExpiry(Date.now() + (tokens.expires_in * 1000))

        if (tokens.refresh_token) {
          setRefreshToken(tokens.refresh_token)
        }

        debugLog(authConfig, 'Token refreshed via refreshTokenIfNeeded')
      } catch (error) {
        debugLog(authConfig, 'refreshTokenIfNeeded failed:', (error as Error).message)
        await logout(false, true) // Force re-login if refresh fails
      }
    }
  }

  /**
   * Internal token refresh implementation with retry logic
   */
  const doTokenRefresh = async (): Promise<void> => {
    if (!refreshToken.value) {
      throw new Error('No refresh token available')
    }

    const config = await validateAuthConfig()
    const oauth2BaseUrl = getOAuth2BaseUrl(config)

    return retryWithBackoff(async () => {
      const response = await fetch(`${oauth2BaseUrl}${config.endpoints.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken.value,
          client_id: config.clientId,
        }),
      })

      if (!response.ok) {
        // Check if it's a network error or auth error
        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`)
        } else if (response.status === 401 || response.status === 400) {
          // Don't retry auth errors, they won't succeed
          throw new Error(`Authentication error: ${response.status}`)
        }
        throw new Error(`Token refresh failed: ${response.status}`)
      }

      const tokens: TokenResponse = await response.json()
      setToken(tokens.access_token)
      setTokenExpiry(Date.now() + (tokens.expires_in * 1000))

      if (tokens.refresh_token) {
        setRefreshToken(tokens.refresh_token)
      }
      
      // Schedule next refresh
      scheduleTokenRefresh()
      
      debugLog(authConfig, 'Token refreshed successfully')
    }, authConfig.maxRetryAttempts, authConfig.retryDelay, 'Token refresh')
  }

  /**
   * Promise-based token refresh with proper race condition prevention
   */
  const performTokenRefresh = async (): Promise<void> => {
    // If refresh is already in progress, return the existing promise
    if (refreshPromise) {
      debugLog(authConfig, 'Token refresh already in progress, waiting for completion')
      return refreshPromise
    }

    // Start new refresh
    debugLog(authConfig, 'Starting token refresh')
    refreshPromise = doTokenRefresh()
    
    try {
      await refreshPromise
    } catch (error) {
      debugLog(authConfig, 'Token refresh failed:', (error as Error).message)
      
      // Check if it's an auth error that requires logout
      const errorMessage = (error as Error).message
      if (errorMessage.includes('Authentication error') || errorMessage.includes('401') || errorMessage.includes('400')) {
        await logout(false, true)
      }
      
      throw error
    } finally {
      refreshPromise = null
    }
  }

  const logout = async (isGlobalLogout = true, forceLocal = false): Promise<void> => {
    try {
      setLoadingState(true)
      const config = await validateAuthConfig()

      if (forceLocal) {
        clearState()
        safeRedirect(ROUTES.LOGIN)
        return
      }

      // Revoke refresh token if available
      await revokeToken(config)
  
      if (isGlobalLogout) {
        // Try to redirect to end_session endpoint
        try {
          const oauth2BaseUrl = getOAuth2BaseUrl(config)
          const logoutUrl = new URL(`${oauth2BaseUrl}${config.endpoints.logout}`)
          logoutUrl.searchParams.set('client_id', config.clientId)
          logoutUrl.searchParams.set(config.endpoints.logoutRedirectParam, `${config.appUrl}${ROUTES.LOGOUT}`)
          
          // Clear local state before redirecting (in case redirect fails)
          clearState()
          safeRedirect(logoutUrl.toString())
        } catch (logoutError) {
          console.error('Logout redirect failed:', logoutError)
          // Fallback to local logout
          clearState()
          safeRedirect(ROUTES.LOGIN)
        }
      } else {
        clearState()
        safeRedirect(ROUTES.LOGIN)
      }
        
    } catch (error) {
      console.error('Logout error:', error)
      // Fallback: clear state and redirect
      clearState()
      safeRedirect(ROUTES.LOGIN)
    }
  }

  const revokeToken = async (config: ExtendedAuthConfig): Promise<void> => {
    if (!refreshToken.value) return

    try {
      const oauth2BaseUrl = getOAuth2BaseUrl(config)
      await fetch(`${oauth2BaseUrl}${config.endpoints.revoke}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: refreshToken.value,
          client_id: config.clientId,
          token_type_hint: 'refresh_token'
        }),
      })
    } catch (revokeError) {
      console.warn('Failed to revoke refresh token:', revokeError)
    }
  }

  const checkSessionValidity = async (): Promise<boolean> => {
    if (!token.value) return false

    try {
      const config = await validateAuthConfig()
      const oauth2BaseUrl = getOAuth2BaseUrl(config)
      // Try to use the token (e.g., call userinfo endpoint)
      const response = await fetch(`${oauth2BaseUrl}${config.endpoints.userinfo}`, {
        headers: {
          'Authorization': `Bearer ${token.value}`,
          'Accept': 'application/json'
        }
      })
      
      if (response.status === 401 || response.status === 403) {
        // Token is invalid, clear local state
        console.warn('Session is no longer valid, clearing local state')
        clearState()
        return false
      }
      
      return response.ok
    } catch (error) {
      console.warn('Session check failed:', error)
      return false
    }
  }
  
  /**
   * Ensures the current token is valid and refreshes if needed
   * This is the main method components should call before API requests
   */
  const ensureValidToken = async (): Promise<void> => {
    if (!token.value) {
      throw new Error(ERROR_MESSAGES.INVALID_TOKEN)
    }
    
    if (isTokenExpiringSoon.value) {
      debugLog(authConfig, 'Token expiring soon, refreshing proactively')
      await performTokenRefresh()
    }
  }

  // Setters with proper typing
  const setToken = (newToken: string): void => {
    token.value = newToken
  }

  const setUser = (newUser: User): void => {
    user.value = newUser
  }

  const setRoles = (newRoles: string[]): void => {
    roles.value = newRoles
  }

  const setPermissions = (newPermissions: string[]): void => {
    permissions.value = newPermissions
  }

  const setRefreshToken = (newRefreshToken: string): void => {
    refreshToken.value = newRefreshToken
  }

  const setTokenExpiry = (newTokenExpiry: number): void => {
    tokenExpiry.value = newTokenExpiry
    // Schedule automatic refresh when token expiry is updated
    scheduleTokenRefresh()
  }

  return {
    // State
    token, user, roles, permissions, refreshToken, tokenExpiry, isLoading, error,
    // Computed
    isAuthenticated, isTokenExpired, isTokenExpiringSoon, isRefreshInProgress,
    // Helper functions
    hasRole, hasPermission,
    // Actions
    login, handleCallback, logout, refreshTokenIfNeeded, performTokenRefresh, ensureValidToken, checkSessionValidity, clearState,
    // Setters (for manual token handling)
    setToken, setUser, setRoles, setPermissions, setRefreshToken, setTokenExpiry,
  }
  }, {
    persist: {
      pick: ['user', 'roles', 'permissions'],
    }
  })
}

// Export default store with default config
export const useAuthStore = createAuthStore()
