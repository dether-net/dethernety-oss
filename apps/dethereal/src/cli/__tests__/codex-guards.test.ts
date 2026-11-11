/**
 * The guards on Codex: its shell tool reaches the hooks as Bash, its writes as apply_patch, both in
 * Codex's own event envelope (cwd, agent_type, the patch text in tool_input.command).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decideConfigWrite, patchOperations, rawEventFrom, type GuardEnv, type RawEvent } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'
import { runCli } from '../index.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'codex-guards-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(project, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function file(rel: string, content: string, base = project): string {
  const f = path.join(base, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, content)
  return f
}

/** Codex's event envelope, as its hooks receive it. */
const codexEvent = (tool: string, input: Record<string, unknown>, cwd = project) =>
  JSON.stringify({
    session_id: 's',
    turn_id: 't',
    cwd,
    hook_event_name: 'PreToolUse',
    model: 'm',
    permission_mode: 'bypassPermissions',
    tool_name: tool,
    tool_input: input,
    tool_use_id: 'u',
    agent_type: 'dethereal-infrastructure-scout',
  })
const patch = (...body: string[]) => codexEvent('apply_patch', { command: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') })

function configEnv(overrides: Partial<GuardEnv> = {}): GuardEnv {
  return {
    env: {},
    home,
    platform: 'linux',
    cwd: project,
    readFile: (f) => {
      try {
        return readFileSync(f, 'utf8')
      } catch {
        return null
      }
    },
    ...overrides,
  }
}
const decidePatch = (text: string, g = configEnv()) => decideConfigWrite(rawEventFrom(text), g)

const TRUSTED = '[hooks.state."dethereal@local:hooks/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n'

describe('config guard on Codex: reading a patch', () => {
  it('finds every file header, indented ones too, and the added text', () => {
    expect(patchOperations('*** Begin Patch\n*** Add File: a.txt\n+one\n+two\n*** Update File: b.txt\n*** Move to: c.txt\n@@\n-x\n+y\n\t*** Delete File: d.txt\n*** End Patch')).toEqual([
      { kind: 'add', path: 'a.txt', content: 'one\ntwo\n' },
      { kind: 'update', path: 'b.txt' },
      { kind: 'move', path: 'c.txt' },
      { kind: 'delete', path: 'd.txt' },
    ])
  })

  it('gives nothing for a patch naming another environment, or naming no file', () => {
    expect(patchOperations('*** Begin Patch\n*** Environment ID: other\n*** Add File: a\n+x\n*** End Patch')).toBeNull()
    expect(patchOperations('*** Begin Patch\n*** End Patch')).toBeNull()
  })
})

describe('config guard on Codex: apply_patch', () => {
  it('judges a created config file whole, against the file it replaces', () => {
    file('.codex/config.toml', TRUSTED)
    // Dropping the hook trust switches the hooks off.
    expect(decidePatch(patch('*** Add File: .codex/config.toml', '+model = "x"'))).toMatchObject({ deny: true, reason: expect.stringMatching(/changes hooks/) })
    expect(decidePatch(patch('*** Add File: .codex/config.toml', '+model = "x"', ...TRUSTED.trimEnd().split('\n').map((l) => `+${l}`))).deny).toBe(false)
    expect(decidePatch(patch('*** Add File: .codex/config.toml', '+[mcp_servers.dethereal]', '+command = "evil"')).deny).toBe(true)
  })

  it('never updates or moves a guarded file, whichever side of the move it is on', () => {
    file('.codex/config.toml', 'model = "x"\n')
    file('a.toml', 'model = "x"\n')
    expect(decidePatch(patch('*** Update File: .codex/config.toml', '@@', '-model = "x"', '+model = "y"'))).toMatchObject({ deny: true, reason: expect.stringMatching(/does not update or move/) })
    expect(decidePatch(patch('*** Update File: a.toml', '*** Move to: .codex/config.toml', '@@', ' model = "x"')).deny).toBe(true)
    expect(decidePatch(patch('*** Update File: .codex/agents/a.toml', '*** Move to: elsewhere.toml', '@@', ' x')).deny).toBe(true)
  })

  it('judges a deleted config file, and lets a definition be deleted', () => {
    file('.codex/config.toml', TRUSTED)
    file('.codex/agents/a.toml', 'name = "a"\n')
    expect(decidePatch(patch('*** Delete File: .codex/config.toml')).deny).toBe(true)
    expect(decidePatch(patch('*** Delete File: .codex/agents/a.toml')).deny).toBe(false)
  })

  it('denies a created definition that grants a Dethereal tool', () => {
    expect(decidePatch(patch('*** Add File: .codex/agents/scout.toml', '+developer_instructions = "use mcp__dethereal__model_state_settle"')).deny).toBe(true)
    expect(decidePatch(patch('*** Add File: .codex/agents/scout.toml', '+name = "scout"')).deny).toBe(false)
  })

  it('denies any write to the Codex plugin folders and to the server folder in the home directory', () => {
    const codexHome = path.join(tmp, 'codex-home')
    const g = configEnv({ env: { CODEX_HOME: codexHome } })
    expect(decidePatch(patch(`*** Update File: ${codexHome}/plugins/cache/m/dethereal/1.0.0/bin/hook.mjs`, '@@', '+x'), g)).toMatchObject({ deny: true, reason: expect.stringMatching(/plugin/) })
    expect(decidePatch(patch('*** Add File: .codex/plugins/x/bin/hook.mjs', '+x')).deny).toBe(true)
    expect(decidePatch(patch('*** Add File: ~/.codex/plugins/x/bin/hook.mjs', '+x')).deny).toBe(true)
    expect(decidePatch(patch(`*** Add File: ${home}/.dethernety/runtime/current.json`, '+{}'))).toMatchObject({ deny: true, reason: expect.stringMatching(/\.dethernety/) })
    expect(decidePatch(patch('*** Add File: ~/.dethernety/x', '+{}')).deny).toBe(true)
  })

  it('denies two operations on one guarded file, under a case or a link alias', () => {
    const twice = patch('*** Add File: .codex/agents/a.toml', '+name = "a"', '*** Delete File: .codex/AGENTS/A.TOML')
    expect(decidePatch(twice, configEnv({ platform: 'darwin' }))).toMatchObject({ deny: true, reason: expect.stringMatching(/twice/) })
    file('.codex/agents/a.toml', 'name = "a"\n')
    symlinkSync(path.join(project, '.codex/agents/a.toml'), path.join(project, 'alias.toml'))
    expect(decidePatch(patch('*** Add File: alias.toml', '+name = "a"', '*** Add File: .codex/agents/a.toml', '+name = "b"')).deny).toBe(true)
  })

  it('follows a link whose target does not exist yet', () => {
    symlinkSync(path.join(project, '.codex/agents/new.toml'), path.join(project, 'new.toml'))
    expect(decidePatch(patch('*** Add File: new.toml', '+developer_instructions = "mcp__dethereal__model_state_settle"')).deny).toBe(true)
  })

  it('reads a path as Codex does: against the session folder, `~` left as written', () => {
    expect(decidePatch(patch('*** Add File: ~/notes.md', '+x')).deny).toBe(false)
    expect(decidePatch(codexEvent('apply_patch', { command: '*** Begin Patch\n*** Add File: config.toml\n+[mcp_servers.x]\n*** End Patch' }, path.join(project, '.codex'))).deny).toBe(true)
  })

  it('denies an indented header, another environment, a patch it cannot read, and an add it cannot read in full', () => {
    expect(decidePatch(patch('\t*** Add File: .codex/agents/x.toml', '+mcp__dethereal__model_state_settle')).deny).toBe(true)
    expect(decidePatch(patch('*** Environment ID: other', '*** Add File: a.txt', '+x')).deny).toBe(true)
    expect(decidePatch(codexEvent('apply_patch', { command: 'nothing here' })).deny).toBe(true)
    expect(decidePatch(patch('*** Add File: .codex/agents/x.toml', '+name = "x"', ' context?')).deny).toBe(true)
    const big: RawEvent = { text: null, fields: new Map([['tool_name', ['apply_patch']]]) }
    expect(decideConfigWrite(big, configEnv()).deny).toBe(true)
  })

  it('lets an ordinary patch run', () => {
    file('README.md', 'a\n')
    expect(decidePatch(patch('*** Add File: src/app.ts', '+export {}', '*** Update File: README.md', '@@', '-a', '+b', '*** Delete File: old.txt')).deny).toBe(false)
  })
})

describe('config guard on Codex: the hook command', () => {
  const run = async (text: string | null) => {
    const out: string[] = []
    const raw: RawEvent = text === null ? { text: null, fields: new Map() } : rawEventFrom(text)
    const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => raw }
    const prev = process.env.DETHEREAL_PROJECT_ROOT
    process.env.DETHEREAL_PROJECT_ROOT = project
    try {
      expect(await runCli(['hook', 'config-guard', '--harness', 'codex'], io as never)).toBe(0)
    } finally {
      if (prev === undefined) delete process.env.DETHEREAL_PROJECT_ROOT
      else process.env.DETHEREAL_PROJECT_ROOT = prev
    }
    const s = out.join('')
    return s ? (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput : null
  }

  it('denies an update or a move of a project secret file, and lets one be deleted', async () => {
    file('.env', 'TOKEN=x\n')
    file('deploy/orders/db-connection.yaml', 'kind: Secret\nstringData:\n  url: x\n')
    expect((await run(patch('*** Update File: .env', '@@', '-TOKEN=x', '+TOKEN=y')))?.permissionDecisionReason).toMatch(/^dethereal-secret-guard: \.env is a secret file/)
    expect((await run(patch('*** Update File: deploy/orders/db-connection.yaml', '*** Move to: notes.txt', '@@', ' kind: Secret')))?.permissionDecision).toBe('deny')
    expect(await run(patch('*** Delete File: .env'))).toBeNull()
    expect(await run(patch('*** Add File: src/app.ts', '+export {}'))).toBeNull()
  })

  it('denies an event it cannot read whole', async () => {
    expect((await run(null))?.permissionDecision).toBe('deny')
  })
})

describe('secret guard on Codex: Bash', () => {
  function env(overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
    return { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
  }
  const bash = (command: unknown, extra: Record<string, unknown> = {}, cwd = project) => codexEvent('Bash', { command, ...extra }, cwd)
  const decide = (text: string, g = env()) => decideCodexAccess(rawEventFrom(text), g)
  const denied = (command: unknown, g = env()) => decide(bash(command), g).deny

  beforeEach(() => {
    file('deploy/orders/secrets.yaml', 'kind: Secret\n')
    file('deploy/orders/db-connection.yaml', 'kind: Secret\n')
    file('deploy/orders/api.yaml', 'kind: Deployment\n')
    file('.dethernety/models.json', '{"models":[]}\n')
    file('.dethernety/tokens.json', '{}\n', home)
  })

  it('judges the command as on Claude, from a string or an argv', () => {
    expect(denied('cat deploy/orders/secrets.yaml')).toBe(true)
    expect(denied('ls deploy/orders')).toBe(false)
    expect(denied(['bash', '-lc', 'cat deploy/orders/db-connection.yaml'])).toBe(true)
    expect(denied(['ls', '-la', 'deploy'])).toBe(false)
  })

  it('runs the command in the workdir the event names', () => {
    expect(decide(bash('cat db-connection.yaml', { workdir: 'deploy/orders' })).deny).toBe(true)
  })

  it('denies an event with no command, or none it can read', () => {
    expect(decide(codexEvent('Bash', { cmd: 'ls' })).deny).toBe(true)
    expect(decide('not json').deny).toBe(true)
  })

  it('denies a patch run through the shell, which Codex applies past the hook', () => {
    expect(denied("apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: .codex/agents/x.toml\n+x\n*** End Patch\nEOF")).toBe(true)
    expect(denied("cd .codex && apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: config.toml\n*** End Patch\nEOF")).toBe(true)
  })

  it.each([['bash'], ['zsh -l'], ['python3'], ['node -i'], ['cd src && sh']])('denies %s, left waiting for input', (command) => {
    expect(denied(command)).toBe(true)
  })

  it.each([['python3 -c "print(1)"'], ['node --version'], ['bash scripts/build.sh'], ['echo bash']])('allows %s', (command) => {
    expect(denied(command)).toBe(false)
  })

  it.each([
    ['cat ~/.dethernety/tokens.json'],
    ['cat $HOME/.dethernety/tokens.json'],
    ['cat "${HOME}/.dethernety/tokens.json"'],
    ['cat ${HOME:-/root}/.dethernety/tokens.json'],
    ['cat ~/.dether\\nety/tokens.json'],
    ['cat ~/.d*/tokens.json'],
    ['cat ~/.{dethernety,x}/tokens.json'],
    ['cat ~//.dethernety/./tokens.json'],
    ['cd ~ && cat .dethernety/tokens.json'],
    ['cd && cat .dethernety/tokens.json'],
    ['ls ~/.dethernety'],
    ['grep -r token ~'],
    ['tar czf /tmp/x.tgz ~'],
    ['cat "$(echo ~)/.dethernety/tokens.json"'],
  ])('denies %s, which reaches the server folder', (command) => {
    expect(decide(bash(command))).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
  })

  it('denies the server folder by its full path, through a link, and in any case on a case-insensitive disk', () => {
    expect(denied(`cat ${home}/.dethernety/tokens.json`)).toBe(true)
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'state'))
    expect(denied('cat state/tokens.json')).toBe(true)
    expect(denied('cat ~/.DETHERNETY/tokens.json', env({ platform: 'darwin' }))).toBe(true)
  })

  it("leaves the project's own .dethernety folder and plain home listings alone", () => {
    for (const command of ['cat .dethernety/models.json', 'ls ~', 'find ~ -name notes.txt', 'ls -la ~/.config']) expect([command, denied(command)]).toEqual([command, false])
    // A search that prints only names still reads every file: over a folder holding the server's, as the Grep tool, refused.
    expect(denied('grep -rl token ~')).toBe(true)
  })

  it('treats a project in the home folder as the server folder', () => {
    file('.dethernety/models.json', '{"models":[]}\n', home)
    const g = env({ env: { DETHEREAL_PROJECT_ROOT: home, HOME: home }, cwd: home })
    expect(decide(bash('cat .dethernety/models.json', {}, home), g).deny).toBe(true)
  })

  it('prints nothing to allow and the deny to refuse, from the hook command', async () => {
    const run = async (command: string) => {
      const out: string[] = []
      const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => rawEventFrom(bash(command)) }
      expect(await runCli(['hook', 'secret-guard', '--harness', 'codex'], io as never)).toBe(0)
      return out.join('')
    }
    const prev = { root: process.env.DETHEREAL_PROJECT_ROOT }
    process.env.DETHEREAL_PROJECT_ROOT = project
    try {
      expect(await run('ls deploy')).toBe('')
      expect(JSON.parse(await run('cat deploy/orders/secrets.yaml')).hookSpecificOutput.permissionDecision).toBe('deny')
    } finally {
      if (prev.root === undefined) delete process.env.DETHEREAL_PROJECT_ROOT
      else process.env.DETHEREAL_PROJECT_ROOT = prev.root
    }
  })
})

describe('the guards on Codex and OpenCode: the cases the reviews found', () => {
  const MARKER = 'dethereal-secret-guard: '
  function env(overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
    return { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
  }
  const bash = (command: unknown, extra: Record<string, unknown> = {}, cwd = project) => codexEvent('Bash', { command, ...extra }, cwd)
  const codex = (command: unknown, g = env()) => decideCodexAccess(rawEventFrom(bash(command)), g)
  const opencode = (tool: string, args: Record<string, unknown>, g = env()) =>
    decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool, directory: project, args })), g)

  beforeEach(() => {
    file('.dethernety/tokens.json', '{}\n', home)
    file('.dethernety/runtime/current.json', '{}\n', home)
    file('.dethernety/models.json', '{"models":[]}\n')
    file('deploy/orders/db-connection.yaml', 'kind: Secret\n')
  })

  it('reads a patch header Codex trims with Rust whitespace (U+0085 and the rest)', () => {
    for (const space of ['\u0085', ' ', ' ', '　']) {
      const text = patch('*** Add File: notes.txt', '+x', `${space}*** Update File: .codex/config.toml`, '@@', '+[mcp_servers.x]')
      expect([JSON.stringify(space), decidePatch(text).deny]).toEqual([JSON.stringify(space), true])
    }
    expect(patchOperations('*** Begin Patch\n\u0085*** Environment ID: other\n*** End Patch')).toBeNull()
  })

  it.each([
    ["bash -c 'cat ~/.dethernety/tokens.json'"],
    ["sh -c 'cat ../.dethernety/tokens.json'"],
    ['bash -o pipefail -c "cat ~/.dethernety/tokens.json"'],
    ['env FOO=1 bash -c "cat ~/.dethernety/tokens.json"'],
    ["bash -c \"sh -c 'cat ~/.dethernety/tokens.json'\""],
    ['cat ~+/../.dethernety/tokens.json'],
    ['cat ~-/.dethernety/tokens.json'],
    ['ln -s ~ k && cat k/.dethernety/tokens.json'],
    ['ln -s ~/.dethernety s'],
    ['dd if=~/.dethernety/tokens.json'],
    ['X=~/.dethernety/tokens.json; cat "$X"'],
  ])('denies %s on Codex, which reaches the server folder', (command) => {
    const cwd = path.join(home, 'proj')
    mkdirSync(cwd, { recursive: true })
    expect(decideCodexAccess(rawEventFrom(bash(command, {}, cwd)), env({ cwd }))).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
  })

  it('judges an argv that runs a shell with -c by its script, whatever follows it', () => {
    expect(codex(['bash', '-c', 'cat ~/.dethernety/tokens.json', 'x']).deny).toBe(true)
    expect(codex(['env', 'sh', '-c', 'cat deploy/orders/db-connection.yaml']).deny).toBe(true)
    expect(codex(['bash', '-c', 'ls src', 'x']).deny).toBe(false)
  })

  it('resolves the links of a glob word before matching it', () => {
    symlinkSync(home, path.join(project, 'h'))
    expect(codex('cat h/.deth*/tokens.json').deny).toBe(true)
    expect(codex('cat h/.dethernety/tokens.json').deny).toBe(true)
  })

  it("denies a project secret inside a shell's -c script, by its content", () => {
    expect(codex("bash -c 'cat deploy/orders/db-connection.yaml'").deny).toBe(true)
    expect(codex("sh -c 'cd deploy/orders && cat db-connection.yaml'").deny).toBe(true)
  })

  it("denies Codex's plugin folder and config.toml through the shell, under CODEX_HOME or the default", () => {
    const codexHome = path.join(tmp, 'codex-home')
    const g = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CODEX_HOME: codexHome } })
    expect(codex(`cp x ${codexHome}/plugins/cache/m/dethereal/1/bin/pre-tool-use.mjs`, g)).toMatchObject({ deny: true, reason: expect.stringMatching(/Codex's plugin folder/) })
    expect(codex('sed -i s/a/b/ $CODEX_HOME/config.toml', g).deny).toBe(true)
    expect(codex('cp x ~/.codex/plugins/a/bin/pre-tool-use.mjs').deny).toBe(true)
    expect(codex('cat ~/.codex/AGENTS.md').deny).toBe(false)
  })

  it("denies a change to Claude Code's configuration through the shell, in the user's, the project's and a set folder; lets it be read", () => {
    const cfg = path.join(tmp, 'claude-config')
    const set = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CLAUDE_CONFIG_DIR: cfg } })
    const CLAUDE = /Claude Code's configuration/
    for (const command of [
      'cp x ~/.claude/plugins/cache/m/dethereal/1/bin/hook.mjs',
      'echo {} > ~/.claude/settings.json',
      'ln -s /tmp/evil ~/.claude/skills/s',
      'rm -rf ~/.claude/agents',
      'echo {} > .claude/settings.local.json',
      `tee ${project}/.claude/commands/c.md`,
      'cp -r ~/.claude /tmp/out',
    ]) expect([command, codex(command)]).toEqual([command, expect.objectContaining({ deny: true, reason: expect.stringMatching(CLAUDE) })])
    for (const command of [`cp x ${cfg}/plugins/h.mjs`, `echo {} > ${cfg}/settings.json`, 'cp x "$CLAUDE_CONFIG_DIR/plugins/h.mjs"', 'cp x ${CLAUDE_CONFIG_DIR}/skills/s/SKILL.md']) {
      expect([command, codex(command, set)]).toEqual([command, expect.objectContaining({ deny: true, reason: expect.stringMatching(CLAUDE) })])
    }
    expect(codex(`cp x ${cfg}/plugins/h.mjs`).deny).toBe(false)
    // A relative value is not a configuration directory, as the config guard reads it.
    const relative = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CLAUDE_CONFIG_DIR: 'claude-config' } })
    expect(codex('cp x claude-config/plugins/h.mjs', relative).deny).toBe(false)
    for (const command of ['cat ~/.claude/plugins/cache/m/dethereal/1/skills/s/SKILL.md', 'cat ~/.claude/settings.json', 'ls ~/.claude', 'head .claude/agents/a.md', `cat ${cfg}/settings.json`]) {
      expect([command, codex(command, set).deny]).toEqual([command, false])
    }
    // .claude.json can hold the user's MCP servers and their keys: not even read, as config.toml is not.
    for (const command of ['cat ~/.claude.json', 'cp e ~/.claude.json', 'jq . ~/.claude.json', `cat ${cfg}/.claude.json`]) {
      expect([command, codex(command, set)]).toEqual([command, expect.objectContaining({ deny: true, reason: expect.stringMatching(/Claude Code's \.claude\.json/) })])
    }
  })

  it("names the server's folder first when a command reaches it and Claude Code's configuration", () => {
    expect(codex('cp ~/.dethernety/tokens.json ~/.claude/plugins/x')).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
  })

  it.each([['exec bash'], ['env python3'], ['nohup node'], ['timeout 5 bash'], ['nice -n 5 zsh'], ['python3.12'], ['nodejs'], ['script'], ["bash -c 'python3'"]])(
    'denies %s, a shell or interpreter left waiting for input',
    (command) => {
      expect(codex(command).deny).toBe(true)
    },
  )

  it.each([['ls -la ~'], ['cat .dethernety/models.json'], ['ln -s ~/projects/x y'], ['bash scripts/build.sh'], ['env NODE_ENV=test node app.js'], ['python3.12 -c "print(1)"'], ['bash -c "ls src"']])(
    'still allows %s',
    (command) => {
      expect(codex(command).deny).toBe(false)
    },
  )

  it('puts the marker once in every Codex and OpenCode denial', () => {
    const reasons = [
      codex("apply_patch <<'EOF'\n*** Begin Patch\n*** End Patch\nEOF"),
      codex('bash'),
      codex('cat ~/.dethernety/tokens.json'),
      codex('cp x ~/.codex/plugins/a'),
      codex('cat deploy/orders/db-connection.yaml'),
      decideCodexAccess(rawEventFrom(codexEvent('Bash', {})), env()),
      opencode('read', { filePath: path.join(home, '.dethernety/tokens.json') }),
      opencode('bash', {}),
    ].map((d) => (d.deny ? d.reason : ''))
    for (const r of reasons) expect([r, r.split(MARKER).length - 1]).toEqual([r, 1])
  })

  it("denies OpenCode's read, grep and bash of the server folder, through `..` in a skill folder and through links", () => {
    expect(opencode('read', { filePath: path.join(project, '.opencode/skills/dethereal-status/../../../../home/.dethernety/tokens.json') }).deny).toBe(true)
    expect(opencode('read', { filePath: path.join(home, '.dethernety/tokens.json') }).deny).toBe(true)
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'state'))
    expect(opencode('read', { filePath: 'state/tokens.json' }).deny).toBe(true)
    expect(opencode('grep', { pattern: 'x', path: path.join(home, '.dethernety') }).deny).toBe(true)
    expect(opencode('bash', { command: 'cat ~/.dethernety/tokens.json' }).deny).toBe(true)
    expect(opencode('bash', { command: "bash -c 'cat ~/.dethernety/runtime/current.json'" }).deny).toBe(true)
    expect(opencode('bash', { command: 'cat tokens.json', workdir: path.join(home, '.dethernety') }).deny).toBe(true)
    expect(opencode('read', { filePath: 'src/app.ts' }).deny).toBe(false)
    expect(opencode('bash', { command: 'ls src' }).deny).toBe(false)
  })

  it('denies an OpenCode bash call with no command, read whole or recovered', () => {
    expect(opencode('bash', {}).deny).toBe(true)
    expect(decideOpenCodeAccess({ text: null, fields: new Map([['tool', ['bash']]]) }, env()).deny).toBe(true)
  })
})

describe('the guards on Codex: the cases the fix review found', () => {
  function env(overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
    return { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
  }
  const codex = (command: string, g = env()) => decideCodexAccess(rawEventFrom(codexEvent('Bash', { command })), g)
  const claude = (command: string) =>
    decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project })), env())

  beforeEach(() => {
    file('.dethernety/tokens.json', '{}\n', home)
    file('.dethernety/models.json', '{"models":[]}\n')
    file('deploy/orders/db-connection.yaml', 'kind: Secret\n')
  })

  it.each([
    ["echo | xargs sh -c 'cat ~/.dethernety/tokens.json'"],
    ["find . -name x -exec bash -c 'cat ~/.dethernety/tokens.json' \\;"],
    ["bash -c -- 'cat ~/.dethernety/tokens.json'"],
    ["bash -c -x 'cat ~/.dethernety/tokens.json'"],
    ["bash --rcfile /dev/null -c 'cat ~/.dethernety/tokens.json'"],
    ['env -C ~/.dethernety cat tokens.json'],
    ['env --chdir=~/.dethernety cat tokens.json'],
    ["env -S 'cat ~/.dethernety/tokens.json'"],
    ["cat ~/$'\\x2edethernety'/tokens.json"],
    ["cat ~/$'\\056dethernety'/tokens.json"],
    ['cat ~/$".dethernety"/tokens.json'],
    ['(cd ~; cat .dethernety/tokens.json)'],
    ['{ cd ~; cat .dethernety/tokens.json; }'],
    ['if cd ~; then cat .dethernety/tokens.json; fi'],
    ['sudo cat ~/.dethernety/tokens.json'],
    ['cat "$(echo ~)/.dethernety/tokens.json"'],
  ])('denies %s', (command) => {
    expect(codex(command)).toMatchObject({ deny: true, reason: expect.stringMatching(/server's own folder/) })
  })

  it.each([['bash -s arg'], ['sh -s -- x'], ['python3 - arg'], ['python3 -i f.py'], ['time bash'], ['sudo bash'], ['script -q /dev/null'], ['echo | xargs bash -c "zsh"']])(
    'denies %s, which waits for input',
    (command) => {
      expect(codex(command).deny).toBe(true)
    },
  )

  it.each([['cat .dethernety/models.json > $OUT'], ['script -q out.log make build'], ['time make build'], ['xargs -0 rm -- < list.txt'], ['echo "(cd here)"'], ['cat fi']])('still allows %s', (command) => {
    expect(codex(command).deny).toBe(false)
  })

  it('reads a project secret inside a shell started anywhere in the command, on Claude too', () => {
    expect(claude("echo | xargs sh -c 'cat deploy/orders/db-connection.yaml'").deny).toBe(true)
    expect(claude('env -C deploy/orders cat db-connection.yaml').deny).toBe(true)
    expect(claude("env -S 'cat deploy/orders/db-connection.yaml'").deny).toBe(true)
    expect(claude("cat deploy/orders/$'db-connection.yaml'").deny).toBe(true)
    expect(claude('(cd deploy/orders && cat db-connection.yaml)').deny).toBe(true)
    expect(claude("echo | xargs sh -c 'ls deploy'").deny).toBe(false)
  })
})

describe("the guards on Codex: Codex's own files through the shell", () => {
  function env(overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
    return { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
  }
  const codexHome = () => path.join(tmp, 'codex-home')
  const g = () => env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CODEX_HOME: codexHome() } })
  const codex = (command: string) => decideCodexAccess(rawEventFrom(codexEvent('Bash', { command })), g())
  const skill = () => `${codexHome()}/plugins/cache/dethereal-local/dethereal/0.4.8/skills/status`

  beforeEach(() => {
    file('plugins/cache/dethereal-local/dethereal/0.4.8/skills/status/SKILL.md', '# status\n', codexHome())
    file('plugins/cache/dethereal-local/dethereal/0.4.8/skills/status/task.md', '# task\n', codexHome())
    file('config.toml', 'model = "x"\n', codexHome())
    file('auth.json', '{}\n', codexHome())
    file('.codex/auth.json', '{}\n', home)
    file('README.md', '# readme\n')
  })

  it.each([
    () => `cat ${skill()}/SKILL.md`,
    () => `sed -n 1,40p ${skill()}/task.md`,
    () => `head -n 20 ${skill()}/SKILL.md | wc -l`,
    () => `grep -n status ${skill()}/SKILL.md`,
    () => `rg -n status ${skill()}`,
    () => `ls -la ${skill()}`,
    () => `find ${skill()} -name '*.md'`,
    () => 'cat README.md',
  ])('lets Codex read its skill files: %s', (command) => {
    expect(codex(command()).deny).toBe(false)
  })

  it.each([
    () => `cat ${codexHome()}/config.toml`,
    () => `grep -n key ${codexHome()}/auth.json`,
    () => `sed -n 1,5p ${codexHome()}/auth.json`,
    () => 'cat ~/.codex/auth.json',
    () => 'cat $CODEX_HOME/auth.json',
    () => `cat ${skill()}/../../../../../../../config.toml`,
    () => `grep -r token ${codexHome()}`,
  ])("denies reading Codex's configuration or sign-in: %s", (command) => {
    expect(codex(command())).toMatchObject({ deny: true, reason: expect.stringMatching(/Codex's config\.toml|a harness's own sign-in/) })
  })

  it.each([
    () => `cp x ${skill()}/SKILL.md`,
    () => `cat x > ${skill()}/SKILL.md`,
    () => `cat ${skill()}/SKILL.md > /tmp/copy.md`,
    () => `echo hi | tee ${skill()}/SKILL.md`,
    () => `sed -i s/a/b/ ${skill()}/SKILL.md`,
    () => `sed -n 'w /tmp/x' ${skill()}/SKILL.md`,
    () => `chmod +x ${skill()}/SKILL.md`,
    () => `ln -s /tmp/x ${skill()}/hook.mjs`,
    () => `mv ${skill()}/SKILL.md /tmp/`,
    () => `node ${skill()}/x.mjs`,
    () => `find ${skill()} -delete`,
    () => `rg --pre ./x status ${skill()}`,
    () => `cp x .codex/plugins/a/bin/hook.mjs`,
  ])("still denies changing, copying or running anything in Codex's plugin folder: %s", (command) => {
    expect(codex(command()).deny).toBe(true)
  })
})

describe("the guards on Codex: sed and file in Codex's plugin folder", () => {
  const codexHome = () => path.join(tmp, 'codex-home')
  const g = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CODEX_HOME: codexHome() }, cwd: project, platform: 'linux', now: Date.now })
  const codex = (command: string) => decideCodexAccess(rawEventFrom(codexEvent('Bash', { command })), g())
  const hook = () => `${codexHome()}/plugins/cache/x/dethereal/1/bin/hook.mjs`
  const task = () => `${codexHome()}/plugins/cache/x/dethereal/1/skills/review/task.md`

  beforeEach(() => {
    file('plugins/cache/x/dethereal/1/bin/hook.mjs', '// runner\n', codexHome())
    file('plugins/cache/x/dethereal/1/skills/review/task.md', '# task\n', codexHome())
  })

  it.each([
    () => `sed -n 1p -e 'w ${hook()}' /tmp/evil`,
    () => `sed -n -e 1p -e 'w ${hook()}' /tmp/evil`,
    () => `sed -n 1p --expression='w ${hook()}' /tmp/evil`,
    () => `sed -n -I.bak 1p ${hook()}`,
    () => `sed -n -i 1p ${hook()}`,
    () => `sed -n 1p ${hook()} -i`,
    () => `sed -n 1p -f /tmp/script ${hook()}`,
    () => `sed -n '1w ${hook()}' /tmp/evil`,
    () => `sed -n -E 1p ${hook()}`,
    () => `file -C -m ${hook()}`,
  ])('denies a sed or file that could write into the plugin folder: %s', (command) => {
    expect(codex(command()).deny).toBe(true)
  })

  it.each([() => `sed -n 1,40p ${task()}`, () => `sed -n 1p ${task()}`, () => `sed --quiet 2,5p ${task()}`, () => `sed -n 3,9p ${task()}`])(
    'still lets Codex read a line range: %s',
    (command) => {
      expect(codex(command()).deny).toBe(false)
    },
  )

  it("judges a path inside a quoted word for project secrets too (a sed script's w file)", () => {
    file('deploy/orders/secrets.yaml', 'kind: Secret\n')
    expect(codex("sed -n '1w deploy/orders/secrets.yaml' /tmp/x").deny).toBe(true)
  })
})
