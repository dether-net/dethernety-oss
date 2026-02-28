/**
 * Token Store
 *
 * Persists OAuth tokens to the local filesystem for session persistence.
 * Tokens are stored in ~/.dethernety/tokens.json
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { debug } from '../config.js'

/** Directory for storing Dethernety config and tokens */
const CONFIG_DIR = join(homedir(), '.dethernety')

/** Token storage file path */
const TOKENS_FILE = join(CONFIG_DIR, 'tokens.json')

/**
 * Stored token data
 */
export interface StoredTokens {
  /** OAuth access token */
  accessToken: string
  /** OIDC identity token (used for API authentication) */
  idToken: string
  /** OAuth refresh token for obtaining new access tokens */
  refreshToken: string
  /** Unix timestamp when the access token expires */
  expiresAt: number
  /** Base URL of the platform these tokens are for */
  baseUrl: string
  /** Timestamp when tokens were stored */
  storedAt: number
}

/**
 * Token file structure (supports multiple platforms)
 */
interface TokenFile {
  version: number
  tokens: Record<string, StoredTokens>
}

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
    debug(`Created config directory: ${CONFIG_DIR}`)
  }
}

/**
 * Read the token file
 */
async function readTokenFile(): Promise<TokenFile> {
  try {
    const content = await readFile(TOKENS_FILE, 'utf-8')
    return JSON.parse(content) as TokenFile
  } catch {
    // Return empty token file if doesn't exist or can't be read
    return { version: 1, tokens: {} }
  }
}

/**
 * Write the token file
 */
async function writeTokenFile(tokenFile: TokenFile): Promise<void> {
  await ensureConfigDir()
  // Write with restrictive permissions (owner read/write only)
  await writeFile(TOKENS_FILE, JSON.stringify(tokenFile, null, 2), { mode: 0o600 })
}

/**
 * Generate a key for storing tokens by platform URL
 * Normalizes the URL to handle trailing slashes, etc.
 */
function getTokenKey(baseUrl: string): string {
  const url = new URL(baseUrl)
  return `${url.protocol}//${url.host}`
}

/**
 * Load stored tokens for a specific platform
 *
 * @param baseUrl - Platform base URL
 * @returns Stored tokens or null if not found/expired
 */
export async function loadStoredTokens(baseUrl: string): Promise<StoredTokens | null> {
  try {
    const tokenFile = await readTokenFile()
    const key = getTokenKey(baseUrl)
    const tokens = tokenFile.tokens[key]

    if (!tokens) {
      debug(`No stored tokens found for ${key}`)
      return null
    }

    // Check if tokens match the requested baseUrl
    if (getTokenKey(tokens.baseUrl) !== key) {
      debug(`Token baseUrl mismatch`)
      return null
    }

    debug(`Loaded stored tokens for ${key}`)
    return tokens
  } catch (error) {
    debug(`Error loading tokens: ${error}`)
    return null
  }
}

/**
 * Save tokens for a platform
 *
 * @param tokens - Tokens to save
 */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  try {
    const tokenFile = await readTokenFile()
    const key = getTokenKey(tokens.baseUrl)

    tokenFile.tokens[key] = {
      ...tokens,
      storedAt: Date.now()
    }

    await writeTokenFile(tokenFile)
    debug(`Saved tokens for ${key}`)
  } catch (error) {
    debug(`Error saving tokens: ${error}`)
    throw new Error(`Failed to save tokens: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Clear tokens for a platform
 *
 * @param baseUrl - Platform base URL
 */
export async function clearTokens(baseUrl: string): Promise<void> {
  try {
    const tokenFile = await readTokenFile()
    const key = getTokenKey(baseUrl)

    delete tokenFile.tokens[key]

    if (Object.keys(tokenFile.tokens).length === 0) {
      // Delete the file if no tokens remain
      if (existsSync(TOKENS_FILE)) {
        await unlink(TOKENS_FILE)
        debug(`Deleted empty token file`)
      }
    } else {
      await writeTokenFile(tokenFile)
    }

    debug(`Cleared tokens for ${key}`)
  } catch (error) {
    debug(`Error clearing tokens: ${error}`)
    throw new Error(`Failed to clear tokens: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Check if stored tokens are expired
 *
 * @param tokens - Stored tokens to check
 * @param bufferMs - Buffer time in ms before actual expiry (default 60 seconds)
 * @returns true if tokens are expired or will expire within buffer
 */
export function isTokenExpired(tokens: StoredTokens, bufferMs: number = 60000): boolean {
  const now = Date.now()
  const expiresAt = tokens.expiresAt

  return now >= expiresAt - bufferMs
}

/**
 * Check if refresh token is likely still valid
 * Cognito refresh tokens are valid for 30 days by default
 *
 * @param tokens - Stored tokens to check
 * @returns true if refresh token is likely valid
 */
export function isRefreshTokenValid(tokens: StoredTokens): boolean {
  const now = Date.now()
  const storedAt = tokens.storedAt || 0

  // Assume refresh token is valid for 29 days (buffer before 30 day default)
  const refreshTokenValidFor = 29 * 24 * 60 * 60 * 1000

  return now - storedAt < refreshTokenValidFor
}

/**
 * Get the token storage file path (for debugging/info)
 */
export function getTokenStoragePath(): string {
  return TOKENS_FILE
}
