/**
 * The package root holds the bundles the package ships, generated from `workflow/` and committed:
 * the Claude plugin (`.claude-plugin/plugin.json` and `bundles/claude/`) and the Codex and OpenCode
 * bundles (`bundles/codex/`, `bundles/opencode/`). These tests keep the committed files equal to the
 * generator's output, keep Claude Code from loading anything beside them, and hold the generated
 * plugin to everything the hand-written one offered.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { committedPackageRootFiles, PKG_ROOT, packageRootFiles } from '../cli.js'
import { LEGACY_ROOT_PATHS } from '../targets/claude/index.js'
import { TOOL_MANIFEST } from '../../tools/manifest.js'
import { AUTO_ACTIONS, autoActions } from '../../cli/approve.js'

const legacy = JSON.parse(readFileSync(path.join(PKG_ROOT, 'src', 'generator', 'fixtures', 'legacy-claude-plugin.json'), 'utf8')) as {
  manifest: Record<string, unknown>
  skills: Record<string, string>
  agents: Record<string, string>
  hooks: Record<string, string[]>
  mcpServers: string[]
}

const committed = committedPackageRootFiles()
const manifest = JSON.parse(committed.get('.claude-plugin/plugin.json') ?? '{}') as Record<string, unknown>
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { name: string; version: string; files: string[] }

type HookEntry = { matcher: string; hooks: { type: string; command: string; args: string[]; timeout: number; onFailure?: string }[] }
const hooks = (JSON.parse(committed.get('bundles/claude/hooks/hooks.json') ?? '{}') as { hooks?: Record<string, HookEntry[]> }).hooks ?? {}

describe('the package root', () => {
  it('holds exactly what the generator emits — run golden:update after a workflow change', () => {
    const generated = packageRootFiles()
    expect([...committed.keys()].sort()).toEqual([...generated.keys()].sort())
    for (const [p, content] of generated) expect(committed.get(p), p).toBe(content)
  })

  it('holds none of the paths Claude Code would load on top of the manifest', () => {
    expect(LEGACY_ROOT_PATHS.filter((p) => existsSync(path.join(PKG_ROOT, p)))).toEqual([])
  })

  it('names the package version, which names the installed plugin directory', () => {
    expect(manifest.name).toBe('dethereal')
    expect(manifest.version).toBe(pkg.version)
  })

  it('holds a bundle for every harness, each at the package version', () => {
    for (const harness of ['claude', 'codex', 'opencode']) {
      const bundle = JSON.parse(committed.get(`bundles/${harness}/bundle.json`) ?? '{}') as { version?: string }
      expect(bundle.version, harness).toBe(pkg.version)
    }
  })

  it('points the manifest at the generated bundle only', () => {
    expect(manifest.skills).toEqual(['./bundles/claude/skills/'])
    expect(manifest.hooks).toBe('./bundles/claude/hooks/hooks.json')
    expect(manifest.mcpServers).toBe('./bundles/claude/.mcp.json')
    for (const agent of manifest.agents as string[]) expect(agent).toMatch(/^\.\/bundles\/claude\/agents\/[a-z-]+\.md$/)
  })

  it('runs the server it ships, never a package fetched at run time', () => {
    const mcp = JSON.parse(committed.get('bundles/claude/.mcp.json')!) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }
    expect(Object.keys(mcp.mcpServers)).toEqual(legacy.mcpServers)
    const server = mcp.mcpServers.dethereal!
    expect(server.command).toBe('node')
    expect(server.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/index.js'])
    // The shell's DETHERNETY_URL reaches the server through the inherited environment and wins.
    expect(server.env).toEqual({ DETHERNETY_PLATFORM_URL: '${user_config.platform_url}' })
    expect(committed.get('bundles/claude/.mcp.json')).not.toMatch(/npx|@dether\.net\/dethereal@/)
  })
})

describe('the generated plugin keeps what the hand-written one offered', () => {
  it('every skill, under the same name', () => {
    for (const name of Object.keys(legacy.skills)) {
      const skill = committed.get(`bundles/claude/skills/${name}/SKILL.md`)
      expect(skill, name).toBeDefined()
      expect(skill!.match(/^name: (.+)$/m)?.[1], name).toBe(name)
    }
  })

  it('every agent, under the same name', () => {
    const agents = (manifest.agents as string[]).map((p) => path.basename(p, '.md'))
    expect(agents).toEqual(expect.arrayContaining(Object.keys(legacy.agents)))
  })

  it('every hook event, run as argv from the shipped server', () => {
    // Session start covered every source; it still does, a fork reporting as a resume.
    expect(legacy.hooks.SessionStart).toEqual([''])
    expect(hooks.SessionStart!.map((h) => h.matcher)).toEqual(['startup', 'resume', 'clear', 'compact', 'fork'])
    expect(hooks.SessionStart!.map((h) => h.hooks[0]!.args[4])).toEqual(['startup', 'resume', 'clear', 'compact', 'resume'])
    // The post-write hint follows every tool the hand-written matcher did.
    for (const tool of legacy.hooks.PostToolUse![0]!.split('|')) expect(hooks.PostToolUse![0]!.matcher.split('|')).toContain(tool)
    // The state before a compaction now reaches the model after it, on the compact session start.
    expect(legacy.hooks.PreCompact).toEqual([''])
    expect(hooks.PreCompact).toBeUndefined()
    // New: writes to harness configuration are guarded, the auto-approved tools are approved, and
    // reads of secret files are refused. The matchers are disjoint, so their order decides nothing.
    expect(hooks.PreToolUse!.map((h) => h.hooks[0]!.args[2])).toEqual(['config-guard', 'approve', 'secret-guard'])
    expect(hooks.PreToolUse![0]!.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit')
    expect(hooks.PreToolUse![2]!.matcher).toBe('^(Read|Grep|Bash)$')
    expect(hooks.PreToolUse![2]!.hooks[0]!.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/index.js', 'hook', 'secret-guard', '--harness', 'claude'])
    expect(hooks.PreToolUse![2]!.hooks[0]!.timeout).toBe(10)
    for (const tool of ['Read', 'Grep', 'Bash']) expect(new RegExp(hooks.PreToolUse![2]!.matcher).test(tool), tool).toBe(true)
    for (const tool of ['Glob', 'ReadMcpResource', 'Write', 'mcp__plugin_dethereal_dethereal__get_classes']) expect(new RegExp(hooks.PreToolUse![2]!.matcher).test(tool), tool).toBe(false)
    for (const entry of Object.values(hooks).flat()) {
      for (const h of entry.hooks) {
        expect(h.command).toBe('node')
        expect(h.args.slice(0, 2)).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/index.js', 'hook'])
        expect(h.args.at(-2)).toBe('--harness')
        expect(h.args.at(-1)).toBe('claude')
        expect(h.timeout).toBeGreaterThan(0)
        // A hook naming an unset plugin option fails to run, so no hook names one.
        expect(JSON.stringify(h)).not.toContain('user_config')
      }
    }
  })

  it('has Claude Code block a call when a guard cannot answer, and only for the two guards', () => {
    const blocking = Object.values(hooks).flat().flatMap((e) => e.hooks).filter((h) => h.onFailure !== undefined)
    expect(blocking.map((h) => [h.args[2], h.onFailure])).toEqual([['config-guard', 'block'], ['secret-guard', 'block']])
    expect(hooks.PreToolUse!.map((e) => e.hooks[0]!.onFailure)).toEqual(['block', undefined, 'block'])
  })
})

describe('the approve hook', () => {
  it('matches exactly the manifest auto tools and the tools with an auto-approved action, by literal anchored names; settlement off leaves its tool out', () => {
    const matcher = hooks.PreToolUse!.find((h) => h.hooks[0]!.args[2] === 'approve')!.matcher
    const m = matcher.match(/^\^mcp__plugin_dethereal_dethereal__\(([a-z_|]+)\)\$$/)
    expect(m, matcher).not.toBeNull()
    const routed = [...TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name), ...Object.keys(autoActions(false))]
    expect(m![1]!.split('|').sort()).toEqual(routed.sort())
    const re = new RegExp(matcher)
    for (const t of TOOL_MANIFEST) expect(re.test(`mcp__plugin_dethereal_dethereal__${t.name}`), t.name).toBe(routed.includes(t.name))
    // Routed to the hook is not approved: for model_state_settle it approves prepare only (approve.test.ts).
    expect(Object.keys(AUTO_ACTIONS)).toEqual(['model_state_settle'])
  })
})

describe('the published files', () => {
  it('ship the generated plugin and the server, and none of the legacy paths', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', '.claude-plugin', 'bundles/claude']))
    for (const p of [...LEGACY_ROOT_PATHS, 'docs', 'scripts']) expect(pkg.files, p).not.toContain(p)
  })
})
