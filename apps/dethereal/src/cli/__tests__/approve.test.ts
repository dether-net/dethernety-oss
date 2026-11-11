import { describe, it, expect, afterEach, vi } from 'vitest'
import { approveOutput, AUTO_ACTIONS, AUTO_TOOLS, autoActions, CLAUDE_MCP_PREFIX } from '../approve.js'
import { runCli } from '../index.js'
import { TOOL_MANIFEST } from '../../tools/manifest.js'

const event = (tool: unknown) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} })

describe('hook approve', () => {
  it('approves exactly the manifest auto tools', () => {
    expect([...AUTO_TOOLS].sort()).toEqual(TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name).sort())
    expect(AUTO_TOOLS.length).toBeGreaterThanOrEqual(16)
    for (const name of AUTO_TOOLS) {
      const out = JSON.parse(approveOutput(event(`${CLAUDE_MCP_PREFIX}${name}`))) as { hookSpecificOutput: Record<string, string> }
      expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse')
      expect(out.hookSpecificOutput.permissionDecision, name).toBe('allow')
    }
  })

  it('says nothing for any other tool, so the harness asks as usual', () => {
    for (const t of TOOL_MANIFEST.filter((m) => m.approval !== 'auto')) expect(approveOutput(event(`${CLAUDE_MCP_PREFIX}${t.name}`)), t.name).toBe('')
    for (const other of ['Write', 'Bash', 'mcp__other__auth_status', `${CLAUDE_MCP_PREFIX}model_state_settle`, `${CLAUDE_MCP_PREFIX}model_state `, `x${CLAUDE_MCP_PREFIX}auth_status`, 'auth_status', 42, null]) {
      expect(approveOutput(event(other)), String(other)).toBe('')
    }
  })

  it('approves a settlement\'s prepare, which writes nothing, and asks for its commit and for a settle', () => {
    const settle = `${CLAUDE_MCP_PREFIX}model_state_settle`
    const call = (tool: string, input: unknown) => approveOutput(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }))
    const out = JSON.parse(call(settle, { action: 'prepare', directory_path: 'm', items: [] })) as { hookSpecificOutput: Record<string, string> }
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow')
    for (const input of [{ action: 'commit', plan_id: '0'.repeat(32), reply: 'yes' }, { action: 'settle', items: [], reply: 'yes' }, {}, { action: ['prepare'] }, { action: 'Prepare' }, null, ['prepare']]) {
      expect(call(settle, input), JSON.stringify(input)).toBe('')
    }
    expect(call(`${CLAUDE_MCP_PREFIX}model_state_prune`, { action: 'prepare' })).toBe('')
  })

  describe('the settlement switch', () => {
    afterEach(() => vi.unstubAllEnvs())
    const settlePrepare = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: `${CLAUDE_MCP_PREFIX}model_state_settle`, tool_input: { action: 'prepare' } })

    it('approves no settle action with the settlement off, as the server does not serve the tool', () => {
      expect(autoActions(false)).not.toHaveProperty('model_state_settle')
      expect(autoActions(true)).toEqual(AUTO_ACTIONS)
      vi.stubEnv('DETHEREAL_SETTLEMENT', '')
      expect(approveOutput(settlePrepare)).toBe('')
      // The auto tools are the same either way.
      expect(approveOutput(event(`${CLAUDE_MCP_PREFIX}auth_status`))).toMatch(/"allow"/)
    })

    it('approves the settle prepare with the settlement on', () => {
      vi.stubEnv('DETHEREAL_SETTLEMENT', '')
      expect(approveOutput(settlePrepare, 'on')).toMatch(/"allow"/)
    })

    it('takes the hook\'s flag, or the exact environment value', async () => {
      vi.stubEnv('DETHEREAL_SETTLEMENT', '')
      const run = async (args: string[]) => {
        const out: string[] = []
        expect(await runCli(['hook', 'approve', '--harness', 'claude', ...args], { stdout: (t: string) => out.push(t), stderr: () => {}, stdin: async () => settlePrepare })).toBe(0)
        return out.join('')
      }
      expect(await run([])).toBe('')
      expect(await run(['--settlement'])).toMatch(/"allow"/)
      vi.stubEnv('DETHEREAL_SETTLEMENT', 'ON')
      expect(await run([])).toBe('')
      vi.stubEnv('DETHEREAL_SETTLEMENT', 'on')
      expect(await run([])).toMatch(/"allow"/)
    })
  })

  it('says nothing for a malformed or missing event', () => {
    for (const raw of [null, '', 'not json', '[]', '"x"', '{"tool_name":{}}']) expect(approveOutput(raw), String(raw)).toBe('')
  })

  it('never denies or asks', () => {
    for (const name of AUTO_TOOLS) expect(approveOutput(event(`${CLAUDE_MCP_PREFIX}${name}`))).not.toMatch(/"(deny|ask)"/)
  })

  it('runs as a hook that exits 0', async () => {
    const out: string[] = []
    const io = { stdout: (t: string) => out.push(t), stderr: () => {}, stdin: async () => event(`${CLAUDE_MCP_PREFIX}auth_status`) }
    expect(await runCli(['hook', 'approve', '--harness', 'claude'], io)).toBe(0)
    expect(out.join('')).toContain('"permissionDecision":"allow"')
    const quiet: string[] = []
    expect(await runCli(['hook', 'approve'], { ...io, stdout: (t: string) => quiet.push(t), stdin: async () => event('Bash') })).toBe(0)
    expect(quiet).toEqual([])
  })
})
