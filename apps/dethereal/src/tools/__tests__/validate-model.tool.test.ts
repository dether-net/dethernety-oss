import { describe, it, expect } from 'vitest'
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
      const result = await validateModelTool.execute(
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
      expect(result.data?.valid).toBe(true)
      expect(result.data?.errors).toHaveLength(0)
    })

    it('should reject invalid manifest (missing name)', async () => {
      const result = await validateModelTool.execute(
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
      expect(result.data?.valid).toBe(false)
      expect(result.data!.errors.length).toBeGreaterThan(0)
    })

    it('should validate a valid structure', async () => {
      const result = await validateModelTool.execute(
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
      expect(result.data?.valid).toBe(true)
    })

    it('should handle JSON string input', async () => {
      const jsonStr = JSON.stringify({
        defaultBoundary: {
          id: 'b-1',
          name: 'System',
        },
      })

      const result = await validateModelTool.execute(
        {
          data: jsonStr,
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data?.valid).toBe(true)
    })

    it('should reject invalid JSON string', async () => {
      const result = await validateModelTool.execute(
        {
          data: '{ invalid json }',
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data?.valid).toBe(false)
      expect(result.data?.errors[0]?.message).toContain('Invalid JSON')
    })

    it('should return error when neither directory_path nor data provided', async () => {
      const result = await validateModelTool.execute({}, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be provided')
    })
  })
})
