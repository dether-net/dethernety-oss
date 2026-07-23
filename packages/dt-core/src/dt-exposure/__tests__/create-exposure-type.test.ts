/**
 * createExposure must send the String `type` unchanged (schema field is
 * String). The old Number.parseInt turned a real value like "misconfiguration"
 * into NaN/null on create.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtExposure } from '../dt-exposure.js'

describe('DtExposure.createExposure — String type is passed through', () => {
  it('sends the string value verbatim, not a parseInt result', async () => {
    const dt = new DtExposure({} as any) as any
    const performMutation = vi.fn().mockResolvedValue({ id: 'exp-1' })
    dt.dtUtils.performMutation = performMutation

    await dt.createExposure({
      exposure: { name: 'X', description: '', type: 'misconfiguration', category: 'C', score: 1 },
      elementId: 'el-1',
      attackTechniqueIds: [],
    })

    expect(performMutation.mock.calls[0][0].variables.input.type).toBe('misconfiguration')
  })

  it('coalesces an absent type to null (not NaN)', async () => {
    const dt = new DtExposure({} as any) as any
    const performMutation = vi.fn().mockResolvedValue({ id: 'exp-1' })
    dt.dtUtils.performMutation = performMutation

    await dt.createExposure({
      exposure: { name: 'X', description: '', category: 'C', score: 1 },
      elementId: 'el-1',
      attackTechniqueIds: [],
    })

    expect(performMutation.mock.calls[0][0].variables.input.type).toBeNull()
  })
})
