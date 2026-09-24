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
 * Open the sign-in page in the default browser
 *
 * Works on macOS, Windows, and Linux. The URL is never logged or put into an
 * error: errors from here reach the model, and the URL carries the pending
 * login's state and PKCE challenge.
 *
 * @param url - URL to open
 * @returns Promise that resolves when the browser is opened
 */
export async function openBrowser(url: string): Promise<void> {
  debug('Opening browser for sign-in')

  try {
    const open = await getOpenModule()
    await open.default(url)
    debug('Browser opened successfully')
  } catch (error) {
    // The launcher's own message is kept for diagnosis, with the URL cut out of it.
    const reason = (error instanceof Error ? error.message : 'Unknown error').split(url).join('<sign-in URL>')
    const hint = 'Sign-in needs a desktop browser on this machine; run login where one is available.'

    if (reason.includes('spawn')) {
      throw new Error(`Failed to open browser: no default browser found. ${hint}`, { cause: error })
    }

    throw new Error(`Failed to open browser: ${reason}. ${hint}`, { cause: error })
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
