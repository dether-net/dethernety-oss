import { describe, it, expect } from 'vitest'
import { manageControlsTool } from '../manage-controls.tool.js'

describe('ManageControlsTool', () => {
  it('should have the correct tool name', () => {
    expect(manageControlsTool.name).toBe('manage_controls')
  })

  it('should require a client', () => {
    expect(manageControlsTool.requiresClient).toBe(true)
  })

  it('should accept list action without parameters', () => {
    const result = manageControlsTool.inputSchema.safeParse({ action: 'list' })
    expect(result.success).toBe(true)
  })

  it('should accept list action with folder_id and class_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'list',
      folder_id: 'folder-1',
      class_ids: ['class-1', 'class-2']
    })
    expect(result.success).toBe(true)
  })

  it('should reject get action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({ action: 'get' })
    expect(result.success).toBe(false)
  })

  it('should accept create action with name', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      name: 'WAF',
      description: 'Web Application Firewall'
    })
    expect(result.success).toBe(true)
  })

  it('should reject create action without name', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      description: 'Missing name'
    })
    expect(result.success).toBe(false)
  })

  it('should reject delete action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({ action: 'delete' })
    expect(result.success).toBe(false)
  })

  // Sprint 5: assign action
  it('should accept assign action with control_id and element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
      element_ids: ['elem-1', 'elem-2'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject assign action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      element_ids: ['elem-1'],
    })
    expect(result.success).toBe(false)
  })

  it('should reject assign action without element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
    })
    expect(result.success).toBe(false)
  })

  it('should reject assign action with empty element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
      element_ids: [],
    })
    expect(result.success).toBe(false)
  })

  // Sprint 5: advanced list filters
  it('should accept list action with name filter', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'list',
      name: 'firewall',
    })
    expect(result.success).toBe(true)
  })

  it('should accept list action with element_ids filter', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'list',
      element_ids: ['elem-1', 'elem-2'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept list action with module_name filter', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'list',
      module_name: 'dethernety-module',
    })
    expect(result.success).toBe(true)
  })

  it('should accept list action with combined filters', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'list',
      name: 'encryption',
      class_type: 'network',
      module_id: 'mod-1',
    })
    expect(result.success).toBe(true)
  })
})
