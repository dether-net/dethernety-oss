/**
 * findIssues({ elementIds }) must OR the element-collection filters (match
 * the element in ANY collection), not AND nine sibling `some` filters (which
 * required the element in all nine at once), each on a field IssueWhere has:
 * a field it does not have fails the whole request. A module filter goes
 * through the issue class (Issue has no module relationship). The shapes are
 * also validated against the schema in dt-ws's dt-core-documents spec. Plus
 * UPDATE_ISSUE must return dataFlows + attributes.
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
    // The issue's model link is `models`.
    expect(condition.AND.OR.map((entry: Record<string, unknown>) => Object.keys(entry)[0])).toEqual([
      'models', 'components', 'dataFlows', 'securityBoundaries', 'controls', 'data', 'analyses', 'exposures', 'countermeasures',
    ])
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

  it('filters by module through the issue class, with the class filters', async () => {
    const dt = new DtIssue({} as any) as any
    const performQuery = vi.fn().mockResolvedValue({ issues: [] })
    dt.dtUtils.performQuery = performQuery

    await dt.findIssues({ classType: 'finding', moduleId: 'module-1', moduleName: 'general' })

    expect(performQuery.mock.calls[0][0].variables.condition).toEqual({
      AND: {
        issueClass: {
          single: { type: { eq: 'finding' }, module: { single: { id: { eq: 'module-1' }, name: { eq: 'general' } } } },
        },
      },
    })
  })

  it('sends a module filter alone through the issue class too', async () => {
    const dt = new DtIssue({} as any) as any
    const performQuery = vi.fn().mockResolvedValue({ issues: [] })
    dt.dtUtils.performQuery = performQuery

    await dt.findIssues({ moduleName: 'general' })

    expect(performQuery.mock.calls[0][0].variables.condition).toEqual({
      AND: { issueClass: { single: { module: { single: { name: { eq: 'general' } } } } } },
    })
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
