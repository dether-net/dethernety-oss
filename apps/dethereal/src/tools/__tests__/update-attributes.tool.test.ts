import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { updateAttributesTool } from '../update-attributes.tool.js'
import type { ToolContext } from '../base-tool.js'

// =============================================================================
// Mock dt-core — intercept the push so we can inspect the exact payload sent.
// =============================================================================

const { mockUpdateAttributesOnly } = vi.hoisted(() => ({ mockUpdateAttributesOnly: vi.fn() }))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtUpdateSplit: class MockDtUpdateSplit {
      constructor(_apolloClient: any) {}
      updateAttributesOnly = mockUpdateAttributesOnly
    },
  }
})

const contextWithClient: ToolContext = { debug: false, apolloClient: {} as any }

const okResult = (updated = 1) => ({
  success: true,
  errors: [],
  warnings: [],
  stats: {
    boundaries: { updated: 0, failed: 0 },
    components: { updated, failed: 0 },
    dataFlows: { updated: 0, failed: 0 },
    dataItems: { updated: 0, failed: 0 },
    total: { updated, failed: 0 },
  },
})

describe('updateAttributesTool — unresolved values are withheld, not pushed', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-updattrs-'))
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      schemaVersion: '2.0.0', format: 'split',
      model: { id: 'M1', name: 'T', defaultBoundaryId: 'root' }, modules: [],
    }), 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify({
      defaultBoundary: { id: 'root', name: 'root', components: [], boundaries: [] },
    }), 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }), 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems: [] }), 'utf-8')
    mockUpdateAttributesOnly.mockReset()
    mockUpdateAttributesOnly.mockResolvedValue(okResult())
  })

  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }) })

  const writeComponentAttrs = async (id: string, attributes: Record<string, unknown>) => {
    const dir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({
      elementId: id, elementType: 'component', elementName: 'DB',
      classData: { id: 'class-db', name: 'Database' }, attributes,
    }), 'utf-8')
  }

  it('does not send null-valued attributes to the platform', async () => {
    // A null means "template field, not yet resolved". The platform write is a
    // Cypher property merge, so pushing a null cannot record "unknown" — it can
    // only erase a value the platform already holds.
    await writeComponentAttrs('c-db', {
      ssl_enabled: true,
      backup_enabled: false,      // an explicit false IS a finding and must be sent
      log_retention_days: null,   // unresolved
      kms_key_arn: null,          // unresolved
    })

    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)
    expect(res.success).toBe(true)

    const payload = mockUpdateAttributesOnly.mock.calls[0]![1]
    expect(payload.components['c-db'].attributes).toEqual({ ssl_enabled: true, backup_enabled: false })
    expect(Object.keys(payload.components['c-db'].attributes)).not.toContain('log_retention_days')

    expect(res.data!.attributes).toEqual({ sent: 2, withheld_unresolved: 2, elements_without_class: 0 })
  })

  it('warns the operator that element counts say nothing about withheld values', async () => {
    await writeComponentAttrs('c-db', { a: null, b: null, c: null })
    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)

    // The old output would report updated:1 / failed:0 and nothing else — the
    // element "succeeded" while carrying no resolved value at all.
    expect(res.data!.stats.total).toEqual({ updated: 1, failed: 0 })
    expect(res.data!.attributes.sent).toBe(0)
    expect(res.data!.attributes.withheld_unresolved).toBe(3)
    expect(res.data!.warnings.some(w => w.includes('3 attribute value(s) are still unresolved'))).toBe(true)
  })

  it('emits no unresolved warning when everything is resolved', async () => {
    await writeComponentAttrs('c-db', { ssl_enabled: true })
    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)
    expect(res.data!.attributes.withheld_unresolved).toBe(0)
    expect(res.data!.warnings.some(w => w.includes('unresolved'))).toBe(false)
  })

  it('surfaces dt-core per-element errors instead of discarding them', async () => {
    await writeComponentAttrs('c-db', { ssl_enabled: true })
    mockUpdateAttributesOnly.mockResolvedValue({
      ...okResult(0),
      success: false,
      errors: [{ step: 'update_components_attributes', elementId: 'c-db', elementName: 'DB', error: 'Failed to set attributes' }],
    })

    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)
    expect(res.data!.errors).toHaveLength(1)
    expect(res.data!.errors[0]!).toMatchObject({ elementId: 'c-db', error: 'Failed to set attributes' })
  })

  it('pushes flat-format attribute files instead of silently skipping them', async () => {
    // Flat is the format the plugin's own agent guidelines tell agents to author.
    // readAttributes can only resolve it to an element when given the structure
    // context; without it the file is skipped with a console.warn that reaches
    // nobody, and update_attributes reports success having pushed nothing.
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify({
      defaultBoundary: {
        id: 'root', name: 'root', boundaries: [],
        components: [{ id: 'c-db', name: 'DB', classData: { id: 'class-db', name: 'Database' } }],
      },
    }), 'utf-8')

    const dir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'c-db.json'), JSON.stringify({
      componentId: 'c-db', name: 'DB', ssl_enabled: true, log_retention_days: null,
    }), 'utf-8')

    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)
    expect(res.success).toBe(true)
    expect(mockUpdateAttributesOnly).toHaveBeenCalled()

    const payload = mockUpdateAttributesOnly.mock.calls[0]![1]
    expect(payload.components['c-db']).toBeDefined()
    expect(payload.components['c-db'].attributes.ssl_enabled).toBe(true)
    expect(res.data!.attributes.sent).toBeGreaterThan(0)
  })

  it('counts elements with no class binding — dt-core reports those as updated', async () => {
    const dir = path.join(tmpDir, 'attributes', 'components')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'c-noclass.json'), JSON.stringify({
      elementId: 'c-noclass', elementType: 'component', elementName: 'Unclassified',
      attributes: { ssl_enabled: true },
    }), 'utf-8')

    const res = await updateAttributesTool.run({ model_id: 'M1', directory_path: tmpDir }, contextWithClient)
    expect(res.data!.attributes.elements_without_class).toBe(1)
  })
})
