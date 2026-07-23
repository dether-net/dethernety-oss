/**
 * createCountermeasure must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtCountermeasure } from '../dt-countermeasure.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtCountermeasure.createCountermeasure — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtCountermeasure(client),
      (dt) =>
        dt.createCountermeasure({
          controlId: 'c1',
          countermeasure: {
            name: 'cm', description: '', type: '', category: '', score: 5,
            references: [], addressedExposures: [], defendedTechniques: [], mitigations: [],
          } as any,
        }),
    )
  })
})
