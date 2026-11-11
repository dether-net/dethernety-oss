/**
 * The install summary says what each harness's bundle lets run without asking. These checks hold that
 * text to the shipped bundles, so a bundle change that allows more fails here until the summary says so.
 */
import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml } from 'yaml'
import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import { autoActions } from '../../../cli/approve.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const AUTO = TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name).sort()
const PROMPT = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => t.name).sort()
const read = (p: string) => fs.readFile(path.join(pkgRoot, p), 'utf8')

describe('what the install summary discloses', () => {
  it('Codex: exactly the read-only tools run without asking, every other one prompts; the agents\' sandboxes as said', async () => {
    const cfg = parseToml(await read('bundles/codex/config.fragment.toml')) as { mcp_servers: { dethereal: { default_tools_approval_mode: string; tools: Record<string, { approval_mode: string }> } } }
    const server = cfg.mcp_servers.dethereal
    expect(server.default_tools_approval_mode).toBe('prompt')
    expect(Object.entries(server.tools).filter(([, v]) => v.approval_mode === 'approve').map(([k]) => k).sort()).toEqual(AUTO)
    expect(AUTO).toHaveLength(16)
    const sandbox: Record<string, string> = {}
    for (const f of await fs.readdir(path.join(pkgRoot, 'bundles/codex/agents'))) {
      sandbox[f.replace(/\.toml$/, '')] = (parseToml(await read(`bundles/codex/agents/${f}`)) as { sandbox_mode: string }).sandbox_mode
    }
    expect(sandbox).toEqual({
      'dethereal-infrastructure-scout': 'read-only', 'dethereal-infrastructure-scout-scoped': 'read-only', 'dethereal-model-reviewer': 'read-only',
      'dethereal-threat-modeler': 'workspace-write', 'dethereal-security-enricher': 'workspace-write', 'dethereal-enrichment-applier': 'workspace-write',
    })
  })

  it('OpenCode: the agents allow only read-only Dethereal tools, never a shell command, and the rest ask', async () => {
    const fragment = JSON.parse(await read('bundles/opencode/mcp.fragment.json')) as { permission: Record<string, string> }
    expect(Object.entries(fragment.permission).filter(([, v]) => v === 'ask').map(([k]) => k.replace(/^dethereal_/, '')).sort()).toEqual(PROMPT)
    expect(PROMPT).toHaveLength(14)
    const shell: string[] = []
    const edits: string[] = []
    for (const f of (await fs.readdir(path.join(pkgRoot, 'bundles/opencode/agents'))).sort()) {
      const text = await read(`bundles/opencode/agents/${f}`)
      const perm = (parseYaml(text.split(/^---$/m)[1]!) as { permission: Record<string, unknown> }).permission
      const name = f.replace(/^dethereal-|\.md$/g, '')
      if (perm.edit !== undefined && perm.edit !== 'deny') edits.push(name)
      if (perm.bash === 'allow' || (typeof perm.bash === 'object' && Object.values(perm.bash as object).includes('allow'))) shell.push(name)
      const allowed = Object.entries(perm).filter(([k, v]) => k.startsWith('dethereal_') && v === 'allow').map(([k]) => k.slice('dethereal_'.length))
      for (const t of allowed.filter((t) => t !== '*')) expect(AUTO, `${name} allows ${t}`).toContain(t)
      if (allowed.includes('*')) {
        // A wildcard allow is fine only with every prompt-class tool denied after it.
        expect(Object.entries(perm).filter(([k, v]) => k.startsWith('dethereal_') && v === 'deny').map(([k]) => k.slice('dethereal_'.length)).sort(), name).toEqual(PROMPT)
      }
    }
    expect(shell).toEqual([])
    expect(edits).toEqual(['enrichment-applier', 'security-enricher', 'threat-modeler'])
  })

  it('Claude Code: the approve hook runs for exactly the auto tools and the tools with an auto-approved action; skills read only their own files; no permission settings', async () => {
    const hooks = JSON.parse(await read('bundles/claude/hooks/hooks.json')) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ args?: string[] }> }>> }
    const approve = Object.values(hooks.hooks).flat().filter((h) => h.hooks.some((x) => x.args?.includes('approve')))
    expect(approve).toHaveLength(1)
    const m = /^\^mcp__plugin_dethereal_dethereal__\(([a-z_|]+)\)\$$/.exec(approve[0]!.matcher ?? '')
    expect(m?.[1]!.split('|').sort()).toEqual([...AUTO, ...Object.keys(autoActions(false))].sort())
    const files = (await fs.readdir(path.join(pkgRoot, 'bundles/claude'), { recursive: true })).map(String)
    expect(files.filter((f) => /(^|\/)settings(\.local)?\.json$/.test(f))).toEqual([])
    for (const f of files.filter((x) => x.endsWith('SKILL.md'))) {
      const allowed = /^allowed-tools:\s*(.*)$/m.exec(await read(`bundles/claude/${f}`))?.[1]
      if (allowed !== undefined) expect(allowed, f).toBe('Read(/${CLAUDE_SKILL_DIR}/*.md)')
    }
    expect(JSON.stringify(JSON.parse(await read('.claude-plugin/plugin.json')))).not.toMatch(/"permissions"|"allow"/)
  })
})
