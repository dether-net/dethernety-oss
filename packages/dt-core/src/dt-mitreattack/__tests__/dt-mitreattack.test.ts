/**
 * DtMitreAttack.getMitreAttackTactics ordering tests.
 *
 * Mirrors the dt-mitre.test harness — stub `dtUtils.performQuery` and inject
 * responses. Tactics are ordered by the `matrix_order` the ingest stamps on each
 * tactic from the ATT&CK bundle, so the order follows the data, not a list in code.
 */

import { describe, it, expect, vi } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtMitreAttack } from '../dt-mitreattack.js'

function buildHarness() {
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtMitreAttack(apolloClient)
  const performQuery = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performQuery = performQuery
  return { dt, performQuery }
}

/** Returns the tactic names in the order the client sorted them. */
async function sortTactics(tactics: Array<{ name: string; matrix_order?: number | null }>): Promise<string[]> {
  const { dt, performQuery } = buildHarness()
  performQuery.mockResolvedValue({ mitreAttackTactics: tactics })
  const out = await dt.getMitreAttackTactics()
  return out.map((t) => t.name as string)
}

describe('DtMitreAttack.getMitreAttackTactics — matrix ordering', () => {
  it('sorts the tactics by matrix_order', async () => {
    expect(
      await sortTactics([
        { name: 'Impact', matrix_order: 14 },
        { name: 'Initial Access', matrix_order: 2 },
        { name: 'Stealth', matrix_order: 6 },
        { name: 'Reconnaissance', matrix_order: 0 },
      ]),
    ).toEqual(['Reconnaissance', 'Initial Access', 'Stealth', 'Impact'])
  })

  it('places the v19 Defense Evasion split by data, whatever the names', async () => {
    // v19 retired Defense Evasion: Stealth kept TA0005 at position 6, Defense Impairment is new at 7.
    expect(
      await sortTactics([
        { name: 'Credential Access', matrix_order: 8 },
        { name: 'Defense Impairment', matrix_order: 7 },
        { name: 'Privilege Escalation', matrix_order: 5 },
        { name: 'Stealth', matrix_order: 6 },
      ]),
    ).toEqual(['Privilege Escalation', 'Stealth', 'Defense Impairment', 'Credential Access'])
  })

  it('sorts tactics without matrix_order LAST, by ATT&CK id, and warns that the data predates matrix order', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({
      mitreAttackTactics: [
        { name: 'Zeta Tactic', attack_id: 'TA0040' },
        { name: 'Impact', attack_id: 'TA0040x', matrix_order: 14 },
        { name: 'Alpha Tactic', attack_id: 'TA0003', matrix_order: null },
        { name: 'Reconnaissance', attack_id: 'TA0043', matrix_order: 0 },
      ],
    })
    const out = await dt.getMitreAttackTactics()
    expect(out.map((t) => t.name)).toEqual(['Reconnaissance', 'Impact', 'Alpha Tactic', 'Zeta Tactic'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 MITRE ATT&CK tactic(s) have no matrix_order'))
    warn.mockRestore()
  })

  it('does not warn when every tactic has a matrix position', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await sortTactics([{ name: 'Impact', matrix_order: 14 }, { name: 'Reconnaissance', matrix_order: 0 }])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns an empty list when the query yields no tactics', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({})
    expect(await dt.getMitreAttackTactics()).toEqual([])
  })
})
