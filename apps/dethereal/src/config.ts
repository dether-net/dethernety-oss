/**
 * Dethereal MCP Server Configuration
 *
 * Environment configuration for the MCP server.
 * Only requires DETHERNETY_URL - all other config is fetched from the platform's /config endpoint.
 */

export interface DetheralConfig {
  /** Base URL of the Dethernety platform (e.g., https://demo.dethernety.io) */
  baseUrl: string
  /** Enable debug logging */
  debug: boolean
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): DetheralConfig {
  return {
    baseUrl: process.env.DETHERNETY_URL || 'http://localhost:3003',
    debug: process.env.DEBUG === 'true'
  }
}

/**
 * Validate configuration and throw errors for missing required values
 */
export function validateConfig(config: DetheralConfig): void {
  if (!config.baseUrl) {
    throw new Error('DETHERNETY_URL is required')
  }

  // Validate URL format
  try {
    new URL(config.baseUrl)
  } catch {
    throw new Error('Invalid DETHERNETY_URL format')
  }
}

/**
 * Debug logging helper
 */
export function debugLog(config: DetheralConfig, message: string, ...args: unknown[]): void {
  if (config.debug) {
    console.error(`[dethereal] ${message}`, ...args)
  }
}

/**
 * Simple debug log that uses current config
 */
export function debug(message: string, ...args: unknown[]): void {
  const config = getConfig()
  debugLog(config, message, ...args)
}
