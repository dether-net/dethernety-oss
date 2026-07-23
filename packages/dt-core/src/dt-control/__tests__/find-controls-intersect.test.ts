/**
 * findControls must INTERSECT an explicit controlId with the elementIds-derived
 * id set (controlId ∈ element set), not clobber it. Plus GET_CONTROL_CLASS_BY_ID
 * must select module.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtControl } from '../dt-control.js'
import { GET_CONTROL_CLASS_BY_ID } from '../../dt-class/dt-class-gql.js'

const harness = (elementDerivedIds: string[]) => {
  const dt = new DtControl({} as any) as any
  const performQuery = vi.fn()
    // Path 1: CONTROL_IDS_BY_ELEMENTS
    .mockResolvedValueOnce({ controlIdsByElements: elementDerivedIds })
    // Path 2: FIND_CONTROLS
    .mockResolvedValueOnce({ controls: [] })
  dt.dtUtils.performQuery = performQuery
  return { dt, performQuery }
}

describe('DtControl.findControls — controlId + elementIds intersect', () => {
  it('keeps controlId only when it is in the element-derived set', async () => {
    const { dt, performQuery } = harness(['c1', 'c2', 'c3'])

    await dt.findControls({ elementIds: ['e1'], controlId: 'c2' })

    const cond = performQuery.mock.calls[1][0].variables.condition.AND
    expect(cond.id).toEqual({ in: ['c2'] }) // intersected, not clobbered to { eq: 'c2' }
  })

  it('yields an empty id set when controlId is not in the element set (no match, not everything)', async () => {
    const { dt, performQuery } = harness(['c1', 'c2', 'c3'])

    await dt.findControls({ elementIds: ['e1'], controlId: 'zzz' })

    const cond = performQuery.mock.calls[1][0].variables.condition.AND
    expect(cond.id).toEqual({ in: [] })
  })

  it('uses eq when only controlId is given (no element set)', async () => {
    const dt = new DtControl({} as any) as any
    const performQuery = vi.fn().mockResolvedValueOnce({ controls: [] })
    dt.dtUtils.performQuery = performQuery

    await dt.findControls({ controlId: 'c9' })

    expect(performQuery.mock.calls[0][0].variables.condition.AND.id).toEqual({ eq: 'c9' })
  })
})

describe('GET_CONTROL_CLASS_BY_ID selection', () => {
  it('selects module { id name }', () => {
    const q = GET_CONTROL_CLASS_BY_ID.loc?.source.body ?? ''
    expect(q).toMatch(/module\s*{[^}]*id[^}]*name/s)
  })
})
