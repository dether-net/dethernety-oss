/**
 * Login Tool
 *
 * Signs in to the platform (authorization code + PKCE) without blocking a tool
 * call for long: a valid stored session is reused, an expired one refreshed, and
 * otherwise a browser sign-in starts and the call returns within `wait` seconds —
 * signed in, or pending with a local URL for the user to open.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from '../base-tool.js'
import { getConfig, originOf } from '../../config.js'
import { login, isAuthDisabled, type LoginAnswer } from '../../auth/index.js'
import { emailClaimOf } from '../../auth/scope.js'

/** Longest `wait`: well inside the 60 s tool-call limit harnesses apply. */
export const MAX_WAIT_SECONDS = 45
const DEFAULT_WAIT_SECONDS = 30

const InputSchema = z.object({
  wait: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_SECONDS)
    .optional()
    .describe(`Seconds to wait for a browser sign-in to finish (0-${MAX_WAIT_SECONDS}, default ${DEFAULT_WAIT_SECONDS})`),
  force_new: z.boolean().optional().describe('Start a new browser sign-in even if a session is stored or a sign-in is pending')
})

type LoginInput = z.infer<typeof InputSchema>

type LoginOutput =
  | {
      status: 'authenticated'
      authenticated: true
      expiresIn: number
      tokenType: string
      fromCache?: boolean
      refreshed?: boolean
      platformUrl: string
      /** Signed-in user, from the identity token */
      email?: string
      /** The session belongs to a different user than the one stored before */
      identityChanged?: boolean
      previousEmail?: string
      scopeShortfall?: string
      message: string
    }
  | {
      status: 'pending' | 'busy'
      authenticated: false
      openUrl?: string
      expiresInSeconds?: number
      platformUrl: string
      message: string
    }

function authenticated(answer: Extract<LoginAnswer, { status: 'authenticated' }>, platformUrl: string): LoginOutput {
  const { result, identityChanged } = answer
  const tokens = result.tokens!
  const email = emailClaimOf(tokens.idToken)
  const parts = [email ? `Signed in as ${email}; show this to the user.` : 'Authentication successful.']
  if (identityChanged) {
    parts.push(
      `This is a different account than before (previously ${identityChanged.previousEmail ?? 'another user'}); ` +
        `data pushed now goes to ${email ?? 'this'} account. If the user did not expect this, call logout.`
    )
  }
  if (result.scopeShortfall) {
    parts.push(`The provider did not grant: ${result.scopeShortfall}. Features depending on those scopes will be refused.`)
  }
  return {
    status: 'authenticated',
    authenticated: true,
    expiresIn: tokens.expiresIn,
    tokenType: tokens.tokenType,
    fromCache: result.fromCache,
    refreshed: result.refreshed,
    platformUrl,
    email,
    ...(identityChanged ? { identityChanged: true, previousEmail: identityChanged.previousEmail } : {}),
    scopeShortfall: result.scopeShortfall,
    message: parts.join(' ')
  }
}

/**
 * Login tool - signs in via the browser, without blocking
 */
export class LoginTool extends ClientFreeTool<LoginInput, LoginOutput> {
  readonly name = 'login'

  readonly description = `Sign in to the Dethernety platform. Returns within "wait" seconds (default ${DEFAULT_WAIT_SECONDS}, at most ${MAX_WAIT_SECONDS}).

- A valid stored session is reused (fromCache: true); an expired one is refreshed when possible (refreshed: true).
- Otherwise a browser sign-in starts. If it is not finished within "wait", the result is status "pending" with "openUrl": give that URL to the user to open in their browser and sign in — never open or fetch it yourself. Then call login again (a pending sign-in is reused) or check auth_status.
- status "busy": another sign-in holds the local port; follow the message.
- On success, tell the user which account is signed in ("email"), and warn them if "identityChanged" is true.

Session credentials stay inside this server and are never returned. Use auth_status to check the session.`

  readonly inputSchema = InputSchema

  async execute(input: LoginInput, _context: ToolContext): Promise<ToolResult<LoginOutput>> {
    const platformUrl = originOf(getConfig().baseUrl)
    const authDisabled = (): ToolResult<LoginOutput> => ({
      success: true,
      data: {
        status: 'authenticated',
        authenticated: true,
        expiresIn: 0,
        tokenType: 'none',
        platformUrl,
        message: 'Authentication is disabled. No login needed — all tools work without authentication.'
      }
    })
    if (isAuthDisabled()) return authDisabled()

    const answer = await login({
      waitMs: (input.wait ?? DEFAULT_WAIT_SECONDS) * 1000,
      forceNew: input.force_new ?? false
    })
    switch (answer.status) {
      case 'authenticated':
        return { success: true, data: authenticated(answer, platformUrl) }
      case 'pending':
        return {
          success: true,
          data: {
            status: 'pending',
            authenticated: false,
            openUrl: answer.openUrl,
            expiresInSeconds: answer.expiresInSeconds,
            platformUrl,
            message:
              `Not signed in yet. Ask the user to open ${answer.openUrl} in their browser and sign in ` +
              `(within ${Math.ceil(answer.expiresInSeconds / 60)} minutes); do not open or fetch it yourself. ` +
              'Then call login again, or check auth_status.' +
              (answer.replaced ? ' The earlier sign-in was cancelled; use this new one.' : '') +
              (answer.newFlow && !answer.browserOpened ? ' No browser could be opened on this machine.' : '')
          }
        }
      case 'busy':
        return { success: true, data: { status: 'busy', authenticated: false, platformUrl, message: answer.message } }
      case 'auth-disabled':
        return authDisabled()
      case 'failed':
        return { success: false, error: answer.error }
    }
  }
}

export const loginTool = new LoginTool()
