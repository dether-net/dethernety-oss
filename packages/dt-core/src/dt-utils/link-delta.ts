/**
 * The add/remove delta for an element's link list.
 *
 * An element-side association write has two possible shapes, and which one is correct depends entirely
 * on whether the caller knows what the list held BEFORE this edit.
 *
 * WITHOUT that knowledge the only safe shape is replace — disconnect everything, connect the list — and
 * that is what an import or a bulk update does, because it is asserting the whole list rather than
 * changing part of one. Replace is also destructive in exactly one situation: two people editing the
 * same element. The second save carries a list assembled from a view of the element taken before the
 * first save landed, so it disconnects what the other person just attached and reports success.
 *
 * WITH a baseline the edit can be expressed as what actually changed, and then the two saves compose:
 * each connects its own addition and disconnects nothing it never knew about.
 *
 * The cost of the delta is a duplicate edge when two people add the SAME id at the same moment, since
 * `connect` compiles to a bare relationship CREATE. That is the trade being made deliberately: a
 * duplicate is additive and invisible on read, and a destroyed attachment is neither.
 */

import { connectIds } from './connect-id.js'

/**
 * A list as a caller actually hands it over. The entries are typed loosely on purpose: the lists come
 * off an element whose id fields are optional on the shared types, so "a list of ids" is what the caller
 * intends rather than what it can promise. Validation happens here, once, for every caller.
 */
export type IdList = readonly (string | undefined | null)[] | undefined

/** One `{ where: { node: { id: { eq } } } }` operand — the shape both halves of a link write use. */
export interface LinkWhere {
  where: { node: { id: { eq: string } } }
}

export interface LinkOps {
  connect?: LinkWhere[]
  disconnect?: LinkWhere[]
}

const operand = (id: string): LinkWhere => ({ where: { node: { id: { eq: id } } } })

/**
 * The operations that take `baseline` to `current`.
 *
 * Returns `undefined` when nothing changed, so the caller omits the key entirely rather than sending an
 * empty operation — an element whose links were not edited must not have its links written at all.
 *
 * Both sides are de-duplicated: an id repeated in the buffer would otherwise connect twice and create
 * the parallel edge this shape exists to avoid.
 *
 * BOTH SIDES ARE ALSO VALIDATED, and the baseline side matters more than the current one. An unusable id
 * in `current` would build a connect that attaches every node of its type; an unusable id in `baseline`
 * would build a DISCONNECT with no condition, clearing every edge of that type on this element. An id
 * that cannot be named cannot be disconnected either, so dropping it from both sides is the whole answer.
 */
export const buildLinkOps = (
  current: IdList,
  baseline: IdList,
): LinkOps | undefined => {
  const cur = new Set(connectIds(current))
  const base = new Set(connectIds(baseline))

  const connect = [...cur].filter(id => !base.has(id)).map(operand)
  const disconnect = [...base].filter(id => !cur.has(id)).map(operand)

  if (!connect.length && !disconnect.length) return undefined

  const ops: LinkOps = {}
  if (connect.length) ops.connect = connect
  if (disconnect.length) ops.disconnect = disconnect
  return ops
}

/** The replace shape: disconnect every existing edge, then connect the asserted list. */
export interface LinkReplace {
  disconnect: Record<string, never>
  connect: LinkWhere[]
}

/** What the caller knew the element's links to be before this edit. */
export interface LinkBaselines {
  controls?: string[]
  dataItems?: string[]
}

/**
 * The value for one link key of an update input, or `undefined` to omit the key.
 *
 * THE WHOLE DECISION LIVES HERE, because there are two different absences and collapsing them is the
 * one mistake that turns a bulk write into a delta against nothing:
 *
 * - `current` absent — the element does not define this list, so it was not edited and must not be
 *   written at all. This is what the import and conduit "safe node" passes rely on.
 * - `baselines` absent — the caller does not know what the list held before, so it is asserting the
 *   whole list and replace is the only correct shape.
 * - `baselines` present but holding nothing for this key — the caller DOES know, and knows it held
 *   nothing. That is a delta against an empty baseline: connect everything, disconnect nothing.
 */
export const linkInput = (
  current: IdList,
  baselines: LinkBaselines | undefined,
  key: keyof LinkBaselines,
): LinkOps | LinkReplace | undefined => {
  if (current === undefined) return undefined
  if (baselines === undefined) {
    // A list asserted whole, minus the entries that cannot be named. The disconnect stays unconditional,
    // so a list of nothing usable clears the association rather than attaching everything — which is the
    // honest reading of "this is the whole list" when none of it resolves.
    return { disconnect: {}, connect: [...new Set(connectIds(current))].map(operand) }
  }
  return buildLinkOps(current, baselines[key] ?? [])
}
