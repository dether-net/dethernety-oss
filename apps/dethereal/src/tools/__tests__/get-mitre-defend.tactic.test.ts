/**
 * get_mitre_defend techniques_by_tactic: the platform selects a tactic by its node id, so a tactic's name or URI is
 * looked up first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const m = vi.hoisted(() => ({ fetchMitreDefendTactics: vi.fn(), getMitreDefendTechniquesByTactic: vi.fn() }))
vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtMitreDefend: class {
      constructor(_c: unknown) {}
      fetchMitreDefendTactics = m.fetchMitreDefendTactics
      getMitreDefendTechniquesByTactic = m.getMitreDefendTechniquesByTactic
    },
  }
})

const { getMitreDefendTool } = await import('../get-mitre-defend.tool.js')
const context = { debug: false, apolloClient: {} } as unknown as ToolContext
const byTactic = (tactic_id: string) => getMitreDefendTool.run({ action: 'techniques_by_tactic', tactic_id }, context)

beforeEach(() => {
  m.fetchMitreDefendTactics.mockReset().mockResolvedValue([
    { id: 'node-harden', name: 'Harden', uri: 'http://d3fend.mitre.org/ontologies/d3fend.owl#Harden' },
    { id: 'node-detect', name: 'Detect', uri: 'http://d3fend.mitre.org/ontologies/d3fend.owl#Detect' },
  ])
  m.getMitreDefendTechniquesByTactic.mockReset().mockImplementation(async ({ tacticId }: { tacticId: string }) =>
    tacticId === 'node-harden' ? [{ id: 'node-d3-mfa', d3fendId: 'D3-MFA', name: 'Multi-factor Authentication' }] : [])
})

describe('get_mitre_defend techniques_by_tactic', () => {
  it.each(['Harden', 'harden', 'node-harden', 'http://d3fend.mitre.org/ontologies/d3fend.owl#Harden'])('reads the tactic %s by its node id', async (tactic) => {
    const r = await byTactic(tactic)
    expect(r.success, r.error).toBe(true)
    expect(m.getMitreDefendTechniquesByTactic).toHaveBeenCalledWith({ tacticId: 'node-harden' })
    expect(r.data).toEqual({ techniques: [{ id: 'node-d3-mfa', d3fendId: 'D3-MFA', name: 'Multi-factor Authentication' }], tactic_id: 'Harden' })
  })

  it('says when the platform has no D3FEND tactics at all, rather than asking for another name', async () => {
    m.fetchMitreDefendTactics.mockResolvedValue(null)
    const r = await byTactic('Harden')
    expect(r).toEqual({ success: false, error: 'the platform has no D3FEND tactics loaded: D3FEND data is not ingested on this platform' })
  })

  it('refuses a tactic the platform does not have, naming the ones it has', async () => {
    const r = await byTactic('Evade')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/D3FEND tactic Evade not found: .*Harden, Detect/)
    expect(m.getMitreDefendTechniquesByTactic).not.toHaveBeenCalled()
  })
})
