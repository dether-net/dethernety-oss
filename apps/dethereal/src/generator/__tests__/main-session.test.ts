/**
 * What every harness's generated bundle grants its agents, and how the tools that ask are wired: the
 * main session's own tools reach no agent, no OpenCode allow rule reaches a tool that asks, and a
 * disposition (prepare and commit alike) asks the operator on every harness.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { FIXTURE_WORKFLOW, goldenFiles, packageGoldenFiles, WORKFLOW } from '../cli.js'
import { generate } from '../index.js'
import { leafMcpTools, MAIN_SESSION_ONLY } from '../targets/common.js'
import { AUTO_ACTIONS, approveOutput, autoActions } from '../../cli/approve.js'
import { manifestTool, TOOL_MANIFEST } from '../../tools/manifest.js'
import { wildcard } from '../../installer/writers/opencode/rules.js'
import type { Harness } from '../types.js'

vi.setConfig({ testTimeout: 60_000 })

const DISPOSITIONS = 'manage_dispositions'
const MAIN_ONLY = 'triage_review'
const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }

/** The bundles under test: the package's own workflow and the fixture, settlement off and on. */
const bundles = (harness: Harness): ReadonlyArray<readonly [string, ReadonlyMap<string, string>]> => [
  ['package', packageGoldenFiles(harness)],
  ['fixture', goldenFiles(harness)],
  ['package, settlement on', generate({ pkg, workflowDir: WORKFLOW, harness, settlement: true })],
  ['fixture, settlement on', generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness, settlement: true })],
]

function frontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  expect(m).not.toBeNull()
  return parse(m![1]!) as Record<string, unknown>
}

const agentFiles = (files: ReadonlyMap<string, string>, dir: string, ext: string) =>
  [...files].filter(([p]) => p.startsWith(`${dir}/`) && p.endsWith(ext))

/** A Claude tool rule: an exact name, or a name with `*` (any run). */
const claudeMatches = (rule: string, name: string) =>
  new RegExp(`^${rule.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name)

/** OpenCode rules as (permission, action) pairs; an object value is one rule per pattern. */
function rulesOf(permission: unknown): Array<{ permission: string; action: string }> {
  if (!permission || typeof permission !== 'object') return typeof permission === 'string' ? [{ permission: '*', action: permission }] : []
  return Object.entries(permission as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'string' ? [{ permission: key, action: value }] : Object.values(value as Record<string, string>).map((action) => ({ permission: key, action })),
  )
}

/** The allow rules whose permission pattern matches `tool` (by OpenCode's wildcard). */
const allowsFor = (permission: unknown, tool: string) => rulesOf(permission).filter((r) => r.action === 'allow' && wildcard(tool, r.permission))

describe('the main session’s own tools', () => {
  it('are auto-approved manifest tools, left out of what `mcp:*` means', () => {
    expect(MAIN_SESSION_ONLY).toEqual([MAIN_ONLY])
    for (const t of MAIN_SESSION_ONLY) expect(manifestTool(t)?.approval, t).toBe('auto')
    expect(leafMcpTools(['mcp:*'])).not.toContain(MAIN_ONLY)
    expect(leafMcpTools(['mcp:*'])).toEqual(TOOL_MANIFEST.filter((t) => t.approval === 'auto' && t.name !== MAIN_ONLY).map((t) => t.name).sort())
  })

  it('Claude: no agent can use triage_review — an agent granted the wildcard has it disallowed', () => {
    const name = `mcp__plugin_dethereal_dethereal__${MAIN_ONLY}`
    for (const [label, files] of bundles('claude')) {
      const agents = agentFiles(files, 'bundles/claude/agents', '.md')
      expect(agents.length, label).toBeGreaterThan(0)
      for (const [p, text] of agents) {
        const meta = frontmatter(text)
        // An agent without a tools list would inherit every tool.
        expect(Array.isArray(meta.tools), `${label} ${p}`).toBe(true)
        const granted = (meta.tools as string[]).some((rule) => claudeMatches(rule, name))
        const disallowed = ((meta.disallowedTools as string[] | undefined) ?? []).some((rule) => claudeMatches(rule, name))
        expect(!granted || disallowed, `${label} ${p}`).toBe(true)
        if ((meta.tools as string[]).includes('mcp__plugin_dethereal_dethereal__*')) expect(meta.disallowedTools, `${label} ${p}`).toContain(name)
      }
    }
  })

  it('Codex: no agent role, nor the allowlist its hook checks, grants triage_review', () => {
    const name = `mcp__dethereal__${MAIN_ONLY}`
    for (const [label, files] of bundles('codex')) {
      const agents = agentFiles(files, 'bundles/codex/agents', '.toml')
      expect(agents.length, label).toBeGreaterThan(0)
      for (const [p, text] of agents) {
        const line = text.split('\n').find((l) => l.startsWith('Dethereal tools you may use:')) ?? ''
        expect(line, `${label} ${p}`).not.toContain(name)
      }
      const allowlist = JSON.parse(files.get('bundles/codex/plugins/dethereal/bin/leaf-allowlist.json')!) as Record<string, { mcp: string[] }>
      expect(Object.keys(allowlist).length, label).toBe(agents.length)
      for (const [agent, entry] of Object.entries(allowlist)) expect(entry.mcp, `${label} ${agent}`).not.toContain(name)
    }
  })

  it('OpenCode: no agent permission allows triage_review, wildcards included, nor names it to the agent', () => {
    const name = `dethereal_${MAIN_ONLY}`
    for (const [label, files] of bundles('opencode')) {
      const agents = agentFiles(files, 'bundles/opencode/agents', '.md')
      expect(agents.length, label).toBeGreaterThan(0)
      for (const [p, text] of agents) {
        expect(allowsFor(frontmatter(text).permission, name), `${label} ${p}`).toEqual([])
        expect(text.split('\n').find((l) => l.startsWith('Dethereal tools you may use:')) ?? '', `${label} ${p}`).not.toContain(name)
      }
    }
  })
})

describe('OpenCode: no allow rule reaches a tool that asks', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'opencode-allows-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const asking = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => `dethereal_${t.name}`)

  it('holds for manage_dispositions in the fragment, every agent and the plugin, as written and as the plugin leaves the configuration', async () => {
    expect(asking).toContain(`dethereal_${DISPOSITIONS}`)
    for (const [label, files] of bundles('opencode')) {
      const fragment = JSON.parse(files.get('bundles/opencode/mcp.fragment.json')!) as { permission: unknown; agent: Record<string, { permission: unknown }> }
      const agents = agentFiles(files, 'bundles/opencode/agents', '.md').map(([p, text]) => [path.basename(p, '.md'), frontmatter(text).permission] as const)
      const plugin = files.get('bundles/opencode/plugins/dethereal.ts')!
      // Every `'<pattern>': 'allow'` the plugin's source writes.
      const pluginAllows = [...plugin.matchAll(/['"]([^'"\n]+)['"]\s*:\s*['"]allow['"]/g)].map((m) => m[1]!)

      // The configuration as installed, then as the plugin's config hook leaves it.
      const file = path.join(tmp, `${label.replace(/\W+/g, '-')}.ts`)
      writeFileSync(file, plugin)
      const mod = (await import(pathToFileURL(file).href)) as { DetherealPlugin: (ctx: { directory: string }) => Promise<Record<string, (c: unknown, o: unknown) => Promise<void>>> }
      const hooks = await mod.DetherealPlugin({ directory: tmp })
      const config: { permission: unknown; agent: Record<string, { permission?: unknown }> } = {
        permission: structuredClone(fragment.permission),
        agent: { ...structuredClone(fragment.agent), ...Object.fromEntries(agents.map(([n, perm]) => [n, { permission: structuredClone(perm) }])) },
      }
      await hooks.config!(config, {})

      for (const tool of asking) {
        expect(allowsFor(fragment.permission, tool), `${label} fragment ${tool}`).toEqual([])
        for (const [agent, permission] of Object.entries(fragment.agent)) expect(allowsFor(permission.permission, tool), `${label} fragment ${agent} ${tool}`).toEqual([])
        for (const [agent, permission] of agents) expect(allowsFor(permission, tool), `${label} ${agent} ${tool}`).toEqual([])
        expect(pluginAllows.filter((pattern) => wildcard(tool, pattern)), `${label} plugin ${tool}`).toEqual([])
        expect(allowsFor(config.permission, tool), `${label} configured ${tool}`).toEqual([])
        for (const [agent, a] of Object.entries(config.agent)) expect(allowsFor(a.permission, tool), `${label} configured ${agent} ${tool}`).toEqual([])
      }
    }
  })

  it('an agent granted `mcp:*` gets one allow per tool it stands for, and no wildcard allow', () => {
    for (const [label, files] of bundles('opencode')) {
      for (const [p, text] of agentFiles(files, 'bundles/opencode/agents', '.md')) {
        const permission = frontmatter(text).permission as Record<string, unknown>
        for (const [key, value] of Object.entries(permission)) if (value === 'allow' && key.includes('*')) expect(key, `${label} ${p}`).not.toMatch(/^dethereal|^\*$/)
      }
    }
    const lead = frontmatter(goldenFiles('opencode').get('bundles/opencode/agents/dethereal-lead.md')!).permission as Record<string, unknown>
    const allowed = Object.entries(lead).filter(([k, v]) => k.startsWith('dethereal_') && v === 'allow').map(([k]) => k.slice('dethereal_'.length))
    expect(allowed.sort()).toEqual(leafMcpTools(['mcp:*']))
  })
})

describe('a disposition asks the operator on every harness, at prepare and at commit', () => {
  const tool = manifestTool(DISPOSITIONS)!

  it('is an approval-required tool with prepare and commit', () => {
    expect(tool.approval).toBe('prompt')
    expect(tool.actions).toEqual(['prepare', 'commit'])
  })

  it('Claude: the approve hook is not routed it, and approves neither action', () => {
    const name = `mcp__plugin_dethereal_dethereal__${DISPOSITIONS}`
    for (const [label, files] of bundles('claude')) {
      const hooks = JSON.parse(files.get('bundles/claude/hooks/hooks.json')!) as { hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ args: string[] }> }> } }
      const approve = hooks.hooks.PreToolUse.filter((h) => h.hooks.some((x) => x.args.includes('approve')))
      expect(approve.length, label).toBe(1)
      expect(new RegExp(approve[0]!.matcher).test(name), label).toBe(false)
    }
    expect(Object.keys(AUTO_ACTIONS)).not.toContain(DISPOSITIONS)
    for (const on of [true, false]) expect(Object.keys(autoActions(on))).not.toContain(DISPOSITIONS)
    for (const action of tool.actions!) {
      for (const mode of ['on', 'off'] as const) {
        expect(approveOutput(JSON.stringify({ tool_name: name, tool_input: { action } }), mode), `${action} ${mode}`).toBe('')
      }
    }
  })

  it('Codex: the fragment approves it nowhere, and every tool not approved prompts', () => {
    for (const [label, files] of bundles('codex')) {
      const fragment = files.get('bundles/codex/config.fragment.toml')!
      expect(fragment, label).toMatch(/^default_tools_approval_mode = "prompt"$/m)
      expect(fragment, label).not.toContain(`[mcp_servers.dethereal.tools.${DISPOSITIONS}]`)
      expect(fragment, label).not.toMatch(new RegExp(`${DISPOSITIONS}[\\s\\S]*?approval_mode = "approve"`))
      const approved = [...fragment.matchAll(/^\[mcp_servers\.dethereal\.tools\.([a-z_]+)\]\napproval_mode = "approve"$/gm)].map((m) => m[1])
      expect(approved, label).not.toContain(DISPOSITIONS)
    }
  })

  it('OpenCode: the fragment asks for it, and the plugin sets it to ask again over later configuration', () => {
    for (const [label, files] of bundles('opencode')) {
      const fragment = JSON.parse(files.get('bundles/opencode/mcp.fragment.json')!) as { permission: Record<string, string> }
      expect(fragment.permission[`dethereal_${DISPOSITIONS}`], label).toBe('ask')
      const asks = /const ASK_TOOLS: readonly string\[\] = (\[[^\]]*\])/.exec(files.get('bundles/opencode/plugins/dethereal.ts')!)
      expect(asks, label).not.toBeNull()
      expect(JSON.parse(asks![1]!), label).toContain(`dethereal_${DISPOSITIONS}`)
    }
  })
})
