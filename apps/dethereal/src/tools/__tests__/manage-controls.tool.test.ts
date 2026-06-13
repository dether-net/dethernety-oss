import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const {
  mockGetControl,
  mockUpdateControl,
  mockCreateControl,
  mockGetClassById,
  mockGetControlClasses,
} = vi.hoisted(() => ({
  mockGetControl: vi.fn(),
  mockUpdateControl: vi.fn(),
  mockCreateControl: vi.fn(),
  mockGetClassById: vi.fn(),
  mockGetControlClasses: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtControl: class MockDtControl {
      constructor(_apolloClient: unknown) {}
      getControl = mockGetControl
      updateControl = mockUpdateControl
      createControl = mockCreateControl
    },
    DtClass: class MockDtClass {
      constructor(_apolloClient: unknown) {}
      getClassById = mockGetClassById
      getControlClasses = mockGetControlClasses
    },
  }
})

// Default: every class id resolves to a CONTROL class (so existing
// merge-defaults tests that pass class_ids pass the new kind validation).
// Kind-specific tests override mockGetClassById per case.
const asControlClass = ({ classType }: { classType: string }) =>
  classType === 'control'
    ? { id: 'ctrl-class', name: 'Network Access Control', module: { id: 'mod-1', name: 'dethernety-general' } }
    : undefined

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
    mockGetClassById.mockReset()
    mockGetControlClasses.mockReset()
    // Existing merge-defaults tests that pass class_ids must clear the new
    // kind validation: treat any provided id as a valid CONTROL class.
    mockGetClassById.mockImplementation(asControlClass)
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

describe('ManageControlsTool.execute — CONTROL class-kind validation', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  // A ComponentClass id (the dogfood G1 case): getClassById('control') misses,
  // the 'component' probe hits, getControlClasses supplies same-module
  // suggestions.
  const componentClass = {
    id: 'comp-class',
    name: 'NetworkPolicy',
    module: { id: 'mod-k8s', name: 'kubernetes-core' },
  }
  const wrongKindLookup = ({ classType }: { classType: string }) =>
    classType === 'component' ? componentClass : undefined

  beforeEach(() => {
    mockGetControl.mockReset()
    mockUpdateControl.mockReset()
    mockCreateControl.mockReset()
    mockGetClassById.mockReset()
    mockGetControlClasses.mockReset()
  })

  it('rejects create with a ComponentClass id before calling createControl', async () => {
    mockGetClassById.mockImplementation(wrongKindLookup)
    mockGetControlClasses.mockResolvedValueOnce([
      { controlClasses: [{ id: 'nac-1', name: 'Network Access Control' }] },
    ])

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'web-netpol', class_ids: ['comp-class'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('NetworkPolicy')
    expect(result.error).toContain('COMPONENT class')
    expect(result.error).toContain('kubernetes-core')
    expect(result.error).toContain('Network Access Control (nac-1)')
    expect(mockCreateControl).not.toHaveBeenCalled()
  })

  it('proceeds with create when every class id is a CONTROL class', async () => {
    mockGetClassById.mockImplementation(asControlClass)
    mockCreateControl.mockResolvedValueOnce({ id: 'new-ctrl', name: 'web-netpol' })

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'web-netpol', class_ids: ['ctrl-class'] } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockCreateControl).toHaveBeenCalled()
  })

  it('does not look up class kinds when create omits class_ids', async () => {
    mockCreateControl.mockResolvedValueOnce({ id: 'new-ctrl', name: 'web-netpol' })

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'web-netpol' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockGetClassById).not.toHaveBeenCalled()
    expect(mockCreateControl).toHaveBeenCalled()
  })

  it('rejects update with a ComponentClass id before fetching/updating the control', async () => {
    mockGetClassById.mockImplementation(wrongKindLookup)
    mockGetControlClasses.mockResolvedValueOnce([])

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', class_ids: ['comp-class'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('NetworkPolicy')
    expect(mockGetControl).not.toHaveBeenCalled()
    expect(mockUpdateControl).not.toHaveBeenCalled()
  })

  it('does not validate kinds when update omits class_ids', async () => {
    mockGetControl.mockResolvedValueOnce({ id: 'ctrl-1', name: 'X', controlClasses: [] })
    mockUpdateControl.mockResolvedValueOnce({ control: { id: 'ctrl-1' }, residualOk: true })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'desc' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockGetClassById).not.toHaveBeenCalled()
  })

  it('reports an unknown class id with verification guidance', async () => {
    // getClassById misses every kind.
    mockGetClassById.mockResolvedValue(undefined)

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'x', class_ids: ['ghost'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('does not resolve to any class')
    expect(mockCreateControl).not.toHaveBeenCalled()
  })
})
