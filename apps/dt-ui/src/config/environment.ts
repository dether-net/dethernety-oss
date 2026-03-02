/**
 * Frontend Environment Configuration
 *
 * This module handles environment variable loading and validation for the frontend.
 * It uses standard environment variable names without framework-specific prefixes.
 */

export type SubscriptionTransport = 'sse' | 'ws';

/**
 * OIDC Provider type for preset selection
 */
export type OidcProvider = 'cognito' | 'zitadel' | 'auth0' | 'keycloak' | 'generic';

/**
 * OAuth2/OIDC endpoint paths configuration
 * These paths are appended to the oidcIssuer URL
 */
export interface OidcEndpoints {
  // OAuth2 endpoints (relative to issuer)
  authorize: string;
  token: string;
  userinfo: string;
  logout: string;
  revoke: string;

  // Token claims configuration
  rolesClaim: string;
  permissionsClaim: string;

  // Logout redirect parameter name (varies by provider)
  logoutRedirectParam: string;
}

/**
 * Provider-specific endpoint presets
 */
export const OIDC_PROVIDER_PRESETS: Record<OidcProvider, OidcEndpoints> = {
  cognito: {
    authorize: '/oauth2/authorize',
    token: '/oauth2/token',
    userinfo: '/oauth2/userInfo',
    logout: '/logout',
    revoke: '/oauth2/revoke',
    rolesClaim: 'cognito:groups',
    permissionsClaim: 'cognito:groups',
    logoutRedirectParam: 'logout_uri',
  },
  zitadel: {
    authorize: '/oauth/v2/authorize',
    token: '/oauth/v2/token',
    userinfo: '/oidc/v1/userinfo',
    logout: '/oidc/v1/end_session',
    revoke: '/oauth/v2/revoke',
    rolesClaim: 'urn:zitadel:iam:org:project:roles',
    permissionsClaim: 'urn:zitadel:iam:org:project:roles',
    logoutRedirectParam: 'post_logout_redirect_uri',
  },
  auth0: {
    authorize: '/authorize',
    token: '/oauth/token',
    userinfo: '/userinfo',
    logout: '/v2/logout',
    revoke: '/oauth/revoke',
    rolesClaim: 'https://your-namespace/roles',
    permissionsClaim: 'permissions',
    logoutRedirectParam: 'returnTo',
  },
  keycloak: {
    authorize: '/protocol/openid-connect/auth',
    token: '/protocol/openid-connect/token',
    userinfo: '/protocol/openid-connect/userinfo',
    logout: '/protocol/openid-connect/logout',
    revoke: '/protocol/openid-connect/revoke',
    rolesClaim: 'realm_access.roles',
    permissionsClaim: 'resource_access',
    logoutRedirectParam: 'post_logout_redirect_uri',
  },
  generic: {
    // Standard OIDC Discovery-based paths
    authorize: '/authorize',
    token: '/token',
    userinfo: '/userinfo',
    logout: '/logout',
    revoke: '/revoke',
    rolesClaim: 'roles',
    permissionsClaim: 'permissions',
    logoutRedirectParam: 'post_logout_redirect_uri',
  },
};

export interface FrontendConfig {
  // Application Configuration
  nodeEnv: string;
  appUrl: string;
  appBaseUrl: string;

  // API Configuration
  apiBaseUrl: string;
  graphqlUrl: string;
  // Subscription transport: 'sse' (default) or 'ws' (WebSocket)
  // - SSE: uses graphqlUrl + '/stream' endpoint
  // - WS: uses graphqlWsUrl (auto-detected if not provided)
  subscriptionTransport: SubscriptionTransport;
  graphqlWsUrl?: string; // Only used when subscriptionTransport is 'ws'

  // Authentication is the default. This flag is only true when the backend
  // has ENABLE_NOAUTH=true in a non-production environment without OIDC.
  authDisabled: boolean;

  // OIDC Authentication
  oidcIssuer: string;
  oidcClientId: string;
  oidcRedirectUri: string;
  oidcProvider: OidcProvider;
  oidcEndpoints: OidcEndpoints;
  // Cognito hosted UI domain for OAuth2 flows (different from issuer)
  // Format: prefix.auth.region.amazoncognito.com (without https://)
  oidcDomain?: string;

  // Feature Flags
  debugAuth: boolean;
  enableDevTools: boolean;

  userProfileUrl: string;
}

/**
 * Get OIDC endpoints for a provider, with optional custom overrides
 */
export function getOidcEndpoints(
  provider: OidcProvider,
  customEndpoints?: Partial<OidcEndpoints>
): OidcEndpoints {
  const preset = OIDC_PROVIDER_PRESETS[provider] || OIDC_PROVIDER_PRESETS.generic;
  return { ...preset, ...customEndpoints };
}

/**
 * Auto-detect OIDC provider from issuer URL
 */
export function detectOidcProvider(issuer: string): OidcProvider {
  const issuerLower = issuer.toLowerCase();

  if (issuerLower.includes('cognito')) {
    return 'cognito';
  }
  if (issuerLower.includes('zitadel')) {
    return 'zitadel';
  }
  if (issuerLower.includes('auth0')) {
    return 'auth0';
  }
  if (issuerLower.includes('keycloak')) {
    return 'keycloak';
  }

  return 'generic';
}

/**
 * Runtime configuration cache
 */
let runtimeConfig: FrontendConfig | null = null;

/**
 * Auto-detect WebSocket URL based on current page location
 * Only used when subscriptionTransport is 'ws'
 */
function autoDetectWebSocketUrl(): string {
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/graphql`;
  }
  return '';
}

/**
 * Fetch configuration from backend at runtime
 */
async function fetchRuntimeConfig(): Promise<FrontendConfig> {
  try {
    const response = await fetch('/config');
    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status}`);
    }
    
    const config = await response.json();
    
    // Transform backend config to frontend config format
    const subscriptionTransport: SubscriptionTransport =
      config.subscriptionTransport === 'ws' ? 'ws' : 'sse';

    return {
      // Application Configuration
      nodeEnv: config.nodeEnv || 'production',
      appUrl: config.appUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
      appBaseUrl: config.appBaseUrl || '/',

      // API Configuration
      apiBaseUrl: config.apiBaseUrl || '',
      graphqlUrl: config.graphqlUrl || '/graphql',
      subscriptionTransport,
      graphqlWsUrl: subscriptionTransport === 'ws'
        ? config.graphqlWsUrl || autoDetectWebSocketUrl()
        : undefined,

      // Authentication is the default — only disabled when backend explicitly says so
      authDisabled: config.authDisabled === true,

      // OIDC Authentication
      oidcIssuer: config.oidcIssuer || '',
      oidcClientId: config.oidcClientId || '',
      oidcRedirectUri: config.oidcRedirectUri || '',
      oidcProvider: (config.oidcProvider as OidcProvider) || detectOidcProvider(config.oidcIssuer || ''),
      oidcEndpoints: getOidcEndpoints(
        (config.oidcProvider as OidcProvider) || detectOidcProvider(config.oidcIssuer || ''),
        config.oidcEndpoints // Allow custom endpoint overrides from backend
      ),
      // Cognito hosted UI domain (for OAuth2 flows when different from issuer)
      oidcDomain: config.oidcDomain || undefined,

      // Feature Flags
      debugAuth: config.debugAuth || false,
      enableDevTools: config.enableDevTools || false,

      userProfileUrl: (() => {
        const url = config.userProfileUrl || '';
        if (!url) return '';
        // Validate URL scheme to prevent javascript: XSS
        try {
          const parsed = new URL(url);
          return ['https:', 'http:'].includes(parsed.protocol) ? url : '';
        } catch {
          return url.startsWith('/') ? url : '';
        }
      })(),
    };
  } catch (error) {
    console.warn('Failed to fetch runtime config, falling back to development config:', error);
    return getDevelopmentConfig();
  }
}

/**
 * Get development configuration (fallback)
 */
function getDevelopmentConfig(): FrontendConfig {
  const isDev = import.meta.env.DEV;
  
  // Get configuration from environment variables (development only)
  const getEnvValue = (key: string, fallback?: string): string => {
    // Try VITE_ prefixed variables for development
    const viteKey = `VITE_${key}`;
    const value = import.meta.env[viteKey];
    if (value !== undefined) return value;
    
    // Use fallback
    return fallback || '';
  };
  
  const subscriptionTransport: SubscriptionTransport =
    getEnvValue('SUBSCRIPTION_TRANSPORT', 'sse').toLowerCase() === 'ws' ? 'ws' : 'sse';

  return {
    // Application Configuration
    nodeEnv: isDev ? 'development' : 'production',
    appUrl: getEnvValue('APP_URL', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005'),
    appBaseUrl: getEnvValue('APP_BASE_URL', '/'),

    // API Configuration
    apiBaseUrl: getEnvValue('API_BASE_URL', isDev ? 'http://localhost:3003' : ''),
    graphqlUrl: getEnvValue('GRAPHQL_URL', isDev ? 'http://localhost:3003/graphql' : '/graphql'),
    subscriptionTransport,
    graphqlWsUrl: subscriptionTransport === 'ws'
      ? getEnvValue('GRAPHQL_WS_URL', isDev ? 'ws://localhost:3003/graphql' : autoDetectWebSocketUrl())
      : undefined,

    // Auth — only disabled when explicitly opted in and no OIDC configured
    authDisabled: getEnvValue('ENABLE_NOAUTH', 'false') === 'true' && !getEnvValue('OIDC_ISSUER'),

    // OIDC Authentication
    oidcIssuer: getEnvValue('OIDC_ISSUER', ''),
    oidcClientId: getEnvValue('OIDC_CLIENT_ID', ''),
    oidcRedirectUri: getEnvValue('OIDC_REDIRECT_URI', ''),
    oidcProvider: (() => {
      const provider = getEnvValue('OIDC_PROVIDER', '');
      if (provider && ['cognito', 'zitadel', 'auth0', 'keycloak', 'generic'].includes(provider)) {
        return provider as OidcProvider;
      }
      return detectOidcProvider(getEnvValue('OIDC_ISSUER', ''));
    })(),
    oidcEndpoints: (() => {
      const issuer = getEnvValue('OIDC_ISSUER', '');
      const provider = getEnvValue('OIDC_PROVIDER', '');
      const resolvedProvider = (provider && ['cognito', 'zitadel', 'auth0', 'keycloak', 'generic'].includes(provider))
        ? provider as OidcProvider
        : detectOidcProvider(issuer);
      return getOidcEndpoints(resolvedProvider);
    })(),
    // Cognito hosted UI domain (for OAuth2 flows when different from issuer)
    oidcDomain: getEnvValue('OIDC_DOMAIN', '') || undefined,

    // Feature Flags
    debugAuth: getEnvValue('DEBUG_AUTH', isDev ? 'true' : 'false') === 'true',
    enableDevTools: getEnvValue('ENABLE_DEV_TOOLS', isDev ? 'true' : 'false') === 'true',

    userProfileUrl: getEnvValue('USER_PROFILE_URL', ''),
  };
}

/**
 * Load configuration (runtime fetch or development fallback)
 */
async function loadConfig(): Promise<FrontendConfig> {
  // Return cached config if available
  if (runtimeConfig) {
    return runtimeConfig;
  }
  
  const isDev = import.meta.env.DEV;
  
  if (isDev) {
    // In development, use environment variables
    runtimeConfig = getDevelopmentConfig();
  } else {
    // In production, fetch from backend
    runtimeConfig = await fetchRuntimeConfig();
  }
  
  return runtimeConfig;
}

/**
 * Validate configuration and throw errors for missing required values
 */
function validateConfig(config: FrontendConfig): void {
  const errors: string[] = [];

  if (!config.authDisabled) {
    // OIDC is required when authentication is active (the default)
    if (!config.oidcIssuer) {
      errors.push('OIDC_ISSUER is required');
    }

    if (!config.oidcClientId) {
      errors.push('OIDC_CLIENT_ID is required');
    }

    if (!config.oidcRedirectUri) {
      errors.push('OIDC_REDIRECT_URI is required');
    }

    // Validate URL formats
    try {
      if (config.oidcIssuer) new URL(config.oidcIssuer);
      if (config.oidcRedirectUri) new URL(config.oidcRedirectUri);
    } catch {
      errors.push('Invalid URL format in OIDC configuration');
    }
  }

  // Always validate app URL if present
  try {
    if (config.appUrl) new URL(config.appUrl);
  } catch {
    errors.push('Invalid appUrl format');
  }

  if (errors.length > 0) {
    throw new Error(`Frontend configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Configuration promise for async loading
let configPromise: Promise<FrontendConfig> | null = null;

/**
 * Get configuration (async)
 */
export async function getConfig(): Promise<FrontendConfig> {
  if (!configPromise) {
    configPromise = loadConfig().then(config => {
      validateConfig(config);
      return config;
    });
  }
  return configPromise;
}

/**
 * Get configuration synchronously (for components that need immediate access)
 * Note: This will return null if config hasn't been loaded yet
 */
export function getConfigSync(): FrontendConfig | null {
  return runtimeConfig;
}

// Legacy exports for backward compatibility (will be null until config is loaded)
export let frontendConfig: FrontendConfig | null = null;
export let nodeEnv: string = '';
export let appUrl: string = '';
export let appBaseUrl: string = '';
export let apiBaseUrl: string = '';
export let graphqlUrl: string = '';
export let oidcIssuer: string = '';
export let oidcClientId: string = '';
export let oidcRedirectUri: string = '';
export let oidcDomain: string = '';
export let debugAuth: boolean = false;
export let enableDevTools: boolean = false;
export let userProfileUrl: string = '';

// Initialize configuration and update exports
getConfig().then(config => {
  frontendConfig = config;
  nodeEnv = config.nodeEnv;
  appUrl = config.appUrl;
  appBaseUrl = config.appBaseUrl;
  apiBaseUrl = config.apiBaseUrl;
  graphqlUrl = config.graphqlUrl;
  oidcIssuer = config.oidcIssuer;
  oidcClientId = config.oidcClientId;
  oidcRedirectUri = config.oidcRedirectUri;
  oidcDomain = config.oidcDomain || '';
  debugAuth = config.debugAuth;
  enableDevTools = config.enableDevTools;
  userProfileUrl = config.userProfileUrl;
}).catch(error => {
  console.error('Failed to load configuration:', error);
});
