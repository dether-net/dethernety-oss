import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { decideConfigWrite, GUARD_EVENT_CAP, guardOutput, rawEventFrom, readGuardEvent, type GuardEnv } from '../config-guard.js'
import { judgeConfigEdit, parseToml, SETTLEMENT_ENV } from '../config-content.js'
import { SETTLEMENT_ENV as SERVER_SETTLEMENT_ENV } from '../../utils/settlement-switch.js'
import { runCli } from '../index.js'

const SETTLE = 'mcp__plugin_dethereal_dethereal__model_state_settle'
const GRANT = `allowed-tools: ${SETTLE}`

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'config-guard-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(project, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** A guard environment whose files are `files` (by absolute path); a file listed as null cannot be read. */
function env(overrides: Partial<GuardEnv> = {}, files: Record<string, string | null> = {}): GuardEnv {
  return {
    env: {},
    home,
    platform: 'linux',
    cwd: project,
    readFile: (file) => (file in files ? files[file]! : null),
    ...overrides,
  }
}

function event(tool: string, input: Record<string, unknown>, cwd = project): string {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd })
}

const decide = (text: string, g: GuardEnv = env()) => decideConfigWrite(rawEventFrom(text), g)
const denied = (text: string, g: GuardEnv = env()) => decide(text, g).deny
const write = (rel: string, content: unknown) => event('Write', { file_path: path.join(project, rel), content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) })

/** An existing file, on disk (so the guard sees it exists) and in the environment. */
function existing(rel: string, content: string): { file: string; g: GuardEnv } {
  const file = path.join(project, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  return { file, g: env({}, { [file]: content }) }
}

describe('config guard: Claude settings, judged by what the edit changes', () => {
  it.each([
    ['an allow rule for a Dethereal tool', { permissions: { allow: [SETTLE] } }, /adds an allow rule/],
    ['a server-wide Dethereal grant', { permissions: { allow: ['mcp__plugin_dethereal_dethereal'] } }, /adds an allow rule/],
    ['a wildcard MCP grant', { permissions: { allow: ['mcp__*'] } }, /adds an allow rule/],
    ['a grant of every tool', { permissions: { allow: ['*'] } }, /adds an allow rule/],
    ['a bypass mode', { permissions: { defaultMode: 'bypassPermissions' } }, /bypassPermissions/],
    ['auto-accepted edits', { permissions: { defaultMode: 'acceptEdits' } }, /acceptEdits/],
    ['dontAsk', { permissions: { defaultMode: 'dontAsk' } }, /dontAsk/],
    ['hooks', { hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'true' }] }] } }, /changes hooks/],
    ['hooks switched off', { disableAllHooks: true }, /changes disableAllHooks/],
    ['project MCP servers', { enableAllProjectMcpServers: true }, /changes enableAllProjectMcpServers/],
    ['this plugin switched off', { enabledPlugins: { 'dethereal@dether.net': false } }, /Dethereal plugin is enabled/],
    ['a status line command', { statusLine: { type: 'command', command: 'true' } }, /changes statusLine/],
    ['an API key helper', { apiKeyHelper: '/bin/true' }, /changes apiKeyHelper/],
    ['an OpenTelemetry headers helper', { otelHeadersHelper: '/bin/true' }, /changes otelHeadersHelper/],
    ['an AWS auth refresh command', { awsAuthRefresh: 'true' }, /changes awsAuthRefresh/],
    ['an AWS credential export command', { awsCredentialExport: 'true' }, /changes awsCredentialExport/],
    ['a file suggestion command', { fileSuggestion: { type: 'command', command: 'true' } }, /changes fileSuggestion/],
    ['an environment variable (it reaches the plugin server and hooks)', { env: { NODE_OPTIONS: '--require /tmp/x.js' } }, /changes env/],
    ['Bash allowed outright', { permissions: { allow: ['Bash'] } }, /allow rule for Bash/],
    ['Bash allowed for any command', { permissions: { allow: ['Bash(*)'] } }, /allow rule for Bash/],
    ['Bash allowed for a command with any arguments', { permissions: { allow: ['Bash(node:*)'] } }, /allow rule for Bash/],
    ['Bash allowed for one exact command (a script it runs can be rewritten)', { permissions: { allow: ['Bash(npm test)'] } }, /allow rule for Bash/],
    ['Bash allowed in another case or spacing', { permissions: { allow: ['bash ( ls )'] } }, /allow rule for Bash/],
    ['Bash allowed through the old list', { allowedTools: ['Bash(sed -i *)'] }, /allow rule for Bash/],
    ['the sandbox (it can run Bash without asking)', { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }, /changes sandbox/],
    ['another plugin enabled', { enabledPlugins: { 'other@market': true } }, /enables a plugin/],
    ['a marketplace added', { extraKnownMarketplaces: { m: { source: { source: 'github', repo: 'x/y' } } } }, /changes extraKnownMarketplaces/],
    ["the plugin's options (its platform URL)", { pluginConfigs: { 'dethereal@dethereal-local': { options: { platform_url: 'http://example.invalid' } } } }, /plugin's options/],
    ['the auto mode', { permissions: { defaultMode: 'auto' } }, /auto/],
  ])('denies %s', (_label, content, reason) => {
    const d = decide(write('.claude/settings.local.json', content))
    expect(d.deny).toBe(true)
    expect(d.deny && d.reason).toMatch(reason)
  })

  it('denies changing or removing a command setting it finds, and allows keeping it', () => {
    const { file, g } = existing('.claude/settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'true' }, apiKeyHelper: '/bin/true' }))
    expect(denied(event('Write', { file_path: file, content: JSON.stringify({ statusLine: { type: 'command', command: 'false' }, apiKeyHelper: '/bin/true' }) }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: JSON.stringify({ apiKeyHelper: '/bin/true' }) }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: JSON.stringify({ statusLine: { type: 'command', command: 'true' }, apiKeyHelper: '/bin/true', theme: 'dark' }) }), g)).toBe(false)
  })

  it('allows every other edit', () => {
    expect(denied(write('.claude/settings.json', { theme: 'dark', model: 'opus' }))).toBe(false)
    expect(denied(write('.claude/settings.json', { permissions: { allow: ['Read(./docs/**)'], defaultMode: 'plan' } }))).toBe(false)
    expect(denied(write('.claude/settings.json', { enabledPlugins: { 'other@market': false } }))).toBe(false)
  })

  it('denies weakening a deny or ask rule, and allows keeping it', () => {
    const before = JSON.stringify({ permissions: { deny: [SETTLE], ask: ['mcp__plugin_dethereal_dethereal__update_model'] } })
    const { file, g } = existing('.claude/settings.json', before)
    expect(denied(event('Edit', { file_path: file, old_string: `"${SETTLE}"`, new_string: '"Bash(rm:*)"' }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: JSON.stringify({ permissions: { deny: [SETTLE], ask: [] } }) }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: JSON.stringify({ permissions: { deny: [SETTLE, 'Bash(curl:*)'], ask: ['mcp__plugin_dethereal_dethereal__update_model'] }, theme: 'light' }) }), g)).toBe(false)
  })

  it('an allow rule already there is not added again', () => {
    const { file, g } = existing('.claude/settings.json', JSON.stringify({ permissions: { allow: [SETTLE] } }))
    expect(denied(event('Edit', { file_path: file, old_string: '{"permissions"', new_string: '{"theme":"dark","permissions"' }), g)).toBe(false)
  })

  it('judges the per-project settings in .claude.json', () => {
    const before = JSON.stringify({ numStartups: 3, projects: { '/p': { allowedTools: [] } } })
    const { file, g } = existing('.claude.json', before)
    const after = (tools: string[]) => JSON.stringify({ numStartups: 4, projects: { '/p': { allowedTools: tools } } })
    expect(denied(event('Write', { file_path: file, content: after(['mcp__plugin_dethereal_dethereal__update_model']) }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: after(['Bash(ls)']) }), g)).toBe(true)
    expect(denied(event('Write', { file_path: file, content: after(['Read(./docs/**)']) }), g)).toBe(false)
  })

  it('covers the user-level copies and the configured directory', () => {
    expect(denied(event('Write', { file_path: '~/.claude/settings.json', content: JSON.stringify({ permissions: { allow: [SETTLE] } }) }))).toBe(true)
    const g = env({ env: { CLAUDE_CONFIG_DIR: path.join(tmp, 'cc') } })
    expect(denied(event('Write', { file_path: path.join(tmp, 'cc', 'settings.json'), content: JSON.stringify({ hooks: {} }) }), g)).toBe(true)
  })

  it('folds case where the file system does, and follows a symlink', () => {
    const text = event('Write', { file_path: path.join(project, '.Claude', 'Settings.json'), content: JSON.stringify({ permissions: { allow: ['*'] } }) })
    expect(denied(text, env({ platform: 'darwin' }))).toBe(true)
    expect(denied(text, env({ platform: 'linux' }))).toBe(false)
    mkdirSync(path.join(project, '.claude'))
    symlinkSync(path.join(project, '.claude'), path.join(project, 'innocent'))
    expect(denied(event('Write', { file_path: path.join(project, 'innocent', 'settings.local.json'), content: JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }) }))).toBe(true)
  })
})

describe('config guard: the Codex config.toml', () => {
  const base = 'model = "gpt-5"\n\n[mcp_servers.dethereal]\ncommand = "node"\nargs = ["/x/dist/index.js"]\n'
  it.each([
    ['approval never', `approval_policy = "never"\n${base}`, /approval_policy to never/],
    ['approval never in a profile', `${base}\n[profiles.fast]\napproval_policy = "never"\n`, /profiles\.fast\.approval_policy/],
    ['an MCP server changed', base.replace('"node"', '"sh"'), /mcp_servers/],
    ['hooks', `${base}\n[hooks]\npre_tool = ["x"]\n`, /hooks/],
    ['a project trusted', `${base}\n[projects."/p"]\ntrust_level = "trusted"\n`, /trust level/],
  ])('denies %s', (_label, after, reason) => {
    const { file, g } = existing('.codex/config.toml', base)
    const d = decide(event('Write', { file_path: file, content: after }), g)
    expect(d.deny).toBe(true)
    expect(d.deny && d.reason).toMatch(reason)
  })

  it('allows an unrelated edit, and denies a file it cannot parse', () => {
    const { file, g } = existing('.codex/config.toml', base)
    expect(denied(event('Edit', { file_path: file, old_string: 'model = "gpt-5"', new_string: 'model = "gpt-5-codex" # faster' }), g)).toBe(false)
    expect(denied(event('Write', { file_path: file, content: 'model = \n[' }), g)).toBe(true)
  })

  it('reads the TOML it needs, and nothing it does not understand', () => {
    expect(parseToml('a = 1\n[t]\nb = [1,\n  2]\nc = { d = "e" }\n[[arr]]\nx = true\n')).toEqual({ a: 1, t: { b: [1, 2], c: { d: 'e' } }, arr: [{ x: true }] })
    expect(parseToml('a = 1\na = 2\n')).toBeUndefined()
    expect(parseToml('a = what\n')).toBeUndefined()
  })
})

describe('config guard: OpenCode opencode.json(c)', () => {
  it.each([
    ['allowing Dethereal tools', { permission: { 'dethereal_*': 'allow' } }, /widens the permission/],
    ['allowing everything', { permission: 'allow' }, /widens the permission \*/],
    ['an agent allowed a Dethereal tool', { agent: { build: { permission: { dethereal_model_state_settle: 'allow' } } } }, /agent\.build/],
    ['an MCP server', { mcp: { x: { type: 'local', command: ['sh'] } } }, /changes mcp/],
    ['a plugin', { plugin: ['evil'] }, /changes plugin/],
  ])('denies %s', (_label, content, reason) => {
    const d = decide(write('opencode.json', content))
    expect(d.deny).toBe(true)
    expect(d.deny && d.reason).toMatch(reason)
  })

  it('reads comments and trailing commas, allows an unrelated edit, and denies a removed ask', () => {
    const before = '{\n  // the operator asks for writes\n  "permission": { "dethereal_update_model": "ask", },\n  "theme": "dark",\n}\n'
    const { file, g } = existing('opencode.jsonc', before)
    expect(denied(event('Edit', { file_path: file, old_string: '"theme": "dark"', new_string: '"theme": "light"' }), g)).toBe(false)
    expect(denied(event('Edit', { file_path: file, old_string: '"dethereal_update_model": "ask", ', new_string: '' }), g)).toBe(true)
  })

  it('denies an OpenCode plugin by path', () => {
    expect(denied(write('.opencode/plugin/x.ts', 'export default {}'))).toBe(true)
  })
})

describe('config guard: the settlement switch', () => {
  /** Claude settings holding `env`, at the top level or in one project of .claude.json. */
  const claude = ({ env, scope }: { env?: Record<string, string>; scope?: string } = {}) =>
    JSON.stringify(scope ? { projects: { [scope]: env ? { env } : {} } } : env ? { env } : {})

  it('guards the same variable the server reads', () => {
    expect(SETTLEMENT_ENV).toBe(SERVER_SETTLEMENT_ENV)
  })

  it.each([
    ['added', claude(), claude({ env: { DETHEREAL_SETTLEMENT: 'on' } })],
    ['removed', claude({ env: { DETHEREAL_SETTLEMENT: 'on' } }), claude()],
    ['turned off', claude({ env: { DETHEREAL_SETTLEMENT: 'on' } }), claude({ env: { DETHEREAL_SETTLEMENT: 'off' } })],
    ['emptied', claude({ env: { DETHEREAL_SETTLEMENT: 'off' } }), claude({ env: { DETHEREAL_SETTLEMENT: '' } })],
    ['changed in a project of .claude.json', claude({ env: { DETHEREAL_SETTLEMENT: 'on' }, scope: '/p' }), claude({ env: { DETHEREAL_SETTLEMENT: 'off' }, scope: '/p' })],
    ['added to a project of .claude.json', claude({ scope: '/p' }), claude({ env: { DETHEREAL_SETTLEMENT: 'off' }, scope: '/p' })],
    ['added in another case (Windows reads it as the same)', claude({ env: { DETHEREAL_SETTLEMENT: 'on' } }), claude({ env: { DETHEREAL_SETTLEMENT: 'on', dethereal_settlement: 'off' } })],
    ['changed in another case', claude({ env: { dethereal_settlement: 'on' } }), claude({ env: { dethereal_settlement: 'off' } })],
    ['given where env was not an object', JSON.stringify({ env: 'x' }), claude({ env: { DETHEREAL_SETTLEMENT: 'on' } })],
    ['dropped by making env a list', claude({ env: { DETHEREAL_SETTLEMENT: 'on' } }), JSON.stringify({ env: [] })],
  ])('refuses the variable %s in Claude settings env', (_, before, after) => {
    expect(judgeConfigEdit('claude', before, after)).toEqual({ ok: false, rule: 'changes DETHEREAL_SETTLEMENT', kind: 'settlement' })
  })

  it('refuses every other env change by the environment rule, and lets the env written in another order through', () => {
    // Every process Claude Code starts reads the settings' environment: any change to it is the operator's.
    expect(judgeConfigEdit('claude', claude({ env: { DETHEREAL_SETTLEMENT: 'on' } }), claude({ env: { DETHEREAL_SETTLEMENT: 'on', DEBUG: 'true' } }))).toEqual({ ok: false, rule: 'changes env' })
    for (const [before, after] of <[string, string][]>[
      [claude(), claude({ env: { DETHERNETY_URL: 'http://example.invalid' } })],
      [claude({ env: { PATH: '/usr/bin' } }), claude({ env: { PATH: '/tmp:/usr/bin' } })],
      [claude({ env: { HTTPS_PROXY: 'http://proxy' } }), claude()],
      [claude({ scope: '/p' }), claude({ env: { NODE_OPTIONS: '--inspect' }, scope: '/p' })],
    ]) expect(judgeConfigEdit('claude', before, after)).toEqual({ ok: false, rule: 'changes env' })
    // The same entries in another order change nothing.
    expect(judgeConfigEdit('claude', claude({ env: { dethereal_settlement: 'x', DETHEREAL_SETTLEMENT: 'y', A: '1' } }), claude({ env: { A: '1', DETHEREAL_SETTLEMENT: 'y', dethereal_settlement: 'x' } }))).toEqual({ ok: true })
  })

  it('refuses the switch in a project of .claude.json with the settlement kind', () => {
    const scoped = (v: string) => JSON.stringify({ projects: { '/p': { env: { DETHEREAL_SETTLEMENT: v } } } })
    expect(judgeConfigEdit('claude', scoped('on'), scoped('off'))).toEqual({ ok: false, rule: 'changes DETHEREAL_SETTLEMENT', kind: 'settlement' })
  })

  it('names the settlement switch in its refusal, and any other env change by the rule that it widens what runs', () => {
    const on = decide(write('.claude/settings.local.json', { env: { DETHEREAL_SETTLEMENT: 'on' } }))
    expect(on.deny && on.reason).toMatch(/changes whether the settlement is on/)
    const other = decide(write('.claude/settings.local.json', { env: { DEBUG: '1' } }))
    expect(other.deny && other.reason).toMatch(/changes env, which widens what runs without asking/)
  })

  it('refuses it in the Codex and OpenCode server entries by the rule for any change to the server', () => {
    const toml = (vars: string) => `[mcp_servers.dethereal]\ncommand = "node"\nenv_vars = [${vars}]\n`
    expect(judgeConfigEdit('codex', toml('"DEBUG"'), toml('"DEBUG", "DETHEREAL_SETTLEMENT"'))).toEqual({ ok: false, rule: 'changes mcp_servers' })
    expect(judgeConfigEdit('codex', toml('"DEBUG"'), `${toml('"DEBUG"')}env = { DETHEREAL_SETTLEMENT = "on" }\n`)).toEqual({ ok: false, rule: 'changes mcp_servers' })
    const oc = (environment: Record<string, string>) => JSON.stringify({ mcp: { dethereal: { type: 'local', environment } } })
    expect(judgeConfigEdit('opencode', oc({}), oc({ DETHEREAL_SETTLEMENT: 'off' }))).toEqual({ ok: false, rule: 'changes mcp' })
  })
})

describe("config guard: Claude Code's plugin cache, denied by path", () => {
  it.each([
    ['the cached bundle server entry', '.claude/plugins/cache/dethereal/1.0.0/.mcp.json'],
    ['the cached hooks', '.claude/plugins/cache/dethereal/1.0.0/hooks/hooks.json'],
    ['the plugin index', '.claude/plugins/installed_plugins.json'],
    ['a cached skill', '.claude/plugins/cache/dethereal/1.0.0/skills/threat-model/SKILL.md'],
  ])('denies a write of %s, whatever it holds', (_label, rel) => {
    for (const where of [path.join(home, rel), path.join(project, rel)]) {
      const d = decide(event('Write', { file_path: where, content: '{}' }))
      expect(d.deny && d.reason).toMatch(/plugin cache/)
    }
    expect(denied(event('Edit', { file_path: path.join(home, rel), old_string: 'a', new_string: 'b' }))).toBe(true)
  })

  it('covers the configured directory, and folds case where the file system does', () => {
    const g = env({ env: { CLAUDE_CONFIG_DIR: path.join(tmp, 'cc') } })
    expect(denied(event('Write', { file_path: path.join(tmp, 'cc', 'plugins', 'installed_plugins.json'), content: '{}' }), g)).toBe(true)
    expect(denied(event('Write', { file_path: path.join(home, '.Claude', 'Plugins', 'installed_plugins.json'), content: '{}' }), env({ platform: 'darwin' }))).toBe(true)
  })

  it('denies the cache whatever the file is named, and through a patch', () => {
    for (const rel of ['.claude/plugins/cache/x/opencode.json', '.claude/plugins/cache/x/.claude/settings.json', '.claude/plugins/cache/x/.claude.json']) {
      const d = decide(event('Write', { file_path: path.join(home, rel), content: '{}' }))
      expect(d.deny && d.reason, rel).toMatch(/plugin cache/)
    }
    const target = path.join(home, '.claude', 'plugins', 'cache', 'dethereal', '1.0.0', 'hooks', 'hooks.json')
    const patch = `*** Begin Patch\n*** Add File: ${target}\n+{}\n*** End Patch\n`
    const d = decide(event('apply_patch', { command: patch }))
    expect(d.deny && d.reason).toMatch(/plugin cache/)
  })

  it('leaves other folders under .claude to their own rules', () => {
    expect(denied(event('Write', { file_path: path.join(project, '.claude', 'notes', 'plugins.md'), content: 'x' }))).toBe(false)
  })
})

describe('config guard: what it cannot judge, on a guarded path', () => {
  it('denies an edit whose text is not found exactly once', () => {
    const { file, g } = existing('.claude/settings.json', '{"theme":"dark","model":"dark"}')
    expect(denied(event('Edit', { file_path: file, old_string: 'nowhere', new_string: 'x' }), g)).toBe(true)
    expect(denied(event('Edit', { file_path: file, old_string: 'dark', new_string: 'light' }), g)).toBe(true)
    expect(denied(event('Edit', { file_path: file, old_string: 'dark', new_string: 'light', replace_all: true }), g)).toBe(false)
  })

  it('denies a file it cannot read or that is too large', () => {
    const file = path.join(project, '.claude', 'settings.json')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{}')
    expect(denied(event('Edit', { file_path: file, old_string: '{', new_string: '{"a":1,' }), env({}, { [file]: null }))).toBe(true)
  })

  it('denies content that does not parse, and a notebook edit', () => {
    expect(denied(write('.claude/settings.json', '{ not json'))).toBe(true)
    expect(denied(event('NotebookEdit', { notebook_path: path.join(project, '.claude', 'settings.json'), new_source: '' }))).toBe(true)
  })
})

describe('config guard: definitions, denied by content', () => {
  it.each([
    ['.claude/skills/x/SKILL.md', `---\n${GRANT}\n---\n`],
    ['.claude/commands/y.md', '---\nallowed-tools: mcp__*\n---\n'],
    ['.claude/agents/z.md', '---\ntools: mcp__plugin_dethereal_dethereal\n---\n'],
    ['.claude/plugins/marketplaces/m/skills/s/SKILL.md', `---\n${GRANT}\n---\n`],
    ['.opencode/agent/a.md', '---\npermission:\n  "dethereal_*": allow\n---\n'],
    ['.opencode/command/c.md', '---\npermission:\n  "*": "allow"\n---\n'],
    ['.codex/agents/a.toml', 'enabled_tools = ["mcp__dethereal__settle"]\n'],
  ])('%s with a grant', (rel, content) => {
    expect(denied(write(rel, content))).toBe(true)
  })

  it('allows a definition without a grant', () => {
    expect(denied(write('.claude/skills/x/SKILL.md', 'Run /dethereal:create to start.'))).toBe(false)
  })

  it('sees a grant an edit completes from the text already there', () => {
    const { file, g } = existing('.claude/skills/x/SKILL.md', '---\nallowed-tools: mcp__plugin_detherXX\n---\n')
    expect(denied(event('Edit', { file_path: file, old_string: 'XX', new_string: 'eal_dethereal__settle' }), g)).toBe(true)
    expect(denied(event('MultiEdit', { file_path: file, edits: [{ old_string: 'XX', new_string: 'eal' }, { old_string: 'eal', new_string: 'eal_dethereal__waive' }] }), g)).toBe(true)
    expect(denied(event('Edit', { file_path: file, old_string: 'XX', new_string: 'ium' }), g)).toBe(false)
  })

  it('leaves a skills directory that is not directly under .claude alone', () => {
    expect(denied(write('.claude/worktrees/wt/oss/apps/dethereal/skills/x/SKILL.md', `---\n${GRANT}\n---\n`))).toBe(false)
  })
})

describe('config guard: everything else', () => {
  it('allows ordinary files and other tools', () => {
    expect(denied(write('src/settings.json', { permissions: { allow: ['*'] } }))).toBe(false)
    expect(denied(write('threat-models/m/structure.json', GRANT))).toBe(false)
    expect(denied(event('Read', { file_path: path.join(project, '.claude', 'settings.json') }))).toBe(false)
  })
})

describe('config guard: an event it cannot read', () => {
  it('denies a guarded path recovered from a malformed event, and allows anything else', () => {
    const broken = (p: string) => `{"tool_name":"Write","tool_input":{"file_path":${JSON.stringify(p)},"content":"`
    expect(denied(broken(path.join(project, '.claude', 'settings.json')))).toBe(true)
    expect(denied(broken(path.join(project, '.claude', 'skills', 'x', 'SKILL.md')))).toBe(true)
    expect(denied(broken(path.join(project, 'src', 'app.ts')))).toBe(false)
    expect(denied('not json at all')).toBe(false)
    expect(denied('')).toBe(false)
  })

  it('recovers the path from an event past the size cap, wherever the path sits', async () => {
    const padding = ' '.repeat(GUARD_EVENT_CAP + 1024)
    const settings = path.join(project, '.claude', 'settings.local.json')
    const text = `{"tool_name":"Write","tool_input":{"content":"${padding}","file_path":${JSON.stringify(settings)}},"cwd":${JSON.stringify(project)}}`
    const chunks: Buffer[] = []
    const bytes = Buffer.from(text)
    // Chunk boundaries that split the key and the value.
    for (let i = 0; i < bytes.length; i += 65_531) chunks.push(bytes.subarray(i, i + 65_531))
    const raw = await readGuardEvent(Readable.from(chunks) as unknown as NodeJS.ReadStream)
    expect(raw.text).toBeNull()
    expect(decideConfigWrite(raw, env()).deny).toBe(true)
    const other = await readGuardEvent(Readable.from([Buffer.from(text.replace(settings, path.join(project, 'big.txt')))]) as unknown as NodeJS.ReadStream)
    expect(decideConfigWrite(other, env()).deny).toBe(false)
  })
})

describe('config guard: the hook', () => {
  it('denies through its output, names the rule, and exits 0', async () => {
    const out: string[] = []
    const text = write('.claude/settings.json', { permissions: { allow: [SETTLE] } })
    const code = await runCli(['hook', 'config-guard', '--harness', 'claude'], { stdout: (t) => out.push(t), stderr: () => {}, guardEvent: async () => rawEventFrom(text) })
    expect(code).toBe(0)
    const parsed = JSON.parse(out.join('')) as { hookSpecificOutput: Record<string, string> }
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/^Dethereal: this edit to harness configuration adds an allow rule/)
  })

  it('says nothing for a write it allows', async () => {
    const out: string[] = []
    const text = write('.claude/settings.json', { theme: 'dark' })
    expect(await runCli(['hook', 'config-guard'], { stdout: (t) => out.push(t), stderr: () => {}, guardEvent: async () => rawEventFrom(text) })).toBe(0)
    expect(out).toEqual([])
    expect(guardOutput({ deny: false })).toBe('')
  })
})
