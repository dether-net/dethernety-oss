import { describe, it, expect } from 'vitest'
import { getControlGapsTool } from '../get-control-gaps.tool.js'

describe('GetControlGapsTool', () => {
  it('should have the correct tool name', () => {
    expect(getControlGapsTool.name).toBe('get_control_gaps')
  })

  it('should require a client', () => {
    expect(getControlGapsTool.requiresClient).toBe(true)
  })

  it('should accept valid input with model_id', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
    })
    expect(result.success).toBe(true)
  })

  it('should reject missing model_id', () => {
    const result = getControlGapsTool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should default top_n to 3 and limit to 50', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.top_n).toBe(3)
      expect(result.data.limit).toBe(50)
    }
  })

  it('should accept custom top_n and limit', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
      top_n: 10,
      limit: 100,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.top_n).toBe(10)
      expect(result.data.limit).toBe(100)
    }
  })

  it('should reject top_n > 20', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
      top_n: 25,
    })
    expect(result.success).toBe(false)
  })

  it('should reject limit > 200', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
      limit: 300,
    })
    expect(result.success).toBe(false)
  })

  it('should reject top_n < 1', () => {
    const result = getControlGapsTool.inputSchema.safeParse({
      model_id: 'model-123',
      top_n: 0,
    })
    expect(result.success).toBe(false)
  })
})
