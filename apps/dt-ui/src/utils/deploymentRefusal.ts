/**
 * What a GraphQL refusal means for the person in front of the screen.
 *
 * A deployment may restrict which accounts it serves. The API answers a
 * caller it does not admit exactly as it answers a missing or invalid
 * credential — one code, UNAUTHENTICATED, on every transport, so the API
 * itself is no oracle for "your token is real but you are not on the list".
 * The distinction is drawn HERE, from what this browser already knows: the
 * identity provider just issued it a token that has not expired. If the API
 * still refuses, the sign-in was fine and the deployment is refusing the
 * account. Without this, that refusal surfaced as "Failed to load models.
 * Please try again" — a retry that can never succeed, on a page the person
 * had been let into.
 *
 * Pure, so the decision is testable apart from the link that acts on it.
 */
export const UNAUTHENTICATED = 'UNAUTHENTICATED'

export type RefusalMeaning =
  // The token is current and the API refused it: this deployment does not admit the account.
  | 'not-admitted'
  // The token is stale or gone; the refusal is the ordinary one and a sign-in answers it.
  | 'sign-in'
  // Not an authentication refusal at all.
  | null

export interface RefusalContext {
  // The deployment runs with authentication off; the API cannot refuse a caller for identity,
  // so a refusal here is something else and must never send anyone to a sign-in.
  authDisabled: boolean
  // This browser holds a token the identity provider issued and that has not expired.
  isAuthenticated: boolean
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

export function refusalMeaning(errors: ReadonlyArray<RefusableError>, ctx: RefusalContext): RefusalMeaning {
  if (ctx.authDisabled) return null
  if (!isUnauthenticated(errors)) return null
  return ctx.isAuthenticated ? 'not-admitted' : 'sign-in'
}
