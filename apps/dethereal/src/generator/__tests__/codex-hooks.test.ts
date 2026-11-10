import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseToml } from 'smol-toml'
import { afterAll, describe, expect, it } from 'vitest'
import { PACKAGE_GOLDENS } from '../cli.js'
import { COLLABORATION_TOOLS } from '../targets/codex/renderer.js'
import { SESSION_SOURCES } from '../../cli/session-start.js'

const BUNDLE = path.join(PACKAGE_GOLDENS, 'codex', 'bundles', 'codex')
const PLUGIN = path.join(BUNDLE, 'plugins', 'dethereal')
const read = (p: string) => readFileSync(path.join(PLUGIN, p), 'utf8')

describe('the Codex plugin hooks', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>>
  const commands = (event: string) => hooks[event]!.map((g) => g.hooks.map((h) => h.command))

  it('declares every hook now, in a fixed order, with version-stable commands', () => {
    expect(Object.keys(hooks)).toEqual(['SessionStart', 'PreToolUse', 'PostToolUse'])
    expect(hooks.SessionStart!.map((g) => g.matcher)).toEqual(['startup', 'resume', 'clear', 'compact'])
    expect(commands('SessionStart')).toEqual(['startup', 'resume', 'clear', 'compact'].map((s) => [`node "\${PLUGIN_ROOT}/bin/hook.mjs" session-start --source ${s} --harness codex`]))
    // every source the hook declares is one the CLI accepts
    for (const g of hooks.SessionStart!) expect(SESSION_SOURCES as readonly string[], g.matcher).toContain(g.matcher)
    expect(hooks.PreToolUse!.map((g) => g.matcher)).toEqual([
      '^mcp__|(spawn_agent|send_message|followup_task|wait_agent|close_agent|resume_agent|list_agents|interrupt_agent|apply_patch)$',
      '^Bash$',
      '^apply_patch$',
    ])
    expect(commands('PreToolUse')).toEqual([
      ['node "${PLUGIN_ROOT}/bin/pre-tool-use.mjs"'],
      ['node "${PLUGIN_ROOT}/bin/hook.mjs" secret-guard --harness codex'],
      ['node "${PLUGIN_ROOT}/bin/hook.mjs" config-guard --harness codex'],
    ])
    expect(hooks.PostToolUse!.map((g) => g.matcher)).toEqual(['Edit|Write'])
    expect(commands('PostToolUse')).toEqual([['node "${PLUGIN_ROOT}/bin/hook.mjs" post-write --harness codex']])
    for (const group of Object.values(hooks).flat()) for (const h of group.hooks) {
      expect(h.type).toBe('command')
      expect(h.timeout).toBeGreaterThan(0)
      expect(h.timeout).toBeLessThanOrEqual(15)
    }
  })

  it('checks the collaboration tools whether or not Codex prefixes them, and every MCP server', () => {
    const matcher = new RegExp(hooks.PreToolUse![0]!.matcher)
    for (const tool of ['spawn_agent', 'collaborationspawn_agent', 'collaboration.wait_agent', 'close_agent', 'collaborationinterrupt_agent', 'apply_patch', 'mcp__dethereal__model_state', 'mcp__other__x']) expect(matcher.test(tool), tool).toBe(true)
    for (const tool of ['Bash', 'exec_command', 'write_stdin', 'update_plan']) expect(matcher.test(tool), tool).toBe(false)
  })

  it("lists each agent's own tools, and lists the plugin's files in bundle.json", () => {
    const list = JSON.parse(read('bin/leaf-allowlist.json')) as Record<string, { mcp: string[]; write: boolean }>
    for (const [name, entry] of Object.entries(list)) {
      const agent = parseToml(readFileSync(path.join(BUNDLE, 'agents', `${name}.toml`), 'utf8')) as Record<string, string>
      const granted = /Dethereal tools you may use: ([^\n]*)\. Use no other Dethereal tool\./.exec(agent.developer_instructions!)
      expect(entry.mcp, name).toEqual(granted ? [...granted[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [])
      expect(entry.write, name).toBe(agent.sandbox_mode === 'workspace-write')
    }
    const bundle = readFileSync(path.join(BUNDLE, 'bundle.json'), 'utf8')
    for (const f of ['hooks/hooks.json', 'bin/pre-tool-use.mjs', 'bin/hook.mjs', 'bin/leaf-allowlist.json']) expect(bundle, f).toContain(`plugins/dethereal/${f}`)
  })

  it('checks in the hook script the same collaboration tools the matcher selects', () => {
    const listed = /const COLLABORATION = new Set\(\[([^\]]*)\]\)/.exec(read('bin/pre-tool-use.mjs'))
    expect([...listed![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...COLLABORATION_TOOLS])
  })

  it('ships scripts that need nothing but node itself', () => {
    for (const script of ['bin/pre-tool-use.mjs', 'bin/hook.mjs']) {
      for (const m of read(script).matchAll(/^\s*import .* from '([^']+)'/gm)) expect(m[1], script).toMatch(/^node:/)
    }
  })

  it('tells the orchestrator what to do without close_agent', () => {
    const skill = readFileSync(path.join(PLUGIN, 'skills', 'threat-model', 'guided-classify.md'), 'utf8')
    expect(skill).toContain("if you have no `close_agent` tool, go on, and if a later `spawn_agent` fails on the agent limit, stop and tell the operator.")
  })
})

describe('the allowlist hook, run as a process', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-hook-'))
  // A home with no installed runtime: the hook runner never looks at the real one.
  const home = mkdtempSync(path.join(tmpdir(), 'codex-hook-home-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })
  for (const f of ['pre-tool-use.mjs', 'leaf-allowlist.json', 'hook.mjs', 'hook-deadlines.json', 'runtime-check.mjs', 'secret-fallback.mjs', 'shell-check.mjs']) writeFileSync(path.join(dir, f), read(`bin/${f}`))
  const run = (input: string, script = 'pre-tool-use.mjs', args: readonly string[] = []) => {
    const r = spawnSync(process.execPath, [path.join(dir, script), ...args], { input, cwd: tmpdir(), encoding: 'utf8', timeout: 15000, env: { HOME: home, PATH: process.env.PATH } })
    expect(r.status, `${script} exit`).toBe(0)
    return r.stdout
  }
  const event = (fields: Record<string, unknown>) => JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/w', tool_input: {}, ...fields })
  const denied = (out: string) => {
    const parsed = JSON.parse(out)
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput'])
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/^Dethereal: \S/)
    // Codex adds a full stop after the reason
    expect(parsed.hookSpecificOutput.permissionDecisionReason).not.toMatch(/\.$/)
    return parsed.hookSpecificOutput.permissionDecisionReason as string
  }

  it('lets the main thread and other agents through, printing nothing', () => {
    expect(run(event({ tool_name: 'mcp__dethereal__update_model' }))).toBe('')
    expect(run(event({ tool_name: 'spawn_agent', agent_type: null }))).toBe('')
    expect(run(event({ tool_name: 'apply_patch', agent_type: 'worker' }))).toBe('')
  })

  it("lets an agent use its own tools and denies the rest, naming what it may use", () => {
    expect(run(event({ tool_name: 'mcp__dethereal__get_classes', agent_type: 'dethereal-infrastructure-scout' }))).toBe('')
    expect(denied(run(event({ tool_name: 'mcp__dethereal__model_state', agent_type: 'dethereal-infrastructure-scout' })))).toContain('may use mcp__dethereal__get_classes')
    expect(denied(run(event({ tool_name: 'mcp__probe__probe_b', agent_type: 'dethereal-infrastructure-scout' })))).toContain('only Dethereal tools')
    expect(run(event({ tool_name: 'apply_patch', agent_type: 'dethereal-security-enricher' }))).toBe('')
    expect(denied(run(event({ tool_name: 'apply_patch', agent_type: 'dethereal-model-reviewer' })))).toContain('may not change files')
  })

  it('denies every collaboration tool to an agent, prefixed or not', () => {
    for (const tool of ['spawn_agent', 'collaborationspawn_agent', 'collaboration.wait_agent', 'close_agent', 'send_message', 'collaborationinterrupt_agent']) {
      expect(denied(run(event({ tool_name: tool, agent_type: 'dethereal-threat-modeler' }))), tool).toContain('may not start, message or manage other agents')
    }
  })

  it('fails closed for an agent: unreadable input, an unknown agent, a missing tool list', () => {
    expect(denied(run('{"agent_type": "dethereal-infrastructure-scout", "tool_name": '))).toContain('could not be read')
    expect(run('{"agent_type": null, "tool_name": ')).toBe('')
    expect(denied(run(event({ tool_name: 'mcp__dethereal__get_classes', agent_type: 'dethereal-foo' })))).toContain('not a known Dethereal agent')
    expect(denied(run(event({ agent_type: 'dethereal-infrastructure-scout' })))).toContain('names no tool')
    rmSync(path.join(dir, 'leaf-allowlist.json'))
    try {
      expect(denied(run(event({ tool_name: 'mcp__dethereal__get_classes', agent_type: 'dethereal-infrastructure-scout' })))).toContain('tool list could not be read')
      expect(run(event({ tool_name: 'mcp__dethereal__get_classes' }))).toBe('')
    } finally {
      writeFileSync(path.join(dir, 'leaf-allowlist.json'), read('bin/leaf-allowlist.json'))
    }
  })

  it('without an installed runtime, judges the guards by name and says so at session start', () => {
    const guard = (sub: string, fields: Record<string, unknown>) => run(event(fields), 'hook.mjs', [sub, '--harness', 'codex'])
    expect(denied(guard('secret-guard', { tool_name: 'Bash', tool_input: { command: 'cat .env' } }))).toContain('could not be verified')
    // by name only, a read of a plugin file cannot be told from a write to it
    expect(denied(guard('secret-guard', { tool_name: 'Bash', tool_input: { command: 'cat ~/.codex/plugins/cache/x/SKILL.md' } }))).toContain('could not be verified')
    expect(guard('secret-guard', { tool_name: 'Bash', tool_input: { command: 'cat README.md' } })).toBe('')
    expect(denied(guard('config-guard', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: .codex/config.toml\n@@\n-a\n+b\n*** End Patch' } }))).toContain('could not be verified')
    expect(guard('config-guard', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: notes.txt\n+hi\n*** End Patch' } })).toBe('')
    const start = JSON.parse(run('{}', 'hook.mjs', ['session-start', '--source', 'startup', '--harness', 'codex'])) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
    expect(start.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(start.hookSpecificOutput.additionalContext).toMatch(/could not be verified/)
    expect(run(JSON.stringify({ hook_event_name: 'PostToolUse' }), 'hook.mjs', ['post-write', '--harness', 'codex'])).toBe('')
  })

  describe('on the events Codex sent in a live session', () => {
    const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-hooks')
    const recorded = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f, ...(JSON.parse(readFileSync(path.join(FIXTURES, f), 'utf8')) as { argv: string[]; event: Record<string, unknown> & { tool_name?: string; hook_event_name: string } }) }))
    const checked = new RegExp((JSON.parse(read('hooks/hooks.json')) as { hooks: { PreToolUse: Array<{ matcher: string }> } }).hooks.PreToolUse[0]!.matcher)

    it('has the shapes the hooks rely on', () => {
      expect(recorded.length).toBeGreaterThan(10)
      for (const r of recorded) {
        // a main-thread call carries no agent_type key at all; an agent's call names its type
        if (r.name.endsWith('__main.json')) expect(r.event, r.name).not.toHaveProperty('agent_type')
        else expect(r.event.agent_type, r.name).toMatch(/^dethereal-/)
      }
      const tools = new Set(recorded.map((r) => r.event.tool_name))
      for (const t of ['Bash', 'apply_patch', 'collaborationspawn_agent', 'collaborationwait_agent', 'mcp__dethereal__workspace_status']) expect(tools, t).toContain(t)
      for (const r of recorded.filter((x) => x.event.tool_name === 'Bash')) expect(typeof (r.event.tool_input as { command?: unknown }).command, r.name).toBe('string')
    })

    it('sent to the allowlist hook exactly the calls its matcher selects', () => {
      for (const r of recorded.filter((x) => x.event.hook_event_name === 'PreToolUse')) {
        expect(checked.test(r.event.tool_name!), r.name).toBe(r.argv.length === 0 || r.event.tool_name === 'apply_patch')
      }
    })

    it('denies only the agent call outside its tools, and lets the rest through', () => {
      for (const r of recorded.filter((x) => x.event.hook_event_name === 'PreToolUse' && checked.test(x.event.tool_name!))) {
        const out = run(JSON.stringify(r.event))
        if (r.name === 'PreToolUse__collaborationlist_agents__dethereal-infrastructure-scout.json') expect(denied(out), r.name).toContain('may not start, message or manage other agents')
        else expect(out, r.name).toBe('')
      }
    })

    it('judges them by name when no runtime is installed, and says so at session start', () => {
      for (const r of recorded.filter((x) => x.argv.length > 0)) {
        // the recordings stand `<home>` for the home folder they were taken in
        const out = run(JSON.stringify(r.event).replaceAll('<home>', home), 'hook.mjs', r.argv)
        const command = (r.event.tool_input as { command?: string } | undefined)?.command ?? ''
        // the recorded reviewer read a skill file from Codex's plugin cache: refused by name
        const named = r.argv[0] === 'secret-guard' && /\.codex\/plugins\//.test(command)
        if (r.argv[0] === 'session-start' || named) expect(out, r.name).toMatch(/could not be verified/)
        else expect(out, r.name).toBe('')
      }
    })
  })
})
