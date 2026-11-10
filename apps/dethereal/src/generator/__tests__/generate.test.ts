import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { FIXTURE_WORKFLOW } from '../cli.js'
import { generate, generateFromSource, GeneratorError, lintWorkflow } from '../index.js'
import { readWorkflow } from '../source.js'
import { claudeTools } from '../targets/claude/index.js'
import { manifestToolNames } from '../../tools/manifest.js'
import { autoActions } from '../../cli/approve.js'
import { hookSettlement, SETTLEMENT_ENV, SETTLEMENT_ON, settlementOn } from '../../utils/settlement-switch.js'

const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }
const fixture = readWorkflow(FIXTURE_WORKFLOW)
const out = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'claude' })

function frontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  expect(m).not.toBeNull()
  return parse(m![1]!) as Record<string, unknown>
}

function file(p: string): string {
  const content = out.get(p)
  expect(content, p).toBeDefined()
  return content!
}

/** The fixture with some files replaced (undefined removes a file). */
function variant(changes: Record<string, string | undefined>): Map<string, string> {
  const source = new Map(fixture)
  for (const [p, content] of Object.entries(changes)) {
    if (content === undefined) source.delete(p)
    else source.set(p, content)
  }
  return source
}

function findingsOf(changes: Record<string, string | undefined>, harness: 'claude' | 'codex' = 'claude'): string[] {
  try {
    generateFromSource({ pkg, source: variant(changes), harness })
  } catch (err) {
    if (err instanceof GeneratorError) return err.findings.map((f) => `${f.rule} ${f.file}: ${f.message}`)
    throw err
  }
  return []
}

const skill = (name: string, head: string, body = 'Body.\n') => ({ [`skills/${name}/SKILL.md`]: `---\n${head}\n---\n\n${body}` })
const agent = (name: string, head: string, body = 'Body.\n') => ({ [`agents/${name}.md`]: `---\n${head}\n---\n\n${body}` })

describe('the fixture workflow for Claude', () => {
  it('emits the plugin manifest, the bundle and nothing else', () => {
    expect([...out.keys()]).toEqual([
      '.claude-plugin/plugin.json',
      'bundles/claude/.mcp.json',
      'bundles/claude/agents/enricher.md',
      'bundles/claude/agents/lead.md',
      'bundles/claude/agents/reviewer.md',
      'bundles/claude/agents/scout.md',
      'bundles/claude/bundle.json',
      'bundles/claude/hooks/hooks.json',
      'bundles/claude/skills/audit/SKILL.md',
      'bundles/claude/skills/guide/SKILL.md',
      'bundles/claude/skills/guide/reference.md',
      'bundles/claude/skills/orchestrate/SKILL.md',
      'bundles/claude/skills/status/SKILL.md',
    ])
  })

  it('writes the root manifest with paths into the bundle and today’s metadata', () => {
    const manifest = JSON.parse(file('.claude-plugin/plugin.json'))
    expect(manifest).toEqual({
      name: 'dethereal',
      version: '1.2.3',
      // The metadata of the hand-written 0.4.x manifest, which the generated one must keep.
      description:
        'Professional threat modeling for Claude Code. Discover infrastructure, build data flow diagrams, enrich with security attributes, and sync with the Dethernety platform.',
      author: { name: 'dether.net', url: 'https://dether.net' },
      homepage: 'https://github.com/dether-net/dethernety-oss',
      repository: 'https://github.com/dether-net/dethernety-oss',
      license: 'AGPL-3.0',
      keywords: ['threat-modeling', 'cybersecurity', 'mitre-attack', 'data-flow-diagram', 'security-analysis'],
      skills: ['./bundles/claude/skills/'],
      agents: [
        './bundles/claude/agents/enricher.md',
        './bundles/claude/agents/lead.md',
        './bundles/claude/agents/reviewer.md',
        './bundles/claude/agents/scout.md',
      ],
      hooks: './bundles/claude/hooks/hooks.json',
      mcpServers: './bundles/claude/.mcp.json',
      userConfig: {
        platform_url: {
          type: 'string',
          title: 'Dethernety platform URL',
          description: 'Base URL of the Dethernety platform. A DETHERNETY_URL set in your shell takes precedence.',
          default: 'http://127.0.0.1:3000',
          sensitive: false,
        },
      },
    })
  })

  it('launches the packaged server through node, with the platform URL from the user config', () => {
    expect(JSON.parse(file('bundles/claude/.mcp.json'))).toEqual({
      mcpServers: {
        dethereal: {
          type: 'stdio',
          command: 'node',
          args: ['${CLAUDE_PLUGIN_ROOT}/dist/index.js'],
          env: { DETHERNETY_PLATFORM_URL: '${user_config.platform_url}' },
        },
      },
    })
  })

  it('runs a given server build under a sandbox HOME when asked', () => {
    const dev = generate({
      pkg,
      workflowDir: FIXTURE_WORKFLOW,
      harness: 'claude',
      mcpEntry: { node: '/opt/node/bin/node', entry: '/src/dist/index.js', home: '/sandbox', url: 'http://127.0.0.1:9' },
    })
    expect(JSON.parse(dev.get('bundles/claude/.mcp.json')!).mcpServers.dethereal).toEqual({
      type: 'stdio',
      command: '/opt/node/bin/node',
      args: ['/src/dist/index.js'],
      env: { DETHERNETY_PLATFORM_URL: '${user_config.platform_url}', HOME: '/sandbox', DETHERNETY_URL: 'http://127.0.0.1:9' },
    })
  })

  it('maps skill frontmatter: fork on the scoped agent, allowed tools, as-file read grant', () => {
    expect(frontmatter(file('bundles/claude/skills/orchestrate/SKILL.md'))).toEqual({
      name: 'orchestrate',
      description: 'Walk the two-step fixture workflow — survey through a specialist agent, then confirm with the operator.',
      'argument-hint': '[subject]',
    })
    expect(frontmatter(file('bundles/claude/skills/audit/SKILL.md'))).toMatchObject({
      context: 'fork',
      agent: 'dethereal:reviewer',
      background: false,
    })
    expect(frontmatter(file('bundles/claude/skills/status/SKILL.md'))['allowed-tools']).toBe('mcp__plugin_dethereal_dethereal__auth_status')
    expect(frontmatter(file('bundles/claude/skills/guide/SKILL.md'))['allowed-tools']).toEqual([
      'mcp__plugin_dethereal_dethereal__auth_status',
      'Read(/${CLAUDE_SKILL_DIR}/*.md)',
    ])
  })

  it('maps agent frontmatter, keeping Claude-only grants and keys', () => {
    expect(frontmatter(file('bundles/claude/agents/scout.md'))).toEqual({
      name: 'scout',
      description: 'Read-only fixture scout that reports what it surveyed.',
      model: 'inherit',
      effort: 'medium',
      maxTurns: 5,
      tools: ['Read', 'Glob', 'Grep', 'Bash', 'mcp__plugin_dethereal_dethereal__get_classes'],
    })
    expect(frontmatter(file('bundles/claude/agents/lead.md'))).toEqual({
      name: 'lead',
      description: 'Fixture lead that works directly with the operator and hands surveys to the scout where it can.',
      model: 'inherit',
      effort: 'high',
      maxTurns: 20,
      memory: 'project',
      color: 'cyan',
      tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'mcp__plugin_dethereal_dethereal__*', 'Agent(dethereal:scout)', 'Agent(dethereal:reviewer)'],
    })
    expect(file('bundles/claude/agents/lead.md')).toContain('`subagent_type: "dethereal:scout"`')
    expect(file('bundles/claude/agents/lead.md')).not.toContain('do it yourself with the read tools')
  })

  it('inlines includes, renders every token and keeps only the Claude blocks', () => {
    const body = file('bundles/claude/skills/orchestrate/SKILL.md')
    expect(body).toContain('## Handoff Protocol')
    expect(body).toContain('Include marker: copper-lantern')
    expect(body).toContain('Subject: $ARGUMENTS.')
    expect(body).toContain('`/dethereal:audit`, which runs the `dethereal:reviewer` agent')
    expect(body).toContain('`/dethereal:audit ./model`')
    expect(body).toContain('The dialog keeps the answer structured')
    expect(body).not.toContain('numbered list')
    expect(body).not.toMatch(/\{\{|\}\}/)
    expect(file('bundles/claude/skills/guide/SKILL.md')).toContain('Read the file `${CLAUDE_SKILL_DIR}/reference.md` in full.')
    expect(file('bundles/claude/skills/guide/reference.md')).toContain('Reference marker: amber-kestrel')
  })


  it('is lint-clean', () => {
    expect(lintWorkflow(fixture)).toEqual([])
  })
})

describe('the rules every directly-run skill carries', () => {
  it('fires on a skill that does not include the core rules, once the workflow has them', () => {
    const found = findingsOf({ 'shared/core-rules.md': 'Rule one.\n' }).filter((f) => f.startsWith('core-rules'))
    // Forked skills run in their agent, whose own instructions carry the rules.
    expect(found.some((f) => f.includes('skill audit'))).toBe(false)
    expect(found.some((f) => f.includes('skill orchestrate'))).toBe(true)
  })

  it('is silent when the skill includes them, directly or through a shared file', () => {
    const found = findingsOf({
      'shared/core-rules.md': 'Rule one.\n',
      'shared/protocols.md': `${fixture.get('shared/protocols.md')}\n{{include shared/core-rules.md}}\n`,
    }).filter((f) => f.startsWith('core-rules'))
    expect(found.some((f) => f.includes('skill orchestrate'))).toBe(false)
  })
})

describe('leaf grants', () => {
  const scout = fixture.get('agents/scout.md')!

  it('refuse an approval-required tool granted to an agent without a recorded use', () => {
    const found = findingsOf({ 'agents/scout.md': scout.replace('  - mcp:get_classes\n', '  - mcp:get_classes\n  - mcp:update_attributes\n') })
    expect(found).toContainEqual(expect.stringMatching(/^leaf-grant agents\/scout\.md: update_attributes needs the operator's approval/))
  })

  it('allow auto-approved tools', () => {
    const found = findingsOf({ 'agents/scout.md': scout.replace('  - mcp:get_classes\n', '  - mcp:get_classes\n  - mcp:list_models\n  - mcp:query_controls\n') })
    expect(found.filter((f) => f.startsWith('leaf-grant'))).toEqual([])
  })

  it('refuse a management tool a specialist once read through: reads go through the query tools', () => {
    const found = findingsOf({ 'agents/scout.md': scout.replace('  - mcp:get_classes\n', '  - mcp:get_classes\n  - mcp:manage_controls\n') })
    expect(found).toContainEqual(expect.stringMatching(/^leaf-grant agents\/scout\.md: manage_controls needs the operator's approval/))
  })

  it('refuse the settle and prune tools to every agent: no specialist registers or prunes', () => {
    const found = findingsOf({ 'agents/scout.md': scout.replace('  - mcp:get_classes\n', '  - mcp:get_classes\n  - mcp:model_state_settle\n  - mcp:model_state_prune\n') })
    expect(found).toContainEqual(expect.stringMatching(/^leaf-grant agents\/scout\.md: model_state_settle needs the operator's approval/))
    expect(found).toContainEqual(expect.stringMatching(/^leaf-grant agents\/scout\.md: model_state_prune needs the operator's approval/))
  })
})

describe('the settlement switch', () => {
  const bundle = (harness: 'claude' | 'codex' | 'opencode', settlement: boolean) =>
    generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness, ...(settlement ? { settlement: true } : {}) })
  type Hooks = Record<string, { matcher: string; hooks: { args?: string[]; command: string }[] }[]>

  it.each(['claude', 'codex', 'opencode'] as const)('%s: off by default — no file sets it, no hook takes the flag, and no approve matcher names the settle tool', (harness) => {
    for (const [p, content] of bundle(harness, false)) {
      // A key with a value: TOML `KEY = "…"`, JSON `"KEY": "…"`. Codex's pass-through list names it without a value.
      expect(content, p).not.toMatch(/\bDETHEREAL_SETTLEMENT"?\s*[=:]/)
      expect(content, p).not.toContain('--settlement')
      expect(content, p).not.toMatch(/model_state_settle[|)]/)
    }
  })

  it('emits the server\'s own switch, and routes to the approve hook exactly the auto actions the server serves in each mode', () => {
    const on = bundle('claude', true)
    const env = JSON.parse(on.get('bundles/claude/.mcp.json')!).mcpServers.dethereal.env as Record<string, string>
    // The server reads what the bundle sets: on in the bundle is on in the server.
    expect(settlementOn(undefined, env)).toBe(true)
    expect(env[SETTLEMENT_ENV]).toBe(SETTLEMENT_ON)
    const hooks = (JSON.parse(on.get('bundles/claude/hooks/hooks.json')!) as { hooks: Hooks }).hooks
    // The server reads each hook's own arguments as on.
    const args = Object.values(hooks).flat().flatMap((e) => e.hooks.map((h) => h.args!))
    expect(args.length).toBeGreaterThan(0)
    for (const a of args) expect(hookSettlement(a), a.join(' ')).toBe('on')
    for (const settlement of [false, true]) {
      const h = (JSON.parse(bundle('claude', settlement).get('bundles/claude/hooks/hooks.json')!) as { hooks: Hooks }).hooks
      const names = /\(([a-z_|]+)\)\$$/.exec(h.PreToolUse!.find((x) => x.hooks[0]!.args![2] === 'approve')!.matcher)![1]!.split('|')
      for (const action of Object.keys(autoActions(true))) expect(names.includes(action), `${action} with settlement ${settlement}`).toBe(Object.keys(autoActions(settlement)).includes(action))
    }
  })

  it('claude: on, the server env, every hook and the approve matcher carry it', () => {
    const out = bundle('claude', true)
    expect(JSON.parse(out.get('bundles/claude/.mcp.json')!).mcpServers.dethereal.env).toEqual({
      DETHERNETY_PLATFORM_URL: '${user_config.platform_url}',
      DETHEREAL_SETTLEMENT: 'on',
    })
    const hooks = (JSON.parse(out.get('bundles/claude/hooks/hooks.json')!) as { hooks: Hooks }).hooks
    for (const entry of Object.values(hooks).flat()) for (const h of entry.hooks) expect(h.args!.slice(-3)).toEqual(['--harness', 'claude', '--settlement'])
    const approve = hooks.PreToolUse!.find((h) => h.hooks[0]!.args![2] === 'approve')!.matcher
    expect(approve).toMatch(/\|model_state_settle\)\$$/)
  })

  it('codex: on, the server env and every hook that runs the server carry it; the pass-through list names it in both modes', () => {
    const on = bundle('codex', true)
    const fragment = on.get('bundles/codex/config.fragment.toml')!
    expect(fragment).toMatch(/^env = \{ DETHERNETY_PLATFORM_URL = "<platform-url>", DETHEREAL_SETTLEMENT = "on" \}$/m)
    for (const out of [on, bundle('codex', false)]) expect(out.get('bundles/codex/config.fragment.toml')).toMatch(/^env_vars = \[[^\]]*"DETHEREAL_SETTLEMENT"\]$/m)
    const hooks = (JSON.parse(on.get('bundles/codex/plugins/dethereal/hooks/hooks.json')!) as { hooks: Hooks }).hooks
    const commands = Object.values(hooks).flat().flatMap((e) => e.hooks.map((h) => h.command))
    for (const c of commands.filter((c) => c.includes('hook.mjs'))) expect(c, c).toMatch(/ --harness codex --settlement$/)
    for (const c of commands.filter((c) => !c.includes('hook.mjs'))) expect(c, c).not.toContain('--settlement')
  })

  it('opencode: on, the server environment and the hooks\' spawn environment carry it', () => {
    const on = bundle('opencode', true)
    expect(JSON.parse(on.get('bundles/opencode/mcp.fragment.json')!).mcp.dethereal.environment).toEqual({
      DETHERNETY_PLATFORM_URL: '<platform-url>',
      DETHEREAL_SETTLEMENT: 'on',
    })
    expect(on.get('bundles/opencode/plugins/dethereal.ts')).toContain('const URL_ENV: Record<string, string> = {"DETHERNETY_PLATFORM_URL":"<platform-url>","DETHEREAL_SETTLEMENT":"on"}')
    expect(bundle('opencode', false).get('bundles/opencode/plugins/dethereal.ts')).toContain('const URL_ENV: Record<string, string> = {"DETHERNETY_PLATFORM_URL":"<platform-url>"}')
  })
})

describe('today’s Claude agent tool lists', () => {
  // The five agents of the 0.4.x plugin, frozen here: the neutral vocabulary must express each
  // list and map back to the same tools.
  const TODAY: Record<string, string[]> = {
    'infrastructure-scout-scoped': ['Read', 'mcp__plugin_dethereal_dethereal__get_classes'],
    'infrastructure-scout': ['Read', 'Glob', 'Grep', 'Bash', 'mcp__plugin_dethereal_dethereal__get_classes'],
    'model-reviewer': [
      'Read', 'Glob', 'Grep',
      'mcp__plugin_dethereal_dethereal__validate_model_json', 'mcp__plugin_dethereal_dethereal__get_classes',
      'mcp__plugin_dethereal_dethereal__manage_exposures', 'mcp__plugin_dethereal_dethereal__manage_countermeasures',
      'mcp__plugin_dethereal_dethereal__get_control_gaps', 'mcp__plugin_dethereal_dethereal__search_mitre_attack',
    ],
    'security-enricher': ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'mcp__plugin_dethereal_dethereal__*'],
    'threat-modeler': [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
      'Agent(infrastructure-scout)', 'Agent(infrastructure-scout-scoped)', 'Agent(security-enricher)', 'Agent(model-reviewer)',
      'mcp__plugin_dethereal_dethereal__*',
    ],
  }
  const NEUTRAL: Record<string, string> = { Read: 'fs-read', Glob: 'fs-search', Grep: 'fs-search', Write: 'fs-write', Edit: 'fs-write', Bash: 'shell' }
  const toNeutral = (tool: string) =>
    NEUTRAL[tool] ?? (tool.startsWith('mcp__plugin_dethereal_dethereal__') ? `mcp:${tool.slice('mcp__plugin_dethereal_dethereal__'.length)}` : tool)

  it.each(Object.entries(TODAY))('%s maps back to the same tools', (_, tools) => {
    expect(new Set(claudeTools(tools.map(toNeutral)))).toEqual(new Set(tools))
  })

  it('names only tools the manifest knows', () => {
    const known = new Set(manifestToolNames())
    const RETIRED = new Set(['manage_exposures']) // retired: reading exposures is query_exposures'
    const mcp = Object.values(TODAY).flat().map(toNeutral).filter((t) => t.startsWith('mcp:') && t !== 'mcp:*')
    expect(mcp.filter((t) => !known.has(t.slice(4)) && !RETIRED.has(t.slice(4)))).toEqual([])
  })
})

describe('frontmatter rules', () => {
  it('rejects a skill agent without a fork, unknown keys and a name that is not the directory', () => {
    const found = findingsOf(skill('status', 'name: other\ndescription: d\nagent: scout\nflavour: x')).join('\n')
    expect(found).toContain('agent is only meaningful with context: fork')
    expect(found).toContain('unknown frontmatter key flavour')
    expect(found).toContain('name must be status')
  })

  it('rejects a fork without an agent, or onto an unknown agent', () => {
    expect(findingsOf(skill('status', 'name: status\ndescription: d\ncontext: fork')).join('\n')).toContain('context: fork needs an agent')
    expect(findingsOf(skill('status', 'name: status\ndescription: d\ncontext: fork\nagent: ghost')).join('\n')).toContain('fork agent ghost is not a workflow agent')
  })

  it('checks agent fields', () => {
    const found = findingsOf(agent('scout', 'name: scout\ndescription: d\neffort: extreme\nmaxTurns: 0\nmemory: team\ntools: []')).join('\n')
    expect(found).toContain('effort must be one of low, medium, high')
    expect(found).toContain('maxTurns must be a positive integer')
    expect(found).toContain('memory must be one of user, project, local')
    expect(found).toContain('tools must be a non-empty list of strings')
  })

  it('ships an agent only for the harnesses it names, and refuses a reference to it where it is not shipped', () => {
    expect(findingsOf(agent('helper', 'name: helper\ndescription: d\nharnesses: [claude, vscode]\ntools:\n  - fs-read')).join('\n')).toContain(
      'harnesses must be a non-empty list of claude, codex, opencode',
    )
    const helper = agent('helper', 'name: helper\ndescription: d\nharnesses: [claude]\ntools:\n  - fs-read')
    expect(generateFromSource({ pkg, source: variant(helper), harness: 'claude' }).has('bundles/claude/agents/helper.md')).toBe(true)
    expect([...generateFromSource({ pkg, source: variant(helper), harness: 'codex' }).keys()].some((p) => p.includes('helper'))).toBe(false)
    // The fixture's skills delegate to the scout on every harness: shipped for Claude alone, Codex refuses them.
    const claudeScout = { 'agents/scout.md': fixture.get('agents/scout.md')!.replace(/^name: scout$/m, 'name: scout\nharnesses: [claude]') }
    expect(findingsOf(claudeScout)).toEqual([])
    expect(findingsOf(claudeScout, 'codex').join('\n')).toContain('agent scout is not shipped for codex')
    // Naming it, or forking onto it, is refused the same way.
    const claudeReviewer = { 'agents/reviewer.md': fixture.get('agents/reviewer.md')!.replace(/^name: reviewer$/m, 'name: reviewer\nharnesses: [claude]') }
    const reviewerFindings = findingsOf(claudeReviewer, 'codex').join('\n')
    expect(reviewerFindings).toContain('render skills/orchestrate/SKILL.md: agent reviewer is not shipped for codex')
    expect(reviewerFindings).toContain('fork agent reviewer is not shipped for codex')
    expect(findingsOf(claudeReviewer)).toEqual([])
  })

  it('checks mcp tool entries against the manifest', () => {
    expect(findingsOf(agent('scout', 'name: scout\ndescription: d\ntools:\n  - mcp:no_such_tool')).join('\n')).toContain(
      'tool no_such_tool is not in the tool manifest',
    )
  })

  it('requires a Claude-only key and a tool literal to be visible to Claude alone', () => {
    const found = findingsOf(agent('scout', 'name: scout\ndescription: d\ncolor: cyan\ntools:\n  - fs-read\n  - WebFetch')).join('\n')
    expect(found).toContain('unknown frontmatter key color')
    expect(found).toContain('tool entry WebFetch is not in the neutral vocabulary and is visible to claude, codex, opencode')
    const ok = agent('scout', 'name: scout\ndescription: d\n{{#harness claude}}\ncolor: cyan\n{{/harness}}\ntools:\n  - fs-read\n{{#harness claude}}\n  - WebFetch\n{{/harness}}')
    expect(findingsOf(ok)).toEqual([])
  })

  it('rejects duplicate keys and missing frontmatter', () => {
    expect(findingsOf(skill('status', 'name: status\nname: status\ndescription: d')).join('\n')).toContain('frontmatter does not parse')
    expect(findingsOf({ 'skills/status/SKILL.md': 'No frontmatter.\n' }).join('\n')).toContain('missing frontmatter')
  })
})

describe('context rules', () => {
  it('rejects a question or the arguments in an agent, and a question in a forked skill', () => {
    const inAgent = findingsOf(agent('scout', 'name: scout\ndescription: d\ntools:\n  - fs-read', '{{#ask id=q}}Go?{{/ask}} {{args}}\n')).join('\n')
    expect(inAgent).toContain('token-context agents/scout.md: a question cannot be asked from here')
    expect(inAgent).toContain('{{args}} is only substituted in a skill body')
    const inFork = findingsOf(skill('audit', 'name: audit\ndescription: d\ncontext: fork\nagent: reviewer', '{{#ask id=q}}Go?{{/ask}}\n'))
    expect(inFork.join('\n')).toContain('a question cannot be asked from here (reaches: fork)')
  })

  it('follows includes: a question in a fragment an agent includes is rejected in the fragment', () => {
    const found = findingsOf({
      ...agent('scout', 'name: scout\ndescription: d\ntools:\n  - fs-read', '{{include shared/steps.md}}\n'),
      'shared/steps.md': '{{#ask id=q}}Go?{{/ask}}\n',
    })
    expect(found.join('\n')).toContain('token-context shared/steps.md: a question cannot be asked from here')
  })

  it('rejects as-file includes outside a skill body and include cycles', () => {
    const asFile = findingsOf(agent('scout', 'name: scout\ndescription: d\ntools:\n  - fs-read', '{{include shared/reference.md as-file}}\n'))
    expect(asFile.join('\n')).toContain('as-file includes belong in a skill body')
    const cycle = findingsOf({ 'shared/steps.md': '{{include shared/protocols.md}}\n' })
    expect(cycle.join('\n')).toContain('include cycle')
  })
})

describe('harness data and output rules', () => {
  it('requires valid Claude harness data', () => {
    expect(findingsOf({ 'harness/claude.yaml': undefined }).join('\n')).toContain('harness-data harness/claude.yaml: missing')
    const bad = findingsOf({ 'harness/claude.yaml': 'plugin:\n  description: d\n  owner: x\nuserConfig:\n  url:\n    type: text\n' }).join('\n')
    expect(bad).toContain('unknown plugin key owner')
    expect(bad).toContain('userConfig.url.type must be one of')
    expect(bad).toContain('userConfig.url.title must be a non-empty string')
  })

  it('fails a skill over the size budget', () => {
    const found = findingsOf(skill('status', 'name: status\ndescription: d', `${'word '.repeat(4100)}\n`))
    expect(found.join('\n')).toContain('size-budget bundles/claude/skills/status/SKILL.md')
  })

  it('fails a protocol reference without the protocol', () => {
    const found = findingsOf(skill('status', 'name: status\ndescription: d', 'Resolve the model per the Drift Protocol.\n'))
    expect(found.join('\n')).toContain('protocol-include bundles/claude/skills/status/SKILL.md: refers to the Drift Protocol')
  })

  it('reports every finding at once, sorted', () => {
    const found = findingsOf({
      ...skill('status', 'name: status\ndescription: d', 'Use the `Read` tool. Record it in state.json.\n'),
      'shared/steps.md': 'See tokens.json.\n',
    })
    expect(found).toEqual([
      'token-store shared/steps.md: names the session token store',
      'claude-literal skills/status/SKILL.md: backticked Claude tool name outside a {{#harness claude}} block: Use the `Read` tool. Record it in state.json.',
      'state-json-write skills/status/SKILL.md: workflow state changes go through the state tool, not writes to state.json',
    ])
  })

  it('rejects files outside the layout', () => {
    expect(findingsOf({ 'notes.txt': 'x' }).join('\n')).toContain('layout notes.txt: not a skill, agent, shared fragment or harness file')
  })
})
