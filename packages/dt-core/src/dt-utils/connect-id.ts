/**
 * The one rule for building a relationship operation: it is built from a validated non-empty id, or it
 * is not built.
 *
 * WHY THE RULE IS NEEDED. `connect` and `disconnect` both filter on `{ id: { eq } }`. An `eq` whose
 * value is undefined serialises away, leaving a filter object with no condition — and a filter with no
 * condition does not match nothing, it matches EVERYTHING carrying that label. A connect built that way
 * attaches the element to every node of that type in the deployment; a disconnect built that way clears
 * every edge of that type on the element. Neither reports an error, and a read collapses parallel edges,
 * so neither is visible from the interface afterwards.
 *
 * THE NON-NULL DISCIPLINE DOES NOT REACH HERE. The mutation documents declare their top-level ids as
 * `ID!`, so an absent one is rejected before the server sees it — but every member of an input OBJECT is
 * nullable, and these filters are built inside input objects. That is the general shape of the class:
 * wherever an id travels inside an input object rather than as a variable, nothing above this checks it.
 *
 * TWO ANSWERS, because the two situations are different.
 *
 * An ARRAY ELEMENT names one item among many. Refusing the whole save would block a user out of an edit
 * they have no way to repair, so the entry is dropped and the rest of the write stands — the same answer
 * the conduit writer already gives a peer id it cannot resolve.
 *
 * A SCALAR *is* the edit. An empty parent means "move me to the root", and a root that has not resolved
 * yet is an intent that cannot be honoured: emitting it detaches the element from its real parent and
 * connects it to nothing, while dropping it silently reports success for a move that did not happen.
 * So it refuses, and the caller reverts to what it had.
 */

const show = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : String(value))

/** Thrown when a scalar relationship field names an id that cannot be used to build a filter. */
export class UnresolvedIdError extends Error {
  readonly name = 'UnresolvedIdError' as const

  constructor(public readonly field: string, public readonly value: unknown) {
    super(
      `Cannot write "${field}": ${show(value)} is not a usable id, and a relationship built from it ` +
        `would match every node of its type`,
    )
  }
}

/**
 * Whether a value may be used to build a relationship filter.
 *
 * Whitespace counts as empty: an all-space id matches nothing, which after an unconditional disconnect
 * is the same silent orphaning an empty string produces.
 */
export const isConnectId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * The usable ids of a list, in order, with the rest dropped.
 *
 * The surviving ids are returned UNCHANGED — validation must never rewrite an id, only reject it.
 */
export const connectIds = (ids: readonly unknown[] | undefined): string[] => (ids ?? []).filter(isConnectId)

/** The id, unchanged, or a refusal naming the field that carried it. */
export const assertConnectId = (value: unknown, field: string): string => {
  if (!isConnectId(value)) throw new UnresolvedIdError(field, value)
  return value
}
