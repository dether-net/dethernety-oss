/**
 * Platform Configuration
 *
 * Fetches and caches the platform configuration from the /config endpoint.
 * This provides all OIDC/OAuth settings needed for authentication.
 */

import fetch from 'cross-fetch'
import { getConfig, debug, originOf, urlPolicyProblem, validateConfig } from '../config.js'

/**
 * Platform configuration returned from /config endpoint
 */
export interface PlatformConfig {
  /** Whether authentication is disabled (no-auth mode) */
  authDisabled?: boolean
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
  /**
   * Space-delimited scope the platform tells clients to request at login.
   *
   * Optional, and deliberately not one of the required fields below: a
   * platform that predates this field, or one that never configured a scope,
   * must still load. `getRequiredScope` supplies the base scopes in that case.
   */
  oidcScope?: string
  /** GraphQL API path (e.g., "/graphql") */
  graphqlUrl: string
  /** GraphQL WebSocket URL for subscriptions */
  graphqlWsUrl: string
  /** Subscription transport type (e.g., "sse") */
  subscriptionTransport: string
  /** Full application URL (e.g., "https://dethernety.example.com") */
  appUrl: string
  /** Application base path (e.g., "/") */
  appBaseUrl: string
  /** API base URL (usually empty, relative to appUrl) */
  apiBaseUrl: string
}

// Cached platform configuration
let cachedConfig: PlatformConfig | null = null
let cacheBaseUrl: string | null = null

/** Upper bound on one /config request, so a platform that never answers cannot stall a caller. */
export const PLATFORM_CONFIG_TIMEOUT_MS = 3_000

/**
 * A signal that aborts after `ms`, or earlier when `caller` aborts. `done()` must run on
 * every exit path; the timer never keeps the process alive on its own.
 */
function boundedSignal(ms: number, caller?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Platform config request timed out', 'TimeoutError')), ms)
  timer.unref?.()
  const onAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) onAbort()
  else caller?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      caller?.removeEventListener('abort', onAbort)
    }
  }
}

/** `text` with the userinfo of `url` removed; fetch errors quote the full request URL. */
function withoutUserinfo(text: string, url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return text
  }
  if (!parsed.username && !parsed.password) return text
  const userinfo = parsed.password ? `${parsed.username}:${parsed.password}@` : `${parsed.username}@`
  return text.split(url).join(parsed.origin).split(userinfo).join('')
}

/**
 * Fetch platform configuration from the /config endpoint
 * Caches the result for subsequent calls with the same baseUrl
 *
 * Refuses a URL the HTTPS rule rejects before any connection is made, and gives up
 * after PLATFORM_CONFIG_TIMEOUT_MS, including a response whose body stalls.
 *
 * @param options.signal - Aborts the request earlier (e.g. a caller's own deadline)
 * @param options.timeoutMs - Overrides the bound (tests)
 */
export async function fetchPlatformConfig(
  baseUrl?: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<PlatformConfig> {
  const config = getConfig()
  const url = baseUrl || config.baseUrl
  validateConfig(baseUrl ? { baseUrl } : config)

  // Return cached config if available and URL matches
  if (cachedConfig && cacheBaseUrl === url) {
    debug('Using cached platform config')
    return cachedConfig
  }

  const platformConfig = await loadPlatformConfig(url, options)

  // Cache the config
  cachedConfig = platformConfig
  cacheBaseUrl = url
  return platformConfig
}

/**
 * Fetch a platform's /config without touching the cache, which holds the
 * configured platform only. Same URL rule, bound and error text as
 * fetchPlatformConfig.
 */
export async function loadPlatformConfig(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<PlatformConfig> {
  validateConfig({ baseUrl: url })
  const configUrl = `${url}/config`
  const shownUrl = `${originOf(url)}/config`
  debug(`Fetching platform config from ${shownUrl}`)

  const bound = boundedSignal(options.timeoutMs ?? PLATFORM_CONFIG_TIMEOUT_MS, options.signal)
  try {
    const response = await fetch(configUrl, { signal: bound.signal })

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
    }

    const platformConfig = (await response.json()) as PlatformConfig

    // When auth is disabled (no-auth mode), skip OIDC validation
    if (!platformConfig.authDisabled) {
      if (!platformConfig.oidcClientId) {
        throw new Error('Platform config missing oidcClientId')
      }
      if (!platformConfig.oidcDomain) {
        throw new Error('Platform config missing oidcDomain')
      }
    }

    if (platformConfig.authDisabled) {
      debug('Platform config loaded — authentication is DISABLED (no-auth mode)')
    } else {
      debug('Platform config loaded successfully', {
        oidcProvider: platformConfig.oidcProvider,
        oidcDomain: platformConfig.oidcDomain,
        graphqlUrl: platformConfig.graphqlUrl
      })
    }

    return platformConfig
  } catch (error) {
    const reason = withoutUserinfo(error instanceof Error ? error.message : 'Unknown error', url)
    throw new Error(`Failed to fetch platform config from ${shownUrl}: ${reason}`, { cause: error })
  } finally {
    bound.done()
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
    return checkedEndpoint(config.graphqlUrl)
  }

  // Otherwise, combine with apiBaseUrl, appUrl, or the configured platform URL
  const baseUrl = config.apiBaseUrl || config.appUrl || getConfig().baseUrl
  return checkedEndpoint(`${baseUrl}${config.graphqlUrl}`)
}

/**
 * The GraphQL endpoint receives the session's bearer, and its address comes from the
 * platform's /config answer, so it is held to the same HTTPS rule as the platform URL.
 */
function checkedEndpoint(endpoint: string): string {
  const problem = urlPolicyProblem(endpoint, 'The platform GraphQL endpoint')
  if (problem) throw new Error(problem)
  return endpoint
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
  if (!isHostOnly(domain)) {
    throw new Error('Platform config has an invalid oidcDomain')
  }

  return {
    authorize: `https://${domain}/oauth2/authorize`,
    token: `https://${domain}/oauth2/token`,
    revoke: `https://${domain}/oauth2/revoke`,
    logout: `https://${domain}/logout`,
    userInfo: `https://${domain}/oauth2/userInfo`
  }
}

/**
 * Is `domain` a bare host (optionally with a port) and nothing else? It comes
 * from the platform's /config and is spliced into the endpoints that receive the
 * authorization code and the refresh token, so a path, userinfo, query, fragment,
 * backslash (read as a slash in https URLs) or escape must not get through.
 */
export function isHostOnly(domain: unknown): domain is string {
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 260) return false
  if (/[\\%\s]/.test(domain)) return false
  let url: URL
  try {
    url = new URL(`https://${domain}`)
  } catch {
    return false
  }
  return (
    url.host === domain.toLowerCase() &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}

/** Scopes to request when the platform advertises none. */
export const BASE_SCOPES = 'openid profile email'

/**
 * The scope this platform wants clients to request.
 *
 * The fallback carries real weight. A platform that advertises no scope is one
 * whose sessions were all minted under the base scopes, so every stored session
 * still satisfies the requirement and nobody is asked to log in again. Treating
 * an absent value as "unknown, so re-authenticate" would open a browser for every
 * operator of every deployment that never configured one.
 */
export function getRequiredScope(platformConfig?: PlatformConfig): string {
  const config = platformConfig || cachedConfig
  if (!config) {
    throw new Error('Platform config not loaded. Call fetchPlatformConfig first.')
  }
  return config.oidcScope || BASE_SCOPES
}

/**
 * Check if authentication is disabled (no-auth mode)
 */
export function isAuthDisabled(): boolean {
  return cachedConfig?.authDisabled === true
}

/**
 * Clear the cached configuration
 */
export function clearPlatformConfigCache(): void {
  cachedConfig = null
  cacheBaseUrl = null
  debug('Platform config cache cleared')
}
