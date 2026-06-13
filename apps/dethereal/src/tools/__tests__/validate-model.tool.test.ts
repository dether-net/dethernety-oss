import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateModelTool } from '../validate-model.tool.js'
import type { ToolContext } from '../base-tool.js'

const context: ToolContext = { debug: false }

describe('ValidateModelTool', () => {
  describe('metadata', () => {
    it('should have the correct tool name', () => {
      expect(validateModelTool.name).toBe('validate_model_json')
    })

    it('should not require a client', () => {
      expect(validateModelTool.requiresClient).toBe(false)
    })
  })

  describe('inline validation', () => {
    it('should validate a valid manifest', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            schemaVersion: '2.0.0',
            format: 'split',
            model: {
              id: null,
              name: 'Test Model',
              defaultBoundaryId: 'boundary-1',
            },
            modules: [],
          },
          file_type: 'manifest',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
      expect((result.data as any)?.errors).toHaveLength(0)
    })

    it('should reject invalid manifest (missing name)', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            schemaVersion: '2.0.0',
            format: 'split',
            model: {
              id: null,
              defaultBoundaryId: 'b-1',
            },
          },
          file_type: 'manifest',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
      expect((result.data as any)!.errors.length).toBeGreaterThan(0)
    })

    it('should validate a valid structure', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: {
              id: 'b-1',
              name: 'System',
            },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should handle JSON string input', async () => {
      const jsonStr = JSON.stringify({
        defaultBoundary: {
          id: 'b-1',
          name: 'System',
        },
      })

      const result = await validateModelTool.run(
        {
          data: jsonStr,
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should reject invalid JSON string', async () => {
      const result = await validateModelTool.run(
        {
          data: '{ invalid json }',
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
      expect((result.data as any)?.errors[0]?.message).toContain('Invalid JSON')
    })

    it('should return error when neither directory_path nor data provided', async () => {
      const result = await validateModelTool.run({}, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be provided')
    })
  })

  // Coverage action
  describe('coverage action', () => {
    it('should accept coverage action with model_id', () => {
      const result = validateModelTool.inputSchema.safeParse({
        action: 'coverage',
        model_id: 'model-123',
      })
      expect(result.success).toBe(true)
    })

    it('should accept coverage action with directory_path', () => {
      const result = validateModelTool.inputSchema.safeParse({
        action: 'coverage',
        directory_path: '/tmp/model',
      })
      expect(result.success).toBe(true)
    })

    it('should return error when coverage has neither model_id nor directory_path', async () => {
      const result = await validateModelTool.run({ action: 'coverage' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Coverage requires')
    })
  })
})

describe('ValidateModelTool — monitoring_tools "None" sentinel (G9)', () => {
  const tool = validateModelTool as any

  it('does not count ["None"] as monitoring', () => {
    expect(tool.hasRealMonitoring(['None'])).toBe(false)
    expect(tool.hasRealMonitoring(['none'])).toBe(false)
    expect(tool.hasRealMonitoring(['N/A'])).toBe(false)
    expect(tool.hasRealMonitoring([])).toBe(false)
    expect(tool.hasRealMonitoring(null)).toBe(false)
    expect(tool.hasRealMonitoring('SIEM')).toBe(false) // not an array
  })

  it('counts a real tool, even alongside a sentinel', () => {
    expect(tool.hasRealMonitoring(['SIEM'])).toBe(true)
    expect(tool.hasRealMonitoring(['none', 'EDR'])).toBe(true)
  })

  it('getAttributeCategories reports monitoring=false for the ["None"] sentinel', () => {
    expect(tool.getAttributeCategories({ monitoring_tools: ['None'] }).monitoring).toBe(false)
    expect(tool.getAttributeCategories({ monitoring_tools: ['SIEM'] }).monitoring).toBe(true)
  })

  it('hasPositiveSecurityAttribute ignores a ["None"] monitoring sentinel', () => {
    // monitoring is the only attribute present — the sentinel must not flip it positive
    expect(tool.hasPositiveSecurityAttribute({ monitoring_tools: ['None'] })).toBe(false)
    expect(tool.hasPositiveSecurityAttribute({ monitoring_tools: ['SIEM'] })).toBe(true)
  })
})

describe('ValidateModelTool — offline coverage is assignment, not mitigation (G10)', () => {
  const dir = path.resolve('./__g10_cov_model__')

  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true })
    // isModelDirectory() only checks for a manifest.json file.
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '2.0.0',
        format: 'split',
        model: { id: null, name: 'cov', defaultBoundaryId: 'b1' },
        modules: [],
      }),
    )
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('tags offline coverage assignment-heuristic and warns it is not mitigation', async () => {
    const spy = vi
      .spyOn(validateModelTool as any, 'computeLocalCoverageBreakdown')
      .mockResolvedValue({
        classified_count: 11,
        covered_count: 11,
        inferred_coverage: {},
        formal_coverage: {},
      })

    const result = await validateModelTool.run(
      { action: 'coverage', directory_path: dir },
      context,
    )
    spy.mockRestore()

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.mode).toBe('offline')
    expect(data.coverage_kind).toBe('assignment-heuristic')
    expect(data.coverage_summary.coverage_pct).toBe(100)
    const warning = (result.warnings ?? []).join(' ')
    expect(warning).toContain('ASSIGNMENT')
    expect(warning).toMatch(/not.*mitigation/i)
  })
})
