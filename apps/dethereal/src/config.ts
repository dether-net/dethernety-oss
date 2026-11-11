/**
 * Dethereal MCP Server Configuration
 *
 * Environment configuration for the MCP server.
 * Only the platform URL is configured here - all other config is fetched from the platform's /config endpoint.
 */

import { nodeOptionTokens, runtimeProblem } from './utils/runtime-trust.js'

/** Where the platform URL came from: the shell/config env, the Claude plugin user config, or the default. */
export type UrlSource = 'env' | 'user_config' | 'default'

export const DEFAULT_PLATFORM_URL = 'http://127.0.0.1:3000'

export interface DetheralConfig {
  /** Base URL of the Dethernety platform (e.g., https://dethernety.example.com) */
  baseUrl: string
  /** Which input supplied `baseUrl` */
  urlSource: UrlSource
  /** Enable debug logging */
  debug: boolean
}

/**
 * The value of an environment variable that was really set.
 *
 * Launchers substitute `${VAR}` in their MCP server env blocks, and when the
 * variable is unset some of them pass the text through unchanged. That literal is
 * truthy, so treating it as a value would skip every fallback and then fail
 * validation. Empty and whitespace-only values count as unset too.
 */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]?.trim()
  if (!value || /^\$\{[^}]*\}$/.test(value)) return undefined
  return value
}

/**
 * The platform URL and its source.
 *
 * A real `DETHERNETY_URL` wins over `DETHERNETY_PLATFORM_URL` (the Claude plugin's
 * user config, which Claude substitutes even when the user never set it), so a URL
 * exported in the shell is never silently overridden. A real but invalid value still
 * wins: falling through to another platform would hide the mistake.
 *
 * Claude runs plugin hooks without the server's env block; there the same user config
 * arrives as `CLAUDE_PLUGIN_OPTION_PLATFORM_URL`.
 */
export function getPlatformUrl(env: NodeJS.ProcessEnv = process.env): { url: string; source: UrlSource } {
  const fromEnv = envValue('DETHERNETY_URL', env)
  if (fromEnv) return { url: fromEnv, source: 'env' }
  const fromUserConfig = envValue('DETHERNETY_PLATFORM_URL', env)
  if (fromUserConfig) return { url: fromUserConfig, source: 'user_config' }
  const fromPluginOption = envValue('CLAUDE_PLUGIN_OPTION_PLATFORM_URL', env)
  if (fromPluginOption) return { url: fromPluginOption, source: 'user_config' }
  return { url: DEFAULT_PLATFORM_URL, source: 'default' }
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): DetheralConfig {
  const { url, source } = getPlatformUrl()
  return {
    baseUrl: url,
    urlSource: source,
    debug: process.env.DEBUG === 'true'
  }
}

export { nodeOptionTokens }

/** `--use-env-proxy` with or without a value, `_` and `-` alike as Node reads option names. */
const isEnvProxyOption = (token: string): boolean => /^--use[-_]env[-_]proxy(=|$)/.test(token)

function variableFor(source?: UrlSource): string {
  return source === 'user_config' ? 'DETHERNETY_PLATFORM_URL' : 'DETHERNETY_URL'
}

/**
 * Why `url` may not be sent a request, or undefined when it may.
 *
 * HTTPS is required for anything but loopback: the platform receives the session's
 * bearer. A user name or password in the URL is refused (the bearer is the only
 * credential sent). Plain HTTP is refused while Node's own fetch honours proxy
 * variables (`NODE_USE_ENV_PROXY`), since a proxy would see the bearer in the
 * clear. `label` names the setting in the message; the URL itself is never quoted,
 * since it can carry userinfo.
 */
export function urlPolicyProblem(url: string, label: string, env: NodeJS.ProcessEnv = process.env, execArgv: readonly string[] = process.execArgv): string | undefined {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return `Invalid ${label} format`
  }

  const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname)
  if (!isLocalhost && parsedUrl.protocol !== 'https:') {
    return (
      `${label} must use HTTPS for non-localhost connections. ` +
      'HTTP is only permitted for localhost, 127.0.0.1, and ::1.'
    )
  }
  if (parsedUrl.username || parsedUrl.password) {
    return `${label} must not contain a user name or password.`
  }
  const proxied = env.NODE_USE_ENV_PROXY !== undefined && env.NODE_USE_ENV_PROXY !== '' && env.NODE_USE_ENV_PROXY !== '0'
  if (parsedUrl.protocol === 'http:' && proxied) {
    return `${label} uses plain HTTP while NODE_USE_ENV_PROXY is set; unset it or use HTTPS.`
  }
  // The same switch as a Node option: in NODE_OPTIONS or on the command line, in any spelling Node accepts.
  if (parsedUrl.protocol === 'http:' && [...nodeOptionTokens(env.NODE_OPTIONS ?? ''), ...execArgv].some(isEnvProxyOption)) {
    return `${label} uses plain HTTP while Node's --use-env-proxy option is set; remove it or use HTTPS.`
  }
  return undefined
}

/**
 * Validate configuration and throw errors for missing required values
 */
export function validateConfig(config: Pick<DetheralConfig, 'baseUrl'> & Partial<DetheralConfig>): void {
  const label = variableFor(config.urlSource)
  if (!config.baseUrl) {
    throw new Error(`${label} is required`)
  }
  const problem = urlPolicyProblem(config.baseUrl, label)
  if (problem) throw new Error(problem)
}

/**
 * Why the current configuration cannot be used, or undefined when it can.
 *
 * The server starts either way — a harness shows a server that exits at startup as
 * simply missing — and every tool reports this instead of reaching the network.
 */
export function configProblem(): string | undefined {
  try {
    validateConfig(getConfig())
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  // A runtime that cannot be trusted with the bearer reaches no network either.
  return runtimeProblem()?.message
}

/** The origin of `url` (no userinfo, path or query), for messages and logs. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'invalid URL'
  }
}

/**
 * Debug logging helper
 */
export function debugLog(config: Pick<DetheralConfig, 'debug'> & Partial<DetheralConfig>, message: string, ...args: unknown[]): void {
  if (config.debug) {
    console.error(`[dethereal] ${message}`, ...args)
  }
}

/**
 * Simple debug log that uses current config
 */
export function debug(message: string, ...args: unknown[]): void {
  debugLog({ debug: process.env.DEBUG === 'true' }, message, ...args)
}
