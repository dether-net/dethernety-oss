/**
 * createBoundaryNode must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtBoundary } from '../dt-boundary.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtBoundary.createBoundaryNode — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtBoundary(client),
      (dt) =>
        dt.createBoundaryNode({
          newNode: { id: '', position: { x: 0, y: 0 }, width: 10, height: 10, data: { label: 'B1', description: '' } } as any,
          classId: 'cls1',
          defaultBoundaryId: 'b1',
        }),
    )
  })
})
