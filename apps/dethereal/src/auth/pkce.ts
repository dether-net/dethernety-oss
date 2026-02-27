/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements RFC 7636 for secure OAuth 2.0 authorization code flow.
 * Uses crypto module for secure random generation and SHA-256 hashing.
 */

import { randomBytes, createHash } from 'crypto'

/**
 * PKCE code pair
 */
export interface PKCECodes {
  /** Random 43-128 character string used to verify the authorization */
  codeVerifier: string
  /** Base64URL encoded SHA-256 hash of the code verifier */
  codeChallenge: string
}

/**
 * Base64URL encode a buffer (RFC 4648)
 * Replaces + with -, / with _, and removes trailing =
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generate a cryptographically random code verifier
 * Must be between 43-128 characters (we use 64)
 */
function generateCodeVerifier(): string {
  // 48 random bytes = 64 base64url characters
  return base64UrlEncode(randomBytes(48))
}

/**
 * Generate code challenge from code verifier using S256 method
 * challenge = BASE64URL(SHA256(verifier))
 */
function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256').update(codeVerifier).digest()
  return base64UrlEncode(hash)
}

/**
 * Generate a PKCE code pair for OAuth authorization
 *
 * @returns PKCE code verifier and challenge
 *
 * @example
 * const { codeVerifier, codeChallenge } = generatePKCE()
 * // Use codeChallenge in authorize request
 * // Use codeVerifier in token exchange request
 */
export function generatePKCE(): PKCECodes {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  return {
    codeVerifier,
    codeChallenge
  }
}

/**
 * Generate a random state parameter for OAuth
 * Used to prevent CSRF attacks
 */
export function generateState(): string {
  return base64UrlEncode(randomBytes(32))
}
