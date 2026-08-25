import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { validateModelTool } from '../validate-model.tool.js'
import type { ToolContext } from '../base-tool.js'

const context: ToolContext = { debug: false }

describe('Quality Score', () => {
  let tmpDir: string

  beforeEach(async () => {
    // Create temp dir inside CWD to satisfy path confinement
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-quality-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeModel(manifest: any, structure: any, dataFlows: any[] = [], dataItems: any[] = []) {
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify(structure, null, 2))
    await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows }, null, 2))
    await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems }, null, 2))
    await fs.mkdir(path.join(tmpDir, 'attributes', 'boundaries'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'components'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'dataFlows'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'dataItems'), { recursive: true })
  }

  it('should return low score for an empty model', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Empty', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    expect(result.success).toBe(true)
    const data = result.data as any
    // Empty model gets some points from boundary_hierarchy_quality conditions
    expect(data.quality_score).toBeLessThan(40)
    expect(data.label).toBe('Starting')
  })

  it('should require directory_path for quality action', async () => {
    const result = await validateModelTool.run({ action: 'quality' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('directory_path')
  })

  it('should compute score between 0 and 100', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Test', defaultBoundaryId: 'b-1' } },
      {
        defaultBoundary: {
          id: 'b-1', name: 'System',
          boundaries: [
            { id: 'b-2', name: 'DMZ', components: [
              { id: 'c-1', name: 'Web Server', classData: { id: 'class-1', name: 'Web Server' } },
              { id: 'c-2', name: 'API Gateway', classData: { id: 'class-2', name: 'API Gateway' } }
            ]},
            { id: 'b-3', name: 'Backend', components: [
              { id: 'c-3', name: 'App Server' }
            ]}
          ]
        }
      },
      [
        { id: 'f-1', name: 'HTTP', source: { id: 'c-1' }, target: { id: 'c-2' } },
        { id: 'f-2', name: 'API', source: { id: 'c-2' }, target: { id: 'c-3' } }
      ]
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.quality_score).toBeGreaterThanOrEqual(0)
    expect(data.quality_score).toBeLessThanOrEqual(100)
    expect(data.element_counts.components).toBe(3)
    expect(data.element_counts.data_flows).toBe(2)
  })

  it('should handle zero denominators without NaN', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'No Components', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    expect(result.success).toBe(true)
    const data = result.data as any
    expect(Number.isNaN(data.quality_score)).toBe(false)
    expect(Number.isFinite(data.quality_score)).toBe(true)

    // All factor values should be finite
    for (const factor of Object.values(data.factors) as any[]) {
      expect(Number.isNaN(factor.value)).toBe(false)
      expect(Number.isFinite(factor.value)).toBe(true)
    }
  })

  it('falls back to file presence — and says so — when no class templates are cached', async () => {
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'DI', defaultBoundaryId: 'b-1' } }
    const structure = {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{ id: 'c-1', name: 'API', classData: { id: 'cls-1', name: 'API' } }]
      }
    }
    const dataItems = [{ id: 'di-1', name: 'PII', classData: { id: 'cls-data', name: 'Personal Data' }, sensitivity: 'confidential' }]
    await writeModel(manifest, structure, [], dataItems)

    // Component enriched, data item NOT — factor must reflect the gap (1/2)
    await fs.writeFile(
      path.join(tmpDir, 'attributes', 'components', 'c-1.json'),
      JSON.stringify({ elementId: 'c-1', elementType: 'component', attributes: { auth: true } })
    )

    let result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    expect(result.success).toBe(true)
    let data = result.data as any
    expect(data.factors.attribute_completion_rate.value).toBeCloseTo(0.5)
    // With no .dethereal/class-cache the tool cannot measure resolved FIELDS, so
    // it degrades to the old file-presence count — but must label the basis, or
    // the number reads as a field measure it is not.
    expect(data.attribute_residual.basis).toBe('file-presence')
    expect(data.factors.attribute_completion_rate.note).toMatch(/No cached class templates/)

    // After the data item is enriched too, the factor reaches 1.0
    await fs.writeFile(
      path.join(tmpDir, 'attributes', 'dataItems', 'di-1.json'),
      JSON.stringify({ elementId: 'di-1', elementType: 'dataItem', attributes: { tls_only_transport: true } })
    )

    result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    expect(result.success).toBe(true)
    data = result.data as any
    expect(data.factors.attribute_completion_rate.value).toBeCloseTo(1.0)
  })

  it('measures resolved template FIELDS, not attribute-file presence', async () => {
    // The regression this pins: the factor used to count Object.keys() on the
    // per-element map, so an element whose every value was null — or whose
    // attributes object was empty — scored identically to a fully enriched one.
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'F', defaultBoundaryId: 'b-1' } }
    const structure = {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{ id: 'c-1', name: 'DB', classData: { id: 'cls-db', name: 'Database' } }],
      },
    }
    await writeModel(manifest, structure, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-db.json'), JSON.stringify({
      classId: 'cls-db', className: 'Database',
      template: { schema: { properties: { ssl_enabled: {}, backups_enabled: {}, audit_log: {}, tls_min: {} } } },
    }))

    // Every field null — the file exists, nothing is answered.
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-1.json'), JSON.stringify({
      elementId: 'c-1', elementType: 'component', elementName: 'DB',
      classData: { id: 'cls-db', name: 'Database' },
      attributes: { ssl_enabled: null, backups_enabled: null, audit_log: null, tls_min: null },
    }))

    let data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    expect(data.factors.attribute_completion_rate.value).toBe(0)   // was 1.0 before the fix
    expect(data.attribute_residual).toMatchObject({ declared: 4, resolved: 0, unresolved: 4, basis: 'template' })
    expect(data.attribute_residual.top_unresolved[0]).toMatchObject({ element: 'DB', class: 'Database', unresolved: 4 })
    expect(data.attribute_residual.top_unresolved[0].fields.sort())
      .toEqual(['audit_log', 'backups_enabled', 'ssl_enabled', 'tls_min'])

    // An explicit `false` is an answer and must count as resolved.
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-1.json'), JSON.stringify({
      elementId: 'c-1', elementType: 'component', elementName: 'DB',
      classData: { id: 'cls-db', name: 'Database' },
      attributes: { ssl_enabled: true, backups_enabled: false, audit_log: null, tls_min: null },
    }))
    data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    expect(data.factors.attribute_completion_rate.value).toBeCloseTo(0.5)
    expect(data.attribute_residual.resolved).toBe(2)
  })

  it('does not score an inherited Object.prototype key as a resolved field', async () => {
    // `f in values` walks the prototype chain, so a template field named
    // `toString` would read as present on every element and inflate the rate.
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'P', defaultBoundaryId: 'b-1' } }
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{ id: 'c-1', name: 'X', classData: { id: 'cls-x', name: 'X' } }],
      },
    }, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-x.json'), JSON.stringify({
      classId: 'cls-x', className: 'X',
      template: { schema: { properties: { toString: {}, constructor: {}, real_field: {} } } },
    }))
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-1.json'), JSON.stringify({
      elementId: 'c-1', elementType: 'component', elementName: 'X',
      classData: { id: 'cls-x', name: 'X' },
      attributes: { real_field: true },   // the other two are genuinely unanswered
    }))

    const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    expect(data.attribute_residual).toMatchObject({ declared: 3, resolved: 1, unresolved: 2 })
    expect(data.attribute_residual.top_unresolved[0].fields.sort()).toEqual(['constructor', 'toString'])
  })

  it('counts boundary and data-flow templates, which the old factor ignored entirely', async () => {
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'B', defaultBoundaryId: 'b-1' } }
    const structure = { defaultBoundary: { id: 'b-1', name: 'Perimeter', components: [], classData: { id: 'cls-b', name: 'Perimeter' } } }
    await writeModel(manifest, structure, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-b.json'), JSON.stringify({
      classId: 'cls-b', className: 'Perimeter',
      template: { schema: { properties: { ingress_default_deny: {}, egress_default_deny: {} } } },
    }))
    await fs.writeFile(path.join(tmpDir, 'attributes', 'boundaries', 'b-1.json'), JSON.stringify({
      elementId: 'b-1', elementType: 'boundary', elementName: 'Perimeter',
      classData: { id: 'cls-b', name: 'Perimeter' },
      attributes: { ingress_default_deny: true, egress_default_deny: null },
    }))

    const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    expect(data.attribute_residual).toMatchObject({ declared: 2, resolved: 1, unresolved: 1 })
  })

  it('excludes elements whose template is unknown rather than scoring them either way', async () => {
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'U', defaultBoundaryId: 'b-1' } }
    const structure = {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-known', name: 'Known', classData: { id: 'cls-db', name: 'Database' } },
          { id: 'c-unknown', name: 'Unknown', classData: { id: 'cls-absent', name: 'Absent' } },
        ],
      },
    }
    await writeModel(manifest, structure, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-db.json'), JSON.stringify({
      classId: 'cls-db', className: 'Database',
      template: { schema: { properties: { ssl_enabled: {}, backups_enabled: {} } } },
    }))
    for (const [id, name, cls] of [['c-known', 'Known', 'cls-db'], ['c-unknown', 'Unknown', 'cls-absent']] as const) {
      await fs.writeFile(path.join(tmpDir, 'attributes', 'components', `${id}.json`), JSON.stringify({
        elementId: id, elementType: 'component', elementName: name,
        classData: { id: cls, name: 'x' }, attributes: { ssl_enabled: true, backups_enabled: true },
      }))
    }

    const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    // Only the cached class contributes to the ratio; the other is reported, not scored.
    expect(data.attribute_residual).toMatchObject({ declared: 2, resolved: 2, elements_without_template: 1 })
    expect(data.factors.attribute_completion_rate.value).toBe(1)
    expect(data.factors.attribute_completion_rate.note).toMatch(/no cached template/)
  })

  it('counts a classified element with NO attribute file as fully unresolved', async () => {
    // The population must come from the structure, not the attribute tree. An
    // export omits the attribute entry for every classified-but-unenriched
    // element, so iterating attribute files would drop exactly the elements
    // carrying the largest residual — the completion rate would climb as
    // enrichment got worse.
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'M', defaultBoundaryId: 'b-1' } }
    const structure = {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-has', name: 'Enriched', classData: { id: 'cls-db', name: 'Database' } },
          { id: 'c-none', name: 'NoFile', classData: { id: 'cls-db', name: 'Database' } },
        ],
      },
    }
    await writeModel(manifest, structure, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-db.json'), JSON.stringify({
      classId: 'cls-db', className: 'Database',
      template: { schema: { properties: { ssl_enabled: {}, backups_enabled: {} } } },
    }))
    // Only ONE of the two elements has an attribute file.
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-has.json'), JSON.stringify({
      elementId: 'c-has', elementType: 'component', elementName: 'Enriched',
      classData: { id: 'cls-db', name: 'Database' },
      attributes: { ssl_enabled: true, backups_enabled: true },
    }))

    const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    // 4 declared (2 elements x 2 fields), 2 resolved — NOT 2/2 = 1.0
    expect(data.attribute_residual).toMatchObject({ declared: 4, resolved: 2, unresolved: 2, elements_scored: 2 })
    expect(data.factors.attribute_completion_rate.value).toBeCloseTo(0.5)
    expect(data.attribute_residual.top_unresolved.map((r: any) => r.element)).toContain('NoFile')
  })

  it('penalises a boundary that mixes an EXTERNAL_ENTITY with internal components', async () => {
    // guidelines-core.md's BAD example: the external actor flattened in beside
    // the internal components, erasing the trust crossing. This condition used
    // to be awarded unconditionally, so the factor could never report it.
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'M', defaultBoundaryId: 'b-1' } }

    const mixed = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [
          { id: 'b-2', name: 'Zone', components: [
            { id: 'u', name: 'User', type: 'EXTERNAL_ENTITY' },
            { id: 'w', name: 'Web', type: 'PROCESS' },
          ] },
          { id: 'b-3', name: 'Other', components: [{ id: 'x', name: 'X', type: 'PROCESS' }] },
        ], components: [],
      },
    }
    await writeModel(manifest, mixed, [], [])
    const bad = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any

    // Same shape, but the external actor gets its own zone (the GOOD example).
    const separated = {
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [
          { id: 'b-0', name: 'Internet', components: [{ id: 'u', name: 'User', type: 'EXTERNAL_ENTITY' }] },
          { id: 'b-2', name: 'Zone', components: [{ id: 'w', name: 'Web', type: 'PROCESS' }] },
          { id: 'b-3', name: 'Other', components: [{ id: 'x', name: 'X', type: 'PROCESS' }] },
        ], components: [],
      },
    }
    await writeModel(manifest, separated, [], [])
    const good = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any

    // Isolate condition (c): the two fixtures differ only in whether the
    // external entity shares a zone, so the gap must be exactly its 0.34.
    expect(
      good.factors.boundary_hierarchy_quality.value - bad.factors.boundary_hierarchy_quality.value,
    ).toBeCloseTo(0.34)
    expect(bad.factors.boundary_hierarchy_quality.value)
      .toBeLessThan(good.factors.boundary_hierarchy_quality.value)
  })

  it('reports an unparseable attribute file instead of counting it as unenriched', async () => {
    // readAttributes swallows per-file parse errors so it never throws. Before
    // the fix that made the file invisible: `quality` counted the element as
    // never enriched and the score dropped with no explanation.
    const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'C', defaultBoundaryId: 'b-1' } }
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{ id: 'c-1', name: 'DB', classData: { id: 'cls-db', name: 'Database' } }],
      },
    }, [], [])
    await fs.mkdir(path.join(tmpDir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.dethereal', 'class-cache', 'cls-db.json'), JSON.stringify({
      classId: 'cls-db', className: 'Database',
      template: { schema: { properties: { ssl_enabled: {} } } },
    }))
    // Truncated JSON — exactly what a partial full-file overwrite produces.
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-1.json'),
      '{"elementId":"c-1","elementType":"component","attributes":{"ssl_enabled":tr')

    const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
    expect(data.warnings?.some((w: string) => w.includes('attributes/components/c-1.json') && w.includes('could not be read'))).toBe(true)
  })

  it('should compute boundary hierarchy quality with three conditions', async () => {
    // Depth 1 only (no nested boundaries) — should get at most 0.67
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Flat', defaultBoundaryId: 'b-1' } },
      {
        defaultBoundary: {
          id: 'b-1', name: 'System',
          components: [
            { id: 'c-1', name: 'A' },
            { id: 'c-2', name: 'B' }
          ]
        }
      }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    // Depth is 1 (< 2), so first condition fails → bhq should be less than 1.0
    expect(data.factors.boundary_hierarchy_quality.value).toBeLessThan(1.0)
  })

  it('should return correct label for each score range', async () => {
    // We just verify the labels logic via the score ranges from the tool
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Empty', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(['Starting', 'In Progress', 'Good', 'Comprehensive']).toContain(data.label)
  })

  it('should include model_name in output', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'My Model', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.model_name).toBe('My Model')
  })

  it('should handle control_coverage_rate with no classified elements', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Test', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(0)
    // No note when there are no classified elements to evaluate
    expect(data.factors.control_coverage_rate.note).toBeUndefined()
  })
})

describe('Control Coverage', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-control-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeModel(manifest: any, structure: any, dataFlows: any[] = [], dataItems: any[] = []) {
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify(structure, null, 2))
    await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows }, null, 2))
    await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems }, null, 2))
    await fs.mkdir(path.join(tmpDir, 'attributes', 'boundaries'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'components'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'dataFlows'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'attributes', 'dataItems'), { recursive: true })
  }

  async function writeComponentAttrs(compId: string, attrs: Record<string, unknown>) {
    await fs.writeFile(
      path.join(tmpDir, 'attributes', 'components', `${compId}.json`),
      JSON.stringify({
        elementId: compId,
        elementType: 'component',
        classData: { id: 'cls-1', name: 'TestClass' },
        attributes: attrs
      }, null, 2)
    )
  }

  const manifest = { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Test', defaultBoundaryId: 'b-1' } }

  it('should compute attribute-inferred coverage from encryption_in_transit', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'Web Server', classData: { id: 'cls-1', name: 'Web Server' } },
          { id: 'c-2', name: 'API Server', classData: { id: 'cls-2', name: 'API Server' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { encryption_in_transit: 'TLS 1.3' })
    await writeComponentAttrs('c-2', { encryption_in_transit: 'TLS 1.2' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(1.0)
  })

  it('pins the exact six-attribute-floor vocabulary the scorer accepts', async () => {
    // The floor is specified to the enricher as CONCEPTS ("authentication",
    // "encryption at rest", …) while the scorer keys on these literal names and
    // strict value shapes. Nothing else connects the two, so this test is the
    // guard: if the accepted vocabulary changes, the skill/agent tables that
    // now spell it out must change with it.
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ['authentication_type string',      { authentication_type: 'oauth2' }, true],
      ['authentication_type "none"',      { authentication_type: 'none' }, false],
      ['encryption_at_rest string',       { encryption_at_rest: 'AES-256' }, true],
      ['encryption_at_rest boolean true', { encryption_at_rest: true }, false],
      ['encryption_in_transit string',    { encryption_in_transit: 'TLS 1.3' }, true],
      ['monitoring_tools non-empty',      { monitoring_tools: ['SIEM'] }, true],
      ['monitoring_tools ["None"]',       { monitoring_tools: ['None'] }, false],
      ['monitoring_tools []',             { monitoring_tools: [] }, false],
      ['implicit_deny_enabled true',      { implicit_deny_enabled: true }, true],
      ['implicit_deny_enabled false',     { implicit_deny_enabled: false }, false],
      // A semantically equivalent template field name does NOT satisfy the floor.
      ['transit_encryption_enforced',     { transit_encryption_enforced: true }, false],
      ['tls_enabled boolean',             { tls_enabled: true }, false],
    ]

    for (const [label, attrs, shouldCount] of cases) {
      await writeModel(manifest, {
        defaultBoundary: {
          id: 'b-1', name: 'System',
          components: [{ id: 'c-1', name: 'X', classData: { id: 'cls-1', name: 'C' } }],
        },
      })
      await writeComponentAttrs('c-1', attrs)
      const data = (await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)).data as any
      expect(data.factors.control_coverage_rate.value, label).toBe(shouldCount ? 1.0 : 0)
    }
  })

  it('should inherit control coverage from parent boundary', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        boundaries: [{
          id: 'b-2', name: 'Protected Zone',
          controls: [{ id: 'ctrl-1', name: 'Firewall' }],
          components: [
            { id: 'c-1', name: 'App Server', classData: { id: 'cls-1', name: 'App' } }
          ]
        }]
      }
    })
    await writeComponentAttrs('c-1', {})

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBeGreaterThan(0)
  })

  it('should count mixed attribute + formal coverage (max rule)', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        boundaries: [{
          id: 'b-2', name: 'Zone A',
          controls: [{ id: 'ctrl-1', name: 'WAF' }],
          components: [
            { id: 'c-1', name: 'Frontend', classData: { id: 'cls-1', name: 'Web App' } }
          ]
        }],
        components: [
          { id: 'c-2', name: 'Backend', classData: { id: 'cls-2', name: 'API' } }
        ]
      }
    })
    // c-1: covered by boundary controls (Tier 2)
    await writeComponentAttrs('c-1', {})
    // c-2: covered by attributes (Tier 1)
    await writeComponentAttrs('c-2', { encryption_in_transit: 'TLS 1.3' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(1.0)
  })

  it('should NOT count basic auth without encryption', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'API', classData: { id: 'cls-1', name: 'API' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { authentication_type: 'basic' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(0)
  })

  it('should count basic auth WITH adequate encryption', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'API', classData: { id: 'cls-1', name: 'API' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', {
      authentication_type: 'basic',
      encryption_in_transit: 'TLS 1.3'
    })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBeGreaterThan(0)
  })

  it('should NOT count deprecated TLS 1.0', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'Legacy', classData: { id: 'cls-1', name: 'Legacy' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { encryption_in_transit: 'TLS 1.0' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(0)
  })

  it('should NOT count deprecated encryption at rest (DES, 3DES, RC4)', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'Store A', classData: { id: 'cls-1', name: 'DB' } },
          { id: 'c-2', name: 'Store B', classData: { id: 'cls-2', name: 'DB' } },
          { id: 'c-3', name: 'Store C', classData: { id: 'cls-3', name: 'DB' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { encryption_at_rest: 'DES' })
    await writeComponentAttrs('c-2', { encryption_at_rest: '3DES' })
    await writeComponentAttrs('c-3', { encryption_at_rest: 'RC4' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(0)
  })

  it('should NOT count digest auth without encryption', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'API', classData: { id: 'cls-1', name: 'API' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { authentication_type: 'digest' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBe(0)
  })

  it('should emit warning for expired compensating control', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{
          id: 'c-1', name: 'App',
          classData: { id: 'cls-1', name: 'App' },
          controls: [{
            id: null,
            name: 'Enhanced Monitoring',
            compensating: {
              expires: '2025-01-01',
              primary_control: 'Automated Patch Management',
              original_requirement: 'PCI-DSS 6.3.3',
              risk_acceptance: 'RISK-2025-001'
            }
          }]
        }]
      }
    })
    await writeComponentAttrs('c-1', {})

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.warnings).toBeDefined()
    expect(data.warnings.length).toBeGreaterThan(0)
    expect(data.warnings[0]).toContain('Enhanced Monitoring')
    expect(data.warnings[0]).toContain('expired')
    expect(data.warnings[0]).toContain('PCI-DSS 6.3.3')
  })

  it('should NOT emit warning for non-expired compensating control', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{
          id: 'c-1', name: 'App',
          classData: { id: 'cls-1', name: 'App' },
          controls: [{
            id: null,
            name: 'Temporary WAF Rule',
            compensating: {
              expires: '2027-12-31',
              primary_control: 'Code Fix',
              original_requirement: 'OWASP A1'
            }
          }]
        }]
      }
    })
    await writeComponentAttrs('c-1', {})

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.warnings).toBeUndefined()
  })

  it('should note "Inferred from attributes" when no formal controls exist', async () => {
    await writeModel(manifest, {
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [
          { id: 'c-1', name: 'API', classData: { id: 'cls-1', name: 'API' } }
        ]
      }
    })
    await writeComponentAttrs('c-1', { encryption_in_transit: 'TLS 1.3' })

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.value).toBeGreaterThan(0)
    expect(data.factors.control_coverage_rate.note).toContain('Inferred from attributes')
  })
})
