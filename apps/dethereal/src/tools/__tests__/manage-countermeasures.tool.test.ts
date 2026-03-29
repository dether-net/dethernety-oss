import { describe, it, expect } from 'vitest'
import { manageCountermeasuresTool } from '../manage-countermeasures.tool.js'

describe('ManageCountermeasuresTool', () => {
  it('should have the correct tool name', () => {
    expect(manageCountermeasuresTool.name).toBe('manage_countermeasures')
  })

  it('should require a client', () => {
    expect(manageCountermeasuresTool.requiresClient).toBe(true)
  })

  it('should accept list action with control_id', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({
      action: 'list',
      control_id: 'ctrl-123'
    })
    expect(result.success).toBe(true)
  })

  it('should reject list action without control_id', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({ action: 'list' })
    expect(result.success).toBe(false)
  })

  it('should accept create with full schema', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({
      action: 'create',
      control_id: 'ctrl-123',
      name: 'TLS Encryption',
      type: 'preventive',
      category: 'encryption',
      description: 'Encrypt data in transit',
      score: 80,
      exposure_ids: ['exp-1', 'exp-2'],
      defend_technique_ids: ['D3-AL'],
      mitigations: [{ id: 'M1036' }],
      references: 'https://example.com'
    })
    expect(result.success).toBe(true)
  })

  it('should reject create without control_id', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({
      action: 'create',
      name: 'Test'
    })
    expect(result.success).toBe(false)
  })

  it('should reject create without name', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({
      action: 'create',
      control_id: 'ctrl-123'
    })
    expect(result.success).toBe(false)
  })

  it('should reject score outside 0-100 range', () => {
    const result = manageCountermeasuresTool.inputSchema.safeParse({
      action: 'create',
      control_id: 'ctrl-123',
      name: 'Test',
      score: 150
    })
    expect(result.success).toBe(false)
  })

  it('should accept valid type values', () => {
    for (const type of ['preventive', 'detective', 'corrective']) {
      const result = manageCountermeasuresTool.inputSchema.safeParse({
        action: 'create',
        control_id: 'ctrl-123',
        name: 'Test',
        type
      })
      expect(result.success).toBe(true)
    }
  })
})
