/**
 * Login Manager
 *
 * One browser sign-in at a time per process, never blocking a tool call for long:
 * - `login` waits at most the caller's budget, then reports the sign-in as pending
 *   with a local URL to open (`/start` redirects to the provider; the provider URL,
 *   state and PKCE challenge never leave this process);
 * - the callback listener lives a fixed time from its start, and the code is
 *   exchanged as soon as the provider redirects, whether or not a call is waiting;
 * - a second `login` reuses the pending sign-in; `force_new` cancels it first;
 * - a sign-in that settles while nobody waits is reported once, on the next call.
 *
 * Every flow runs under its own abort signal. Cancelling (force_new, logout,
 * shutdown) aborts the code exchange and waits for the flow to settle and for the
 * port to be free, and a flow that was cancelled never writes the session store.
 * A logout in any other session does the same: a sign-in saves only if the
 * store's logout epoch is still the one it read when it began.
 * Flow outcomes are values, never rejections: nothing in here can leave a promise
 * rejected with no one listening.
 */

import { getConfig, debug } from '../config.js'
import { getCachedPlatformConfig, getOAuthUrls, getRequiredScope } from './platform-config.js'
import { emailClaimOf, subClaimOf } from './scope.js'
import { generatePKCE, generateState } from './pkce.js'
import {
  startCallbackServer,
  DEFAULT_CALLBACK_PORT,
  CallbackAbandoned,
  CallbackPortBusy,
  type CallbackServer
} from './oauth-server.js'
import { openBrowser, buildAuthorizationUrl } from './browser.js'
import { loadStoredTokens, saveSignIn, beginSignInEpoch } from './token-store.js'
import { revokeDetached } from './revoke.js'
import { exchangeCodeForTokens, sessionLogin, scopeShortfallOf, type LoginResult } from './oauth-flow.js'

/** How long a sign-in listener lives, from its start. */
export const LISTENER_LIFETIME_MS = 5 * 60 * 1000
/** Upper bound on the code exchange once the provider has redirected. */
const EXCHANGE_TIMEOUT_MS = 15_000
/** Upper bound on the session step's network work (platform config, refresh). */
const SESSION_STEP_TIMEOUT_MS = 10_000
/**
 * What the session step may always spend, whatever the caller's wait: `wait: 0`
 * means "do not wait for the browser", not "skip the stored-session check".
 */
const SESSION_STEP_FLOOR_MS = 3_000
/** How long a settled sign-in's outcome stays reportable. */
const LAST_LOGIN_TTL_MS = 10 * 60 * 1000

interface Identity {
  email?: string
  sub?: string
}

export type FlowOutcome =
  | { kind: 'ok'; result: LoginResult; identityChanged?: { previousEmail?: string } }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' }
  | { kind: 'expired' }

interface Flow {
  id: number
  server: CallbackServer
  abort: AbortController
  openUrl: string
  expiresAt: number
  browserOpened: boolean
  outcome: Promise<FlowOutcome>
}

export type LoginAnswer =
  | { status: 'authenticated'; result: LoginResult; identityChanged?: { previousEmail?: string } }
  | { status: 'pending'; openUrl: string; expiresInSeconds: number; newFlow: boolean; browserOpened: boolean; replaced: boolean }
  | { status: 'busy'; message: string }
  | { status: 'auth-disabled' }
  | { status: 'failed'; error: string }

export interface LoginRequest {
  /** How long this call may take, in total */
  waitMs: number
  forceNew: boolean
}

export interface ManagerOptions {
  /** Callback port (tests); never taken from input or the environment */
  port?: number
  /** Listener lifetime (tests) */
  lifetimeMs?: number
}

let current: Flow | undefined
let nextId = 1
let lastSettled: { outcome: FlowOutcome; at: number; delivered: boolean } | undefined
let queue: Promise<unknown> = Promise.resolve()

/** Run `fn` after every operation queued before it: one state change at a time. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.sub && b.sub) return a.sub === b.sub
  if (a.email && b.email) return a.email.toLowerCase() === b.email.toLowerCase()
  return true
}

function identityOf(idToken?: string): Identity {
  return { email: emailClaimOf(idToken), sub: subClaimOf(idToken) }
}

function combinedSignal(signal: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  timer.unref?.()
  const onAbort = () => controller.abort()
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

/** Start a browser sign-in: listener, authorization URL behind /start, browser. */
async function beginFlow(options: ManagerOptions): Promise<Flow> {
  const config = getConfig()
  const platformConfig = getCachedPlatformConfig()
  // Everything that can fail on the platform's answer fails before a port is bound.
  if (!platformConfig || platformConfig.authDisabled || !platformConfig.oidcDomain || !platformConfig.oidcClientId) {
    throw new Error('The platform does not offer sign-in')
  }
  const requiredScope = getRequiredScope(platformConfig)
  const { authorize } = getOAuthUrls(platformConfig)
  const previous = identityOf((await loadStoredTokens(config.baseUrl).catch(() => null))?.idToken)
  const epoch = await beginSignInEpoch()

  const { codeVerifier, codeChallenge } = generatePKCE()
  const state = generateState()
  const lifetimeMs = options.lifetimeMs ?? LISTENER_LIFETIME_MS
  const server = await startCallbackServer({ port: options.port ?? DEFAULT_CALLBACK_PORT, timeout: lifetimeMs, state })
  const abort = new AbortController()
  try {
    server.setAuthorizationUrl(
      buildAuthorizationUrl({
        authorizeEndpoint: authorize,
        clientId: platformConfig.oidcClientId,
        redirectUri: server.callbackUrl,
        scope: requiredScope,
        codeChallenge,
        state
      })
    )
  } catch (error) {
    await server.close()
    throw error
  }

  const id = nextId++
  // The listener's lifetime starts now: the wait is armed at once.
  const outcome: Promise<FlowOutcome> = server.waitForCallback().then(
    async (callback): Promise<FlowOutcome> => {
      try {
        const tokens = await exchangeCodeForTokens(callback.code, codeVerifier, server.callbackUrl, {
          signal: combinedSignal(abort.signal, EXCHANGE_TIMEOUT_MS)
        })
        // A flow cancelled while exchanging or waiting to save never writes the store.
        if (abort.signal.aborted) return { kind: 'cancelled' }
        const saved = await saveSignIn(
          {
            accessToken: tokens.accessToken,
            idToken: tokens.idToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
            baseUrl: config.baseUrl,
            storedAt: Date.now(),
            grantedScope: tokens.scope,
            oidcDomain: platformConfig.oidcDomain,
            oidcClientId: platformConfig.oidcClientId
          },
          { expectEpoch: epoch, signal: abort.signal }
        )
        if (saved.kind !== 'saved') {
          // Stored nowhere, so nobody can use it: end it at the provider.
          revokeDetached(tokens.refreshToken, platformConfig)
          if (saved.kind === 'cancelled') return { kind: 'cancelled' }
          return { kind: 'failed', error: 'You signed out in another session while this sign-in was pending; sign in again' }
        }
        // The session this sign-in replaced is no longer stored anywhere either.
        const displaced = saved.displaced
        if (
          displaced?.refreshToken &&
          (displaced.oidcDomain === undefined ||
            (displaced.oidcDomain === platformConfig.oidcDomain && displaced.oidcClientId === platformConfig.oidcClientId))
        ) {
          revokeDetached(displaced.refreshToken, platformConfig)
        }
        debug('Login successful')
        const now = identityOf(tokens.idToken)
        const changed = (previous.sub || previous.email) && !sameIdentity(previous, now)
        return {
          kind: 'ok',
          result: { success: true, tokens, scopeShortfall: scopeShortfallOf(tokens, requiredScope) },
          ...(changed ? { identityChanged: { previousEmail: previous.email } } : {})
        }
      } catch (error) {
        if (abort.signal.aborted) return { kind: 'cancelled' }
        return { kind: 'failed', error: describe(error) }
      }
    },
    (error: unknown): FlowOutcome => {
      if (error instanceof CallbackAbandoned) return { kind: error.reason }
      return { kind: 'failed', error: describe(error) }
    }
  )

  const flow: Flow = {
    id,
    server,
    abort,
    openUrl: server.startUrl,
    expiresAt: Date.now() + lifetimeMs,
    browserOpened: false,
    outcome
  }
  void outcome.then((settled) => {
    if (current?.id === id) {
      current = undefined
      lastSettled = { outcome: settled, at: Date.now(), delivered: false }
    }
    void server.close()
  })

  try {
    await openBrowser(server.startUrl)
    flow.browserOpened = true
  } catch (error) {
    debug(`Browser not opened: ${describe(error)}`)
  }
  return flow
}

/** Cancel `flow` and wait until it has settled and its port is free. */
async function drain(flow: Flow): Promise<void> {
  flow.abort.abort()
  await flow.server.cancel()
  await flow.outcome
  await flow.server.close()
}

function answerFor(outcome: FlowOutcome): LoginAnswer {
  switch (outcome.kind) {
    case 'ok':
      return { status: 'authenticated', result: outcome.result, identityChanged: outcome.identityChanged }
    case 'failed':
      return { status: 'failed', error: outcome.error }
    case 'expired':
      return { status: 'failed', error: 'The sign-in window expired before the sign-in finished' }
    case 'cancelled':
      return { status: 'failed', error: 'The sign-in was cancelled' }
  }
}

/**
 * Sign in within `waitMs`: a stored or refreshed session at once, otherwise a
 * browser sign-in that is either finished within the budget or reported pending.
 */
export async function login(request: LoginRequest, options: ManagerOptions = {}): Promise<LoginAnswer> {
  const deadline = Date.now() + Math.max(0, request.waitMs)
  const remaining = () => Math.max(0, deadline - Date.now())

  const step = await serialized(async (): Promise<LoginAnswer | { flow: Flow; newFlow: boolean; replaced: boolean }> => {
    // A sign-in that settled while nobody waited is reported once.
    // force_new asks for a new sign-in: it never takes one that finished earlier.
    if (!current && lastSettled && !lastSettled.delivered && Date.now() - lastSettled.at < LAST_LOGIN_TTL_MS) {
      lastSettled.delivered = true
      const settled = lastSettled.outcome
      if (!request.forceNew && (settled.kind === 'ok' || settled.kind === 'failed' || settled.kind === 'expired')) {
        return answerFor(settled)
      }
    }

    let replaced = false
    if (current && !request.forceNew) return { flow: current, newFlow: false, replaced }
    if (current) {
      await drain(current)
      current = undefined
      replaced = true
    }

    const budget = Math.min(SESSION_STEP_TIMEOUT_MS, Math.max(SESSION_STEP_FLOOR_MS, remaining()))
    if (!request.forceNew) {
      try {
        const session = await sessionLogin({ signal: AbortSignal.timeout(budget) })
        if (session) return { status: 'authenticated', result: session }
      } catch (error) {
        return { status: 'failed', error: describe(error) }
      }
    } else {
      // The platform config is needed for the browser sign-in.
      try {
        await sessionLoginConfigOnly(AbortSignal.timeout(budget))
      } catch (error) {
        return { status: 'failed', error: describe(error) }
      }
    }
    // A platform that turns out to run without authentication needs no sign-in.
    if (getCachedPlatformConfig()?.authDisabled) return { status: 'auth-disabled' }

    try {
      current = await beginFlow(options)
      return { flow: current, newFlow: true, replaced }
    } catch (error) {
      if (error instanceof CallbackPortBusy) {
        return {
          status: 'busy',
          message: error.otherProgram
            ? `Port ${error.port} is in use by another program; sign-in cannot start until it is free.`
            : `Port ${error.port} is busy: possibly a sign-in pending in another Dethereal session (it expires within ` +
              `${Math.round(LISTENER_LIFETIME_MS / 60000)} minutes), or another program. Finish that sign-in in the window it ` +
              'opened, or wait, then call login again.'
        }
      }
      return { status: 'failed', error: describe(error) }
    }
  })
  if (!('flow' in step)) return step

  const { flow, newFlow, replaced } = step
  const settled = await Promise.race([
    flow.outcome,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), remaining()))
  ])
  if (settled) {
    if (lastSettled?.outcome === settled) lastSettled.delivered = true
    return answerFor(settled)
  }
  return {
    status: 'pending',
    openUrl: flow.openUrl,
    expiresInSeconds: Math.max(0, Math.round((flow.expiresAt - Date.now()) / 1000)),
    newFlow,
    browserOpened: flow.browserOpened,
    replaced
  }
}

async function sessionLoginConfigOnly(signal: AbortSignal): Promise<void> {
  const { fetchPlatformConfig } = await import('./platform-config.js')
  await fetchPlatformConfig(undefined, { signal })
}

/** Whether a browser sign-in is pending in this process. */
export function isLoginPending(): boolean {
  return current !== undefined
}

/** The last sign-in that settled in this process, while it is recent. */
export function lastLoginSummary(): { status: FlowOutcome['kind']; identityChanged?: boolean; error?: string } | undefined {
  if (!lastSettled || Date.now() - lastSettled.at >= LAST_LOGIN_TTL_MS) return undefined
  const o = lastSettled.outcome
  return {
    status: o.kind,
    ...(o.kind === 'ok' && o.identityChanged ? { identityChanged: true } : {}),
    ...(o.kind === 'failed' ? { error: o.error } : {})
  }
}

/** Cancel a pending sign-in and wait until its port is free (logout, shutdown). */
export function cancelPendingLogin(): Promise<void> {
  return serialized(async () => {
    if (current) {
      const flow = current
      await drain(flow)
      if (current?.id === flow.id) current = undefined
    }
  })
}

/** Forget all state (tests). */
export async function resetLoginManager(): Promise<void> {
  await cancelPendingLogin()
  lastSettled = undefined
}
