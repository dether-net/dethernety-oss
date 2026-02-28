/**
 * Refresh Token Tool
 *
 * Refreshes OAuth tokens using a refresh token.
 * Updates the cached tokens with the new values.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig } from '../../config.js'
import {
  refreshTokens,
  saveTokens,
  fetchPlatformConfig,
  getTokenStoragePath
} from '../../auth/index.js'

/**
 * Input schema for refresh token tool
 */
const InputSchema = z.object({
  /** Refresh token from previous authentication */
  refresh_token: z.string().describe('The refresh token from a previous login')
})

type RefreshTokenInput = z.infer<typeof InputSchema>

/**
 * Output from refresh token tool
 */
interface RefreshTokenOutput {
  /** Token lifetime in seconds */
  expiresIn: number
  /** Token type */
  tokenType: string
  /** Whether the refresh succeeded */
  refreshed: boolean
  /** Where tokens are stored locally */
  tokenStoragePath: string
}

/**
 * Refresh token tool - gets new tokens using refresh token
 */
export class RefreshTokenTool extends ClientFreeTool<RefreshTokenInput, RefreshTokenOutput> {
  readonly name = 'refresh_token'

  readonly description = `Refresh OAuth tokens using a refresh token.

Use this when your access token has expired but you still have a valid refresh token.
Returns new access and ID tokens, and updates the local token cache.

Cognito refresh tokens are typically valid for 30 days.`

  readonly inputSchema = InputSchema

  async execute(
    input: RefreshTokenInput,
    context: ToolContext
  ): Promise<ToolResult<RefreshTokenOutput>> {
    try {
      const config = getConfig()

      // Ensure platform config is loaded
      await fetchPlatformConfig()

      // Refresh tokens
      const tokens = await refreshTokens(input.refresh_token)

      // Save the new tokens
      await saveTokens({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        baseUrl: config.baseUrl,
        storedAt: Date.now()
      })

      return {
        success: true,
        data: {
          expiresIn: tokens.expiresIn,
          tokenType: tokens.tokenType,
          refreshed: true,
          tokenStoragePath: getTokenStoragePath()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed'
      }
    }
  }
}

export const refreshTokenTool = new RefreshTokenTool()
