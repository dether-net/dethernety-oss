/**
 * createIssue must not retry a failed write (no commit-then-timeout
 * duplicate window). See create-no-retry.helper for the mechanism rationale.
 */
import { describe, it } from 'vitest'
import { DtIssue } from '../dt-issue.js'
import { expectNoMutationRetry } from '../../dt-utils/__tests__/create-no-retry.helper.js'

describe('DtIssue.createIssue — no retry on failed write', () => {
  it('issues exactly one apolloClient.mutate', async () => {
    await expectNoMutationRetry(
      (client) => new DtIssue(client),
      (dt) => dt.createIssue({ name: 'iss', issueClassId: 'ic1' }),
    )
  })
})
