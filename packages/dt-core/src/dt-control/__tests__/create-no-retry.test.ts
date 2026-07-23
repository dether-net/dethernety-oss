/**
 * createControl must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtControl } from '../dt-control.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtControl.createControl — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtControl(client),
      (dt) =>
        dt.createControl({
          newControl: { name: 'ctrl', description: '' } as any,
          classIds: ['cc1'],
          folderId: undefined,
        }),
    )
  })
})
