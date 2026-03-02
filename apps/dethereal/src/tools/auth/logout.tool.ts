/**
 * Logout Tool
 *
 * Clears cached tokens and optionally revokes them with Cognito.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig } from '../../config.js'
import { clearTokens, getTokenStoragePath, isAuthDisabled } from '../../auth/index.js'
import { clearClientCache } from '../../client/apollo-client.js'

/**
 * Input schema for logout tool
 */
const InputSchema = z.object({
  /** Clear all cached tokens for all platforms */
  clear_all: z.boolean().optional().describe('Clear all cached tokens for all platforms')
})

type LogoutInput = z.infer<typeof InputSchema>

/**
 * Output from logout tool
 */
interface LogoutOutput {
  /** Success message */
  message: string
  /** Path where tokens were stored */
  tokenStoragePath: string
}

/**
 * Logout tool - clears cached tokens
 */
export class LogoutTool extends ClientFreeTool<LogoutInput, LogoutOutput> {
  readonly name = 'logout'

  readonly description = `Log out and clear cached authentication tokens.

Removes tokens from the local cache. Future API calls will require a new login.

Note: This clears local tokens only. If you need to fully revoke access,
you may also want to sign out from the Cognito hosted UI.`

  readonly inputSchema = InputSchema

  async execute(input: LogoutInput, context: ToolContext): Promise<ToolResult<LogoutOutput>> {
    if (isAuthDisabled()) {
      return {
        success: true,
        data: {
          message: 'Authentication is disabled. No logout needed.',
          tokenStoragePath: ''
        }
      }
    }

    try {
      const config = getConfig()

      // Clear tokens from storage
      await clearTokens(config.baseUrl)

      // Clear Apollo client cache
      clearClientCache()

      return {
        success: true,
        data: {
          message: 'Successfully logged out. Cached tokens have been cleared.',
          tokenStoragePath: getTokenStoragePath()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Logout failed'
      }
    }
  }
}

export const logoutTool = new LogoutTool()
