/**
 * Platform Configuration
 *
 * Fetches and caches the platform configuration from the /config endpoint.
 * This provides all OIDC/OAuth settings needed for authentication.
 */

import fetch from 'cross-fetch'
import { getConfig, debug } from '../config.js'

/**
 * Platform configuration returned from /config endpoint
 */
export interface PlatformConfig {
  /** OIDC issuer URL (e.g., https://your-oidc-provider.example.com) */
  oidcIssuer: string
  /** OIDC client ID for the application */
  oidcClientId: string
  /** OIDC hosted UI domain (e.g., your-app.auth.your-region.amazoncognito.com) */
  oidcDomain: string
  /** Default redirect URI configured in Cognito (we use localhost instead) */
  oidcRedirectUri: string
  /** OIDC provider type (e.g., "cognito") */
  oidcProvider: string
  /** GraphQL API path (e.g., "/graphql") */
  graphqlUrl: string
  /** GraphQL WebSocket URL for subscriptions */
  graphqlWsUrl: string
  /** Subscription transport type (e.g., "sse") */
  subscriptionTransport: string
  /** Full application URL (e.g., "https://demo.dethernety.io") */
  appUrl: string
  /** Application base path (e.g., "/") */
  appBaseUrl: string
  /** API base URL (usually empty, relative to appUrl) */
  apiBaseUrl: string
}

// Cached platform configuration
let cachedConfig: PlatformConfig | null = null
let cacheBaseUrl: string | null = null

/**
 * Fetch platform configuration from the /config endpoint
 * Caches the result for subsequent calls with the same baseUrl
 */
export async function fetchPlatformConfig(baseUrl?: string): Promise<PlatformConfig> {
  const config = getConfig()
  const url = baseUrl || config.baseUrl

  // Return cached config if available and URL matches
  if (cachedConfig && cacheBaseUrl === url) {
    debug('Using cached platform config')
    return cachedConfig
  }

  const configUrl = `${url}/config`
  debug(`Fetching platform config from ${configUrl}`)

  try {
    const response = await fetch(configUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
    }

    const platformConfig = (await response.json()) as PlatformConfig

    // Validate required fields
    if (!platformConfig.oidcClientId) {
      throw new Error('Platform config missing oidcClientId')
    }
    if (!platformConfig.oidcDomain) {
      throw new Error('Platform config missing oidcDomain')
    }

    // Cache the config
    cachedConfig = platformConfig
    cacheBaseUrl = url

    debug('Platform config loaded successfully', {
      oidcProvider: platformConfig.oidcProvider,
      oidcDomain: platformConfig.oidcDomain,
      graphqlUrl: platformConfig.graphqlUrl
    })

    return platformConfig
  } catch (error) {
    throw new Error(
      `Failed to fetch platform config from ${configUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Get cached platform configuration
 * Returns null if not yet fetched
 */
export function getCachedPlatformConfig(): PlatformConfig | null {
  return cachedConfig
}

/**
 * Get the full GraphQL endpoint URL
 */
export function getGraphQLEndpoint(platformConfig?: PlatformConfig): string {
  const config = platformConfig || cachedConfig
  if (!config) {
    throw new Error('Platform config not loaded. Call fetchPlatformConfig first.')
  }

  // If graphqlUrl is absolute, use it directly
  if (config.graphqlUrl.startsWith('http')) {
    return config.graphqlUrl
  }

  // Otherwise, combine with appUrl
  const baseUrl = config.apiBaseUrl || config.appUrl
  return `${baseUrl}${config.graphqlUrl}`
}

/**
 * Get Cognito OAuth URLs
 */
export function getOAuthUrls(platformConfig?: PlatformConfig) {
  const config = platformConfig || cachedConfig
  if (!config) {
    throw new Error('Platform config not loaded. Call fetchPlatformConfig first.')
  }

  const domain = config.oidcDomain

  return {
    authorize: `https://${domain}/oauth2/authorize`,
    token: `https://${domain}/oauth2/token`,
    logout: `https://${domain}/logout`,
    userInfo: `https://${domain}/oauth2/userInfo`
  }
}

/**
 * Clear the cached configuration
 */
export function clearPlatformConfigCache(): void {
  cachedConfig = null
  cacheBaseUrl = null
  debug('Platform config cache cleared')
}
