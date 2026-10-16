import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const { mockGetCountermeasure, mockUpdateCountermeasure, mockDeleteCountermeasure } = vi.hoisted(() => ({
  mockGetCountermeasure: vi.fn(),
  mockUpdateCountermeasure: vi.fn(),
  mockDeleteCountermeasure: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtCountermeasure: class MockDtCountermeasure {
      constructor(_apolloClient: unknown) {}
      getCountermeasure = mockGetCountermeasure
      updateCountermeasure = mockUpdateCountermeasure
      deleteCountermeasure = mockDeleteCountermeasure
    },
  }
})

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

describe('ManageCountermeasuresTool.execute — update merge-defaults', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  const currentCountermeasure = {
    id: 'cm-1',
    name: 'TLS Encryption',
    description: 'Encrypt data in transit',
    type: 'preventive',
    category: 'encryption',
    score: 80,
    references: 'https://example.com',
    addressedExposures: ['exp-1', 'exp-2'],
    tags: [],
    defendedTechniques: [{ id: 'D3-AL' }],
    mitigations: [{ id: 'M1036' }],
    createdBy: 'USER',
  }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockUpdateCountermeasure.mockReset()
  })

  it('preserves type, score, and link lists on a description-only update', async () => {
    mockGetCountermeasure.mockResolvedValueOnce(currentCountermeasure)
    mockUpdateCountermeasure.mockResolvedValueOnce({ ...currentCountermeasure, description: 'Updated' })

    const result = await manageCountermeasuresTool.execute(
      { action: 'update', countermeasure_id: 'cm-1', description: 'Updated' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateCountermeasure).toHaveBeenCalledWith({
      countermeasureId: 'cm-1',
      countermeasure: expect.objectContaining({
        name: 'TLS Encryption',
        description: 'Updated',
        type: 'preventive',
        category: 'encryption',
        score: 80,
        references: 'https://example.com',
        addressedExposures: ['exp-1', 'exp-2'],
        defendedTechniques: [{ id: 'D3-AL' }],
        mitigations: [{ id: 'M1036' }],
      }),
    })
  })

  it('provided lists REPLACE the stored ones', async () => {
    mockGetCountermeasure.mockResolvedValueOnce(currentCountermeasure)
    mockUpdateCountermeasure.mockResolvedValueOnce(currentCountermeasure)

    await manageCountermeasuresTool.execute(
      {
        action: 'update',
        countermeasure_id: 'cm-1',
        exposure_ids: ['exp-9'],
        defend_technique_ids: ['D3-NTA'],
      } as never,
      context,
    )

    expect(mockUpdateCountermeasure).toHaveBeenCalledWith({
      countermeasureId: 'cm-1',
      countermeasure: expect.objectContaining({
        addressedExposures: ['exp-9'],
        defendedTechniques: [{ id: 'D3-NTA' }],
        mitigations: [{ id: 'M1036' }],
      }),
    })
  })

  it('fails without calling update when the countermeasure does not exist', async () => {
    mockGetCountermeasure.mockResolvedValueOnce(null)

    const result = await manageCountermeasuresTool.execute(
      { action: 'update', countermeasure_id: 'cm-missing', description: 'x' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(mockUpdateCountermeasure).not.toHaveBeenCalled()
  })
})

describe('ManageCountermeasuresTool.execute — a SYSTEM countermeasure is not updated', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }
  const systemCountermeasure = {
    id: 'cm-sys',
    name: 'Inventory',
    description: 'From the class policy',
    type: 'preventive',
    category: 'governance',
    score: 50,
    references: '',
    addressedExposures: [],
    tags: [],
    defendedTechniques: [],
    mitigations: [{ id: 'M1030' }],
    createdBy: 'SYSTEM',
  }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockUpdateCountermeasure.mockReset()
  })

  // Link edits, the exposure list and the plain fields alike: the next save of the control would undo each.
  const edits: Array<[string, Record<string, unknown>]> = [
    ['mitigations', { mitigations: [{ id: 'M1032' }] }],
    ['defend_technique_ids', { defend_technique_ids: ['D3-MFA'] }],
    ['exposure_ids', { exposure_ids: ['exp-1'] }],
    ['description', { description: 'Edited' }],
    ['score', { score: 90 }],
  ]

  for (const [field, edit] of edits) {
    it(`refuses an update of ${field}, and names supersede into a USER copy`, async () => {
      mockGetCountermeasure.mockResolvedValueOnce(systemCountermeasure)

      const result = await manageCountermeasuresTool.execute(
        { action: 'update', countermeasure_id: 'cm-sys', ...edit } as never,
        context,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('"Inventory" (cm-sys)')
      expect(result.error).toContain('createdBy SYSTEM')
      expect(result.error).toContain('supersede it into a USER copy')
      expect(result.error).toContain('"Customize as an editable copy"')
      expect(mockUpdateCountermeasure).not.toHaveBeenCalled()
    })
  }

  it('treats a countermeasure with no createdBy (legacy) as SYSTEM', async () => {
    const { createdBy: _omit, ...legacy } = systemCountermeasure
    mockGetCountermeasure.mockResolvedValueOnce(legacy)

    const result = await manageCountermeasuresTool.execute(
      { action: 'update', countermeasure_id: 'cm-sys', description: 'Edited' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(mockUpdateCountermeasure).not.toHaveBeenCalled()
  })

  it('still updates a USER countermeasure', async () => {
    mockGetCountermeasure.mockResolvedValueOnce({ ...systemCountermeasure, createdBy: 'USER' })
    mockUpdateCountermeasure.mockResolvedValueOnce({ ...systemCountermeasure, createdBy: 'USER' })

    const result = await manageCountermeasuresTool.execute(
      { action: 'update', countermeasure_id: 'cm-sys', description: 'Edited' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateCountermeasure).toHaveBeenCalledTimes(1)
  })

  it('says so in the tool description', () => {
    expect(manageCountermeasuresTool.description).toContain('Update and delete apply only to USER countermeasures')
  })
})

describe('ManageCountermeasuresTool — delete reports the outcome it actually got', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockDeleteCountermeasure.mockReset()
  })

  it('refuses to report success when the delete comes back false', () => {
    // The controls tool already refuses this; the countermeasures tool returned
    // `success: true, deleted: false` — an outcome the caller reads as done.
    mockGetCountermeasure.mockResolvedValue({ id: 'cm-1', name: 'TLS 1.3', createdBy: 'USER' })
    mockDeleteCountermeasure.mockResolvedValue(false)

    return manageCountermeasuresTool
      .run({ action: 'delete', countermeasure_id: 'cm-1' }, context)
      .then((res) => {
        expect(res.success).toBe(false)
        expect(res.error).toMatch(/not confirmed/i)
        expect((res.data as { deleted: boolean }).deleted).toBe(false)
      })
  })

  it('reports success and forwards the pre-delete name when the delete works', async () => {
    // The name drives dt-core's supersede companion; it must be the pre-delete
    // value, which is exactly what the existence check holds.
    mockGetCountermeasure.mockResolvedValue({ id: 'cm-1', name: 'TLS 1.3', createdBy: 'USER' })
    mockDeleteCountermeasure.mockResolvedValue(true)

    const res = await manageCountermeasuresTool.run(
      { action: 'delete', countermeasure_id: 'cm-1' }, context)

    expect(res.success).toBe(true)
    expect(mockDeleteCountermeasure).toHaveBeenCalledWith({
      countermeasureId: 'cm-1',
      countermeasureName: 'TLS 1.3',
    })
  })

  it('does not attempt the delete when the countermeasure is not there', async () => {
    mockGetCountermeasure.mockResolvedValue(null)

    const res = await manageCountermeasuresTool.run(
      { action: 'delete', countermeasure_id: 'cm-gone' }, context)

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
    expect(mockDeleteCountermeasure).not.toHaveBeenCalled()
  })
})

describe('ManageCountermeasuresTool — a SYSTEM countermeasure is not deleted', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockDeleteCountermeasure.mockReset()
  })

  it('refuses the delete, and names the attribute answers and the USER copy', async () => {
    mockGetCountermeasure.mockResolvedValue({ id: 'cm-sys', name: 'Inventory', createdBy: 'SYSTEM' })

    const res = await manageCountermeasuresTool.run(
      { action: 'delete', countermeasure_id: 'cm-sys' }, context)

    expect(res.success).toBe(false)
    expect(res.error).toContain('"Inventory" (cm-sys)')
    expect(res.error).toContain('createdBy SYSTEM')
    expect(res.error).toContain('re-creates it')
    expect(res.error).toContain('attribute answers')
    expect(res.error).toContain('"Customize as an editable copy"')
    expect(mockDeleteCountermeasure).not.toHaveBeenCalled()
  })

  it('treats a countermeasure with no createdBy (legacy) as SYSTEM', async () => {
    mockGetCountermeasure.mockResolvedValue({ id: 'cm-old', name: 'Legacy' })

    const res = await manageCountermeasuresTool.run(
      { action: 'delete', countermeasure_id: 'cm-old' }, context)

    expect(res.success).toBe(false)
    expect(mockDeleteCountermeasure).not.toHaveBeenCalled()
  })
})
