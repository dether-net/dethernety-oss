import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { FIXTURE_WORKFLOW } from '../cli.js'
import { generate, generateFromSource, GeneratorError } from '../index.js'
import { ASK_ID_MAX, claudeLiteralsInOutput, openCodeTemplateSafety } from '../lint.js'
import { readWorkflow } from '../source.js'
import { agentPreamble, NEVER_MODEL_FILES, openCodeCommandRenderer, openCodeRenderer, openCodeTaskRenderer, permissionRules } from '../targets/opencode/index.js'
import { SECRET_PATHS, SECRET_SUFFIXES } from '../../utils/secret-paths.js'
import { renderText } from '../tokens.js'
import { TOOL_MANIFEST } from '../../tools/manifest.js'

const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }
const out = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'opencode' })
const fixture = readWorkflow(FIXTURE_WORKFLOW)
const file = (p: string) => {
  const content = out.get(`bundles/opencode/${p}`)
  expect(content, p).toBeDefined()
  return content!
}
const frontmatter = (text: string) => parse(text.match(/^---\n([\s\S]*?)\n---\n/)![1]!) as Record<string, unknown>
const oc = (text: string) => renderText(text, { harness: 'opencode', renderer: openCodeRenderer, shared: () => undefined, allowAsFile: true, skill: 'guide' }).text

function findingsOf(changes: Record<string, string>): string[] {
  try {
    generateFromSource({ pkg, source: new Map([...fixture, ...Object.entries(changes)]), harness: 'opencode' })
  } catch (err) {
    if (err instanceof GeneratorError) return err.findings.map((f) => `${f.rule} ${f.file}: ${f.message}`)
    throw err
  }
  return []
}

describe('OpenCode renderings', () => {
  it('spells tools, commands, agents and arguments the OpenCode way', () => {
    expect(oc('{{tool:list_models}} {{cmd:sync}} {{agent:model-reviewer}} {{args}}')).toBe(
      '`dethereal_list_models` `/dethereal-sync` `dethereal-model-reviewer` the arguments given with the command, or those a skill that handed over to this one named',
    )
    expect(openCodeCommandRenderer.inline('args', '', false)).toBe('$ARGUMENTS')
    expect(openCodeTaskRenderer.inline('args', '', false)).toBe("the operator's text quoted in your task prompt")
  })

  it('delegates through the task tool with a description, and fails closed', () => {
    expect(oc('{{#delegate scout}}Survey it.{{/delegate}}')).toBe(
      'Use the `task` tool with `subagent_type: "dethereal-scout"`, a 3–5 word `description`, and this prompt: “Survey it.” Wait for its result. ' +
        'If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.',
    )
  })

  it('names the question tool and its header, and asks again when no answer came', () => {
    expect(oc('{{#ask id=push-confirm}}Push now? (push / skip){{/ask}}')).toBe(
      '`[prompt: push-confirm]` Push now? (push / skip) — table first, the `question` tool, header `push-confirm`; unanswered → ask again.',
    )
    expect(oc('{{#ask id=notes text}}Anything else?{{/ask}}')).toBe('`[prompt: notes]` Anything else? — a plain message; end your turn; unanswered → ask again.')
  })

  it('reads as-file siblings from the skill base directory, and from the task file directory in a task', () => {
    expect(openCodeRenderer.asFile('ref.md', 'guide')).toBe("Read the file `ref.md` with the `read` tool, from this skill's base directory (shown when the skill was loaded), in full.")
    expect(openCodeTaskRenderer.asFile('ref.md', 'audit')).toBe('Read the file `ref.md` with the `read` tool, from the same directory as your task file, in full.')
  })
})

describe('agent permissions', () => {
  it('deny everything first, then grant exactly the neutral tools, in evaluation order', () => {
    expect(Object.entries(permissionRules(['fs-read', 'fs-search', 'mcp:validate_model_json'], true))).toEqual([
      ['*', 'deny'],
      ['task', 'deny'],
      ['read', expect.objectContaining({ '*': 'allow', '*.env': 'deny', '.env.*': 'deny', '*/.env.*': 'deny', '*.env.example': 'allow', '*.env.template': 'allow' })],
      ['glob', 'allow'],
      ['external_directory', { '*/skills/dethereal-*/*': 'allow' }],
      ['dethereal_validate_model_json', 'allow'],
    ])
    const all = permissionRules(['fs-write', 'shell', 'mcp:*'])
    expect(Object.entries(all).slice(0, 5)).toEqual([['*', 'deny'], ['task', 'deny'], ['edit', expect.objectContaining({ '*': 'deny' })], ['bash', 'ask'], ['dethereal_*', 'allow']])
    // A leaf cannot ask for approval: each tool that needs it is denied after the wildcard.
    const denied = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => [`dethereal_${t.name}`, 'deny'])
    expect(Object.entries(all).slice(5)).toEqual(denied)
  })

  it('never grant a tool that needs approval: OpenCode would run it without asking', () => {
    const rules = permissionRules(['mcp:get_classes', 'mcp:manage_controls'])
    expect(rules).toEqual({ '*': 'deny', task: 'deny', dethereal_get_classes: 'allow' })
    const preamble = agentPreamble({ name: 'x', description: 'd', tools: ['mcp:get_classes', 'mcp:manage_controls'], own: [] })
    expect(preamble).toContain('Dethereal tools you may use: `dethereal_get_classes`. Use no other Dethereal tool.')
  })

  // OpenCode's matcher: `*` spans any characters, `/` included, and the whole relative path must match; the last match wins.
  const decide = (rules: Record<string, string>, relPath: string): string | undefined => {
    let action: string | undefined
    for (const [pattern, a] of Object.entries(rules)) {
      const re = new RegExp(`^${pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      if (re.test(relPath)) action = a
    }
    return action
  }

  it('deny every secret file at the project root and below it', () => {
    const read = permissionRules(['fs-read']).read as Record<string, string>
    const secrets = ['.env', '.env.production', '.envrc', 'terraform.tfstate', 'terraform.tfstate.backup', 'prod.tfvars', 'prod.tfvars.json',
      'tls.pem', 'tls.key', 'cert.p12', 'cert.pfx', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519.pub', '.npmrc', '.pypirc', '.netrc',
      '.git-credentials', 'kubeconfig', '.aws/credentials', 'application_default_credentials.json', '.docker/config.json', 'opencode.json', 'opencode.jsonc',
      'app.env', 'signing.p8', 'store.jks', 'release.keystore', 'credentials.json', 'ci-service-account.json', 'deploy-sa-key.json', '.pgpass', '.my.cnf',
      '.htpasswd', '.vault-token', '.terraformrc', 'credentials.tfrc.json', 'secrets.yaml', 'secrets.prod.yaml', 'values-secret.yaml',
      'secrets.yml', 'values-secret.yml', 'secret.yaml', 'secret.yml', 'secrets.yaml.dec', '.kube/config', 'prod.kubeconfig', 'kubeconfig-prod.yaml', 'kubeconfig.yml']
    for (const f of secrets) {
      expect(decide(read, f), f).toBe('deny')
      expect(decide(read, `deploy/app/${f}`), `deploy/app/${f}`).toBe('deny')
    }
    for (const f of ['app.txt', '.env.example', 'config/.env.template', '.env.sample', 'deploy/.env.dist', 'src/id_generator.go', 'docs/aws.md', 'values.yaml',
      // The shared list's narrowed patterns: source files that only mention the names.
      'pkg/kubeconfig/loader.go', 'src/app.env.ts',
      // A model file named after an element id comes back after the name patterns.
      'model/attributes/components/c-ci-service-account.json', 'controls/kubeconfig-guard.json']) {
      expect(decide(read, f), f).toBe('allow')
    }
    // OpenCode's `*` spans folders, so the model files' allow-backs reach any depth: the names no model
    // file carries are denied again after them.
    for (const f of ['x/controls/gcp/credentials.json', 'model/attributes/a/.aws/credentials', 'controls/x/.docker/config.json',
      'attributes/k/.kube/config', 'controls/credentials.tfrc.json', 'attributes/application_default_credentials.json',
      'controls/.credentials.json', 'x/controls/gcp/.credentials.json', 'home/attributes/.claude/.credentials.json']) {
      expect(decide(read, f), f).toBe('deny')
    }
    for (const n of NEVER_MODEL_FILES) expect([...SECRET_SUFFIXES, ...SECRET_PATHS], n).toContain(n)
  })

  it("let a writing leaf change model files only: every spelling of OpenCode's config, agents and plugins falls on the deny", () => {
    const edit = permissionRules(['fs-write']).edit as Record<string, string>
    // No agent writes a pending-values file; only the enricher writes the relay files, and the applier only attribute files.
    expect(decide(edit, 'model/.dethereal/enrichment-pending.json')).toBe('deny')
    expect(decide(edit, 'model/.dethereal/relay/run-1.txt')).toBe('deny')
    const enricher = permissionRules(['fs-write'], false, 'security-enricher').edit as Record<string, string>
    expect(decide(enricher, 'model/.dethereal/relay/run-1.txt')).toBe('allow')
    expect(decide(enricher, 'model/.dethereal/relay/run-1.md')).toBe('deny')
    expect(decide(enricher, 'model/.dethereal/enrichment-pending.json')).toBe('deny')
    const applier = permissionRules(['fs-write'], false, 'enrichment-applier').edit as Record<string, string>
    expect(decide(applier, 'model/attributes/components/a.json')).toBe('allow')
    expect(decide(applier, 'attributes/dataFlows/f.json')).toBe('allow')
    for (const f of ['model/structure.json', 'model/dataflows.json', 'model/data-items.json', 'model/.dethereal/scope.json', 'model/controls/c-1.json',
      'model/.dethereal/relay/run-1.txt', 'opencode.json', '.opencode/agents/x.md']) {
      expect(decide(applier, f), f).toBe('deny')
    }
    for (const f of ['manifest.json', 'structure.json', 'model/dataflows.json', 'model/data-items.json', 'model/attributes/components/a.json',
      'model/controls/c-1.json', 'a/b/model/.dethereal/scope.json', 'model/.dethereal/discovery.json',
      '.dethernety/discovery-cache.json', '.dethernety/decomposition-plan.json']) {
      expect(decide(edit, f), f).toBe('allow')
    }
    // OpenCode matches against the path from the git root: a project in a monorepo folder, or a session
    // with no git root (the path from `/`), still reaches its own project files, and only those.
    for (const f of ['apps/orders/.dethernety/discovery-cache.json', 'apps/orders/.dethernety/decomposition-plan.json',
      'Users/u/work/orders/.dethernety/discovery-cache.json']) {
      expect(decide(edit, f), f).toBe('allow')
    }
    // A macOS disk ignores case; OpenCode's patterns do not.
    for (const f of ['opencode.json', 'OPENCODE.JSON', 'OpenCode.jsonc', 'sub/opencode.json', '.opencode/opencode.json', '.opencode/plugins/x.ts',
      '.OPENCODE/plugins/x.ts', '.opencode/agents/a.md', '.OpenCode/command/c.md', 'AGENTS.md', 'src/app.ts', 'README.md',
      'model/attributes/x.ts', 'model/.dethereal/notes.md', 'STRUCTURE.JSON',
      // State goes through the server; started in the home directory, `.dethernety/` is the server's own store.
      'model/.dethereal/state.json', '.dethernety/models.json', '.dethernety/tokens.json', 'apps/orders/.dethernety/models.json',
      'Users/u/.dethernety/tokens.json', 'Users/u/.dethernety/runtime/current.json', 'apps/orders/.dethernety/discovery-cache.json.bak']) {
      expect(decide(edit, f), f).toBe('deny')
    }
  })

  it('search by name only: grep would reach the files read denies', () => {
    expect(permissionRules(['fs-read', 'fs-search'])).not.toHaveProperty('grep')
  })

  it('keep secret files out of reach, and the example env files in reach', () => {
    const read = permissionRules(['fs-read']).read as Record<string, string>
    for (const p of ['*.env', '*.envrc', '*.tfstate', '*.tfvars', '*.tfvars.json', '*.pem', '*.key', '*.p12', '*.pfx', '*/id_rsa*', '*/id_dsa*', '*.npmrc', '*.pypirc', '*.netrc', '*.git-credentials', '*.kubeconfig', '*/kubeconfig', '*/.kube/config', '*/.aws/credentials', '*application_default_credentials.json', '*/.docker/config.json']) {
      expect(read[p], p).toBe('deny')
    }
    // Later rules win: the example files come after the `*.env.*` deny.
    const keys = Object.keys(read)
    expect(keys.indexOf('*.env.example')).toBeGreaterThan(keys.indexOf('*/.env.*'))
    expect(read['*.env.example']).toBe('allow')
  })

  it('reach outside the project only for an agent that runs a forked skill', () => {
    expect(frontmatter(file('agents/dethereal-reviewer.md')).permission).toHaveProperty('external_directory')
    for (const agent of ['scout', 'enricher', 'lead']) expect(frontmatter(file(`agents/dethereal-${agent}.md`)).permission).not.toHaveProperty('external_directory')
  })

  it('never grant questions, delegation, skills or the web', () => {
    for (const agent of ['scout', 'reviewer', 'enricher', 'lead']) {
      const perm = frontmatter(file(`agents/dethereal-${agent}.md`)).permission as Record<string, unknown>
      for (const key of ['question', 'skill', 'webfetch', 'websearch']) expect(perm[key], `${agent}.${key}`).toBeUndefined()
      expect(Object.keys(perm).slice(0, 2)).toEqual(['*', 'task'])
      expect(perm.task, agent).toBe('deny')
    }
  })
})

describe('the fixture workflow for OpenCode', () => {
  it('emits skills, agents, one command for the forked skill, the MCP entry and the plugin', () => {
    expect([...out.keys()]).toEqual([
      'bundles/opencode/agents/dethereal-enricher.md',
      'bundles/opencode/agents/dethereal-lead.md',
      'bundles/opencode/agents/dethereal-reviewer.md',
      'bundles/opencode/agents/dethereal-scout.md',
      'bundles/opencode/bundle.json',
      'bundles/opencode/commands/dethereal-audit.md',
      'bundles/opencode/mcp.fragment.json',
      'bundles/opencode/plugins/dethereal.ts',
      'bundles/opencode/skills/dethereal-audit/SKILL.md',
      'bundles/opencode/skills/dethereal-audit/task.md',
      'bundles/opencode/skills/dethereal-guide/SKILL.md',
      'bundles/opencode/skills/dethereal-guide/reference.md',
      'bundles/opencode/skills/dethereal-orchestrate/SKILL.md',
      'bundles/opencode/skills/dethereal-status/SKILL.md',
    ])
  })

  it('names skills with the flat prefix', () => {
    expect(frontmatter(file('skills/dethereal-orchestrate/SKILL.md'))).toEqual({
      name: 'dethereal-orchestrate',
      description: 'Walk the two-step fixture workflow — survey through a specialist agent, then confirm with the operator.',
    })
  })

  it('runs a forked skill on its agent as a command, and delegates it with a task file from the skill', () => {
    const command = file('commands/dethereal-audit.md')
    expect(frontmatter(command)).toEqual({
      description: "Audit the fixture model read-only and report the reviewer's findings. [model path]",
      agent: 'dethereal-reviewer',
      subtask: true,
    })
    expect(command).toContain('Audit the model at $ARGUMENTS (or the current directory')
    expect(file('skills/dethereal-audit/SKILL.md')).toContain('`subagent_type: "dethereal-reviewer"`')
    expect(file('skills/dethereal-audit/SKILL.md')).toContain('Read and follow the task file `task.md`')
    expect(file('skills/dethereal-audit/task.md')).toMatch(/^Audit the model at the operator's text quoted in your task prompt/)
  })

  it('writes agents as subagents with a step limit and the leaf preamble', () => {
    const scout = file('agents/dethereal-scout.md')
    expect(frontmatter(scout)).toMatchObject({ mode: 'subagent', steps: 5 })
    expect(scout).toContain('Never start other agents.')
    expect(scout).toContain('Dethereal tools you may use: `dethereal_get_classes`. Use no other Dethereal tool.')
    const enricher = file('agents/dethereal-enricher.md')
    expect(enricher).not.toContain('You may use every Dethereal tool.')
    expect(enricher).toContain('`dethereal_validate_model_json`')
    expect(enricher).not.toMatch(/Dethereal tools you may use:[^\n]*dethereal_update_attributes/)
  })

  it('declares the MCP entry with a per-call timeout and installer placeholders', () => {
    expect(JSON.parse(file('mcp.fragment.json'))).toEqual({
      mcp: {
        dethereal: {
          type: 'local',
          command: ['<node-abs>', '<runtime>/dist/index.js'],
          environment: { DETHERNETY_PLATFORM_URL: '<platform-url>' },
          timeout: 60000,
          enabled: true,
        },
      },
      permission: Object.fromEntries(TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => [`dethereal_${t.name}`, 'ask'])),
      agent: { explore: { permission: { 'dethereal_*': 'deny' } } },
    })
    expect(JSON.parse(file('bundle.json')).placeholders).toEqual(['<node-abs>', '<platform-url>', '<runtime>'])
  })

  it('gives the server and the plugin the install URL as a default, so a DETHERNETY_URL in the environment still wins', () => {
    expect(file('mcp.fragment.json')).not.toContain('"DETHERNETY_URL"')
    const plugin = file('plugins/dethereal.ts')
    expect(plugin.split('const URL_ENV: Record<string, string> = {"DETHERNETY_PLATFORM_URL":"<platform-url>"}')).toHaveLength(2)
    expect(plugin).toContain("env: { ...process.env, ...URL_ENV }")
  })

  it('pins a development build to its URL, whatever the shell exports', () => {
    const dev = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'opencode', mcpEntry: { node: '/n', entry: '/d/index.js', home: '/h', url: 'http://127.0.0.1:9' } })
    const server = JSON.parse(dev.get('bundles/opencode/mcp.fragment.json')!).mcp.dethereal
    expect(server.command).toEqual(['/n', '/d/index.js'])
    expect(server.environment).toEqual({ DETHERNETY_URL: 'http://127.0.0.1:9', HOME: '/h' })
    const plugin = dev.get('bundles/opencode/plugins/dethereal.ts')!
    expect(plugin).toContain('const URL_ENV: Record<string, string> = {"DETHERNETY_URL":"http://127.0.0.1:9"}')
    expect(plugin).not.toMatch(/<node-abs>|<runtime>|<platform-url>/)
    const bare = generate({ pkg, workflowDir: FIXTURE_WORKFLOW, harness: 'opencode', mcpEntry: { node: '/n', entry: '/d/index.js' } })
    expect(JSON.parse(bare.get('bundles/opencode/mcp.fragment.json')!).mcp.dethereal.environment).toEqual({})
    expect(bare.get('bundles/opencode/plugins/dethereal.ts')).toContain('const URL_ENV: Record<string, string> = {}')
  })

  it('asks before every tool that needs approval, keyed by the MCP server name, and keeps the explore agent read-only', () => {
    const fragment = JSON.parse(file('mcp.fragment.json')) as { mcp: Record<string, unknown>; permission: Record<string, string>; agent: Record<string, { permission: Record<string, string> }> }
    const [server] = Object.keys(fragment.mcp)
    // A new tool that needs approval asks from the day it is added.
    const prompt = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => t.name)
    expect(Object.keys(fragment.permission).sort()).toEqual(prompt.map((t) => `${server}_${t}`).sort())
    expect(new Set(Object.values(fragment.permission))).toEqual(new Set(['ask']))
    expect(Object.keys(fragment.permission).some((k) => k.endsWith('_model_state_waive'))).toBe(true)
    expect(fragment.agent.explore!.permission).toEqual({ [`${server}_*`]: 'deny' })
  })

  it('keeps Claude spellings out, and keeps skills free of template syntax', () => {
    for (const [p, content] of out) {
      expect(claudeLiteralsInOutput(p, content, 'opencode'), p).toEqual([])
      if (p.endsWith('.md')) expect(openCodeTemplateSafety(p, content), p).toEqual([])
    }
  })
})

describe('OpenCode rules', () => {
  it('allows its own task parameter and command variable, nothing else of Claude', () => {
    expect(claudeLiteralsInOutput('agents/x.md', 'Pass subagent_type.', 'opencode')).toEqual([])
    expect(claudeLiteralsInOutput('bundles/opencode/commands/x.md', 'At $ARGUMENTS.', 'opencode')).toEqual([])
    expect(claudeLiteralsInOutput('bundles/opencode/skills/x/SKILL.md', 'At $ARGUMENTS.', 'opencode')).toHaveLength(1)
    expect(claudeLiteralsInOutput('x.md', 'Use AskUserQuestion.', 'opencode')).toHaveLength(1)
  })

  it('flags shell and positional template syntax in skills', () => {
    expect(openCodeTemplateSafety('s/SKILL.md', 'Run !`ls` now.\nCosts $1 each.').map((f) => f.line)).toEqual([1, 2])
    expect(openCodeTemplateSafety('s/SKILL.md', 'Plain text with `code` and a price in words.')).toEqual([])
  })

  it('refuses a forked skill with an as-file include, or run by an agent that writes', () => {
    const withSibling = findingsOf({
      'skills/audit/SKILL.md': '---\nname: audit\ndescription: d\ncontext: fork\nagent: reviewer\n---\n\n{{include shared/reference.md as-file}}\n',
    })
    expect(withSibling.join('\n')).toContain('an as-file include in a forked skill cannot be carried on OpenCode')
    const writer = findingsOf({ 'skills/audit/SKILL.md': '---\nname: audit\ndescription: d\ncontext: fork\nagent: enricher\n---\n\nAudit.\n' })
    expect(writer.join('\n')).toContain('must not write files (enricher has fs-write)')
  })

  it('limits ask ids to the question header length', () => {
    const long = 'a'.repeat(ASK_ID_MAX + 1)
    const found = findingsOf({ 'skills/status/SKILL.md': `---\nname: status\ndescription: d\n---\n\n{{#ask id=${long}}}Go? (yes / no){{/ask}}\n` })
    expect(found.join('\n')).toContain(`ask id ${long} is longer than ${ASK_ID_MAX} characters`)
  })

  it('needs an empty harness file', () => {
    expect(findingsOf({ 'harness/opencode.yaml': 'plugin: x\n' }).join('\n')).toContain('must be an empty mapping')
  })
})
