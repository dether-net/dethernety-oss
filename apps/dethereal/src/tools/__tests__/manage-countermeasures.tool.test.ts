import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import type { ToolContext } from '../base-tool.js'

const { mockGetCountermeasure, mockUpdateCountermeasure, mockDeleteCountermeasure, mockCreateCountermeasure } = vi.hoisted(() => ({
  mockGetCountermeasure: vi.fn(),
  mockUpdateCountermeasure: vi.fn(),
  mockDeleteCountermeasure: vi.fn(),
  mockCreateCountermeasure: vi.fn(),
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
      createCountermeasure = mockCreateCountermeasure
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

  it('refuses the read actions: listing and reading countermeasures is query_countermeasures\'', () => {
    expect(manageCountermeasuresTool.inputSchema.safeParse({ action: 'list', control_id: 'ctrl-123' }).success).toBe(false)
    expect(manageCountermeasuresTool.inputSchema.safeParse({ action: 'get', countermeasure_id: 'cm-1' }).success).toBe(false)
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
      defend_technique_ids: ['def-node-al'],
      mitigations: [{ id: 'mit-node-1036' }],
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
    defendedTechniques: [{ id: 'def-node-al' }],
    mitigations: [{ id: 'mit-node-1036' }],
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
        defendedTechniques: [{ id: 'def-node-al' }],
        mitigations: [{ id: 'mit-node-1036' }],
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
        defend_technique_ids: ['def-node-nta'],
      } as never,
      context,
    )

    expect(mockUpdateCountermeasure).toHaveBeenCalledWith({
      countermeasureId: 'cm-1',
      countermeasure: expect.objectContaining({
        addressedExposures: ['exp-9'],
        defendedTechniques: [{ id: 'def-node-nta' }],
        mitigations: [{ id: 'mit-node-1036' }],
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
    mitigations: [{ id: 'mit-node-1030' }],
    createdBy: 'SYSTEM',
  }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockUpdateCountermeasure.mockReset()
  })

  // Link edits, the exposure list and the plain fields alike: the next save of the control would undo each.
  const edits: Array<[string, Record<string, unknown>]> = [
    ['mitigations', { mitigations: [{ id: 'mit-node-1032' }] }],
    ['defend_technique_ids', { defend_technique_ids: ['def-node-mfa'] }],
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

describe('ManageCountermeasuresTool — links take node ids, never MITRE codes', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  beforeEach(() => {
    mockGetCountermeasure.mockReset()
    mockUpdateCountermeasure.mockReset()
    mockCreateCountermeasure.mockReset()
  })

  it('says in both link fields that they take node ids, and how to find one', () => {
    const props = (z.toJSONSchema(manageCountermeasuresTool.inputSchema, { target: 'draft-07' }) as { properties: Record<string, { description?: string }> }).properties
    for (const [field, lookup, code] of [['mitigations', 'search_mitre_attack', 'M1032'], ['defend_technique_ids', 'get_mitre_defend', 'D3-MFA']] as const) {
      const text = props[field]!.description as string
      expect(text).toContain("node id")
      expect(text).toContain(lookup)
      expect(text).toContain(code)
    }
  })

  it.each([
    ['an ATT&CK mitigation code', { mitigations: [{ id: 'M1032' }] }, 'M1032'],
    ['a D3FEND code', { defend_technique_ids: ['D3-MFA'] }, 'D3-MFA'],
    ['an ATT&CK technique code', { defend_technique_ids: ['T1078.004'] }, 'T1078.004'],
    ['a code in lower case', { mitigations: [{ id: 'm1032' }] }, 'm1032'],
  ])('refuses %s on create, before anything is read or written', async (_what, links, code) => {
    const result = await manageCountermeasuresTool.execute({ action: 'create', control_id: 'ctrl-1', name: 'MFA', ...links } as never, context)
    expect(result.success).toBe(false)
    expect(result.data).toEqual({ code: 'mitre_code_not_node_id', codes: [code] })
    expect(result.error).toContain('search_mitre_attack')
    expect(result.error).toContain('get_mitre_defend')
    expect(result.error).toContain('Nothing was written')
    expect(mockCreateCountermeasure).not.toHaveBeenCalled()
  })

  it('refuses a code on update before reading the countermeasure', async () => {
    const result = await manageCountermeasuresTool.execute({ action: 'update', countermeasure_id: 'cm-1', defend_technique_ids: ['def-node-1', 'D3-NTA'] } as never, context)
    expect(result.success).toBe(false)
    expect((result.data as any).codes).toEqual(['D3-NTA'])
    expect(mockGetCountermeasure).not.toHaveBeenCalled()
    expect(mockUpdateCountermeasure).not.toHaveBeenCalled()
  })

  it('links node ids and reports success when every requested link is held', async () => {
    mockCreateCountermeasure.mockResolvedValueOnce({ id: 'cm-9', name: 'MFA', mitigations: [{ id: 'mit-node-1032' }], defendedTechniques: [{ id: 'def-node-mfa' }] })
    const result = await manageCountermeasuresTool.execute({ action: 'create', control_id: 'ctrl-1', name: 'MFA', mitigations: [{ id: 'mit-node-1032' }], defend_technique_ids: ['def-node-mfa'] } as never, context)
    expect(result.success).toBe(true)
    expect(mockCreateCountermeasure).toHaveBeenCalledWith(expect.objectContaining({
      countermeasure: expect.objectContaining({ mitigations: [{ id: 'mit-node-1032' }], defendedTechniques: [{ id: 'def-node-mfa' }] }),
    }))
  })

  it('reports ids that linked nothing on create, with success false and the created countermeasure', async () => {
    mockCreateCountermeasure.mockResolvedValueOnce({ id: 'cm-9', name: 'MFA', mitigations: [], defendedTechniques: [{ id: 'def-node-mfa' }] })
    const result = await manageCountermeasuresTool.execute({ action: 'create', control_id: 'ctrl-1', name: 'MFA', mitigations: [{ id: 'not-a-node' }], defend_technique_ids: ['def-node-mfa'] } as never, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('cm-9')
    expect(result.error).toContain('not-a-node')
    expect((result.data as any).not_linked).toEqual({ mitigations: ['not-a-node'], defend_technique_ids: [] })
    expect((result.data as any).countermeasure.id).toBe('cm-9')
  })

  it('checks only the lists an update gave, not the links it preserved', async () => {
    const current = { id: 'cm-1', name: 'TLS', createdBy: 'USER', mitigations: [{ id: 'mit-node-1' }], defendedTechniques: [{ id: 'def-node-1' }] }
    mockGetCountermeasure.mockResolvedValueOnce(current)
    // The platform answers without the preserved mitigation: not this call's to report.
    mockUpdateCountermeasure.mockResolvedValueOnce({ ...current, mitigations: [], defendedTechniques: [{ id: 'def-node-2' }] })
    const ok = await manageCountermeasuresTool.execute({ action: 'update', countermeasure_id: 'cm-1', defend_technique_ids: ['def-node-2'] } as never, context)
    expect(ok.success).toBe(true)

    mockGetCountermeasure.mockResolvedValueOnce(current)
    mockUpdateCountermeasure.mockResolvedValueOnce({ ...current, defendedTechniques: [] })
    const missing = await manageCountermeasuresTool.execute({ action: 'update', countermeasure_id: 'cm-1', defend_technique_ids: ['def-node-gone'] } as never, context)
    expect(missing.success).toBe(false)
    expect((missing.data as any).not_linked).toEqual({ mitigations: [], defend_technique_ids: ['def-node-gone'] })
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
