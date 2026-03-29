import { describe, it, expect } from 'vitest'
import { manageExposuresTool } from '../manage-exposures.tool.js'

describe('ManageExposuresTool', () => {
  it('should have the correct tool name', () => {
    expect(manageExposuresTool.name).toBe('manage_exposures')
  })

  it('should require a client', () => {
    expect(manageExposuresTool.requiresClient).toBe(true)
  })

  it('should accept list action with element_id', () => {
    const result = manageExposuresTool.inputSchema.safeParse({
      action: 'list',
      element_id: 'elem-123'
    })
    expect(result.success).toBe(true)
  })

  it('should reject list action without element_id', () => {
    const result = manageExposuresTool.inputSchema.safeParse({
      action: 'list'
    })
    expect(result.success).toBe(false)
  })

  it('should accept get action with exposure_id', () => {
    const result = manageExposuresTool.inputSchema.safeParse({
      action: 'get',
      exposure_id: 'exp-123'
    })
    expect(result.success).toBe(true)
  })

  it('should reject get action without exposure_id', () => {
    const result = manageExposuresTool.inputSchema.safeParse({
      action: 'get'
    })
    expect(result.success).toBe(false)
  })

  it('should not accept create/update/delete actions', () => {
    const result = manageExposuresTool.inputSchema.safeParse({
      action: 'create'
    })
    expect(result.success).toBe(false)
  })
})
