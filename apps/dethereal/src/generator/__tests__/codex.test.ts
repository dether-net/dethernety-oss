import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { FIXTURE_WORKFLOW, PACKAGE_GOLDENS } from '../cli.js'
import { generate, generateFromSource, GeneratorError } from '../index.js'
import { claudeLiteralsInOutput } from '../lint.js'
import { readWorkflow } from '../source.js'
import { agentPreamble, autoApproved, codexRenderer, codexTarget, codexTaskRenderer, codexTools } from '../targets/codex/index.js'
import { tomlLines, tomlString, tomlUnescape } from '../../installer/writers/codex/toml-text.js'
import { renderText } from '../tokens.js'
import { manifestToolNames, TOOL_MANIFEST } from '../../tools/manifest.js'

const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }
const out = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'codex' })
const fixture = readWorkflow(FIXTURE_WORKFLOW)
const file = (p: string) => {
  const content = out.get(`bundles/codex/${p}`)
  expect(content, p).toBeDefined()
  return content!
}
const codex = (text: string, shared: Record<string, string> = {}) =>
  renderText(text, { harness: 'codex', renderer: codexRenderer, shared: (p) => shared[p], allowAsFile: true, skill: 'guide' }).text

function findingsOf(changes: Record<string, string>): string[] {
  try {
    generateFromSource({ pkg, source: new Map([...fixture, ...Object.entries(changes)]), harness: 'codex' })
  } catch (err) {
    if (err instanceof GeneratorError) return err.findings.map((f) => `${f.rule} ${f.file}: ${f.message}`)
    throw err
  }
  return []
}

describe('Codex renderings', () => {
  it('spells tools, skill invocations, agents and arguments the Codex way', () => {
    expect(codex('{{tool:list_models}} {{cmd:sync}} {{agent:model-reviewer}} {{args}}')).toBe(
      '`mcp__dethereal__list_models` `$dethereal:sync` `dethereal-model-reviewer` the text the operator supplied with the skill invocation, or the arguments a skill that handed over to this one named',
    )
    expect(codex('`{{cmd:sync}} push`')).toBe('`$dethereal:sync push`')
  })

  it('delegates with spawn_agent without the conversation, waits, and fails closed', () => {
    expect(codex('{{#delegate scout}}Survey it.{{/delegate}}')).toBe(
      'Use the `spawn_agent` tool with `agent_type: "dethereal-scout"`, `fork_turns: "none"` and this message: “Survey it.” ' +
        "Then wait for its final answer with `wait_agent`, and once you have it close the agent with `close_agent` — a finished agent counts against the session's agent limit until it is closed; if you have no `close_agent` tool, go on, and if a later `spawn_agent` fails on the agent limit, stop and tell the operator. " +
        'If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.',
    )
  })

  it('asks choices as a numbered list after the table, and ends the turn', () => {
    expect(codex('{{#ask id=push-confirm}}Push now? (push / skip){{/ask}}')).toBe('`[prompt: push-confirm]` Push now? (push / skip) — table first, a numbered list; end your turn.')
    expect(codex('{{#ask id=notes text}}Anything else?{{/ask}}')).toBe('`[prompt: notes]` Anything else? — a plain message; end your turn.')
  })

  it('points an as-file read at the skill directory, and a task file at its own directory', () => {
    expect(codex('{{include shared/ref.md as-file}}', { 'shared/ref.md': 'x' })).toBe(
      "Read the file `ref.md` from the directory of the `dethereal:guide` skill's `SKILL.md` (its path is in your skill list), in full.",
    )
    expect(codexTaskRenderer.asFile('ref.md', 'audit')).toBe('Read the file `ref.md` from the same directory as your task file, in full.')
    expect(codexTaskRenderer.inline('args', '', false)).toBe("the operator's text quoted in your task message")
    expect(codexTaskRenderer.inline('tool', 'x', false)).toBe('`mcp__dethereal__x`')
  })
})

describe('Codex tools for an agent', () => {
  it('reads through the shell, writes through apply_patch, and names its Dethereal tools', () => {
    expect(codexTools(['fs-read', 'mcp:get_classes'])).toEqual({ mcp: ['mcp__dethereal__get_classes'], useShell: true, write: false, literal: [] })
    expect(codexTools(['fs-write'])).toMatchObject({ useShell: true, write: true })
    // A leaf cannot ask for approval: every Dethereal tool means every tool that needs none.
    expect(codexTools(['mcp:*']).mcp).toEqual(TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => `mcp__dethereal__${t.name}`).sort())
    expect(codexTools(['mcp:*']).mcp).not.toContain('mcp__dethereal__update_attributes')
    expect(codexTools(['mcp:model_state'])).toMatchObject({ useShell: false, write: false })
  })

  it('opens every agent with its place and its tools', () => {
    const readOnly = agentPreamble({ name: 'r', description: 'd', tools: ['fs-read', 'fs-search', 'mcp:validate_model_json'], own: [] })
    expect(readOnly).toContain('never wait for a reply')
    expect(readOnly).toContain('Never start other agents.')
    expect(readOnly).toContain('Dethereal tools you may use: `mcp__dethereal__validate_model_json`. Use no other Dethereal tool.')
    expect(readOnly).toContain('Never change files — no edits, and no shell command that writes; for you the shell runs only commands that read.')
    expect(readOnly).not.toContain('sandbox is read-only')
    const toolsOnly = agentPreamble({ name: 'r', description: 'd', tools: ['mcp:model_state'], own: [] })
    expect(toolsOnly).toContain('Do not read or search files.')
  })
})

describe('the fixture workflow for Codex', () => {
  it('emits the marketplace, the plugin with its hooks, the agents and the config fragment', () => {
    expect([...out.keys()]).toEqual([
      'bundles/codex/.agents/plugins/marketplace.json',
      'bundles/codex/agents/dethereal-enricher.toml',
      'bundles/codex/agents/dethereal-lead.toml',
      'bundles/codex/agents/dethereal-reviewer.toml',
      'bundles/codex/agents/dethereal-scout.toml',
      'bundles/codex/bundle.json',
      'bundles/codex/config.fragment.toml',
      'bundles/codex/plugins/dethereal/.codex-plugin/plugin.json',
      'bundles/codex/plugins/dethereal/bin/hook-deadlines.json',
      'bundles/codex/plugins/dethereal/bin/hook.mjs',
      'bundles/codex/plugins/dethereal/bin/leaf-allowlist.json',
      'bundles/codex/plugins/dethereal/bin/pre-tool-use.mjs',
      'bundles/codex/plugins/dethereal/bin/runtime-check.mjs',
      'bundles/codex/plugins/dethereal/bin/secret-fallback.mjs',
      'bundles/codex/plugins/dethereal/bin/shell-check.mjs',
      'bundles/codex/plugins/dethereal/hooks/hooks.json',
      'bundles/codex/plugins/dethereal/skills/audit/SKILL.md',
      'bundles/codex/plugins/dethereal/skills/audit/task.md',
      'bundles/codex/plugins/dethereal/skills/guide/SKILL.md',
      'bundles/codex/plugins/dethereal/skills/guide/reference.md',
      'bundles/codex/plugins/dethereal/skills/orchestrate/SKILL.md',
      'bundles/codex/plugins/dethereal/skills/status/SKILL.md',
    ])
  })

  it('lists the plugin in the marketplace and serves its skills', () => {
    expect(JSON.parse(file('.agents/plugins/marketplace.json')).plugins).toEqual([
      { name: 'dethereal', source: { source: 'local', path: './plugins/dethereal' } },
    ])
    expect(JSON.parse(file('plugins/dethereal/.codex-plugin/plugin.json'))).toMatchObject({ name: 'dethereal', version: '1.2.3', skills: './skills/' })
  })

  it('hands a forked skill to its agent as a task file', () => {
    const skill = file('plugins/dethereal/skills/audit/SKILL.md')
    expect(skill).toContain('`agent_type: "dethereal-reviewer"`, `fork_turns: "none"`')
    expect(skill).toContain('Read and follow the task file `task.md`')
    expect(skill).toContain('show its final answer to the operator in full')
    expect(skill).not.toContain('Reply with your reviewer marker line')
    expect(file('plugins/dethereal/skills/audit/task.md')).toMatch(/^Audit the model at the operator's text quoted in your task message/)
  })

  it('writes agents as leaves: read-only sandbox without writes, no maxTurns or memory, Codex-only prose', () => {
    const scout = file('agents/dethereal-scout.toml')
    expect(scout).toMatch(/^name = "dethereal-scout"\ndescription = ".+"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\n/)
    expect(file('agents/dethereal-enricher.toml')).toContain('sandbox_mode = "workspace-write"')
    const lead = file('agents/dethereal-lead.toml')
    expect(lead).toContain('do it yourself with the read tools')
    expect(lead).not.toMatch(/maxTurns|memory|color|spawn_agent`? tool with/)
  })

  it('auto-approves exactly the manifest’s auto tools, which are the documented set, and prompts for the rest', () => {
    const fragment = file('config.fragment.toml')
    expect(fragment).toContain('default_tools_approval_mode = "prompt"')
    const approved = [...fragment.matchAll(/^\[mcp_servers\.dethereal\.tools\.([a-z_]+)\]\napproval_mode = "approve"$/gm)].map((m) => m[1])
    expect(approved).toEqual(autoApproved())
    expect(approved).toEqual(TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name).sort())
    // The documented auto-approve set of the Codex bundle.
    expect(approved).toEqual(
      [
        'auth_status', 'workspace_status', 'detect_drift', 'validate_model_json', 'get_model_schema', 'get_example_models',
        'list_models', 'get_classes', 'match_classes', 'search_mitre_attack', 'get_mitre_defend', 'get_control_gaps', 'model_state',
        'query_controls', 'query_exposures', 'query_countermeasures',
      ].sort(),
    )
    expect(approved.every((t) => manifestToolNames().includes(t!))).toBe(true)
    // Nothing else is keyed under the server's tools table.
    expect([...fragment.matchAll(/^\[mcp_servers\.dethereal\.tools\./gm)]).toHaveLength(approved.length)
  })

  it('carries the whole server entry with installer placeholders', () => {
    const fragment = file('config.fragment.toml')
    expect(fragment).toMatch(/^\[mcp_servers\.dethereal\]\ncommand = "<node-abs>"\nargs = \["<runtime>\/dist\/index\.js"\]\nenv = \{ DETHERNETY_PLATFORM_URL = "<platform-url>" \}\n/)
    // The install URL is a default; DETHERNETY_URL from Codex's environment passes through and wins.
    expect(fragment).toContain('env_vars = ["NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "DEBUG", "DETHERNETY_URL", "DETHEREAL_SETTLEMENT"]')
    // The settlement switch passes through from the operator's shell; the bundle never sets it.
    expect(fragment).not.toMatch(/^env = \{[^}]*\bDETHEREAL_SETTLEMENT\b/m)
    expect(fragment).not.toMatch(/^env = \{[^}]*\bDETHERNETY_URL\b/m)
    expect(fragment).toContain('startup_timeout_sec = 30\ntool_timeout_sec = 120\n')
    expect(JSON.parse(file('bundle.json')).placeholders).toEqual(['<node-abs>', '<platform-url>', '<runtime>'])
  })

  it('fills the server entry when a build is given', () => {
    const dev = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'codex', mcpEntry: { node: '/n', entry: '/d/index.js', url: 'http://127.0.0.1:9' } })
    const fragment = dev.get('bundles/codex/config.fragment.toml')!
    expect(fragment).toContain('command = "/n"\nargs = ["/d/index.js"]\nenv = { DETHERNETY_PLATFORM_URL = "http://127.0.0.1:9" }')
    expect(JSON.parse(dev.get('bundles/codex/bundle.json')!).placeholders).toEqual([])
  })

  it('keeps every Claude spelling out of the Codex bundle', () => {
    for (const [p, content] of out) expect(claudeLiteralsInOutput(p, content, 'codex'), p).toEqual([])
  })
})

describe('Codex rules', () => {
  it('flags Claude spellings in another harness’s output, not the Codex ones', () => {
    expect(claudeLiteralsInOutput('f', 'Call mcp__plugin_dethereal_dethereal__x.\nUse AskUserQuestion.\nRun /dethereal:sync.', 'codex').map((f) => f.line)).toEqual([1, 2, 3])
    expect(claudeLiteralsInOutput('f', 'Pass subagent_type.\nParse $ARGUMENTS.', 'codex').map((f) => f.line)).toEqual([1, 2])
    expect(claudeLiteralsInOutput('f', 'Call `mcp__dethereal__x`; run `$dethereal:sync`; spawn `dethereal-scout`.', 'codex')).toEqual([])
  })

  it('requires every agent it starts to be closed again', () => {
    expect(codexTarget.checkOutput(new Map([['s/SKILL.md', 'Use the `spawn_agent` tool now.\n\nThen go on.\n']])).map((f) => f.message)).toEqual([
      'a spawn_agent instruction without the matching close_agent',
    ])
    expect(codexTarget.checkOutput(out)).toEqual([])
  })

  it('refuses a delegation inside a forked skill: it runs as a leaf', () => {
    const found = findingsOf({ 'skills/audit/SKILL.md': '---\nname: audit\ndescription: d\ncontext: fork\nagent: reviewer\n---\n\n{{#delegate scout}}Go.{{/delegate}}\n' })
    expect(found.join('\n')).toContain('a forked skill runs as a leaf and cannot delegate')
  })

  it('requires valid Codex harness data', () => {
    const found = findingsOf({ 'harness/codex.yaml': 'plugin:\n  description: d\n  interface:\n    displayName: X\nmarketplace:\n  name: Bad Name\n  displayName: M\n' }).join('\n')
    expect(found).toContain('plugin.interface.shortDescription must be a non-empty string')
    expect(found).toContain('plugin.interface.capabilities must be a list of strings')
    expect(found).toContain('marketplace.name must be lowercase words joined by hyphens')
  })
})

describe('the TOML writer', () => {
  it('reads back what it wrote: the instructions a ledger anchor is matched against', () => {
    const text = 'Say "hi" \\ then\n\ttab \u0001 and \'\'\' done"'
    const oneLine = 'Say "hi" \\ then\ttab \u0001 done"'
    expect(tomlUnescape(tomlString(oneLine).slice(1, -1))).toBe(oneLine)
    const file = tomlLines([['name', 'x'], ['developer_instructions', `line one\n${text}\n`]])
    expect(codexTarget.agentText!(file)).toBe(`line one\n${text}\n`)
  })

  it('writes one-line strings as escaped basic strings', () => {
    expect(tomlString('a "quoted" \\ path\tand\rcontrol\u0001')).toBe('"a \\"quoted\\" \\\\ path\\tand\\rcontrol\\u0001"')
  })

  it('writes multi-line text so that no content can end the string early', () => {
    const text = "line one\n'''\n\"\"\" and a trailing quote\"\nback\\slash\n"
    expect(tomlString(text)).toBe('"""\nline one\n\'\'\'\n\\"\\"\\" and a trailing quote\\"\nback\\\\slash\n"""')
  })

  it('writes keys in order, drops undefined values, and quotes keys that are not bare', () => {
    expect(tomlLines([['a', 1], ['b', undefined], ['c d', true], ['e', ['x', 'y']], ['f', { K: 'v' }]])).toBe('a = 1\n"c d" = true\ne = ["x", "y"]\nf = { K = "v" }\n')
  })
})

describe('the TOML files, read back by an independent parser', () => {
  const tomlFiles = [...out].filter(([p]) => p.endsWith('.toml'))

  it('parses every TOML file of the bundle', () => {
    expect(tomlFiles.length).toBe(5)
    for (const [p, content] of tomlFiles) expect(() => parseToml(content), p).not.toThrow()
  })

  it('gives every agent file what the Codex role loader requires', () => {
    for (const [p, content] of tomlFiles.filter(([f]) => f.includes('/agents/'))) {
      const role = parseToml(content) as Record<string, unknown>
      expect(Object.keys(role), p).toEqual(['name', 'description', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions'])
      expect(role.name, p).toMatch(/^dethereal-[a-z0-9-]+$/)
      expect(String(role.description).trim(), p).not.toBe('')
      expect(String(role.developer_instructions).trim(), p).not.toBe('')
      expect(['read-only', 'workspace-write']).toContain(role.sandbox_mode)
      expect(['low', 'medium', 'high']).toContain(role.model_reasoning_effort)
    }
  })

  it('reads the config fragment as the server entry with its approvals', () => {
    const config = parseToml(file('config.fragment.toml')) as { mcp_servers: { dethereal: Record<string, unknown> } }
    const server = config.mcp_servers.dethereal
    expect(server).toMatchObject({
      command: '<node-abs>',
      args: ['<runtime>/dist/index.js'],
      env: { DETHERNETY_PLATFORM_URL: '<platform-url>' },
      startup_timeout_sec: 30,
      tool_timeout_sec: 120,
      default_tools_approval_mode: 'prompt',
    })
    // The install never pins DETHERNETY_URL: that one stays the user's.
    expect(server.env).toEqual({ DETHERNETY_PLATFORM_URL: '<platform-url>' })
    const tools = server.tools as Record<string, Record<string, unknown>>
    expect(Object.keys(tools).sort()).toEqual(autoApproved())
    for (const entry of Object.values(tools)) expect(entry).toEqual({ approval_mode: 'approve' })
  })

  it('round-trips text that would break a naive writer, exactly', () => {
    const nasty = [
      'ends with a quote"',
      `triple '''single''' and """double""" quotes`,
      'back\\slashes \\n not newlines',
      'CR\r and tab\t and bell\u0007',
      'multi\nline\n\nwith a blank line and a trailing newline\n',
      '\nleading newline',
    ]
    for (const text of nasty) {
      const parsed = parseToml(tomlLines([['v', text]])) as { v: string }
      expect(parsed.v).toBe(text)
    }
  })
})

describe('asking on Codex', () => {
  const heads = (harness: string): string[] => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : n === 'SKILL.md' ? [p] : []
    })
    return walk(path.join(PACKAGE_GOLDENS, harness))
  }
  const NO_DIALOG = 'Never ask with `request_user_input`.'
  const WAIT = 'After the question, end your turn: no tool or shell call until the operator answers.'

  // Codex's request_user_input does not end the turn in default mode, so a question is a message and the turn ends with it.
  it('every Codex skill asks in its message and makes no call until the answer', () => {
    const codex = heads('codex')
    expect(codex.length).toBeGreaterThan(10)
    for (const f of codex) {
      const text = readFileSync(f, 'utf8')
      if (!text.includes('**The asking rule.**')) continue
      expect(text, f).toContain(NO_DIALOG)
      expect(text, f).toContain(WAIT)
    }
  })

  it('the Claude and OpenCode skills keep their own asking', () => {
    for (const harness of ['claude', 'opencode']) {
      for (const f of heads(harness)) {
        const text = readFileSync(f, 'utf8')
        expect(text, f).not.toContain(NO_DIALOG)
        expect(text, f).not.toContain(WAIT)
      }
    }
  })
})
