/**
 * findIssues({ elementIds }) must OR the element-collection filters (match
 * the element in ANY collection), not AND nine sibling `some` filters (which
 * required the element in all nine at once). Plus UPDATE_ISSUE must return
 * dataFlows + attributes.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtIssue } from '../dt-issue.js'
import { UPDATE_ISSUE } from '../dt-issue-gql.js'

describe('DtIssue.findIssues — element filters are OR-ed', () => {
  it('builds condition.AND.OR with the nine element conditions', async () => {
    const dt = new DtIssue({} as any) as any
    const performQuery = vi.fn().mockResolvedValue({ issues: [] })
    dt.dtUtils.performQuery = performQuery

    await dt.findIssues({ elementIds: ['e1'] })

    const condition = performQuery.mock.calls[0][0].variables.condition
    expect(condition.AND.OR).toBeInstanceOf(Array)
    expect(condition.AND.OR).toHaveLength(9)
    // Every entry is a single `{ <collection>: { some: { id: { in } } } }` filter.
    expect(condition.AND.OR).toContainEqual({ dataFlows: { some: { id: { in: ['e1'] } } } })
    expect(condition.AND.OR).toContainEqual({ components: { some: { id: { in: ['e1'] } } } })
    // The nine are NOT sibling AND keys anymore.
    expect(condition.AND.components).toBeUndefined()
  })

  it('still AND-s a non-element filter alongside the element OR', async () => {
    const dt = new DtIssue({} as any) as any
    const performQuery = vi.fn().mockResolvedValue({ issues: [] })
    dt.dtUtils.performQuery = performQuery

    await dt.findIssues({ elementIds: ['e1'], issueStatus: 'OPEN' })

    const condition = performQuery.mock.calls[0][0].variables.condition
    expect(condition.AND.OR).toHaveLength(9)
    expect(condition.AND.issueStatus).toEqual({ eq: 'OPEN' })
  })
})

describe('UPDATE_ISSUE selection', () => {
  it('returns dataFlows and the raw attributes scalar', () => {
    const q = UPDATE_ISSUE.loc?.source.body ?? ''
    expect(q).toMatch(/dataFlows\s*{/)
    // `attributes` selected as its own scalar field line (not merely mentioned in
    // syncedAttributes' customResolver text or elsewhere).
    expect(q).toMatch(/^\s*attributes\s*$/m)
  })
})
