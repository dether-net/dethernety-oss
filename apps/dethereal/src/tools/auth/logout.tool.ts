/**
 * Logout Tool
 *
 * Removes the stored session from the local store, then revokes it at the
 * identity provider of its own platform.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { configProblem, getConfig, originOf } from '../../config.js'
import { clearTokens, clearAllTokens, cancelPendingLogin, revokeSessions, type RevocationResult } from '../../auth/index.js'
import { clearClientCache } from '../../client/apollo-client.js'

/**
 * Input schema for logout tool
 */
const InputSchema = z.object({
  /** Clear all cached tokens for all platforms */
  clear_all: z.boolean().optional().describe('Sign out of every platform, not just the configured one')
})

type LogoutInput = z.infer<typeof InputSchema>

/**
 * Output from logout tool
 */
interface LogoutOutput {
  /** Success message */
  message: string
  /** One entry per removed session: revoked at its identity provider, skipped, or failed. */
  revocation: RevocationResult[]
}

/**
 * Logout tool - removes and revokes stored sessions
 */
export class LogoutTool extends ClientFreeTool<LogoutInput, LogoutOutput> {
  readonly name = 'logout'

  readonly description = `Sign out: remove the stored session for this platform (clear_all: for every platform) from the local store, then revoke each removed session at its own platform's identity provider. A platform that cannot be reached is skipped and reported in revocation.

Also stops any sign-in still pending, in this session or another Dethereal session on this machine, from being saved. Platform tools then require a new login.`

  readonly inputSchema = InputSchema

  async execute(input: LogoutInput, _context: ToolContext): Promise<ToolResult<LogoutOutput>> {
    try {
      const config = getConfig()

      // A pending sign-in could otherwise complete after this and re-create the session.
      await cancelPendingLogin()

      // The local session goes first, so signing out never depends on the network.
      const removed = input.clear_all ? await clearAllTokens() : await clearTokens(config.baseUrl)

      // Clear Apollo client cache
      clearClientCache()

      // With a configuration or runtime that cannot be trusted, nothing is sent: the refresh token stays off the wire.
      const problem = configProblem()
      const revocation: RevocationResult[] = problem
        ? removed.map((r) => ({ platform: r.baseUrl ? originOf(r.baseUrl) : 'unknown', result: 'skipped' as const, reason: 'not sent: this configuration or runtime cannot be trusted with the session; revoke it at the identity provider' }))
        : await revokeSessions(removed)
      const scope = input.clear_all ? 'for all platforms' : 'for this platform'
      const message =
        removed.length === 0
          ? `Signed out: there was no stored session ${scope}.`
          : `Signed out: the stored session ${scope} was removed. See revocation for the identity provider's answer.`

      return { success: true, data: { message, revocation } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Logout failed'
      }
    }
  }
}

export const logoutTool = new LogoutTool()
