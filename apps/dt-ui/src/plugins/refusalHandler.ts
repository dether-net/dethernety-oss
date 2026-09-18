import { Observable, CombinedGraphQLErrors } from '@apollo/client/core'
import type { ApolloLink } from '@apollo/client/core'
import {
  refusalAction,
  isUnauthenticated,
  bearerOf,
  RETRIED_AFTER_REFUSAL,
  type RefusableError,
} from '@/utils/deploymentRefusal'

/**
 * The part of the auth store the refusal handler needs, named so a test can hand it a fake.
 */
export interface RefusalAuth {
  authDisabled: boolean
  isAuthenticated: boolean
  token: string
  performTokenRefresh: () => Promise<void>
  clearState: () => void
}

export interface RefusalDeps {
  auth: () => RefusalAuth
  // A full-page navigation, started at most once per page (see apolloClient.ts).
  leave: (href: string) => void
  basePath: string
}

/**
 * The GraphQL half of the error link: what to do when the API refuses a request for identity.
 * Returns an Observable when it retries the request, and nothing when it does not — which is the
 * contract ErrorLink's handler has.
 *
 * The decision is `refusalAction`'s; this is only the acting on it. The one subtle part is the
 * RETRY: `forward(operation)` runs the rest of the chain again, so the auth link sets the headers
 * afresh from whatever token the store now holds. Its answer is read by this handler's own
 * subscriber, not by the link (see there), and the request carries a marker as well, so that however
 * a second refusal comes back, it ends the matter instead of starting a third attempt.
 */
export function createRefusalHandler(deps: RefusalDeps) {
  return ({
    error,
    operation,
    forward,
  }: {
    error: unknown
    operation: ApolloLink.Operation
    forward: ApolloLink.ForwardFunction
  }): Observable<ApolloLink.Result> | void => {
    if (!CombinedGraphQLErrors.is(error)) return
    const auth = deps.auth()
    const context = operation.getContext()
    const action = refusalAction(error.errors, {
      authDisabled: auth.authDisabled,
      isAuthenticated: auth.isAuthenticated,
      alreadyRetried: Boolean(context[RETRIED_AFTER_REFUSAL]),
      refusedTokenIsCurrent: bearerOf(context.headers) === auth.token,
    })

    if (action === 'not-admitted') {
      deps.leave(`${deps.basePath}auth/not-admitted`)
      return
    }
    if (action === 'sign-in') {
      auth.clearState()
      deps.leave(`${deps.basePath}login`)
      return
    }
    if (action !== 'refresh-and-retry' && action !== 'retry') return

    // Several queries of one page load are refused together. The store's refresh is locked, so they
    // share one refresh rather than starting one each; the ones that arrive after it has landed find
    // their refused token already replaced and retry without asking for another.
    return new Observable<ApolloLink.Result>((observer) => {
      let inner: { unsubscribe(): void } | undefined
      let closed = false
      const ready = action === 'refresh-and-retry' ? auth.performTokenRefresh() : Promise.resolve()
      ready.then(
        () => {
          if (closed) return
          operation.setContext({ [RETRIED_AFTER_REFUSAL]: true })
          // THE RETRY'S ANSWER IS READ HERE, because nothing else will read it. ErrorLink hands a
          // retried result straight to the caller without running this handler on it again, so a
          // second refusal left to the link would reach the page as a plain "failed to load" — the
          // very message this exists to replace. A freshly issued token refused again is the
          // deployment refusing the account; the result still goes on to its caller either way.
          inner = forward(operation).subscribe({
            next: (result) => {
              // Everything else was settled before the retry went out — authentication is on, and the
              // token it carries was just issued — so the one question left is whether it was refused.
              const errors = (result as { errors?: ReadonlyArray<RefusableError> }).errors
              if (errors && isUnauthenticated(errors)) deps.leave(`${deps.basePath}auth/not-admitted`)
              observer.next(result)
            },
            error: (e) => observer.error(e),
            complete: () => observer.complete(),
          })
        },
        () => {
          // The identity provider would not issue a fresh token: the session is over, and that is
          // the ordinary sign-in, not a refusal by this deployment.
          if (closed) return
          deps.auth().clearState()
          deps.leave(`${deps.basePath}login`)
          observer.error(error)
        },
      )
      return () => {
        closed = true
        inner?.unsubscribe()
      }
    })
  }
}
