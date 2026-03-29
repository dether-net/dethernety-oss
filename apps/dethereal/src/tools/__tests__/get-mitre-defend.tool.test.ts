import { describe, it, expect } from 'vitest'
import { getMitreDefendTool } from '../get-mitre-defend.tool.js'

describe('GetMitreDefendTool', () => {
  it('should have the correct tool name', () => {
    expect(getMitreDefendTool.name).toBe('get_mitre_defend')
  })

  it('should require a client', () => {
    expect(getMitreDefendTool.requiresClient).toBe(true)
  })

  it('should accept tactics action', () => {
    const result = getMitreDefendTool.inputSchema.safeParse({
      action: 'tactics'
    })
    expect(result.success).toBe(true)
  })

  it('should accept techniques_by_tactic with tactic_id', () => {
    const result = getMitreDefendTool.inputSchema.safeParse({
      action: 'techniques_by_tactic',
      tactic_id: 'TA0001'
    })
    expect(result.success).toBe(true)
  })

  it('should reject techniques_by_tactic without tactic_id', () => {
    const result = getMitreDefendTool.inputSchema.safeParse({
      action: 'techniques_by_tactic'
    })
    expect(result.success).toBe(false)
  })

  it('should accept technique with d3fend_id', () => {
    const result = getMitreDefendTool.inputSchema.safeParse({
      action: 'technique',
      d3fend_id: 'D3-AL'
    })
    expect(result.success).toBe(true)
  })

  it('should reject technique without d3fend_id', () => {
    const result = getMitreDefendTool.inputSchema.safeParse({
      action: 'technique'
    })
    expect(result.success).toBe(false)
  })
})
