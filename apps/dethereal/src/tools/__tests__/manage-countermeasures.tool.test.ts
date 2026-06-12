import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

const { mockGetCountermeasure, mockUpdateCountermeasure } = vi.hoisted(() => ({
  mockGetCountermeasure: vi.fn(),
  mockUpdateCountermeasure: vi.fn(),
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtCountermeasure: class MockDtCountermeasure {
      constructor(_apolloClient: unknown) {}
      getCountermeasure = mockGetCountermeasure
      updateCountermeasure = mockUpdateCountermeasure
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
