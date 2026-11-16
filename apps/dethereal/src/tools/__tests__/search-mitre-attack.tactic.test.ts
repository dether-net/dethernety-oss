/**
 * techniques_by_tactic: the platform selects a tactic by its node id, so an ATT&CK tactic id is looked up first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const m = vi.hoisted(() => ({ getMitreAttackTactics: vi.fn(), getMitreAttackTechniquesByTactic: vi.fn() }))
vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DtMitreAttack: class {
      constructor(_c: unknown) {}
      getMitreAttackTactics = m.getMitreAttackTactics
      getMitreAttackTechniquesByTactic = m.getMitreAttackTechniquesByTactic
    },
  }
})

const { searchMitreAttackTool } = await import('../search-mitre-attack.tool.js')
const context = { debug: false, apolloClient: {} } as unknown as ToolContext
const byTactic = (tactic_id: string) => searchMitreAttackTool.run({ action: 'techniques_by_tactic', tactic_id }, context)

beforeEach(() => {
  m.getMitreAttackTactics.mockReset().mockResolvedValue([
    { id: 'node-ta0001', attack_id: 'TA0001', name: 'Initial Access' },
    { id: 'node-ta0008', attack_id: 'TA0008', name: 'Lateral Movement' },
  ])
  m.getMitreAttackTechniquesByTactic.mockReset().mockImplementation(async ({ tacticId }: { tacticId: string }) =>
    tacticId === 'node-ta0008' ? [{ id: 'node-t1021', attack_id: 'T1021', name: 'Remote Services' }] : [])
})

describe('techniques_by_tactic', () => {
  it.each(['TA0008', 'ta0008', 'node-ta0008'])('reads the tactic %s by its node id', async (tactic) => {
    const r = await byTactic(tactic)
    expect(r.success, r.error).toBe(true)
    expect(m.getMitreAttackTechniquesByTactic).toHaveBeenCalledWith({ tacticId: 'node-ta0008' })
    expect(r.data).toEqual({ techniques: [{ id: 'node-t1021', attack_id: 'T1021', name: 'Remote Services' }], tactic_id: 'TA0008' })
  })

  it('refuses a tactic the platform does not have, rather than answer an empty list', async () => {
    const r = await byTactic('TA9999')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Tactic TA9999 not found/)
    expect(m.getMitreAttackTechniquesByTactic).not.toHaveBeenCalled()
  })
})
