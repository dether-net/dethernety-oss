/**
 * Browser Utilities
 *
 * Cross-platform utilities for opening URLs in the default browser.
 * Uses the 'open' package for reliable cross-platform support.
 */

import { debug } from '../config.js'

/**
 * Dynamically import the 'open' package
 * This is an ESM-only package, so we need dynamic import
 */
async function getOpenModule(): Promise<typeof import('open')> {
  return await import('open')
}

/**
 * Open a URL in the default browser
 *
 * Works on macOS, Windows, and Linux.
 *
 * @param url - URL to open
 * @returns Promise that resolves when the browser is opened
 *
 * @example
 * await openBrowser('https://example.com/auth')
 */
export async function openBrowser(url: string): Promise<void> {
  debug(`Opening browser: ${url}`)

  try {
    const open = await getOpenModule()
    await open.default(url)
    debug('Browser opened successfully')
  } catch (error) {
    // Provide helpful error messages for common issues
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('spawn')) {
      throw new Error(
        `Failed to open browser. No default browser found. ` +
          `Please manually open: ${url}`,
        { cause: error }
      )
    }

    throw new Error(`Failed to open browser: ${message}. Please manually open: ${url}`, { cause: error })
  }
}

/**
 * Build an OAuth authorization URL
 *
 * @param params - URL parameters
 * @returns Complete authorization URL
 */
export function buildAuthorizationUrl(params: {
  authorizeEndpoint: string
  clientId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  state: string
  additionalParams?: Record<string, string>
}): string {
  const url = new URL(params.authorizeEndpoint)

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)

  // Add any additional parameters
  if (params.additionalParams) {
    for (const [key, value] of Object.entries(params.additionalParams)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}
