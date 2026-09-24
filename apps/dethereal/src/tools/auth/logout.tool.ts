/**
 * Logout Tool
 *
 * Deletes the stored session from the local cache.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig } from '../../config.js'
import { clearTokens, clearAllTokens, isAuthDisabled } from '../../auth/index.js'
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
}

/**
 * Logout tool - clears cached tokens
 */
export class LogoutTool extends ClientFreeTool<LogoutInput, LogoutOutput> {
  readonly name = 'logout'

  readonly description = `Sign out: delete the stored session for this platform (clear_all: for every platform) from the local cache. Platform tools then require a new login.

This does not revoke the session at the identity provider: a session copied elsewhere stays valid until it expires.`

  readonly inputSchema = InputSchema

  async execute(input: LogoutInput, context: ToolContext): Promise<ToolResult<LogoutOutput>> {
    if (isAuthDisabled()) {
      return {
        success: true,
        data: {
          message: 'Authentication is disabled. No logout needed.'
        }
      }
    }

    try {
      const config = getConfig()

      // Clear tokens from storage
      if (input.clear_all) {
        await clearAllTokens()
      } else {
        await clearTokens(config.baseUrl)
      }

      // Clear Apollo client cache
      clearClientCache()

      return {
        success: true,
        data: {
          message: input.clear_all
            ? 'Successfully logged out. Cached tokens for ALL platforms have been cleared.'
            : 'Successfully logged out. Cached tokens have been cleared.'
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
