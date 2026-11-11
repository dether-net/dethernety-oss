/**
 * How each tool appears in `tools/list`: its name, description, the top-level
 * properties of its input schema, and — for tools whose manifest entry has
 * `requiresUser` — the hint that the operator must interact before it runs.
 *
 * Claude Code reads `anthropic/requiresUserInteraction`: it asks even under allow
 * rules and refuses the call where no one can answer (bypass, dontAsk, `-p`). Other
 * harnesses ignore the key and apply their own approval rules.
 */

import { z } from 'zod'
import type { BaseTool } from './tools/base-tool.js'
import { manifestTool } from './tools/manifest.js'

export const REQUIRES_USER_INTERACTION = 'anthropic/requiresUserInteraction'

export interface ListedTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: unknown; required?: string[] }
  _meta?: Record<string, unknown>
}

/**
 * Adds the interaction hint when the tool's manifest entry asks for it. Keys already
 * in `_meta` are kept; the hint itself always ends up `true`. The input is not changed.
 * A tool with no entry gets no hint: the manifest test requires an entry for every
 * registered tool.
 */
export function withInteractionHint<T extends { name: string; _meta?: Record<string, unknown> }>(listed: T): T {
  if (manifestTool(listed.name)?.requiresUser !== true) return listed
  return { ...listed, _meta: { ...listed._meta, [REQUIRES_USER_INTERACTION]: true } }
}

export function listedTool(tool: BaseTool): ListedTool {
  // Convert Zod schema to JSON Schema
  const jsonSchema = z.toJSONSchema(tool.inputSchema, {
    target: 'draft-07'
  })

  // Remove the outermost wrapper to get just the properties
  const inputSchema = (jsonSchema as Record<string, unknown>).properties
    ? {
        type: 'object' as const,
        properties: (jsonSchema as Record<string, unknown>).properties,
        required: ((jsonSchema as Record<string, unknown>).required as string[]) || []
      }
    : { type: 'object' as const, properties: {} }

  return withInteractionHint({
    name: tool.name,
    description: tool.description,
    inputSchema
  })
}
