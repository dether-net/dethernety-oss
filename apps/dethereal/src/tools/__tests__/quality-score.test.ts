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

  it('should note control_coverage_rate requires platform', async () => {
    await writeModel(
      { schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Test', defaultBoundaryId: 'b-1' } },
      { defaultBoundary: { id: 'b-1', name: 'System' } }
    )

    const result = await validateModelTool.run({ action: 'quality', directory_path: tmpDir }, context)
    const data = result.data as any
    expect(data.factors.control_coverage_rate.note).toContain('platform')
    expect(data.factors.control_coverage_rate.value).toBe(0)
  })
})
