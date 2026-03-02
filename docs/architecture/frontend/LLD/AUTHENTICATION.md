# Frontend Authentication Architecture

## Table of Contents
- [Overview](#overview)
- [Auth-Disabled Mode](#auth-disabled-mode)
- [OIDC/PKCE Flow](#oidcpkce-flow)
- [Token Refresh Architecture](#token-refresh-architecture)
- [Multi-Provider Support](#multi-provider-support)
- [Apollo Client Integration](#apollo-client-integration)
- [Security Considerations](#security-considerations)
- [State Management](#state-management)
- [Error Handling](#error-handling)

## Overview

The frontend authentication system implements OIDC (OpenID Connect) with PKCE (Proof Key for Code Exchange) to provide secure, standards-based authentication across multiple identity providers.

**Primary Source File:** `apps/dt-ui/src/stores/authStore.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Authentication Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User clicks Login                                                   │
│     └─→ authStore.login()                                               │
│         ├─→ Generate state, nonce, code_verifier                        │
│         ├─→ Store in localStorage                                       │
│         └─→ Redirect to OIDC provider                                   │
│                                                                         │
│  2. Provider redirects back with code                                   │
│     └─→ /auth/callback route                                            │
│         └─→ authStore.handleCallback()                                  │
│             ├─→ Validate state parameter                                │
│             ├─→ Exchange code for tokens (with code_verifier)           │
│             └─→ Store tokens, decode user info                          │
│                                                                         │
│  3. Authenticated requests                                              │
│     └─→ Apollo authLink                                                 │
│         └─→ Injects Authorization: Bearer {token}                       │
│                                                                         │
│  4. Token refresh (before expiration)                                   │
│     └─→ authStore.ensureValidToken()                                    │
│         └─→ If token expires in < 5 min                                 │
│             └─→ authStore.refreshToken()                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Auth-Disabled Mode

When the backend returns `authDisabled: true` from the `/config` endpoint (see [Configuration Guide](../../../CONFIGURATION_GUIDE.md#auth-disabled-mode-demo--development)), the frontend bypasses all OIDC flows and operates without authentication.

### How it works

On startup, `authStore` calls `initializeAuthMode()` which checks the `authDisabled` flag from the runtime config:

```typescript
// authStore.ts — simplified
const initializeAuthMode = async () => {
  const config = await fetchRuntimeConfig()
  if (config.authDisabled) {
    authDisabled.value = true
    user.value = { name: 'dev-user', email: 'dev@localhost' }
    // isAuthenticated computed returns true when authDisabled is true
  }
}
```

When `authDisabled` is true:

| Component | Behavior |
|-----------|----------|
| **authStore** | `isAuthenticated` returns `true`, `login()` returns immediately, mock user injected |
| **Router guard** | Skips auth check — all routes are accessible |
| **Apollo authLink** | Omits `Authorization` header (no token available) |
| **Config validation** | Skips OIDC field validation (`oidcIssuer`, `oidcClientId`, etc.) |

The backend's `jwt-auth.guard.ts` handles unauthenticated requests by creating a mock `dev-user` context, so GraphQL operations work normally.

### Safety

Auth-disabled mode requires three conditions on the backend: `NODE_ENV !== 'production'`, no OIDC configured, and `ENABLE_NOAUTH=true`. The frontend cannot enable this mode on its own — it only reads the flag from the backend.

---

## OIDC/PKCE Flow

### PKCE Implementation

PKCE prevents authorization code interception attacks by requiring a cryptographic proof during token exchange.

**Source:** `authStore.ts:355-379`

```typescript
// PKCE Code Verifier and Challenge Generation
const generatePKCE = async (): Promise<{
  codeVerifier: string
  codeChallenge: string
  codeChallengeMethod: 'S256' | 'plain'
}> => {
  // Generate random code verifier (128 characters)
  const codeVerifier = generateRandomString(config.pkceCodeVerifierLength)

  // In secure context (HTTPS): Use SHA-256 for challenge
  if (window.isSecureContext && window.crypto?.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(codeVerifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const codeChallenge = base64URLEncode(digest)

    return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' }
  }

  // Development fallback: Plain method (HTTP environments)
  return { codeVerifier, codeChallenge: codeVerifier, codeChallengeMethod: 'plain' }
}
```

**Key Points:**
- **S256 Method (Production):** SHA-256 hash of code_verifier, base64URL encoded
- **Plain Method (Development):** Code challenge equals code verifier (for HTTP localhost)
- **Code Verifier Length:** 128 characters (configurable via `pkceCodeVerifierLength`)

### Authorization Request

**Source:** `authStore.ts:381-413`

```typescript
const login = async (): Promise<void> => {
  const { codeVerifier, codeChallenge, codeChallengeMethod } = await generatePKCE()
  const state = generateRandomString(config.stateLength)

  // Store PKCE values for callback validation
  localStorage.setItem('code_verifier', codeVerifier)
  localStorage.setItem('challenge_method', codeChallengeMethod)
  localStorage.setItem('auth_state', state)

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: oidcConfig.clientId,
    redirect_uri: oidcConfig.redirectUri,
    response_type: 'code',
    scope: config.defaultScope,  // 'openid profile email'
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state: state
  })

  window.location.href = `${authorizationEndpoint}?${params.toString()}`
}
```

### Callback Handling

**Source:** `authStore.ts:415-473`

```typescript
const handleCallback = async (): Promise<void> => {
  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get('code')
  const returnedState = urlParams.get('state')

  // 1. CSRF Protection: Validate state parameter
  const storedState = localStorage.getItem('auth_state')
  if (returnedState !== storedState) {
    throw new Error('Invalid state parameter - possible CSRF attack')
  }

  // 2. Retrieve PKCE code_verifier
  const codeVerifier = localStorage.getItem('code_verifier')

  // 3. Exchange authorization code for tokens
  const tokens = await exchangeCodeForTokens(code, codeVerifier)

  // 4. Cleanup temporary localStorage values
  localStorage.removeItem('code_verifier')
  localStorage.removeItem('challenge_method')
  localStorage.removeItem('auth_state')

  // 5. Process tokens and user info
  const userInfo = await fetchUserInfo(tokens.access_token)
  const tokenExpiry = calculateTokenExpiry(tokens)

  // 6. Extract roles/permissions from provider-specific claims
  const roles = extractRolesFromUserInfo(userInfo, config.endpoints.rolesClaim)
  const permissions = extractPermissionsFromUserInfo(userInfo, config.endpoints.permissionsClaim)

  // 7. Update store state
  setToken(tokens.access_token)
  setRefreshToken(tokens.refresh_token)
  setUser(userInfo)
  setRoles(roles)
  setTokenExpiry(tokenExpiry)

  // 8. Schedule automatic token refresh
  scheduleTokenRefresh()

  // 9. Redirect to home
  router.push('/')
}
```

---

## Token Refresh Architecture

### Race Condition Prevention

The token refresh mechanism uses a promise-based mutex pattern to prevent multiple concurrent refresh requests.

**Source:** `authStore.ts:669-695`

```typescript
// Singleton refresh promise
let refreshPromise: Promise<void> | null = null
let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null

const performTokenRefresh = async (): Promise<void> => {
  // If refresh already in progress, return existing promise
  if (refreshPromise) {
    return refreshPromise
  }

  // Create new refresh promise
  refreshPromise = (async () => {
    try {
      await doTokenRefresh()
    } finally {
      // Always clear the promise reference
      refreshPromise = null
    }
  })()

  return refreshPromise
}
```

**Why This Matters:**
- Multiple components may call `ensureValidToken()` simultaneously
- Without mutex, each call would trigger a separate refresh request
- The mutex prevents concurrent refreshes; others await the same promise

### Automatic Refresh Scheduling

**Source:** `authStore.ts:281-307`

```typescript
const scheduleTokenRefresh = (): void => {
  // Clear any existing scheduled refresh
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId)
    refreshTimeoutId = null
  }

  if (!token.value || !tokenExpiry.value) return

  const timeUntilRefresh = tokenExpiry.value - Date.now() - config.tokenRefreshThreshold

  if (timeUntilRefresh > 0) {
    // Schedule refresh before expiration
    refreshTimeoutId = setTimeout(async () => {
      await performTokenRefresh()
    }, timeUntilRefresh)
  } else if (Date.now() < tokenExpiry.value) {
    // Token expiring soon, refresh immediately
    performTokenRefresh()
  }
}
```

**Timing Configuration:**
- **tokenRefreshThreshold:** 5 minutes (300,000 ms) before expiry
- Refresh is scheduled at: `tokenExpiry - now - 5min`

### Retry with Exponential Backoff

**Source:** `authStore.ts:196-220`

```typescript
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  maxAttempts: number = config.maxRetryAttempts,
  baseDelay: number = config.retryDelay,
  operationName: string = 'operation'
): Promise<T> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === maxAttempts) throw error

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error(`${operationName} failed after ${maxAttempts} attempts`)
}
```

**Backoff Schedule (defaults):**
| Attempt | Delay |
|---------|-------|
| 1 | 1000ms |
| 2 | 2000ms |
| 3 | 4000ms |

### Token Refresh Implementation

**Source:** `authStore.ts:621-664`

```typescript
const doTokenRefresh = async (): Promise<void> => {
  return retryWithBackoff(async () => {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken.value,
        client_id: oidcConfig.clientId
      })
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 400) {
        // Non-retryable: Session invalid, force logout
        clearState()
        router.push('/login')
        throw new Error('Session expired')
      }
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const tokens = await response.json()

    // Update tokens
    setToken(tokens.access_token)
    if (tokens.refresh_token) {
      setRefreshToken(tokens.refresh_token)  // Rotating refresh tokens
    }
    setTokenExpiry(calculateTokenExpiry(tokens))

    // Schedule next refresh
    scheduleTokenRefresh()
  }, config.maxRetryAttempts, config.retryDelay, 'token refresh')
}
```

---

## Multi-Provider Support

### Supported Providers

**Source:** `config/environment.ts:38-90`

| Provider | Token Endpoint | UserInfo | Logout | Roles Claim |
|----------|---------------|----------|--------|-------------|
| **Cognito** | `/oauth2/token` | `/oauth2/userInfo` | `/logout` | `cognito:groups` |
| **Zitadel** | `/oauth/v2/token` | `/oidc/v1/userinfo` | `/oidc/v1/end_session` | `urn:zitadel:iam:org:project:roles` |
| **Auth0** | `/oauth/token` | `/userinfo` | `/v2/logout` | Custom namespace |
| **Keycloak** | `/protocol/openid-connect/token` | `/protocol/openid-connect/userinfo` | `/protocol/openid-connect/logout` | `realm_access.roles` |

### Provider Configuration

```typescript
interface OidcEndpoints {
  authorize: string          // Authorization endpoint path
  token: string              // Token endpoint path
  userinfo: string           // UserInfo endpoint path
  logout: string             // Logout endpoint path
  revoke: string             // Token revocation endpoint path
  rolesClaim: string         // Path to roles in ID token/userinfo
  permissionsClaim: string   // Path to permissions in ID token/userinfo
  logoutRedirectParam: string // Parameter name for post-logout redirect
}
```

### Cognito Special Handling

**Source:** `authStore.ts:84-93`

Cognito uses a separate hosted UI domain that differs from the issuer:

```typescript
const getOAuth2BaseUrl = (): string => {
  // Cognito: Use oidcDomain for OAuth2 endpoints (hosted UI)
  // Other providers: Use issuer directly
  const baseUrl = oidcConfig.oidcDomain || oidcConfig.issuer

  // Ensure HTTPS prefix
  if (!baseUrl.startsWith('http')) {
    return `https://${baseUrl}`
  }
  return baseUrl
}
```

### Role Extraction (Multi-Format)

**Source:** `authStore.ts:150-186`

Different providers return roles in different formats:

```typescript
const extractRolesFromUserInfo = (
  userInfo: UserInfo,
  rolesClaim: string
): string[] => {
  const rolesData = getNestedValue(userInfo, rolesClaim)

  // Zitadel format: Object with role names as keys
  // { "admin": {...}, "user": {...} }
  if (rolesData && typeof rolesData === 'object' && !Array.isArray(rolesData)) {
    return Object.keys(rolesData)
  }

  // Cognito/Auth0 format: Array of strings
  // ["admin", "user"]
  if (Array.isArray(rolesData)) {
    return rolesData.filter(r => typeof r === 'string')
  }

  // Fallback: Check standard 'roles' claim
  if (Array.isArray(userInfo.roles)) {
    return userInfo.roles
  }

  return []
}
```

---

## Apollo Client Integration

### Auth Link

**Source:** `plugins/apolloClient.ts:44-59`

Every GraphQL request passes through the auth link:

```typescript
const authLink = setContext(async (_, { headers }) => {
  const authStore = useAuthStore()

  // CRITICAL: Ensure token is valid before request
  // This triggers refresh if token expiring soon
  await authStore.ensureValidToken()

  const token = authStore.token

  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }
})
```

### Subscription Authentication

**WebSocket (Source: apolloClient.ts:85-110)**

```typescript
const wsClient = createWsClient({
  url: wsUrl,
  connectionParams: () => {
    const authStore = useAuthStore()
    const token = authStore.token
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
  on: {
    error: (error: unknown) => {
      // Detect auth failures in WebSocket
      if (error?.message?.includes('Unauthorized') ||
          error?.message?.includes('401')) {
        authStore.clearState()
        window.location.href = '/login'
      }
    }
  }
})
```

**SSE (Source: apolloClient.ts:112-149)**

```typescript
const sseClient = createSseClient({
  url: sseUrl,
  headers: (): Record<string, string> => {
    const authStore = useAuthStore()
    const token = authStore.token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
})
```

---

## Security Considerations

### CSRF Protection

**State Parameter Validation:**
```typescript
// On login: Generate and store state
const state = generateRandomString(32)
localStorage.setItem('auth_state', state)

// On callback: Validate state matches
const storedState = localStorage.getItem('auth_state')
if (returnedState !== storedState) {
  throw new Error('Invalid state parameter - possible CSRF attack')
}
```

### PKCE Security

| Method | Security Level | Use Case |
|--------|---------------|----------|
| **S256** | High | Production (HTTPS) |
| **Plain** | Lower | Development (HTTP localhost) |

The code automatically selects S256 when `window.isSecureContext` is true.

### Token Storage

| Data | Storage | Persisted |
|------|---------|-----------|
| Access Token | Pinia + localStorage | Yes |
| Refresh Token | Pinia + localStorage | Yes |
| User Info | Pinia + localStorage | Yes |
| Code Verifier | localStorage | Temporary (cleared after callback) |
| State | localStorage | Temporary (cleared after callback) |

### Error Handling Security

**Source:** `authStore.ts:37-44, 322-350`

User-facing errors never expose internal details:

```typescript
const getUserFriendlyError = (error: Error, context: string): string => {
  // Map technical errors to safe user messages
  const message = error.message.toLowerCase()

  if (message.includes('network') || message.includes('fetch')) {
    return 'Connection failed. Please check your internet connection.'
  }
  if (message.includes('csrf') || message.includes('state')) {
    return 'Security validation failed. Please try logging in again.'
  }
  if (message.includes('token') || message.includes('401')) {
    return 'Your session has expired. Please log in again.'
  }

  return `Authentication failed. Please try again.`
}
```

---

## State Management

### Persisted State (via Pinia persist plugin)

**Source:** `authStore.ts:843-844`

```typescript
persist: {
  paths: ['token', 'refreshToken', 'user', 'roles', 'permissions', 'tokenExpiry']
}
```

### Computed Properties

**Source:** `authStore.ts:245-257`

```typescript
// Authentication status
const isAuthenticated = computed(() =>
  token.value !== '' && Date.now() < tokenExpiry.value
)

// Token expiration check
const isTokenExpired = computed(() =>
  Date.now() >= tokenExpiry.value
)

// Pre-expiration warning (within threshold)
const isTokenExpiringSoon = computed(() =>
  token.value !== '' &&
  (tokenExpiry.value - Date.now()) < config.tokenRefreshThreshold
)

// Refresh operation status
const isRefreshInProgress = computed(() =>
  refreshPromise !== null
)
```

### State Reset

**Source:** `authStore.ts:722-740`

```typescript
const clearState = (): void => {
  // Clear refresh timer
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId)
    refreshTimeoutId = null
  }

  // Clear refresh promise
  refreshPromise = null

  // Reset all state
  token.value = ''
  refreshToken.value = ''
  user.value = null
  roles.value = []
  permissions.value = []
  tokenExpiry.value = 0
  error.value = ''
  isLoading.value = false

  // Clear localStorage (handled by persist plugin on state change)
}
```

---

## Error Handling

### Error Classification

| Error Type | Retryable | Action |
|------------|-----------|--------|
| Network errors | Yes | Retry with backoff |
| 401/400 on refresh | No | Logout, redirect to login |
| CSRF validation failure | No | Clear state, show error |
| Token decode failure | No | Logout, show error |

### Router Guard

**Source:** `router/index.ts:19-33`

```typescript
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // Allow auth-related routes without authentication
  if (to.path === '/login' || to.path.startsWith('/auth/')) {
    next()
    return
  }

  // Check authentication status (includes expiry check)
  if (!authStore.isAuthenticated) {
    next('/login')
  } else {
    next()
  }
})
```

---

## Configuration Reference

### Default Configuration

```typescript
const DEFAULT_CONFIG: AuthConfig = {
  tokenRefreshThreshold: 5 * 60 * 1000,  // 5 minutes
  pkceCodeVerifierLength: 128,
  stateLength: 32,
  defaultScope: 'openid profile email',
  maxRetryAttempts: 3,
  retryDelay: 1000  // 1 second base delay
}
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_OIDC_PROVIDER` | Provider type: `cognito`, `zitadel`, `auth0`, `keycloak` |
| `VITE_OIDC_ISSUER` | OIDC issuer URL |
| `VITE_OIDC_CLIENT_ID` | OAuth2 client ID |
| `VITE_OIDC_REDIRECT_URI` | Post-login redirect URI |
| `VITE_OIDC_DOMAIN` | Cognito hosted UI domain (optional) |
