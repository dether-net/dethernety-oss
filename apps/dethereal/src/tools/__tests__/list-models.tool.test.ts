import { describe, it, expect } from 'vitest'
import { listModelsTool } from '../list-models.tool.js'

describe('ListModelsTool', () => {
  it('should have the correct tool name', () => {
    expect(listModelsTool.name).toBe('list_models')
  })

  it('should require a client', () => {
    expect(listModelsTool.requiresClient).toBe(true)
  })

  it('should accept empty input', () => {
    const result = listModelsTool.inputSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should accept folder_id and name filters', () => {
    const result = listModelsTool.inputSchema.safeParse({
      folder_id: 'folder-123',
      name: 'test'
    })
    expect(result.success).toBe(true)
  })
})
