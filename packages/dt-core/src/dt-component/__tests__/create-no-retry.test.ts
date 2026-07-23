/**
 * createComponentNode must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtComponent } from '../dt-component.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtComponent.createComponentNode — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtComponent(client),
      (dt) =>
        dt.createComponentNode({
          newNode: { id: '', type: 'process', position: { x: 0, y: 0 }, data: { label: 'C1', description: '' } } as any,
          classId: 'cls1',
          defaultBoundaryId: 'b1',
        }),
    )
  })
})
