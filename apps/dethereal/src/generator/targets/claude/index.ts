/**
 * Claude Code target. The package root is the plugin root: a generated
 * `.claude-plugin/plugin.json` points into `bundles/claude/`.
 *
 * The manifest names the hooks file explicitly. Claude Code also loads a root `hooks/hooks.json`
 * on top of it, so a plugin root holding both runs every hook twice; `LEGACY_ROOT_PATHS` lists the
 * root paths that must not exist beside the generated bundle.
 */

import { SETTLEMENT_ENV, SETTLEMENT_FLAG, SETTLEMENT_ON, STATE_ROOT_RULE } from '../common.js'
import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import { autoActions } from '../../../cli/approve.js'
import { emitFrontmatter } from '../../frontmatter.js'
import { type Finding, PLUGIN_NAME } from '../../types.js'
import type { AgentMeta } from '../../workflow.js'
import type { McpEntryOverride, Target, TargetInput } from '../types.js'
import { claudeRenderer, claudeTools, MCP_TOOL_PREFIX } from './renderer.js'

export { claudeRenderer, claudeTools } from './renderer.js'

const ROOT = 'bundles/claude'
const MANIFEST = '.claude-plugin/plugin.json'
const HOOKS = `${ROOT}/hooks/hooks.json`

/**
 * Plugin-root paths Claude Code reads by default, on top of what the manifest names: skills,
 * commands and agents directories, a hooks file, an MCP config, and settings.
 */
export const LEGACY_ROOT_PATHS = ['skills', 'commands', 'agents', 'hooks', '.mcp.json', 'settings.json'] as const

/** Session start sources and the source the hook reports for each; a forked session resumes one. */
const SESSION_START_SOURCES: readonly (readonly [string, string])[] = [
  ['startup', 'startup'],
  ['resume', 'resume'],
  ['clear', 'clear'],
  ['compact', 'compact'],
  ['fork', 'resume'],
]
/** File-writing tools: the post-write hint follows them, and the config guard sees them first. */
const EDIT_TOOLS = 'Write|Edit|MultiEdit'
const GUARDED_TOOLS = 'Write|Edit|MultiEdit|NotebookEdit'
/** The tools that can read a file's content: the secret-file guard checks them. Listing names (Glob) stays open. */
const SECRET_GUARDED_TOOLS = '^(Read|Grep|Bash)$'

/**
 * The manifest's auto-approved tools, and the tools with auto-approved actions, as an anchored matcher
 * of their exact names: the approve hook runs for those only (and approves nothing else). Settlement's
 * tools are named only when the bundle turns settlement on.
 */
export function autoToolMatcher(settlement = false): string {
  const names = [...TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name), ...Object.keys(autoActions(settlement))]
  return `^${MCP_TOOL_PREFIX}(${names.join('|')})$`
}

interface ClaudeData {
  readonly plugin: Readonly<Record<string, unknown>>
  readonly userConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

const PLUGIN_KEYS = ['description', 'author', 'homepage', 'repository', 'license', 'keywords'] as const
const USER_CONFIG_KEYS = ['type', 'title', 'description', 'required', 'default', 'sensitive'] as const
const USER_CONFIG_TYPES = ['string', 'number', 'boolean', 'directory', 'file']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function checkData(data: unknown, file: string): Finding[] {
  const findings: Finding[] = []
  const add = (message: string) => findings.push({ rule: 'harness-data', file, line: 0, message })
  if (!isRecord(data)) {
    add('must be a mapping with plugin (and optionally userConfig)')
    return findings
  }
  for (const key of Object.keys(data)) if (key !== 'plugin' && key !== 'userConfig') add(`unknown key ${key}`)
  if (!isRecord(data.plugin)) add('plugin must be a mapping')
  else {
    for (const key of Object.keys(data.plugin)) if (!(PLUGIN_KEYS as readonly string[]).includes(key)) add(`unknown plugin key ${key}`)
    if (typeof data.plugin.description !== 'string' || !data.plugin.description) add('plugin.description must be a non-empty string')
    for (const key of ['homepage', 'repository', 'license'] as const) {
      if (data.plugin[key] !== undefined && typeof data.plugin[key] !== 'string') add(`plugin.${key} must be a string`)
    }
    const author = data.plugin.author
    if (author !== undefined && !(isRecord(author) && Object.entries(author).every(([k, v]) => ['name', 'email', 'url'].includes(k) && typeof v === 'string'))) {
      add('plugin.author must map name/email/url to strings')
    }
    const keywords = data.plugin.keywords
    if (keywords !== undefined && !(Array.isArray(keywords) && keywords.every((k) => typeof k === 'string'))) add('plugin.keywords must be a list of strings')
  }
  if (data.userConfig !== undefined) {
    if (!isRecord(data.userConfig)) add('userConfig must be a mapping')
    else {
      for (const [name, entry] of Object.entries(data.userConfig)) {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) add(`userConfig name ${name} must be snake_case`)
        if (!isRecord(entry)) {
          add(`userConfig.${name} must be a mapping`)
          continue
        }
        for (const key of Object.keys(entry)) if (!(USER_CONFIG_KEYS as readonly string[]).includes(key)) add(`unknown userConfig.${name} key ${key}`)
        if (!USER_CONFIG_TYPES.includes(entry.type as string)) add(`userConfig.${name}.type must be one of ${USER_CONFIG_TYPES.join(', ')}`)
        for (const key of ['title', 'description'] as const) {
          if (typeof entry[key] !== 'string' || !entry[key]) add(`userConfig.${name}.${key} must be a non-empty string`)
        }
        for (const key of ['required', 'sensitive'] as const) {
          if (entry[key] !== undefined && typeof entry[key] !== 'boolean') add(`userConfig.${name}.${key} must be a boolean`)
        }
      }
    }
  }
  return findings
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function mcpConfig(override: McpEntryOverride | undefined, settlement: boolean): string {
  const env: Record<string, string> = { DETHERNETY_PLATFORM_URL: '${user_config.platform_url}' }
  if (override?.home) env.HOME = override.home
  if (override?.url) env.DETHERNETY_URL = override.url
  if (settlement) env[SETTLEMENT_ENV] = SETTLEMENT_ON
  return json({
    mcpServers: {
      [PLUGIN_NAME]: {
        type: 'stdio',
        command: override ? override.node : 'node',
        args: [override ? override.entry : '${CLAUDE_PLUGIN_ROOT}/dist/index.js'],
        env,
      },
    },
  })
}

/**
 * Hooks run the server's own executable as argv, never through a shell. The two guards also carry
 * `onFailure: "block"`: Claude Code (2.1.295 and later) then blocks the call when a guard cannot
 * answer (it fails to start, times out, exits with neither 0 nor 2, or prints invalid output), where
 * a hook failure otherwise lets the call run; older versions ignore the key.
 */
function hooksConfig(override: McpEntryOverride | undefined, settlement: boolean): string {
  const command = (timeout: number, ...args: string[]) => ({
    type: 'command',
    command: override ? override.node : 'node',
    args: [override ? override.entry : '${CLAUDE_PLUGIN_ROOT}/dist/index.js', 'hook', ...args, ...(settlement ? [SETTLEMENT_FLAG] : [])],
    timeout,
  })
  const guard = (timeout: number, ...args: string[]) => ({ ...command(timeout, ...args), onFailure: 'block' })
  return json({
    hooks: {
      SessionStart: SESSION_START_SOURCES.map(([matcher, source]) => ({
        matcher,
        hooks: [command(15, 'session-start', '--source', source, '--harness', 'claude')],
      })),
      PreToolUse: [
        { matcher: GUARDED_TOOLS, hooks: [guard(10, 'config-guard', '--harness', 'claude')] },
        { matcher: autoToolMatcher(settlement), hooks: [command(10, 'approve', '--harness', 'claude')] },
        { matcher: SECRET_GUARDED_TOOLS, hooks: [guard(10, 'secret-guard', '--harness', 'claude')] },
      ],
      PostToolUse: [{ matcher: EDIT_TOOLS, hooks: [command(15, 'post-write', '--harness', 'claude')] }],
    },
  })
}

/** `mcp:prompt` in `disallowedTools` stands for every Dethereal tool that needs the operator's approval. */
function ownAgentKeys(own: AgentMeta['own']): AgentMeta['own'] {
  const prompted = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => `${MCP_TOOL_PREFIX}${t.name}`).sort()
  return own.map(([key, value]) =>
    key === 'disallowedTools' && Array.isArray(value) ? [key, [...new Set(value.flatMap((v) => (v === 'mcp:prompt' ? prompted : [v])))]] : [key, value],
  )
}

function agentFile(meta: AgentMeta, body: string): string {
  return (
    emitFrontmatter([
      ['name', meta.name],
      ['description', meta.description],
      ['model', 'inherit'],
      ['effort', meta.effort],
      ['maxTurns', meta.maxTurns],
      ['memory', meta.memory],
      ...ownAgentKeys(meta.own),
      ['tools', claudeTools(meta.tools)],
    ]) +
    `\n${STATE_ROOT_RULE}\n` +
    body
  )
}

export const claudeTarget: Target = {
  harness: 'claude',
  renderer: claudeRenderer,
  bundleRoot: ROOT,
  skillPath: (name) => `${ROOT}/skills/${name}/SKILL.md`,
  siblingPath: (skill, fileName) => `${ROOT}/skills/${skill}/${fileName}`,
  agentPath: (name) => `${ROOT}/agents/${name}.md`,
  checkHarnessData: checkData,

  emit(input: TargetInput): Map<string, string> {
    const files = new Map<string, string>()
    const data = input.harnessData as ClaudeData

    for (const skill of input.skills) {
      const allowed = skill.meta.allowedTools ? claudeTools(skill.meta.allowedTools) : []
      // A leading `/` makes the expanded directory `//<path>`, Claude Code's absolute-path form; without it
      // the rule is read relative to the settings and never matches. The grant lasts until the next message.
      if (skill.siblings.size > 0) allowed.push('Read(/${CLAUDE_SKILL_DIR}/*.md)')
      const head = emitFrontmatter([
        ['name', skill.meta.name],
        ['description', skill.meta.description],
        ['argument-hint', skill.meta.argumentHint],
        ...skill.meta.own,
        ['allowed-tools', allowed.length === 0 ? undefined : allowed.length === 1 ? allowed[0] : allowed],
        ...(skill.meta.forkAgent
          ? ([
              ['context', 'fork'],
              ['agent', `${PLUGIN_NAME}:${skill.meta.forkAgent}`],
              ['background', false],
            ] as const)
          : []),
      ])
      files.set(this.skillPath(skill.name), head + skill.body)
      for (const [fileName, content] of skill.siblings) files.set(this.siblingPath(skill.name, fileName), content)
    }

    const agentPaths: string[] = []
    for (const agent of input.agents) {
      const p = this.agentPath(agent.name)
      files.set(p, agentFile(agent.meta, agent.body))
      agentPaths.push(`./${p}`)
    }

    files.set(`${ROOT}/.mcp.json`, mcpConfig(input.mcpEntry, !!input.settlement))
    files.set(HOOKS, hooksConfig(input.mcpEntry, !!input.settlement))

    const plugin = data.plugin
    files.set(
      MANIFEST,
      json({
        name: PLUGIN_NAME,
        version: input.pkg.version,
        ...Object.fromEntries(PLUGIN_KEYS.filter((k) => plugin[k] !== undefined).map((k) => [k, plugin[k]])),
        skills: [`./${ROOT}/skills/`],
        agents: agentPaths.sort(),
        hooks: `./${HOOKS}`,
        mcpServers: `./${ROOT}/.mcp.json`,
        ...(data.userConfig ? { userConfig: data.userConfig } : {}),
      }),
    )
    return files
  },

  checkOutput(files: ReadonlyMap<string, string>): Finding[] {
    const findings: Finding[] = []
    const manifest = files.get(MANIFEST)
    if (manifest === undefined) return [{ rule: 'agents-manifest', file: MANIFEST, line: 0, message: 'manifest not emitted' }]
    const agents = (JSON.parse(manifest) as { agents?: unknown }).agents
    for (const entry of Array.isArray(agents) ? agents : []) {
      const p = typeof entry === 'string' ? entry.replace(/^\.\//, '') : ''
      if (!p.endsWith('.md') || !files.has(p)) {
        findings.push({ rule: 'agents-manifest', file: MANIFEST, line: 0, message: `agents entry ${String(entry)} is not an emitted .md file` })
      }
    }
    for (const p of files.keys()) {
      if (LEGACY_ROOT_PATHS.some((legacy) => p === legacy || p.startsWith(`${legacy}/`))) {
        findings.push({ rule: 'plugin-root', file: p, line: 0, message: 'Claude Code loads this root path on top of the manifest; emit it under bundles/claude/' })
      }
    }
    return findings
  },
}
