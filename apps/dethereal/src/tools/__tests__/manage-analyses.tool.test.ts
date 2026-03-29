import { describe, it, expect } from 'vitest'
import { manageAnalysesTool } from '../manage-analyses.tool.js'

describe('ManageAnalysesTool', () => {
  it('should have the correct tool name', () => {
    expect(manageAnalysesTool.name).toBe('manage_analyses')
  })

  it('should require a client', () => {
    expect(manageAnalysesTool.requiresClient).toBe(true)
  })

  it('should accept list_classes action without parameters', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({ action: 'list_classes' })
    expect(result.success).toBe(true)
  })

  it('should accept list action with element_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'list',
      element_id: 'model-123'
    })
    expect(result.success).toBe(true)
  })

  it('should reject list action without element_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({ action: 'list' })
    expect(result.success).toBe(false)
  })

  it('should accept create with all required fields', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'create',
      element_id: 'model-123',
      name: 'Test Analysis',
      analysis_class_id: 'class-456'
    })
    expect(result.success).toBe(true)
  })

  it('should reject create without element_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'create',
      name: 'Test',
      analysis_class_id: 'class-456'
    })
    expect(result.success).toBe(false)
  })

  it('should reject create without analysis_class_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'create',
      element_id: 'model-123',
      name: 'Test'
    })
    expect(result.success).toBe(false)
  })

  it('should accept run with analysis_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'run',
      analysis_id: 'analysis-789'
    })
    expect(result.success).toBe(true)
  })

  it('should reject run without analysis_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({ action: 'run' })
    expect(result.success).toBe(false)
  })

  it('should accept status with analysis_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'status',
      analysis_id: 'analysis-789'
    })
    expect(result.success).toBe(true)
  })

  it('should accept results with analysis_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'results',
      analysis_id: 'analysis-789'
    })
    expect(result.success).toBe(true)
  })

  it('should accept delete with analysis_id', () => {
    const result = manageAnalysesTool.inputSchema.safeParse({
      action: 'delete',
      analysis_id: 'analysis-789'
    })
    expect(result.success).toBe(true)
  })
})
