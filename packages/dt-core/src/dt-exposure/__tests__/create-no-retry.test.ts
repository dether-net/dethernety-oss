/**
 * createExposure must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtExposure } from '../dt-exposure.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtExposure.createExposure — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtExposure(client),
      (dt) =>
        dt.createExposure({
          exposure: { name: 'exp', description: '', type: 'misconfiguration', category: '', score: 1, attackVector: null } as any,
          elementId: 'e1',
          attackTechniqueIds: [],
        }),
    )
  })
})
