import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { TOOL_MANIFEST, manifestToolNames } from '../tools/manifest.js'
import { allTools } from '../tools/index.js'
import { listedTool, withInteractionHint, REQUIRES_USER_INTERACTION } from '../tool-listing.js'

// The tools that write to the platform or record a waiver: never run unattended.
const REQUIRES_USER = [
  'model_state_waive',
  'model_state_settle',
  'model_state_prune',
  'import_model',
  'update_model',
  'update_attributes',
  'create_threat_model',
]

// Prompted tools that stay unflagged: each asks under the harness's own rules, and the
// interaction hint would stop them where they are still needed unattended. A new
// prompted tool must be added to one list or the other.
const PROMPTED_UNFLAGGED = [
  'login',
  'logout',
  'export_model',
  'generate_attribute_stubs',
  'manage_controls',
  'manage_countermeasures',
  'manage_analyses',
]

const sorted = (xs: Iterable<string>) => [...xs].sort()

describe('tool listing', () => {
  it('flags exactly the platform-write and waiver tools in the manifest', () => {
    const flagged = TOOL_MANIFEST.filter((t) => t.requiresUser === true).map((t) => t.name)
    const present = REQUIRES_USER.filter((n) => manifestToolNames().includes(n))
    expect(sorted(flagged)).toEqual(sorted(present))
    expect(present).toEqual(expect.arrayContaining(['model_state_waive', 'import_model', 'update_model', 'update_attributes', 'create_threat_model']))
  })

  it('flags only prompted tools, and decides every prompted tool one way or the other', () => {
    for (const t of TOOL_MANIFEST) {
      if (t.requiresUser) expect(t.approval, t.name).toBe('prompt')
      if (t.approval === 'prompt') expect(REQUIRES_USER.includes(t.name) !== PROMPTED_UNFLAGGED.includes(t.name), t.name).toBe(true)
    }
  })

  it('keeps update_model prompted and requiring the user: the operator sees what an overwrite names', () => {
    const entry = TOOL_MANIFEST.find((t) => t.name === 'update_model')
    expect(entry).toMatchObject({ approval: 'prompt', requiresUser: true })
    expect(entry?.inputs).toMatchObject({ overwrite_changed: 'element_id_set', overwrite_revision: 'text' })
  })

  it('adds no _meta to a tool that does not require the user', () => {
    const listed = { name: 'auth_status', description: 'd' }
    expect(withInteractionHint(listed)).toBe(listed)
    expect('_meta' in withInteractionHint(listed)).toBe(false)
  })

  it('keeps existing _meta keys and never lets them clear the hint', () => {
    const listed = { name: 'import_model', _meta: { 'example/key': 1, [REQUIRES_USER_INTERACTION]: false } }
    const hinted = withInteractionHint(listed)
    expect(hinted._meta).toEqual({ 'example/key': 1, [REQUIRES_USER_INTERACTION]: true })
    expect(listed._meta).toEqual({ 'example/key': 1, [REQUIRES_USER_INTERACTION]: false })
  })

  it('lists every registered tool with its schema properties, hinted only when the manifest says so', () => {
    for (const tool of allTools) {
      const listed = listedTool(tool)
      const json = z.toJSONSchema(tool.inputSchema, { target: 'draft-07' }) as { properties?: unknown; required?: string[] }
      expect(listed.name).toBe(tool.name)
      expect(listed.description).toBe(tool.description)
      expect(listed.inputSchema).toEqual(
        json.properties ? { type: 'object', properties: json.properties, required: json.required ?? [] } : { type: 'object', properties: {} }
      )
      if (REQUIRES_USER.includes(tool.name)) expect(listed._meta).toEqual({ [REQUIRES_USER_INTERACTION]: true })
      else expect(listed).not.toHaveProperty('_meta')
    }
  })
})
