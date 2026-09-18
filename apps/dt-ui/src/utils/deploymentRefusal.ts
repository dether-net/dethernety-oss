/**
 * What a GraphQL refusal means for the person in front of the screen.
 *
 * A deployment may restrict which accounts it serves. The API answers a
 * caller it does not admit exactly as it answers a missing or invalid
 * credential — one code, UNAUTHENTICATED, on every transport, so the API
 * itself is no oracle for "your token is real but you are not on the list".
 * The distinction is drawn HERE, in the browser, and it has to be drawn from
 * something the browser can PROVE rather than something it believes.
 *
 * THE BELIEF IS NOT ENOUGH. The browser's idea that its token is current is a
 * local calculation — the token's own expiry against the browser's clock, with
 * a refresh scheduled a few minutes early. The API checks the same expiry
 * against the server's clock. At the boundary they disagree: a skewed clock, a
 * scheduled refresh that never ran because the tab was asleep, a request that
 * left just before one landed. Deciding "not admitted" on the belief sent a
 * person whose session had merely expired to a page telling them the
 * deployment refuses their account.
 *
 * SO THE CLAIM IS MADE TRUE BEFORE IT IS MADE. A refusal of a token believed
 * current is answered by asking the identity provider for a fresh one and
 * retrying the request once. A refresh that fails means the session is over —
 * the ordinary sign-in. A retry that succeeds means nothing needed saying. Only
 * a freshly issued token that is refused again is a deployment refusing the
 * account, and only then is that page shown.
 *
 * Pure, so the decision is testable apart from the link that acts on it.
 */
export const UNAUTHENTICATED = 'UNAUTHENTICATED'

export type RefusalAction =
  // A freshly issued token was refused too: this deployment does not admit the account.
  | 'not-admitted'
  // The token is stale or gone; the refusal is the ordinary one and a sign-in answers it.
  | 'sign-in'
  // The refused token is still the one this browser holds: get a fresh one, then retry once.
  | 'refresh-and-retry'
  // The refused token has already been replaced — a refresh landed while this request was out — so
  // the current one has not been tried yet: retry once, without another refresh.
  | 'retry'
  // Not an authentication refusal at all.
  | null

export interface RefusalContext {
  // The deployment runs with authentication off; the API cannot refuse a caller for identity,
  // so a refusal here is something else and must never send anyone to a sign-in.
  authDisabled: boolean
  // This browser holds a token it believes has not expired.
  isAuthenticated: boolean
  // This request is itself the retry: it went out with a token issued after the first refusal.
  alreadyRetried: boolean
  // The token this request was refused with is still the one this browser holds.
  refusedTokenIsCurrent: boolean
}

// The shape of a formatted GraphQL error, as far as this cares: the code is the only field that
// survives production masking, so it is the only field read.
export interface RefusableError {
  message?: string
  extensions?: Record<string, unknown> | null
}

export function isUnauthenticated(errors: ReadonlyArray<RefusableError>): boolean {
  return errors.some((e) => e?.extensions?.code === UNAUTHENTICATED)
}

export function refusalAction(errors: ReadonlyArray<RefusableError>, ctx: RefusalContext): RefusalAction {
  if (ctx.authDisabled) return null
  if (!isUnauthenticated(errors)) return null
  // The retry went out with a token the identity provider had just issued. Refused again, the only
  // thing left that can be refusing it is this deployment's list.
  if (ctx.alreadyRetried) return 'not-admitted'
  if (!ctx.isAuthenticated) return 'sign-in'
  return ctx.refusedTokenIsCurrent ? 'refresh-and-retry' : 'retry'
}

// The context key a retried request carries, so a second refusal is not answered with a third attempt.
export const RETRIED_AFTER_REFUSAL = 'retriedAfterRefusal'

// The bearer a request actually went out with, read back from the headers the auth link set on it.
export function bearerOf(headers: Record<string, unknown> | undefined): string {
  const value = headers?.Authorization ?? headers?.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice('Bearer '.length) : ''
}
