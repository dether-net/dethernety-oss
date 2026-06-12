import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const { mockGetControl, mockUpdateControl } = vi.hoisted(() => ({
  mockGetControl: vi.fn(),
  mockUpdateControl: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtControl: class MockDtControl {
      constructor(_apolloClient: unknown) {}
      getControl = mockGetControl
      updateControl = mockUpdateControl
    },
  }
})

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

  // Assign action
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

  // Advanced list filters
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

  // Multi-class bindings — a Control may bind several ControlClasses
  it('should accept create action with multiple class_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      name: 'DB Encryption',
      class_ids: ['class-a', 'class-b'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept update action with multiple class_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'update',
      control_id: 'ctrl-1',
      class_ids: ['class-a', 'class-b'],
    })
    expect(result.success).toBe(true)
  })
})

describe('ManageControlsTool.execute — update merge-defaults', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  const currentControl = {
    id: 'ctrl-1',
    name: 'DB Encryption',
    description: 'Encryption at rest for payment-db',
    folder: { id: 'folder-9' },
    controlClasses: [{ id: 'class-a' }, { id: 'class-b' }],
  }

  beforeEach(() => {
    mockGetControl.mockReset()
    mockUpdateControl.mockReset()
  })

  it('preserves name, class bindings, and folder on a description-only update', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: { ...currentControl, description: 'Updated' },
      bindingResult: null,
      residualOk: true,
    })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'Updated' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateControl).toHaveBeenCalledWith({
      controlId: 'ctrl-1',
      name: 'DB Encryption',
      description: 'Updated',
      controlClasses: ['class-a', 'class-b'],
      folderId: 'folder-9',
    })
  })

  it('passes explicitly provided values through unchanged', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: { ...currentControl, name: 'Renamed' },
      bindingResult: null,
      residualOk: true,
    })

    const result = await manageControlsTool.execute(
      {
        action: 'update',
        control_id: 'ctrl-1',
        name: 'Renamed',
        description: 'New desc',
        class_ids: ['class-c'],
        folder_id: 'folder-2',
      } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateControl).toHaveBeenCalledWith({
      controlId: 'ctrl-1',
      name: 'Renamed',
      description: 'New desc',
      controlClasses: ['class-c'],
      folderId: 'folder-2',
    })
  })

  it('fails without calling updateControl when the control does not exist', async () => {
    mockGetControl.mockResolvedValueOnce(null)

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-missing', description: 'x' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(mockUpdateControl).not.toHaveBeenCalled()
  })

  it('reports failure when updateControl returns control: null / residualOk: false', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: null,
      bindingResult: null,
      residualOk: false,
    })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'x' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to update control')
  })
})
