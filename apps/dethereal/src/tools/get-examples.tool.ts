/**
 * Get Examples Tool
 *
 * Returns example threat model templates for different system architectures.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from './base-tool.js'
import { getExample, getExampleTypes, ExampleType, ExampleModel } from '../data/examples.js'

const ExampleTypeEnum = z.enum(['simple', 'web_app', 'api_service', 'database', 'microservices'])
const FileTypeEnum = z.enum(['manifest', 'structure', 'dataflows', 'data-items', 'attributes', 'all'])

const InputSchema = z.object({
  type: ExampleTypeEnum.optional().describe('Type of example model to return (default: simple)'),
  file_type: FileTypeEnum.optional().describe('Specific file type to return. If omitted or "all", returns all files.')
})

type GetExamplesInput = z.infer<typeof InputSchema>

interface ExamplesOutput {
  type: string
  available_types: string[]
  file_type?: string
  content?: any
  files?: Record<string, any>
}

export class GetExamplesTool extends ClientFreeTool<GetExamplesInput, ExamplesOutput> {
  readonly name = 'get_example_models'
  readonly description = 'Get example Dethernety threat model templates for different system architectures (web apps, APIs, microservices, etc.)'
  readonly inputSchema = InputSchema

  async execute(input: GetExamplesInput, context: ToolContext): Promise<ToolResult<ExamplesOutput>> {
    try {
      const exampleType = (input.type || 'simple') as ExampleType
      const example = getExample(exampleType)
      const availableTypes = getExampleTypes()

      if (!input.file_type || input.file_type === 'all') {
        // Return all files
        return {
          success: true,
          data: {
            type: exampleType,
            available_types: availableTypes,
            files: {
              manifest: example.manifest,
              structure: example.structure,
              dataflows: example.dataflows,
              'data-items': example.dataItems,
              attributes: example.attributes
            }
          }
        }
      }

      // Return specific file
      const content = this.getFileContent(example, input.file_type)
      return {
        success: true,
        data: {
          type: exampleType,
          available_types: availableTypes,
          file_type: input.file_type,
          content
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get examples'
      }
    }
  }

  private getFileContent(example: ExampleModel, fileType: string): any {
    switch (fileType) {
      case 'manifest':
        return example.manifest
      case 'structure':
        return example.structure
      case 'dataflows':
        return example.dataflows
      case 'data-items':
        return example.dataItems
      case 'attributes':
        return example.attributes
      default:
        throw new Error(`Unknown file type: ${fileType}`)
    }
  }
}

// Export singleton instance
export const getExamplesTool = new GetExamplesTool()
