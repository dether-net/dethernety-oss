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

  it('counts data items in attribute_completion_rate', async () => {
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
