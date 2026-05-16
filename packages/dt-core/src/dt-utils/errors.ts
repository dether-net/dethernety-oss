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
