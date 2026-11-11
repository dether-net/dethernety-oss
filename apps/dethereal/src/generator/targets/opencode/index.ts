/**
 * OpenCode target: skills, subagents, commands and the MCP entry, installed into an OpenCode
 * config directory (`.opencode/` or `~/.config/opencode/`; never `.claude/skills/`).
 *
 * - Every skill is also a slash command in OpenCode, so plain skills need no command file. A
 *   forked skill gets a command that runs its body on the agent (`subtask`), which takes the
 *   command's name from the automatic one; the skill itself hands the body to the agent as a
 *   task file.
 * - Agents are leaves with deny-by-default permissions, in rule order (the last matching rule
 *   wins): everything denied — which also hides it — then what the neutral tool list grants.
 * - `mcp.fragment.json` is the server entry for the `mcp` key of `opencode.json`, with installer
 *   placeholders; its `timeout` bounds every tool call.
 * - `plugins/dethereal.ts` runs the hooks (the secret guard, the post-write hint, the state for a
 *   compaction summary), from the template beside this file, with the same placeholders. The
 *   by-name judgement it falls back on (`secret-fallback.mjs`, the module Codex's runner carries
 *   beside it) is written into it in place of its import, so the installed plugin is one file.
 */

import { readFileSync } from 'node:fs'

import { TOOL_MANIFEST } from '../../../tools/manifest.js'
import { SECRET_EXCEPTIONS, SECRET_PATHS as SHARED_SECRET_PATHS, SECRET_SUFFIXES } from '../../../utils/secret-paths.js'
import { FAIL_CLOSED, LEAF_ROLE, leafMcpTools, SETTLEMENT_ENV, SETTLEMENT_ON, STATE_ROOT_RULE } from '../common.js'
import { emitFrontmatter } from '../../frontmatter.js'
import { type Finding, PLUGIN_NAME } from '../../types.js'
import type { AgentMeta } from '../../workflow.js'
import type { McpEntryOverride, RenderedAgent, RenderedSkill, Target, TargetInput } from '../types.js'
import { agentName, delegation, openCodeCommandRenderer, openCodeRenderer, openCodeTaskRenderer } from './renderer.js'

export { openCodeCommandRenderer, openCodeRenderer, openCodeTaskRenderer } from './renderer.js'

const ROOT = 'bundles/opencode'
const FRAGMENT = `${ROOT}/mcp.fragment.json`
const PLUGIN = `${ROOT}/plugins/${PLUGIN_NAME}.ts`
const TASK_FILE = 'task.md'
/** Each tool call's limit, in milliseconds: it bounds every call, not only the listing, so a tool that waits (login) stays well inside it. */
const TOOL_TIMEOUT_MS = 60000
/** Where a forked skill's task file lives, for an agent that must read it from outside the project. */
const SKILL_FILES = `*/skills/${PLUGIN_NAME}-*/*`


/**
 * Secret-bearing files a leaf may not read: the shared list, plus the project's own OpenCode config,
 * where provider keys and server tokens can sit; the example and template env files hold names only.
 * OpenCode matches a rule against the path relative to the git worktree (the root folder when there
 * is none), not the project, `*` spanning directories and the whole path anchored: a file that may
 * sit at that root needs its root form too, and a project below it is reached by the form with a
 * leading `*` folder. Its
 * patterns are case-sensitive, so a differently cased name passes here; the Claude read guard
 * matches in any letter case.
 */
const SECRET_PATHS = [...SHARED_SECRET_PATHS, 'opencode.json*']
/** Model files named after element ids, which a name pattern above could catch. */
const MODEL_READS = ['attributes/*.json', 'controls/*.json'] as const
/**
 * Secret names no model file can carry (a folder form, or an exact credential name). They are denied
 * after the model files' allow-backs, which `*` (spanning folders) would otherwise stretch over them:
 * `x/controls/gcp/credentials.json`.
 */
export const NEVER_MODEL_FILES: ReadonlySet<string> = new Set([
  '.aws/credentials', '.docker/config.json', '.kube/config', 'credentials.json', '.credentials.json', 'credentials.tfrc.json',
  '*application_default_credentials.json',
])
const denyRule = (p: string) => (p.startsWith('*') ? [[p, 'deny']] : [[p, 'deny'], [`*/${p}`, 'deny']])
const READ_RULES: Record<string, string> = {
  '*': 'allow',
  ...Object.fromEntries(SECRET_SUFFIXES.filter((p) => !NEVER_MODEL_FILES.has(p)).flatMap((p) => [[p, 'deny']])),
  ...Object.fromEntries(SECRET_PATHS.filter((p) => !NEVER_MODEL_FILES.has(p)).flatMap(denyRule)),
  // The model's own files come back after the name patterns above (a component id can contain
  // "service-account"); the names no model file carries are denied again after them, and the
  // example env files come last: the last match wins.
  ...Object.fromEntries(MODEL_READS.flatMap((f) => [[f, 'allow'], [`*/${f}`, 'allow']])),
  ...Object.fromEntries([...NEVER_MODEL_FILES].flatMap(denyRule)),
  ...Object.fromEntries(SECRET_EXCEPTIONS.map((p) => [p, 'allow'])),
}

/**
 * The only files a writing leaf may change: the model tree's own shapes, at the project root or
 * below it. An allow-list, because OpenCode's patterns are case-sensitive while a macOS disk is
 * not: a deny for `opencode.json` would let `OPENCODE.JSON` through, a deny-all catches every
 * spelling. OpenCode loads none of these as config, agent, command or plugin code.
 */
const MODEL_FILES = [
  'manifest.json',
  'structure.json',
  'dataflows.json',
  'data-items.json',
  'attributes/*.json',
  'controls/*.json',
  '.dethereal/scope.json',
  '.dethereal/discovery.json',
] as const
/**
 * Project-level files, at the git root or in a project below it (the path OpenCode matches is
 * relative to the git worktree). Only these two names: a wider `.dethernety/` shape would reach the
 * server's own store when the session starts in the home directory, and it holds neither name.
 */
const PROJECT_FILES = ['.dethernety/discovery-cache.json', '.dethernety/decomposition-plan.json'] as const
const EDIT_RULES: Record<string, string> = {
  '*': 'deny',
  ...Object.fromEntries(MODEL_FILES.flatMap((f) => [[f, 'allow'], [`*/${f}`, 'allow']])),
  ...Object.fromEntries(PROJECT_FILES.flatMap((f) => [[f, 'allow'], [`*/${f}`, 'allow']])),
}
const allowAtAnyDepth = (f: string) => ({ [f]: 'allow', [`*/${f}`]: 'allow' })
/** The enrichment relay files: only the agent that writes its return there writes them. */
const RELAY_FILES = '.dethereal/relay/*.txt'
export const RELAY_WRITERS: ReadonlySet<string> = new Set(['security-enricher'])
/** The agents that change attribute files and nothing else. */
export const ATTRIBUTE_WRITERS: ReadonlySet<string> = new Set(['enrichment-applier'])

/** An agent's `edit` rules: the model files, narrowed or widened for the agents named above. */
function editRules(agent: string | undefined): Record<string, string> {
  if (agent !== undefined && ATTRIBUTE_WRITERS.has(agent)) return { '*': 'deny', ...allowAtAnyDepth('attributes/*.json') }
  return { ...EDIT_RULES, ...(agent !== undefined && RELAY_WRITERS.has(agent) ? allowAtAnyDepth(RELAY_FILES) : {}) }
}
/**
 * An agent's `permission` rules, in the order OpenCode evaluates them (the last match wins).
 * Only an agent that runs a forked skill's task file may reach outside the project, and only
 * the Dethereal skill directories: the rule governs writes too, so such an agent never writes.
 */
export function permissionRules(tools: readonly string[], readsTaskFiles = false, agent?: string): Record<string, unknown> {
  // A leaf hands no work on: no subagents of its own.
  const rules: Record<string, unknown> = { '*': 'deny', task: 'deny' }
  if (tools.includes('fs-read')) rules.read = { ...READ_RULES }
  // Names only: OpenCode's grep searches hidden files and checks its rule against the search
  // pattern, never a path, so no rule could keep it out of a file `read` denies.
  if (tools.includes('fs-search')) rules.glob = 'allow'
  if (tools.includes('fs-write')) rules.edit = editRules(agent)
  // Shell commands ask, as a Bash call does on Claude Code unless the user allowed it: the plugin's
  // guard checks each one too, but running them without the operator is not the default.
  if (tools.includes('shell')) rules.bash = 'ask'
  if (readsTaskFiles) rules.external_directory = { [SKILL_FILES]: 'allow' }
  if (tools.includes('mcp:*')) {
    rules[`${PLUGIN_NAME}_*`] = 'allow'
    // Approval-required tools stay out of a leaf's `mcp:*`: nobody can approve them there.
    for (const t of TOOL_MANIFEST) if (t.approval === 'prompt') rules[`${PLUGIN_NAME}_${t.name}`] = 'deny'
  }
  for (const t of tools) {
    // An `allow` would skip the approval the tool needs, and nobody can give it here: leave it denied.
    if (t.startsWith('mcp:') && t !== 'mcp:*') {
      if (!needsApproval(t.slice(4))) rules[`${PLUGIN_NAME}_${t.slice(4)}`] = 'allow'
    }
    else if (!['fs-read', 'fs-search', 'fs-write', 'shell'].includes(t) && !t.startsWith('mcp:')) rules[t] = 'allow'
  }
  return rules
}

const needsApproval = (tool: string): boolean => TOOL_MANIFEST.find((m) => m.name === tool)?.approval === 'prompt'

/** The opening of every agent's instructions: its place in the workflow and its tools. */
export function agentPreamble(meta: AgentMeta): string {
  const t = meta.tools
  const mcp = leafMcpTools(t).filter((x) => !needsApproval(x)).map((x) => `\`${PLUGIN_NAME}_${x}\``)
  const files = [
    t.includes('fs-read') ? 'read files' : undefined,
    t.includes('fs-search') ? 'find them by name' : undefined,
    t.includes('fs-write') ? 'change them' : undefined,
    t.includes('shell') ? 'run shell commands' : undefined,
  ].filter(Boolean)
  const lines = [
    LEAF_ROLE,
    '',
    STATE_ROOT_RULE,
    '',
    mcp.length ? `Dethereal tools you may use: ${mcp.join(', ')}. Use no other Dethereal tool.` : 'Use no Dethereal tool.',
    files.length ? `You may ${files.join(', ')}; nothing else.` : 'You have no file access.',
  ]
  return `${lines.join('\n')}\n\n`
}

function agentFile(meta: AgentMeta, body: string, readsTaskFiles: boolean): string {
  return (
    emitFrontmatter([
      ['description', meta.description],
      ['mode', 'subagent'],
      ['steps', meta.maxTurns],
      ['permission', permissionRules(meta.tools, readsTaskFiles, meta.name)],
    ]) +
    '\n' +
    agentPreamble(meta) +
    body.replace(/^\n+/, '')
  )
}

function forkSkillBody(agent: string): string {
  const prompt =
    `Read and follow the task file \`${TASK_FILE}\` in <this skill's base directory, shown when the skill was loaded>. ` +
    `The operator's text: <the arguments given with the command, verbatim, or "none">.`
  return `\n${delegation(agent, prompt, `Then show its final answer to the operator in full. ${FAIL_CLOSED}`)}\n`
}

function fragment(override: McpEntryOverride | undefined, settlement: boolean): string {
  const environment: Record<string, string> = override ? overrideUrlEnv(override) : { DETHERNETY_PLATFORM_URL: '<platform-url>' }
  if (override?.home) environment.HOME = override.home
  if (settlement) environment[SETTLEMENT_ENV] = SETTLEMENT_ON
  return `${JSON.stringify(
    {
      mcp: {
        [PLUGIN_NAME]: {
          type: 'local',
          command: [override ? override.node : '<node-abs>', override ? override.entry : '<runtime>/dist/index.js'],
          environment,
          timeout: TOOL_TIMEOUT_MS,
          enabled: true,
        },
      },
      // OpenCode allows every tool unless told otherwise: a tool that needs the operator's approval asks.
      permission: Object.fromEntries(TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => [`${PLUGIN_NAME}_${t.name}`, 'ask'])),
      // The asks come after the built-in read-only explore agent's deny-all and would widen it.
      agent: { explore: { permission: { [`${PLUGIN_NAME}_*`]: 'deny' } } },
    },
    null,
    2,
  )}\n`
}

/**
 * The override's URL, pinned in DETHERNETY_URL as on Claude: a sandboxed run must not follow a
 * DETHERNETY_URL exported in the developer's shell. The shipped entry uses DETHERNETY_PLATFORM_URL.
 */
function overrideUrlEnv(override: McpEntryOverride): Record<string, string> {
  return override.url ? { DETHERNETY_URL: override.url } : {}
}

const FALLBACK_MODULE = new URL('../../../utils/secret-fallback.mjs', import.meta.url)
/** The plugin's import of the by-name judgement, which the generator replaces with the module itself. */
export const FALLBACK_IMPORT = "import * as fallback from '../../../utils/secret-fallback.mjs'"
/** The builtins the module may import: none of them loads code, starts a process or reaches the network. */
const NODE_IMPORT = /^import ([^'"]+) from '(node:(?:path|os|url|util))'$/
/** Ways code is loaded or built at run time, which the module may not use: the plugin would load what no check saw. */
const RUNTIME_LOAD = /\bimport\s*(\(|\/\*|\/\/|\.meta)|\brequire\s*\(|\bcreateRequire\b|\bgetBuiltinModule\b|\beval\s*\(|\bFunction\s*\(|\bprocess\.binding\b|\bBun\b/
/** The installer's and the generator's placeholders, which must stay unique to the plugin. */
const PLACEHOLDER = /<node-abs>|<runtime>|<ask-tools>|<platform-url>/
/** A top-level declaration of the plugin, whose name an import of the module may not bind. */
const DECLARED = /^(?:export )?(?:async )?(?:function\*?|const|let|var|class|interface|type) ([A-Za-z_$][\w$]*)/
const EXPORTED = /^export (?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/

/** The names an import line binds: its default, its namespace and each named import as it is bound. */
function importBindings(clause: string): string[] {
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
  const rest = clause.replace(/\{[^}]*\}/, '').split(',').map((x) => x.trim()).filter(Boolean)
  return [
    ...rest.map((x) => x.replace(/^\*\s+as\s+/, '')),
    ...named.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+as\s+/).pop()!),
  ]
}

/**
 * The plugin with its import of `secret-fallback.mjs` replaced by the module: its `node:` imports
 * (an import the plugin already makes, line for line, is not repeated), then its body with `export`
 * dropped, inside a function whose result is `fallback`, so none of its names reach the plugin's top
 * level. Refuses a module this cannot carry: an import other than one line from `node:path`,
 * `node:os`, `node:url` or `node:util`, an export of another form, an export the plugin calls
 * (`fallback.<name>`) missing, an import binding the plugin already has, a placeholder, or code
 * loaded or built at run time (`import(`, `import.meta`, `import //`, `require(`, `createRequire`,
 * `getBuiltinModule`, `eval(`, `Function(`, `process.binding`, `Bun`, in comments too).
 */
export function inlineFallback(plugin: string, source: string): string {
  if (plugin.split(FALLBACK_IMPORT).length !== 2) throw new Error('The OpenCode plugin must import secret-fallback.mjs exactly once.')
  const module = source.replace(/\r\n/g, '\n')
  const load = RUNTIME_LOAD.exec(module)
  if (load) throw new Error(`secret-fallback.mjs may not load or build code at run time: ${load[0]}`)
  if (PLACEHOLDER.test(module)) throw new Error('secret-fallback.mjs may not hold a placeholder of the plugin or the installer.')
  const lines = module.split('\n')
  const imports = lines.filter((l) => /^\s*import\b/.test(l))
  const bad = imports.find((l) => !NODE_IMPORT.test(l))
  if (bad !== undefined) throw new Error(`secret-fallback.mjs may import only node:path, node:os, node:url and node:util, each as one \`import … from 'node:…'\` line: ${bad}`)
  const names: string[] = []
  const body = lines.filter((l) => !imports.includes(l)).map((l) => {
    const m = EXPORTED.exec(l)
    if (m) names.push(m[1]!)
    return m ? l.slice('export '.length) : l
  })
  const other = body.find((l) => /^\s*export\b/.test(l))
  if (other !== undefined) throw new Error(`secret-fallback.mjs has an export the plugin cannot carry: ${other}`)
  const used = [...new Set([...plugin.matchAll(/(?<![\w$-])fallback\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!))]
  const missing = used.filter((n) => !names.includes(n))
  if (missing.length) throw new Error(`secret-fallback.mjs does not export ${missing.join(', ')}.`)
  const pluginLines = plugin.split('\n')
  const own = pluginLines.filter((l) => /^import\b/.test(l) && l !== FALLBACK_IMPORT)
  const ownBindings = new Set([
    ...own.flatMap((l) => importBindings(/^import (.+?) from /.exec(l)?.[1] ?? '')),
    ...pluginLines.flatMap((l) => DECLARED.exec(l)?.[1] ?? []),
  ])
  const added = imports.filter((l) => !own.includes(l))
  const clash = added.flatMap((l) => importBindings(NODE_IMPORT.exec(l)![1]!)).find((b) => ownBindings.has(b) || b === 'fallback')
  if (clash !== undefined) throw new Error(`secret-fallback.mjs imports ${clash}, which the OpenCode plugin already binds.`)
  const inlined = [
    ...added,
    '// The by-name judgement, written in by the generator from secret-fallback.mjs.',
    'const fallback = (() => {',
    ...body,
    `return { ${names.join(', ')} }`,
    '})()',
  ].join('\n')
  return plugin.replace(FALLBACK_IMPORT, () => inlined)
}

/**
 * The plugin, with the asking tools filled in, and its node, server entry and hook environment written
 * as JSON: the installer's placeholders, or the override; the hooks get the settlement switch through
 * that environment when the bundle turns it on.
 */
export function pluginSource(override?: McpEntryOverride, settlement = false): string {
  // The tools that must ask the operator, as the plugin sets them again over later configuration.
  const asks = TOOL_MANIFEST.filter((t) => t.approval === 'prompt').map((t) => `${PLUGIN_NAME}_${t.name}`)
  const plugin = readFileSync(new URL('./plugin.ts', import.meta.url), 'utf8')
  let template = inlineFallback(plugin, readFileSync(FALLBACK_MODULE, 'utf8')).replace('["<ask-tools>"]', () => JSON.stringify(asks))
  if (override) {
    template = template.replace('"<node-abs>"', () => JSON.stringify(override.node)).replace('"<runtime>/dist/index.js"', () => JSON.stringify(override.entry))
  }
  const hookEnv: Record<string, string> = override ? overrideUrlEnv(override) : { DETHERNETY_PLATFORM_URL: '<platform-url>' }
  if (settlement) hookEnv[SETTLEMENT_ENV] = SETTLEMENT_ON
  return template.replace('{"DETHERNETY_PLATFORM_URL":"<platform-url>"}', () => JSON.stringify(hookEnv))
}

export const openCodeTarget: Target = {
  harness: 'opencode',
  renderer: openCodeRenderer,
  forkRenderers: { command: openCodeCommandRenderer, task: openCodeTaskRenderer },
  bundleRoot: ROOT,
  skillPath: (name) => `${ROOT}/skills/${agentName(name)}/SKILL.md`,
  siblingPath: (skill, fileName) => `${ROOT}/skills/${agentName(skill)}/${fileName}`,
  agentPath: (name) => `${ROOT}/agents/${agentName(name)}.md`,

  checkHarnessData(data: unknown, file: string): Finding[] {
    const ok = !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0
    return ok ? [] : [{ rule: 'harness-data', file, line: 0, message: 'must be an empty mapping ({}): OpenCode needs no harness data' }]
  },

  checkInput(skills: readonly RenderedSkill[], fileOf: (skill: string) => string, agents: readonly RenderedAgent[]): Finding[] {
    const findings: Finding[] = []
    for (const s of skills) {
      if (!s.meta.forkAgent) continue
      const file = fileOf(s.name)
      if (s.siblings.size > 0) {
        findings.push({
          rule: 'token-context',
          file,
          line: 0,
          message: 'an as-file include in a forked skill cannot be carried on OpenCode: the command that runs it has no skill directory',
        })
      }
      if (agents.find((a) => a.name === s.meta.forkAgent)?.meta.tools.includes('fs-write')) {
        findings.push({
          rule: 'token-context',
          file,
          line: 0,
          message: `on OpenCode the agent of a forked skill reads its task from the skill directory, so it must not write files (${s.meta.forkAgent} has fs-write)`,
        })
      }
    }
    return findings
  },

  emit(input: TargetInput): Map<string, string> {
    const files = new Map<string, string>()
    for (const skill of input.skills) {
      const head = emitFrontmatter([
        ['name', agentName(skill.meta.name)],
        ['description', skill.meta.description],
      ])
      if (skill.meta.forkAgent) {
        files.set(this.skillPath(skill.name), head + forkSkillBody(skill.meta.forkAgent))
        files.set(this.siblingPath(skill.name, TASK_FILE), (skill.forkBodies.get('task') ?? '').replace(/^\n+/, ''))
        const description = skill.meta.argumentHint ? `${skill.meta.description} ${skill.meta.argumentHint}` : skill.meta.description
        files.set(
          `${ROOT}/commands/${agentName(skill.name)}.md`,
          emitFrontmatter([
            ['description', description],
            ['agent', agentName(skill.meta.forkAgent)],
            ['subtask', true],
          ]) + (skill.forkBodies.get('command') ?? ''),
        )
      } else {
        files.set(this.skillPath(skill.name), head + skill.body)
      }
      for (const [fileName, content] of skill.siblings) files.set(this.siblingPath(skill.name, fileName), content)
    }
    const forkAgents = new Set(input.skills.flatMap((s) => (s.meta.forkAgent ? [s.meta.forkAgent] : [])))
    for (const agent of input.agents) files.set(this.agentPath(agent.name), agentFile(agent.meta, agent.body, forkAgents.has(agent.name)))
    files.set(FRAGMENT, fragment(input.mcpEntry, !!input.settlement))
    files.set(PLUGIN, pluginSource(input.mcpEntry, !!input.settlement))
    return files
  },

  checkOutput(): Finding[] {
    return []
  },
}
