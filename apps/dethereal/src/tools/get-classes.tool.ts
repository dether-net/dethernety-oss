/**
 * Get Classes Tool
 *
 * Finds available Dethernety classes (component types, boundary types, data flow types, etc.)
 * based on flexible search criteria. Classes are provided by modules and define the attributes
 * to set for threat model elements.
 */

import { z } from 'zod'
import { DtModule } from '@dethernety/dt-core'
import { Class, Module } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { getConfig, debugLog } from '../config.js'

const ClassTypeEnum = z.enum(['PROCESS', 'EXTERNAL_ENTITY', 'STORE', 'BOUNDARY', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL'])

const FieldsEnum = z.enum(['id', 'name', 'description', 'type', 'category', 'attributes', 'guide', 'module'])

const InputSchema = z.object({
  class_id: z.string().optional().describe('The ID of a specific class to find'),
  name: z.string().optional().describe('The name of the class to find'),
  class_type: ClassTypeEnum.optional().describe('The type of class (PROCESS, EXTERNAL_ENTITY, STORE, BOUNDARY, SECURITY_BOUNDARY, DATA_FLOW, DATA, CONTROL)'),
  category: z.string().optional().describe('The category of the class'),
  module_id: z.string().optional().describe('The ID of the module to find classes in'),
  module_name: z.string().optional().describe('The name of the module to find classes in'),
  fields: z.array(FieldsEnum).optional().describe('Optional list of field names to return. Available: id, name, description, type, category, attributes (as a JSON schema), guide, module. If omitted, returns all fields.')
})

type GetClassesInput = z.infer<typeof InputSchema>

interface ClassInfo {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  attributes?: any
  guide?: any
  module?: {
    id: string
    name: string
  }
}

interface GetClassesOutput {
  classes: ClassInfo[]
  total: number
}

export class GetClassesTool extends ClientDependentTool<GetClassesInput, GetClassesOutput> {
  readonly name = 'get_classes'
  readonly description = 'Find available Dethernety classes (component types, boundary types, data flow types, etc.) based on flexible search criteria. Classes provided by modules and define the attributes to set for threat model elements.'
  readonly inputSchema = InputSchema

  async execute(input: GetClassesInput, context: ToolContext): Promise<ToolResult<GetClassesOutput>> {
    const config = getConfig()

    try {
      if (!context.apolloClient) {
        return {
          success: false,
          error: 'Apollo client not available. Please ensure you are authenticated.'
        }
      }

      const dtModule = new DtModule(context.apolloClient)

      // Get modules based on filter
      let modules: Module[] = []

      if (input.module_id) {
        const module = await dtModule.getModuleById(input.module_id)
        if (module) {
          modules = [module]
        }
      } else if (input.module_name) {
        const module = await dtModule.getModuleByName(input.module_name)
        if (module) {
          modules = [module]
        }
      } else {
        modules = await dtModule.getModules()
      }

      debugLog(config, `Found ${modules.length} modules to search`)

      // Collect classes from all modules
      const classes: ClassInfo[] = []

      for (const module of modules) {
        const moduleRef = { id: module.id, name: module.name }

        // Get classes based on type filter
        const classTypes = input.class_type
          ? [this.mapClassType(input.class_type)]
          : ['component', 'boundary', 'dataflow', 'data', 'control']

        for (const classType of classTypes) {
          const classArray = this.getClassArrayFromModule(module, classType)
          if (!classArray) continue

          for (const cls of classArray) {
            // Apply filters
            if (input.class_id && cls.id !== input.class_id) continue
            if (input.name && !cls.name.toLowerCase().includes(input.name.toLowerCase())) continue
            if (input.category && cls.category !== input.category) continue

            // Build class info based on requested fields
            const classInfo = this.buildClassInfo(cls, moduleRef, classType, input.fields)
            classes.push(classInfo)
          }
        }
      }

      debugLog(config, `Found ${classes.length} matching classes`)

      return {
        success: true,
        data: {
          classes,
          total: classes.length
        }
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get classes'
      }
    }
  }

  private mapClassType(type: string): string {
    switch (type) {
      case 'PROCESS':
      case 'EXTERNAL_ENTITY':
      case 'STORE':
        return 'component'
      case 'BOUNDARY':
      case 'SECURITY_BOUNDARY':
        return 'boundary'
      case 'DATA_FLOW':
        return 'dataflow'
      case 'DATA':
        return 'data'
      case 'CONTROL':
        return 'control'
      default:
        return 'component'
    }
  }

  private getClassArrayFromModule(module: Module, classType: string): Class[] | undefined {
    switch (classType) {
      case 'component':
        return module.componentClasses
      case 'boundary':
        return module.securityBoundaryClasses
      case 'dataflow':
        return module.dataFlowClasses
      case 'data':
        return module.dataClasses
      case 'control':
        return module.controlClasses
      default:
        return undefined
    }
  }

  private buildClassInfo(cls: Class, moduleRef: { id: string; name: string }, classType: string, fields?: string[]): ClassInfo {
    const allFields = !fields || fields.length === 0

    const info: ClassInfo = {
      id: cls.id,
      name: cls.name
    }

    if (allFields || fields?.includes('description')) {
      info.description = cls.description
    }

    if (allFields || fields?.includes('type')) {
      info.type = cls.type || classType.toUpperCase()
    }

    if (allFields || fields?.includes('category')) {
      info.category = cls.category
    }

    if (allFields || fields?.includes('attributes')) {
      // Return template as attributes schema
      info.attributes = cls.template || {}
    }

    if (allFields || fields?.includes('guide')) {
      info.guide = cls.guide
    }

    if (allFields || fields?.includes('module')) {
      info.module = moduleRef
    }

    return info
  }
}

// Export singleton instance
export const getClassesTool = new GetClassesTool()
