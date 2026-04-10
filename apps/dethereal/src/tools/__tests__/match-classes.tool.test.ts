import { describe, it, expect } from 'vitest'
import { matchClassesTool } from '../match-classes.tool.js'

describe('MatchClassesTool', () => {
  it('should have the correct tool name', () => {
    expect(matchClassesTool.name).toBe('match_classes')
  })

  it('should require a client', () => {
    expect(matchClassesTool.requiresClient).toBe(true)
  })

  it('should accept valid input with required fields', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'Web Application Firewall' }],
      classLabel: 'CONTROL',
    })
    expect(result.success).toBe(true)
  })

  it('should accept elements with optional type and description', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'API Gateway', type: 'PROCESS', description: 'REST API entry point' }],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty elements array', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(false)
  })

  it('should reject elements array exceeding max 100', () => {
    const elements = Array.from({ length: 101 }, (_, i) => ({ name: `Element ${i}` }))
    const result = matchClassesTool.inputSchema.safeParse({
      elements,
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(false)
  })

  it('should accept optional componentType for COMPONENT classLabel', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
    })
    expect(result.success).toBe(true)
  })

  it('should accept all valid classLabel values', () => {
    for (const label of ['COMPONENT', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL']) {
      const result = matchClassesTool.inputSchema.safeParse({
        elements: [{ name: 'Test' }],
        classLabel: label,
      })
      expect(result.success).toBe(true)
    }
  })

  it('should reject invalid classLabel', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'Test' }],
      classLabel: 'INVALID',
    })
    expect(result.success).toBe(false)
  })

  it('should default topN to 3', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.topN).toBe(3)
    }
  })

  it('should reject topN > 10', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      topN: 15,
    })
    expect(result.success).toBe(false)
  })

  it('should accept optional moduleIds', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      moduleIds: ['mod-1', 'mod-2'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept optional fields filter', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      fields: ['description', 'category'],
    })
    expect(result.success).toBe(true)
  })
})
