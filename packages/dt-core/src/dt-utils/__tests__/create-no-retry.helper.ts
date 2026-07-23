/**
 * Regression guard — non-idempotent creates must NOT retry a failed write.
 *
 * Mutations do not retry: `executeActualMutation` issues a single
 * `apolloClient.mutate` and never re-sends, because a network-classified error
 * (timeout / 502 / 504) may mean the write already committed server-side — a
 * blind retry would create a duplicate node. None of the eight entity creates
 * carries a client id or a server-side MERGE path (only `Analysis` does), so
 * "don't retry" is the mechanism that closes the duplicate-node P1 for them.
 *
 * These guards pin that behavior. They mock at the real Apollo boundary — not
 * the per-entity `dtUtils` seam — so the actual
 * `performMutation → withMutex → executeActualMutation → apolloClient.mutate`
 * chain runs, and "mutate called exactly once" genuinely proves nothing in that
 * chain (nor the dedup/mutex layer) re-issues the write. A future edit that
 * reintroduces a create retry loop turns these red.
 */
import { expect, vi } from 'vitest'

/**
 * Assert a create issues exactly one `apolloClient.mutate` and does not retry,
 * for both a network-classified error (the risky commit-then-timeout shape that
 * a retry would have re-sent) and a plain error.
 *
 * @param makeInstance builds the entity wrapper from a fake Apollo client
 *   (`(client) => new DtX(client)`)
 * @param invoke calls the create method on that wrapper
 */
export async function expectNoMutationRetry(
  makeInstance: (apolloClient: any) => any,
  invoke: (instance: any) => Promise<unknown>,
): Promise<void> {
  for (const message of ['504 Gateway Timeout', 'Constraint validation failed']) {
    const mutate = vi.fn().mockRejectedValue(new Error(message))
    const instance = makeInstance({ mutate })

    await expect(invoke(instance)).rejects.toThrow(message)
    // Exactly one network round-trip — no re-send on failure, regardless of
    // whether the error looks network-shaped.
    expect(mutate).toHaveBeenCalledTimes(1)
  }
}
