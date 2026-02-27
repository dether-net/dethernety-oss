/**
 * Frontend Environment Configuration
 * 
 * This module handles environment variable loading and validation for the frontend.
 * It uses standard environment variable names without framework-specific prefixes.
 */

export interface FrontendConfig {
  // Application Configuration
  nodeEnv: string;
  appUrl: string;
  appBaseUrl: string;
  
  // API Configuration
  apiBaseUrl: string;
  graphqlUrl: string;
  graphqlWsUrl: string;
  
  // OIDC Authentication (optional in development)
  oidcIssuer: string;
  oidcClientId: string;
  oidcRedirectUri: string;
  
  // User Profile
  userProfileUrl: string;
  
  // Feature Flags
  debugAuth: boolean;
  enableDevTools: boolean;
}

export interface ConfigState {
  config: FrontendConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * Runtime configuration state
 */
let configState: ConfigState = {
  config: null,
  loading: false,
  error: null
};

/**
 * Sanitize string input to prevent XSS
 */
function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>"'&]/g, '');
}

/**
 * Parse boolean value safely
 */
function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return false;
}

/**
 * Validate and sanitize URL
 */
function sanitizeUrl(value: unknown, allowedSchemes: string[] = ['http:', 'https:', 'ws:', 'wss:'], allowEmpty: boolean = true): string {
  const urlString = sanitizeString(value);
  if (!urlString) return allowEmpty ? '' : '';
  
  try {
    const url = new URL(urlString);
    if (!allowedSchemes.includes(url.protocol)) {
      console.warn(`Invalid URL scheme: ${url.protocol}`);
      return allowEmpty ? '' : '';
    }
    return url.toString();
  } catch {
    return allowEmpty ? '' : '';
  }
}

/**
 * Fetch configuration from backend at runtime
 */
async function fetchRuntimeConfig(): Promise<FrontendConfig> {
  try {
    const response = await fetch('/config');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const config = await response.json();
    
    // Transform and sanitize backend config to frontend config format
    return {
      // Application Configuration
      nodeEnv: sanitizeString(config.nodeEnv) || 'production',
      appUrl: sanitizeUrl(config.appUrl) || (typeof window !== 'undefined' ? window.location.origin : ''),
      appBaseUrl: sanitizeString(config.appBaseUrl) || '/',
      
      // API Configuration
      apiBaseUrl: sanitizeUrl(config.apiBaseUrl) || '',
      graphqlUrl: sanitizeString(config.graphqlUrl) || '/graphql',
      graphqlWsUrl: sanitizeUrl(config.graphqlWsUrl, ['ws:', 'wss:']) || autoDetectWebSocketUrl(),
      
      // OIDC Authentication
      oidcIssuer: sanitizeUrl(config.oidcIssuer, ['http:', 'https:']) || '',
      oidcClientId: sanitizeString(config.oidcClientId) || '',
      oidcRedirectUri: sanitizeUrl(config.oidcRedirectUri, ['http:', 'https:']) || '',
      
      // User Profile
      userProfileUrl: sanitizeUrl(config.userProfileUrl, ['http:', 'https:']) || '',
      
      // Feature Flags
      debugAuth: parseBoolean(config.debugAuth),
      enableDevTools: parseBoolean(config.enableDevTools),
    };
  } catch (error) {
    console.warn('Failed to fetch runtime config, falling back to development config');
    return getDevelopmentConfig();
  }
}

/**
 * Get development configuration (fallback)
 */
function getDevelopmentConfig(): FrontendConfig {
  // Determine if we're in development based on NODE_ENV, with Vite DEV as fallback
  const nodeEnv = import.meta.env.VITE_NODE_ENV || import.meta.env.NODE_ENV || (import.meta.env.DEV ? 'development' : 'production');
  const isDev = nodeEnv === 'development';
  
  // Get configuration from environment variables (development only)
  const getEnvValue = (key: string, fallback?: string): string => {
    // Try VITE_ prefixed variables for development
    const viteKey = `VITE_${key}`;
    const value = import.meta.env[viteKey];
    if (value !== undefined && value !== '') return value;
    
    // Use fallback
    return fallback || '';
  };
  
  // Get OIDC values, but don't sanitize empty values in development
  const getOidcValue = (key: string): string => {
    const value = getEnvValue(key, '');
    if (!value && isDev) {
      // Return empty string in dev if not configured - auth store will handle this
      return '';
    }
    return value;
  };
  
  return {
    // Application Configuration
    nodeEnv: nodeEnv,
    appUrl: sanitizeUrl(getEnvValue('APP_URL', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005')) || 'http://localhost:3005',
    appBaseUrl: sanitizeString(getEnvValue('APP_BASE_URL', '/')) || '/',
    
    // API Configuration
    apiBaseUrl: sanitizeUrl(getEnvValue('API_BASE_URL', isDev ? 'http://localhost:3003' : '')) || (isDev ? 'http://localhost:3003' : ''),
    graphqlUrl: sanitizeString(getEnvValue('GRAPHQL_URL', isDev ? 'http://localhost:3003/graphql' : '/graphql')) || '/graphql',
    graphqlWsUrl: sanitizeUrl(getEnvValue('GRAPHQL_WS_URL', isDev ? 'ws://localhost:3003/graphql' : autoDetectWebSocketUrl()), ['ws:', 'wss:']) || autoDetectWebSocketUrl(),
    
    // OIDC Authentication - preserve empty values in development
    oidcIssuer: getOidcValue('OIDC_ISSUER'),
    oidcClientId: getOidcValue('OIDC_CLIENT_ID'), 
    oidcRedirectUri: getOidcValue('OIDC_REDIRECT_URI'),
    
    // User Profile
    userProfileUrl: sanitizeUrl(getEnvValue('USER_PROFILE_URL', ''), ['http:', 'https:']) || '',
    
    // Feature Flags
    debugAuth: parseBoolean(getEnvValue('DEBUG_AUTH', isDev ? 'true' : 'false')),
    enableDevTools: parseBoolean(getEnvValue('ENABLE_DEV_TOOLS', isDev ? 'true' : 'false')),
  };
}

/**
 * Auto-detect WebSocket URL
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
 * Load configuration (runtime fetch or development fallback)
 */
async function loadConfig(): Promise<FrontendConfig> {
  // Return cached config if available
  if (configState.config) {
    return configState.config;
  }
  
  if (configState.loading) {
    // Wait for existing load operation
    while (configState.loading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (configState.config) {
      return configState.config;
    }
  }
  
  configState.loading = true;
  configState.error = null;
  
  try {
    // Determine if we're in development based on NODE_ENV, with Vite DEV as fallback
    const nodeEnv = import.meta.env.VITE_NODE_ENV || import.meta.env.NODE_ENV || (import.meta.env.DEV ? 'development' : 'production');
    const isDev = nodeEnv === 'development';
    
    if (isDev) {
      // In development, use environment variables
      configState.config = getDevelopmentConfig();
    } else {
      // In production, fetch from backend
      configState.config = await fetchRuntimeConfig();
    }
    
    return configState.config;
  } catch (error) {
    configState.error = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  } finally {
    configState.loading = false;
  }
}

/**
 * Validate configuration and throw errors for missing required values
 */
function validateConfig(config: FrontendConfig): void {
  const errors: string[] = [];
  // Use the nodeEnv from the config itself to determine if we're in development
  const isDev = config.nodeEnv === 'development';
  
  // Required OIDC configuration (only in production)
  if (!isDev) {
    if (!config.oidcIssuer) {
      errors.push('OIDC_ISSUER is required in production');
    }
    
    if (!config.oidcClientId) {
      errors.push('OIDC_CLIENT_ID is required in production');
    }
    
    if (!config.oidcRedirectUri) {
      errors.push('OIDC_REDIRECT_URI is required in production');
    }
  }
  
  // Validate URL schemes (only if URLs are provided)
  // if (config.oidcIssuer) {
  //   if (!isDev && !config.oidcIssuer.startsWith('https:')) {
  //     errors.push('OIDC_ISSUER must use HTTPS in production');
  //   } else if (isDev && !config.oidcIssuer.startsWith('http')) {
  //     errors.push('OIDC_ISSUER must be a valid HTTP/HTTPS URL');
  //   }
  // }
  
  // Validate required URLs are properly formed (but only if they exist)
  const urlsToValidate = [
    { key: 'appUrl', required: false },
    { key: 'apiBaseUrl', required: false },
    { key: 'graphqlUrl', required: false }
  ] as const;
  
  urlsToValidate.forEach(({ key, required }) => {
    const url = config[key];
    if (url && !isValidUrl(url)) {
      errors.push(`${key} is not a valid URL: ${url}`);
    } else if (required && !url) {
      errors.push(`${key} is required`);
    }
  });
  
  if (errors.length > 0) {
    const message = `Configuration validation failed: ${errors.join(', ')}`;
    if (isDev) {
      console.warn(message);
      return; // Don't throw in development, just warn
    }
    throw new Error(message);
  }
}

/**
 * Check if a string is a valid URL (supports both absolute and relative URLs)
 */
function isValidUrl(urlString: string): boolean {
  if (!urlString) return false;
  
  // Check for relative URLs (starting with /, //, or query params)
  if (urlString.startsWith('/') || urlString.startsWith('?') || urlString.startsWith('#')) {
    return true;
  }
  
  // Check for absolute URLs
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
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
      console.log('config', config);
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
  return configState.config;
}

/**
 * Get configuration state (loading, error, config)
 */
export function getConfigState(): ConfigState {
  return { ...configState };
}

/**
 * Reset configuration cache (useful for testing)
 */
export function resetConfig(): void {
  configState.config = null;
  configState.loading = false;
  configState.error = null;
  configPromise = null;
}

// DEPRECATED: Legacy exports - use getConfig() or getConfigSync() instead
// These will be removed in a future version
export const DEPRECATED_NOTICE = 'Legacy config exports are deprecated. Use getConfig() or getConfigSync() instead.';

/**
 * @deprecated Use getConfig() or getConfigSync() instead
 */
export function getLegacyConfig() {
  console.warn(DEPRECATED_NOTICE);
  return configState.config;
}

// Initialize configuration loading
getConfig().catch(error => {
  console.error('Failed to initialize configuration:', error);
});
