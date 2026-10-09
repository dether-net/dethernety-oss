/**
 * Sentinel error used by `DtUtils.withCancellableLatest` to signal that a
 * newer call with the same key superseded an older one. The underlying
 * promise (e.g. a GraphQL request) still runs to completion — only the
 * stale resolved value is discarded.
 *
 * Callers can branch on `err instanceof CancelledError` to silently drop
 * stale results from fast-typing UX (autocomplete, search).
 */
export class CancelledError extends Error {
  readonly name = 'CancelledError' as const

  constructor(public readonly key: string) {
    super(`Cancelled by a newer call with key "${key}"`)
  }
}

const MAX_MESSAGE_LENGTH = 1000

/**
 * A request the client resolved with an error and no data (a client built with
 * `errorPolicy: 'all'` resolves instead of throwing). Carries only the server's
 * message, capped in length: not the Apollo error object, whose raw response
 * body or extensions could echo request input back to whoever reads the error.
 *
 * `retryable` is true only for transport failures (a 5xx or no response at
 * all); a GraphQL error or a 4xx fails the same way on every attempt.
 */
export class DtRequestError extends Error {
  readonly name = 'DtRequestError' as const

  constructor(message: string, public readonly retryable: boolean) {
    super(
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : message
    )
  }
}
