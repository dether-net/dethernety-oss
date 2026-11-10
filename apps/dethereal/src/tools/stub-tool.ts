/**
 * Placeholder for a tool the manifest lists but this build does not implement.
 * Registered only when DETHEREAL_REGISTER_STUBS=1 (tests), so a model never
 * sees a tool that always fails. The schema is typed from the manifest kinds.
 */
import { z } from 'zod'
import { ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import type { InputKind, ManifestTool } from './manifest.js'

function schemaFor(kind: InputKind): z.ZodType {
  if (kind.startsWith('enum:')) {
    const values = kind.slice('enum:'.length).split('|')
    return z.enum(values as [string, ...string[]])
  }
  switch (kind) {
    case 'model_dir':
      return z.string().max(4096)
    case 'commit':
      return z.string().regex(/^[0-9a-f]{7,64}$/)
    case 'element_ids':
      return z.array(z.string().max(256)).max(500)
    case 'text':
      return z.string().max(500).regex(/^[^\p{C}\p{Zl}\p{Zp}]*$/u)
    case 'platform_fields':
      return z.object({}).strict()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(z.unknown()).max(50)
    default:
      return z.unknown()
  }
}

export class StubTool extends ClientFreeTool<Record<string, unknown>, never> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<Record<string, unknown>>

  constructor(entry: ManifestTool) {
    super()
    this.name = entry.name
    this.description = `${entry.name} is not available in this version.`
    this.inputSchema = z.object(
      Object.fromEntries(Object.entries(entry.inputs).map(([key, kind]) => [key, schemaFor(kind).optional()])),
    ) as unknown as z.ZodType<Record<string, unknown>>
  }

  async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult<never>> {
    return { success: false, error: `${this.name} is not available in this version` }
  }
}
