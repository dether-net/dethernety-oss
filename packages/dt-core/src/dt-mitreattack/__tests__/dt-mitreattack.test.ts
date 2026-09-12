/**
 * DtMitreAttack.getMitreAttackTactics ordering tests.
 *
 * Mirrors the dt-mitre.test harness — stub `dtUtils.performQuery` and inject
 * responses. The tactic list is sorted client-side against a hardcoded matrix
 * order, so these lock the two things that order depends on: the ATT&CK version
 * the names come from, and what happens to a name the list does not carry.
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

/** Returns the tactics in the order the client sorted them. */
async function sortNames(names: string[]): Promise<string[]> {
  const { dt, performQuery } = buildHarness()
  performQuery.mockResolvedValue({
    mitreAttackTactics: names.map((name) => ({ name })),
  })
  const out = await dt.getMitreAttackTactics()
  return out.map((t) => t.name as string)
}

describe('DtMitreAttack.getMitreAttackTactics — matrix ordering', () => {
  it('sorts a shuffled Enterprise matrix back into matrix order', async () => {
    expect(
      await sortNames(['Impact', 'Initial Access', 'Stealth', 'Reconnaissance']),
    ).toEqual(['Reconnaissance', 'Initial Access', 'Stealth', 'Impact'])
  })

  it('orders the v19 Defense Evasion split between Privilege Escalation and Credential Access', async () => {
    // v19 retired Defense Evasion: Stealth kept TA0005, Defense Impairment is new.
    expect(
      await sortNames([
        'Credential Access',
        'Defense Impairment',
        'Privilege Escalation',
        'Stealth',
      ]),
    ).toEqual([
      'Privilege Escalation',
      'Stealth',
      'Defense Impairment',
      'Credential Access',
    ])
  })

  it('carries all fifteen v19 Enterprise tactics', async () => {
    const shuffled = [
      'Impact', 'Exfiltration', 'Command and Control', 'Collection',
      'Lateral Movement', 'Discovery', 'Credential Access', 'Defense Impairment',
      'Stealth', 'Privilege Escalation', 'Persistence', 'Execution',
      'Initial Access', 'Resource Development', 'Reconnaissance',
    ]
    expect(await sortNames(shuffled)).toEqual([
      'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
      'Persistence', 'Privilege Escalation', 'Stealth', 'Defense Impairment',
      'Credential Access', 'Discovery', 'Lateral Movement', 'Collection',
      'Command and Control', 'Exfiltration', 'Impact',
    ])
  })

  it('sorts an unrecognized tactic LAST and still returns it', async () => {
    // The regression this guards: a bare `indexOf` yields -1 for an unknown
    // name, which sorts it to the FRONT — so a tactic renamed by an ATT&CK
    // release would silently lead the matrix. Dropping it would be just as
    // wrong: the caller asked for every tactic the server has.
    expect(
      await sortNames(['Impact', 'Tactic From A Later Release', 'Reconnaissance']),
    ).toEqual(['Reconnaissance', 'Impact', 'Tactic From A Later Release'])
  })

  it('keeps every unrecognized tactic, in the order the server returned them', async () => {
    expect(await sortNames(['Zeta Tactic', 'Impact', 'Alpha Tactic'])).toEqual([
      'Impact',
      'Zeta Tactic',
      'Alpha Tactic',
    ])
  })

  it('orders the retired Defense Evasion name at its successor slot', async () => {
    // TRANSITIONAL: a pre-v19 dataset still reports the retired name. It must
    // order where Stealth now sits, not lead the matrix (bare indexOf) and not
    // trail it (unknown-name fallback), until the data catches up.
    expect(
      await sortNames(['Impact', 'Defense Evasion', 'Privilege Escalation']),
    ).toEqual(['Privilege Escalation', 'Defense Evasion', 'Impact'])
  })

  it('sorts a whole pre-v19 tactic list into matrix order', async () => {
    expect(
      await sortNames([
        'Impact', 'Defense Evasion', 'Reconnaissance', 'Credential Access',
      ]),
    ).toEqual([
      'Reconnaissance', 'Defense Evasion', 'Credential Access', 'Impact',
    ])
  })

  it('returns an empty list when the query yields no tactics', async () => {
    const { dt, performQuery } = buildHarness()
    performQuery.mockResolvedValue({})
    expect(await dt.getMitreAttackTactics()).toEqual([])
  })
})
