/**
 * DtIssue.updateIssue — issue-class relationship guard.
 * Omitting `issueClassId` (an update that doesn't touch the class) previously
 * emitted a bare disconnect-all + a connect on `eq: undefined`, wiping the
 * issue's class. It must now OMIT the key (preserve); a present id disconnects
 * the old class and connects the new one (single-valued move).
 */
import { describe, it, expect, vi } from 'vitest'
import { DtIssue } from '../dt-issue.js'

const make = () => {
  const dtIssue = new DtIssue({} as any)
  const performMutation = vi.fn().mockResolvedValue({ updateIssues: { issues: [{ id: 'i1' }] } })
  ;(dtIssue as any).dtUtils.performMutation = performMutation
  return { dtIssue, performMutation }
}

const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input

describe('DtIssue.updateIssue — issueClass guard', () => {
  it('omits issueClass entirely when issueClassId is absent (preserve the binding)', async () => {
    const { dtIssue, performMutation } = make()
    await dtIssue.updateIssue({ issueId: 'i1', name: 'N', description: 'D' })
    expect(inputOf(performMutation)).not.toHaveProperty('issueClass')
  })

  it('disconnects the old class and connects the given id when present (move)', async () => {
    const { dtIssue, performMutation } = make()
    await dtIssue.updateIssue({ issueId: 'i1', name: 'N', issueClassId: 'ic1' })
    expect(inputOf(performMutation).issueClass).toEqual({
      disconnect: {},
      connect: { where: { node: { id: { eq: 'ic1' } } } },
    })
  })
})
