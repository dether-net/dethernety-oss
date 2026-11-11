import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { TOOL_MANIFEST } from '../manifest.js'

type Registry = typeof import('../index.js')

async function loadRegistry(stubs: boolean): Promise<Registry> {
  vi.resetModules()
  if (stubs) process.env.DETHEREAL_REGISTER_STUBS = '1'
  else delete process.env.DETHEREAL_REGISTER_STUBS
  return import('../index.js')
}

/** The listing the server sends for a tool: top-level properties of its JSON schema. */
function listed(schema: z.ZodType): Record<string, Record<string, unknown>> {
  const json = z.toJSONSchema(schema, { target: 'draft-07' }) as { properties?: Record<string, Record<string, unknown>> }
  return json.properties ?? {}
}

const sorted = (xs: Iterable<string>) => [...xs].sort()

afterEach(() => {
  delete process.env.DETHEREAL_REGISTER_STUBS
})

describe('tool manifest', () => {
  it('has one entry per tool name', () => {
    const names = TOOL_MANIFEST.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('registers exactly the manifest tools when placeholders are enabled', async () => {
    const { allTools } = await loadRegistry(true)
    expect(sorted(allTools.map((t) => t.name))).toEqual(sorted(TOOL_MANIFEST.map((t) => t.name)))
  })

  it('registers no placeholder unless enabled', async () => {
    const { allTools } = await loadRegistry(false)
    const { StubTool } = await import('../stub-tool.js')
    expect(allTools.some((t) => t instanceof StubTool)).toBe(false)
    for (const tool of allTools) expect(TOOL_MANIFEST.map((t) => t.name)).toContain(tool.name)
  })

  it('matches every conformant tool exactly', async () => {
    const { allTools } = await loadRegistry(false)
    for (const entry of TOOL_MANIFEST.filter((t) => t.status === 'conformant')) {
      const tool = allTools.find((t) => t.name === entry.name)
      expect(tool, entry.name).toBeDefined()
      const props = listed(tool!.inputSchema)
      expect(sorted(Object.keys(props)), entry.name).toEqual(sorted(Object.keys(entry.inputs)))
      if (entry.actions) expect(sorted((props.action?.enum as string[]) ?? []), entry.name).toEqual(sorted(entry.actions))
      else expect(props.action, entry.name).toBeUndefined()
    }
  })

  it('lists the settlement-only inputs only with the settlement on', async () => {
    try {
      for (const mode of ['on', 'off'] as const) {
        vi.stubEnv('DETHEREAL_SETTLEMENT', mode === 'on' ? 'on' : '')
        const { allTools } = await loadRegistry(false)
        const entries = TOOL_MANIFEST.filter((t) => t.settlementOnly && allTools.some((x) => x.name === t.name))
        expect(entries.map((e) => e.name), mode).toContain('model_state')
        for (const entry of entries) {
          const props = Object.keys(listed(allTools.find((t) => t.name === entry.name)!.inputSchema))
          const want = mode === 'on' ? Object.keys(entry.inputs) : Object.keys(entry.inputs).filter((k) => !entry.settlementOnly!.includes(k))
          expect(sorted(props), `${entry.name} ${mode}`).toEqual(sorted(want))
          for (const k of entry.settlementOnly!) expect(Object.keys(entry.inputs), `${entry.name}.${k}`).toContain(k)
        }
      }
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('keeps implemented planned tools within their target inputs', async () => {
    const { allTools } = await loadRegistry(false)
    for (const entry of TOOL_MANIFEST.filter((t) => t.status === 'planned')) {
      const tool = allTools.find((t) => t.name === entry.name)
      if (!tool) continue
      const props = listed(tool.inputSchema)
      const allowed = new Set([...Object.keys(entry.inputs), ...(entry.retiring ?? [])])
      for (const key of Object.keys(props)) expect(allowed.has(key), `${entry.name}.${key}`).toBe(true)
      for (const action of (props.action?.enum as string[]) ?? []) expect(entry.actions, `${entry.name}.${action}`).toContain(action)
    }
  })

  it('gives every placeholder a typed schema and a not-available result', async () => {
    const { allTools } = await loadRegistry(true)
    const { StubTool } = await import('../stub-tool.js')
    const stubs = allTools.filter((t) => t instanceof StubTool)
    const unimplemented = TOOL_MANIFEST.filter((entry) => !allTools.some((t) => t.name === entry.name && !(t instanceof StubTool)))
    expect(stubs.map((s) => s.name).sort()).toEqual(unimplemented.map((e) => e.name).sort())
    // Once every manifest tool is implemented, a synthetic entry keeps the placeholder path covered.
    if (stubs.length === 0) {
      stubs.push(new StubTool({ name: 'placeholder_probe', approval: 'auto', status: 'planned', inputs: { directory_path: 'model_dir', flag: 'boolean' } }))
    }
    for (const stub of stubs) {
      expect(stub.requiresClient).toBe(false)
      for (const [key, prop] of Object.entries(listed(stub.inputSchema))) {
        expect(prop.type ?? prop.enum, `${stub.name}.${key}`).toBeDefined()
      }
      const result = await stub.run({}, { debug: false })
      expect(result).toEqual({ success: false, error: `${stub.name} is not available in this version` })
    }
  })

  it('names no credential and no confinement base as an input', () => {
    const credential = /token|bearer|jwt|refresh|authorization|password|passw|secret|cookie|api_?key|verifier|session/i
    const base = /root|base_?dir|cwd|home/i
    for (const entry of TOOL_MANIFEST) {
      for (const key of Object.keys(entry.inputs)) {
        expect(credential.test(key), `${entry.name}.${key}`).toBe(false)
        expect(base.test(key), `${entry.name}.${key}`).toBe(false)
      }
    }
  })

  it('assigns every tool an approval class', () => {
    const auto = TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name)
    expect(sorted(auto)).toEqual(sorted([
      'auth_status', 'workspace_status', 'detect_drift', 'validate_model_json', 'get_model_schema',
      'get_example_models', 'list_models', 'get_classes', 'match_classes', 'search_mitre_attack',
      'get_mitre_defend', 'get_control_gaps', 'model_state', 'query_controls', 'query_exposures', 'query_countermeasures',
    ]))
    for (const entry of TOOL_MANIFEST) expect(['auto', 'prompt']).toContain(entry.approval)
  })
})
