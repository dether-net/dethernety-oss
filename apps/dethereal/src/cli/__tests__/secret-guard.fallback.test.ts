/**
 * Claude Code's secret guard when the full check fails: a shell command is judged by the names it holds, against the
 * same homes the Codex runner reads (Codex's, set or default, and Claude Code's configuration directory). Nothing a
 * command can spell makes the full check fail today, so the failure is put in by hand.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../secret-guard.js', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  decideSecretAccess: () => {
    throw new Error('the full check failed')
  },
}))

const { runCli } = await import('../index.js')
const { rawEventFrom } = await import('../config-guard.js')

/** The guard's answer to a shell command, with only `env`'s homes set (an empty value reads as unset). */
const judged = async (command: string, env: Record<string, string> = {}) => {
  vi.unstubAllEnvs()
  for (const [k, v] of Object.entries({ CODEX_HOME: '', CLAUDE_CONFIG_DIR: '', ...env })) vi.stubEnv(k, v)
  const out: string[] = []
  const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
  const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => rawEventFrom(event) }
  expect(await runCli(['hook', 'secret-guard', '--harness', 'claude'], io as never)).toBe(0)
  if (out.join('') === '') return 'run'
  const decision = JSON.parse(out.join('')).hookSpecificOutput
  // Only the fallback's own refusal: the full check never ran.
  expect(decision.permissionDecisionReason).toBe('dethereal-secret-guard: this call could not be checked for secret files (an internal error), so it is not run.')
  return decision.permissionDecision
}

afterEach(() => vi.unstubAllEnvs())

describe('the secret guard when its full check fails', () => {
  it('refuses a command naming Codex\'s sign-in or Claude Code\'s plugin cache, wherever the environment puts them', async () => {
    expect(await judged('cat ~/.codex/auth.json')).toBe('deny')
    expect(await judged('cp x ~/.claude/plugins/cache/m/dethereal/1/bin/hook.mjs')).toBe('deny')
    expect(await judged('ls -la')).toBe('run')
    const homes = { CODEX_HOME: '/opt//cx/', CLAUDE_CONFIG_DIR: '/cfg/x/../claude' }
    for (const command of ['cat /opt/cx/auth.json', 'cp e /opt/cx/plugins/c/x.mjs', 'cp x /cfg/claude/plugins/cache/h.mjs', 'echo {} > /cfg/claude/settings.json']) {
      expect([command, await judged(command)]).toEqual([command, 'run'])
      expect([command, await judged(command, homes)]).toEqual([command, 'deny'])
    }
    expect(await judged('cat /cfg/claude/notes.md', homes)).toBe('run')
    // Spelled through the variables, too.
    expect(await judged('cat "$CODEX_HOME/auth.json"', homes)).toBe('deny')
    expect(await judged('cp x ${CLAUDE_CONFIG_DIR}/plugins/h.mjs', homes)).toBe('deny')
    expect(await judged('cat ~/.claude/.credentials.json')).toBe('deny')
  })

  it('names what is written under a relative CODEX_HOME, and reads a relative CLAUDE_CONFIG_DIR as unset', async () => {
    const relative = { CODEX_HOME: 'cx', CLAUDE_CONFIG_DIR: 'cfg' }
    expect(await judged('cat cx/auth.json', relative)).toBe('deny')
    expect(await judged('cp x cfg/plugins/h.mjs', relative)).toBe('run')
    // Codex's default home still counts.
    expect(await judged('cat ~/.codex/auth.json', relative)).toBe('deny')
  })
})
