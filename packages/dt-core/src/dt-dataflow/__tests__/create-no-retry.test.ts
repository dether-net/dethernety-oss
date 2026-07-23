/**
 * createDataFlow must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 * (This only guards the no-retry behaviour; the dedup key on this method is covered separately.)
 */
import { describe, it } from 'vitest'
import { DtDataflow } from '../dt-dataflow.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtDataflow.createDataFlow — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtDataflow(client),
      (dt) =>
        dt.createDataFlow({
          newEdge: { id: '', source: 'A', target: 'B', sourceHandle: null, targetHandle: null, label: 'flow', data: { description: '' } } as any,
          classId: 'cls1',
        }),
    )
  })
})
