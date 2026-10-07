/**
 * DtMitreAtlas reads: the documents sent and the matrix ordering of tactics.
 * Stubs `dtUtils.performQuery`, as the other dt-core reader tests do.
 */
import { describe, it, expect, vi } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtMitreAtlas } from '../dt-mitreatlas.js'

function buildHarness() {
  const dt = new DtMitreAtlas({} as Apollo.ApolloClient)
  const performQuery = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performQuery = performQuery
  return { dt, performQuery }
}

describe('DtMitreAtlas', () => {
  it('finds techniques by filter and orders each technique\'s tactics by ATLAS matrix position', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({
      mitreAtlasTechniques: [{
        id: 't1', name: 'LLM Prompt Injection', atlas_id: 'AML.T0051',
        tactics: [{ id: 'x', name: 'Execution', atlas_id: 'AML.TA0005', matrix_order: 5 },
                  { id: 'y', name: 'AI Model Access', atlas_id: 'AML.TA0000', matrix_order: 4 }],
      }],
    })
    const out = await dt.findMitreAtlasTechniques({ query: { atlas_id: { eq: 'AML.T0051' } } })
    expect(performQuery.mock.calls[0][0].variables).toEqual({ filter: { atlas_id: { eq: 'AML.T0051' } } })
    expect(performQuery.mock.calls[0][0].query.loc.source.body).toContain('mitreAtlasTechniques(where: $filter)')
    expect(out[0].tactics!.map(t => t.name)).toEqual(['AI Model Access', 'Execution'])
  })

  it('lists tactics in ATLAS matrix order, unplaced last', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({
      mitreAtlasTactics: [
        { id: 'a', name: 'Impact', atlas_id: 'AML.TA0011', matrix_order: 15 },
        { id: 'b', name: 'Unplaced', atlas_id: 'AML.TA9999' },
        { id: 'c', name: 'Reconnaissance', atlas_id: 'AML.TA0002', matrix_order: 0 },
      ],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect((await dt.getMitreAtlasTactics()).map(t => t.name)).toEqual(['Reconnaissance', 'Impact', 'Unplaced'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 MITRE ATLAS tactic(s) have no matrix_order'))
    warn.mockRestore()
  })

  it('returns empty lists when the data has no ATLAS', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({})
    expect(await dt.getMitreAtlasMitigations()).toEqual([])
    expect(await dt.getMitreAtlasTactics()).toEqual([])
    expect(await dt.findMitreAtlasTechniques({ query: {} })).toEqual([])
  })
})
