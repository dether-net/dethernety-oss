import { describe, it, expect } from 'vitest'
import { searchMitreAttackTool } from '../search-mitre-attack.tool.js'

describe('SearchMitreAttackTool', () => {
  it('should have the correct tool name', () => {
    expect(searchMitreAttackTool.name).toBe('search_mitre_attack')
  })

  it('should require a client', () => {
    expect(searchMitreAttackTool.requiresClient).toBe(true)
  })

  it('should accept search action with query', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'search',
      query: 'phishing'
    })
    expect(result.success).toBe(true)
  })

  it('should reject search action without query', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'search'
    })
    expect(result.success).toBe(false)
  })

  it('should accept tactics action without parameters', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'tactics'
    })
    expect(result.success).toBe(true)
  })

  it('should reject techniques_by_tactic without tactic_id', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'techniques_by_tactic'
    })
    expect(result.success).toBe(false)
  })

  it('should accept technique action with attack_id', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'technique',
      attack_id: 'T1566.001'
    })
    expect(result.success).toBe(true)
  })

  it('should reject technique action without attack_id', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'technique'
    })
    expect(result.success).toBe(false)
  })

  it('should accept mitigations action', () => {
    const result = searchMitreAttackTool.inputSchema.safeParse({
      action: 'mitigations'
    })
    expect(result.success).toBe(true)
  })
})
