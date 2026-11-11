/**
 * OpenAI Codex CLI target.
 *
 * - The plugin (skills and hooks) is served from a local marketplace the installer writes:
 *   `.agents/plugins/marketplace.json` → `plugins/dethereal/.codex-plugin/plugin.json`, with
 *   `hooks/hooks.json` at the plugin root. Hook commands run scripts in the plugin's `bin/`:
 *   `pre-tool-use.mjs` keeps each agent to its tools (from `leaf-allowlist.json`); `hook.mjs`
 *   runs the session-start, post-write and guard hooks in the installed runtime once it has
 *   checked it (`runtime-check.mjs`, the installer's own check), within a deadline per hook
 *   (`hook-deadlines.json`), and judges the guards' calls by name (`secret-fallback.mjs`) when
 *   the runtime cannot be used; before that, a read-only agent's shell command must only read
 *   (`shell-check.mjs`). Codex trusts a hook by a hash of its definition, so the commands
 *   and their order are fixed.
 * - The MCP server is defined in the user's config, not by the plugin: `config.fragment.toml`
 *   holds the whole `[mcp_servers.dethereal]` entry with installer placeholders, and the
 *   approvals — every tool prompts unless the tool manifest marks it `auto`.
 * - Agents are TOML role files. Every agent is a leaf: it never asks, never spawns, and is told
 *   which tools it may use; an agent without file writes gets a read-only sandbox setting, which
 *   Codex may not apply to its shell, so its shell commands are also checked to only read.
 */

import { FAIL_CLOSED, LEAF_PROMPT_GRANTS, LEAF_ROLE, SETTLEMENT_ENV, SETTLEMENT_FLAG, SETTLEMENT_ON, STATE_ROOT_RULE } from '../common.js'
import { emitFrontmatter } from '../../frontmatter.js'
import { type Finding, PLUGIN_NAME } from '../../types.js'
import type { AgentMeta } from '../../workflow.js'
import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import type { McpEntryOverride, Target, TargetInput } from '../types.js'
import { agentName, codexRenderer, codexTaskRenderer, codexTools, COLLABORATION_TOOLS, delegation, MCP_TOOL_PREFIX, WRITE_TOOLS } from './renderer.js'
import { tomlLines, tomlTable, tomlUnescape } from '../../../installer/writers/codex/toml-text.js'
import { readFileSync } from 'node:fs'

export { codexRenderer, codexTaskRenderer, codexTools } from './renderer.js'

const ROOT = 'bundles/codex'
const PLUGIN_DIR = `${ROOT}/plugins/${PLUGIN_NAME}`
const MARKETPLACE = `${ROOT}/.agents/plugins/marketplace.json`
const MANIFEST = `${PLUGIN_DIR}/.codex-plugin/plugin.json`
const FRAGMENT = `${ROOT}/config.fragment.toml`
const HOOKS = `${PLUGIN_DIR}/hooks/hooks.json`
const BIN = `${PLUGIN_DIR}/bin`

/** A plugin script, copied verbatim from `assets/`. */
const asset = (name: string) => readFileSync(new URL(`./assets/${name}`, import.meta.url), 'utf8')
/** Modules the hook runner shares with the package, copied verbatim from their source: one implementation each. */
const SHARED_MODULES = {
  'runtime-check.mjs': new URL('../../../installer/core/runtime-check.mjs', import.meta.url),
  'secret-fallback.mjs': new URL('../../../utils/secret-fallback.mjs', import.meta.url),
  'shell-check.mjs': new URL('../../../utils/shell-check.mjs', import.meta.url),
} as const
/** How much earlier than Codex's own hook timeout the runner stops a hook it started. */
const DEADLINE_MARGIN_S = 2

/** The tools an agent's allowlist hook checks: every MCP tool, the collaboration tools (with or without Codex's prefix), and file changes. */
const LEAF_CHECKED = `^mcp__|(${[...COLLABORATION_TOOLS, ...WRITE_TOOLS].join('|')})$`

/** A hook command: version-stable (`${PLUGIN_ROOT}` is substituted after the trust hash), never a shell feature beyond the quoting. */
const hookCommand = (script: string, ...args: string[]) => [`node "\${PLUGIN_ROOT}/bin/${script}"`, ...args].join(' ')

interface HookSpec {
  event: 'SessionStart' | 'PreToolUse' | 'PostToolUse'
  matcher: string
  timeout: number
  script: string
  args: string[]
}

/** Every hook, in the fixed order Codex hashes them in. */
const HOOKS_SPEC: readonly HookSpec[] = [
  ...(['startup', 'resume', 'clear', 'compact'] as const).map((source): HookSpec => (
    { event: 'SessionStart', matcher: source, timeout: 15, script: 'hook.mjs', args: ['session-start', '--source', source, '--harness', 'codex'] })),
  { event: 'PreToolUse', matcher: LEAF_CHECKED, timeout: 10, script: 'pre-tool-use.mjs', args: [] },
  { event: 'PreToolUse', matcher: '^Bash$', timeout: 10, script: 'hook.mjs', args: ['secret-guard', '--harness', 'codex'] },
  { event: 'PreToolUse', matcher: '^apply_patch$', timeout: 10, script: 'hook.mjs', args: ['config-guard', '--harness', 'codex'] },
  { event: 'PostToolUse', matcher: 'Edit|Write', timeout: 15, script: 'hook.mjs', args: ['post-write', '--harness', 'codex'] },
]

function hooksFile(settlement: boolean): string {
  const hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>> = {}
  for (const h of HOOKS_SPEC) {
    const args = settlement && h.script === 'hook.mjs' ? [...h.args, SETTLEMENT_FLAG] : h.args
    ;(hooks[h.event] ??= []).push({ matcher: h.matcher, hooks: [{ type: 'command', command: hookCommand(h.script, ...args), timeout: h.timeout }] })
  }
  return json({ hooks })
}

/** The runner's deadline for each hook it runs, in milliseconds: the hook's timeout less a margin, so its own answer is in time. */
function hookDeadlines(): string {
  const deadlines: Record<string, number> = {}
  for (const h of HOOKS_SPEC.filter((x) => x.script === 'hook.mjs')) {
    const ms = (h.timeout - DEADLINE_MARGIN_S) * 1000
    const name = h.args[0]!
    if (deadlines[name] !== undefined && deadlines[name] !== ms) throw new Error(`hook ${name} has two timeouts`)
    deadlines[name] = ms
  }
  return json(deadlines)
}

/** Each agent's checked tools: its Dethereal tools, and whether it may change files. */
function leafAllowlist(agents: TargetInput['agents']): string {
  const list: Record<string, { mcp: string[]; write: boolean }> = {}
  for (const agent of [...agents].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const tools = codexTools(agent.meta.tools)
    list[agentName(agent.name)] = { mcp: [...tools.mcp], write: tools.write }
  }
  return json(list)
}
const TASK_FILE = 'task.md'

/** Environment variables the server may read from the user's shell (proxies, custom CAs, debug). */
// The install URL is only a default: a `DETHERNETY_URL` in the environment Codex starts with passes
// through and wins (`getPlatformUrl`), as it does on Claude. The settlement switch passes through the
// same way, so an operator's own export reaches the server as it reaches the hooks; nothing here sets it.
const ENV_VARS = ['NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'DEBUG', 'DETHERNETY_URL', SETTLEMENT_ENV]


/** The tools that run without a prompt: the manifest's `auto` class, nothing else. */
export function autoApproved(): string[] {
  return TOOL_MANIFEST.filter((t) => t.approval === 'auto')
    .map((t) => t.name)
    .sort()
}

interface CodexData {
  readonly plugin: {
    readonly description: string
    readonly author?: Readonly<Record<string, string>>
    readonly interface: Readonly<Record<string, unknown>>
  }
  readonly marketplace: { readonly name: string; readonly displayName: string }
}

const INTERFACE_STRINGS = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'defaultPrompt']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function checkData(data: unknown, file: string): Finding[] {
  const findings: Finding[] = []
  const add = (message: string) => findings.push({ rule: 'harness-data', file, line: 0, message })
  if (!isRecord(data)) return [{ rule: 'harness-data', file, line: 0, message: 'must be a mapping with plugin and marketplace' }]
  for (const key of Object.keys(data)) if (key !== 'plugin' && key !== 'marketplace') add(`unknown key ${key}`)

  const plugin = data.plugin
  if (!isRecord(plugin)) add('plugin must be a mapping')
  else {
    for (const key of Object.keys(plugin)) if (!['description', 'author', 'interface'].includes(key)) add(`unknown plugin key ${key}`)
    if (typeof plugin.description !== 'string' || !plugin.description) add('plugin.description must be a non-empty string')
    if (plugin.author !== undefined && !(isRecord(plugin.author) && Object.entries(plugin.author).every(([k, v]) => ['name', 'email', 'url'].includes(k) && typeof v === 'string'))) {
      add('plugin.author must map name/email/url to strings')
    }
    const ui = plugin.interface
    if (!isRecord(ui)) add('plugin.interface must be a mapping')
    else {
      for (const key of Object.keys(ui)) if (![...INTERFACE_STRINGS, 'capabilities'].includes(key)) add(`unknown plugin.interface key ${key}`)
      for (const key of INTERFACE_STRINGS) if (typeof ui[key] !== 'string' || !ui[key]) add(`plugin.interface.${key} must be a non-empty string`)
      if (!(Array.isArray(ui.capabilities) && ui.capabilities.every((c) => typeof c === 'string'))) add('plugin.interface.capabilities must be a list of strings')
    }
  }
  const mkt = data.marketplace
  if (!isRecord(mkt)) add('marketplace must be a mapping')
  else {
    for (const key of Object.keys(mkt)) if (!['name', 'displayName'].includes(key)) add(`unknown marketplace key ${key}`)
    if (typeof mkt.name !== 'string' || !/^[a-z0-9-]+$/.test(mkt.name)) add('marketplace.name must be lowercase words joined by hyphens')
    if (typeof mkt.displayName !== 'string' || !mkt.displayName) add('marketplace.displayName must be a non-empty string')
  }
  return findings
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** A granted tool by its Codex name, with the only use allowed when it needs approval. */
function grantText(tool: string): string {
  const use = LEAF_PROMPT_GRANTS[tool.slice(MCP_TOOL_PREFIX.length)]?.use
  return use ? `\`${tool}\` (${use})` : `\`${tool}\``
}

/** The opening of every agent's instructions: its place in the workflow and its tools. */
export function agentPreamble(meta: AgentMeta): string {
  const tools = codexTools(meta.tools)
  const lines = [
    LEAF_ROLE,
    '',
    STATE_ROOT_RULE,
    '',
    tools.mcp.length ? `Dethereal tools you may use: ${tools.mcp.map(grantText).join(', ')}. Use no other Dethereal tool.` : 'Use no Dethereal tool.',
    tools.useShell
      ? meta.tools.includes('shell') || meta.tools.includes('fs-search')
        ? `Read and search files with the shell (\`exec_command\`)${meta.tools.includes('shell') ? '' : '; run no command that changes anything'}.`
        : 'Read files with the shell (`exec_command`): only commands that print a file, never a search, a listing or any other command.'
      : 'Do not read or search files.',
    tools.write ? 'You may change files with `apply_patch`.' : 'Never change files — no edits, and no shell command that writes; for you the shell runs only commands that read.',
  ]
  if (tools.literal.length) lines.push(`Also allowed: ${tools.literal.map((t) => `\`${t}\``).join(', ')}.`)
  return `${lines.join('\n')}\n\n`
}

function agentFile(meta: AgentMeta, body: string): string {
  const tools = codexTools(meta.tools)
  return tomlLines([
    ['name', agentName(meta.name)],
    ['description', meta.description],
    ['model_reasoning_effort', meta.effort],
    ['sandbox_mode', tools.write ? 'workspace-write' : 'read-only'],
    ['developer_instructions', agentPreamble(meta) + body.replace(/^\n+/, '')],
  ])
}

/** The skill a Codex operator invokes for a forked skill: it hands the body to the agent as a task file. */
function forkSkillBody(agent: string): string {
  const message =
    `Read and follow the task file \`${TASK_FILE}\` at <the absolute path of the ${TASK_FILE} next to this SKILL.md>. ` +
    `The operator's text: <the text the operator supplied with the skill invocation, verbatim, or "none">.`
  return `\n${delegation(agent, message, `Then show its final answer to the operator in full. ${FAIL_CLOSED}`)}\n`
}

function fragment(override: McpEntryOverride | undefined, settlement: boolean): string {
  const env: Record<string, string> = { DETHERNETY_PLATFORM_URL: override?.url ?? '<platform-url>' }
  if (override?.home) env.HOME = override.home
  if (settlement) env[SETTLEMENT_ENV] = SETTLEMENT_ON
  let out =
    tomlTable(['mcp_servers', PLUGIN_NAME]) +
    tomlLines([
      ['command', override ? override.node : '<node-abs>'],
      ['args', [override ? override.entry : '<runtime>/dist/index.js']],
      ['env', env],
      ['env_vars', ENV_VARS],
      ['startup_timeout_sec', 30],
      ['tool_timeout_sec', 120],
      ['default_tools_approval_mode', 'prompt'],
    ])
  for (const tool of autoApproved()) out += `\n${tomlTable(['mcp_servers', PLUGIN_NAME, 'tools', tool])}${tomlLines([['approval_mode', 'approve']])}`
  return out
}

export const codexTarget: Target = {
  harness: 'codex',
  renderer: codexRenderer,
  forkRenderers: { task: codexTaskRenderer },
  bundleRoot: ROOT,
  skillPath: (name) => `${PLUGIN_DIR}/skills/${name}/SKILL.md`,
  siblingPath: (skill, fileName) => `${PLUGIN_DIR}/skills/${skill}/${fileName}`,
  agentPath: (name) => `${ROOT}/agents/${agentName(name)}.toml`,
  agentText: (content) => tomlUnescape(content.match(/^developer_instructions = """\n([\s\S]*?)"""$/m)?.[1] ?? ''),
  checkHarnessData: checkData,

  emit(input: TargetInput): Map<string, string> {
    const files = new Map<string, string>()
    const data = input.harnessData as CodexData

    for (const skill of input.skills) {
      const head = emitFrontmatter([
        ['name', skill.meta.name],
        ['description', skill.meta.description],
        ['argument-hint', skill.meta.argumentHint],
      ])
      if (skill.meta.forkAgent) {
        if (skill.siblings.has(TASK_FILE)) throw new Error(`skill ${skill.name}: an as-file include may not be named ${TASK_FILE}`)
        files.set(this.skillPath(skill.name), head + forkSkillBody(skill.meta.forkAgent))
        files.set(this.siblingPath(skill.name, TASK_FILE), (skill.forkBodies.get('task') ?? '').replace(/^\n+/, ''))
      } else {
        files.set(this.skillPath(skill.name), head + skill.body)
      }
      for (const [fileName, content] of skill.siblings) files.set(this.siblingPath(skill.name, fileName), content)
    }

    for (const agent of input.agents) files.set(this.agentPath(agent.name), agentFile(agent.meta, agent.body))

    files.set(
      MANIFEST,
      json({
        name: PLUGIN_NAME,
        version: input.pkg.version,
        description: data.plugin.description,
        ...(data.plugin.author ? { author: data.plugin.author } : {}),
        skills: './skills/',
        interface: data.plugin.interface,
      }),
    )
    files.set(
      MARKETPLACE,
      json({
        name: data.marketplace.name,
        interface: { displayName: data.marketplace.displayName },
        plugins: [{ name: PLUGIN_NAME, source: { source: 'local', path: `./plugins/${PLUGIN_NAME}` } }],
      }),
    )
    files.set(FRAGMENT, fragment(input.mcpEntry, !!input.settlement))
    files.set(HOOKS, hooksFile(!!input.settlement))
    files.set(`${BIN}/pre-tool-use.mjs`, asset('pre-tool-use.mjs'))
    files.set(`${BIN}/hook.mjs`, asset('hook.mjs'))
    files.set(`${BIN}/hook-deadlines.json`, hookDeadlines())
    for (const [name, source] of Object.entries(SHARED_MODULES)) files.set(`${BIN}/${name}`, readFileSync(source, 'utf8'))
    files.set(`${BIN}/leaf-allowlist.json`, leafAllowlist(input.agents))
    return files
  },

  /** Every paragraph that starts an agent also closes it: open agents exhaust the session's limit. */
  checkOutput(files: ReadonlyMap<string, string>): Finding[] {
    const findings: Finding[] = []
    for (const [p, content] of files) {
      if (!p.endsWith('.md') && !p.endsWith('.toml')) continue
      for (const paragraph of content.split(/\n\s*\n/)) {
        if (paragraph.includes('`spawn_agent`') && !paragraph.includes('`close_agent`')) {
          findings.push({ rule: 'agent-close', file: p, line: 0, message: 'a spawn_agent instruction without the matching close_agent' })
        }
      }
    }
    return findings
  },
}
