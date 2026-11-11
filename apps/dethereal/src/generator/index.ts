/**
 * Workflow generator: the neutral workflow → one harness's native bundle.
 *
 *   generate({ pkg, workflowDir, harness }) → Map<path relative to the package root, content>
 *
 * Pure apart from reading the workflow: nothing is written, output is sorted by path, LF only,
 * without timestamps. Any lint or parse finding fails the whole run with every finding listed.
 */

import { ASKING_RULE, DISMISSAL_RULE } from './ask-cues.js'
import { bundleJson } from './bundle-json.js'
import { parseYaml } from './frontmatter.js'
import {
  askIds,
  backtickedTokens,
  bareToolNames,
  pendingFileWrites,
  skillHandovers,
  shellWrites,
  unfilteredClassListings,
  baselineCommits,
  skillTokensInCode,
  reviewRecords,
  claudeLiterals,
  claudeLiteralsInOutput,
  type Context,
  openCodeTemplateSafety,
  duplicateParagraphs,
  optionLists,
  protocolIncludes,
  sizeBudget,
  askCues,
  optionCounts,
  stateJsonWrites,
  tokenContexts,
  tokenStore,
  unknownTargets,
  versionLiterals,
} from './lint.js'
import { askLayoutsOf, lintRegistry, parseRegistry, REGISTRY_FILE } from './registry.js'
import { byCodePoint, readWorkflow, treeHash } from './source.js'
import { unreasonedPromptGrants } from './targets/common.js'
import { targetFor } from './targets/index.js'
import type { McpEntryOverride, RenderedAgent, RenderedSkill } from './targets/types.js'
import { renderText, type ScanResult, scanTokens, type TokenRenderer, unrenderedTokenLines } from './tokens.js'
import { type Finding, GeneratorError, type Harness, HARNESSES, type PackageInfo, type WorkflowSource } from './types.js'
import { type AgentMeta, crossHarnessFindings, layout, type Layout, mcpToolsOf, parseAgent, parseSkill, type SkillMeta } from './workflow.js'
import { manifestToolNames } from '../tools/manifest.js'

export { GeneratorError } from './types.js'
export type { Finding, Harness, PackageInfo, WorkflowSource } from './types.js'
export type { McpEntryOverride } from './targets/types.js'

/**
 * Skill and agent names that tokens may reference although the workflow does not define them:
 * the ones still in the pre-migration tree. Empty once everything is migrated.
 */
export interface ExternalNames {
  readonly skills: ReadonlySet<string>
  readonly agents: ReadonlySet<string>
}

export interface GenerateOptions {
  readonly pkg: PackageInfo
  readonly workflowDir: string
  readonly harness: Harness
  /** Test and development only: run a specific server build (see McpEntryOverride). */
  readonly mcpEntry?: McpEntryOverride
  readonly externalNames?: ExternalNames
  /** Turn the server's settlement on in the bundle (off by default; for server tests). */
  readonly settlement?: boolean
}

export interface GenerateFromSourceOptions {
  readonly pkg: PackageInfo
  readonly source: WorkflowSource
  readonly harness: Harness
  readonly mcpEntry?: McpEntryOverride
  /** Defaults to the tool manifest. */
  readonly toolNames?: ReadonlySet<string>
  readonly externalNames?: ExternalNames
  readonly settlement?: boolean
}

export function generate(options: GenerateOptions): Map<string, string> {
  const { workflowDir, ...rest } = options
  return generateFromSource({ ...rest, source: readWorkflow(workflowDir) })
}

function sortFindings(findings: Finding[]): Finding[] {
  const key = (f: Finding) => `${f.file}\0${String(f.line).padStart(6, '0')}\0${f.rule}\0${f.message}`
  const unique = new Map(findings.map((f) => [key(f), f]))
  return [...unique.keys()].sort(byCodePoint).map((k) => unique.get(k)!)
}

interface Checked {
  readonly layout: Layout
  readonly scans: ReadonlyMap<string, ScanResult>
  readonly findings: Finding[]
}

/** Every source-level rule over the whole workflow. */
function checkSource(source: WorkflowSource, toolNames: ReadonlySet<string>, external?: ExternalNames): Checked {
  const lay = layout(source)
  const findings: Finding[] = [...lay.findings]
  const scans = new Map<string, ScanResult>()
  const targets = {
    tools: toolNames,
    skills: new Set([...lay.skills.keys(), ...(external?.skills ?? [])]),
    agents: new Set([...lay.agents.keys(), ...(external?.agents ?? [])]),
    shared: new Set(lay.shared),
  }
  const workflowAgents = new Set(lay.agents.keys())

  for (const [file, text] of source) {
    findings.push(...tokenStore(file, text), ...versionLiterals(file, text))
    if (!file.endsWith('.md')) continue
    const scan = scanTokens(file, text)
    scans.set(file, scan)
    findings.push(
      ...scan.findings,
      ...claudeLiterals(file, text),
      ...bareToolNames(file, text, toolNames),
      ...pendingFileWrites(file, text),
      ...shellWrites(file, text),
      ...unfilteredClassListings(file, text),
      ...baselineCommits(file, text),
      ...skillTokensInCode(file, text),
      ...reviewRecords(file, text),
      ...stateJsonWrites(file, text),
      ...optionLists(file, text, scan),
      ...optionCounts(file, text),
      ...backtickedTokens(file, scan),
      ...askIds(file, scan),
      ...unknownTargets(file, scan, targets),
    )
  }
  findings.push(...duplicateParagraphs(source), ...skillHandovers(source))

  // Frontmatter, in every harness's view.
  const forks = new Set<string>()
  const checkTools = (file: string, entries: readonly string[] | undefined) => {
    for (const tool of mcpToolsOf(entries ?? [])) {
      if (!toolNames.has(tool)) findings.push({ rule: 'unknown-target', file, line: 1, message: `tool ${tool} is not in the tool manifest` })
    }
  }
  for (const [name, file] of lay.skills) {
    const views = new Map<Harness, { keys: readonly string[]; literals: readonly string[] }>()
    for (const h of HARNESSES) {
      const parsed = parseSkill(file, name, source.get(file)!, h)
      findings.push(...parsed.findings)
      views.set(h, parsed)
      checkTools(file, parsed.meta?.allowedTools)
      const fork = parsed.meta?.forkAgent
      if (fork) {
        forks.add(file)
        if (!workflowAgents.has(fork)) findings.push({ rule: 'unknown-target', file, line: 1, message: `fork agent ${fork} is not a workflow agent` })
      }
    }
    findings.push(...crossHarnessFindings(file, 'skill', views))
  }
  for (const [name, file] of lay.agents) {
    const views = new Map<Harness, { keys: readonly string[]; literals: readonly string[] }>()
    for (const h of HARNESSES) {
      const parsed = parseAgent(file, name, source.get(file)!, h)
      findings.push(...parsed.findings)
      views.set(h, parsed)
      checkTools(file, parsed.meta?.tools)
    }
    findings.push(...crossHarnessFindings(file, 'agent', views))
  }

  // Where each file's text lands, following includes; include cycles.
  const contexts = new Map<string, Set<Context>>()
  const reach = (file: string, context: Context, stack: readonly string[]) => {
    const set = contexts.get(file) ?? new Set<Context>()
    if (set.has(context) && stack.length > 1) return
    set.add(context)
    contexts.set(file, set)
    for (const t of scans.get(file)?.tokens ?? []) {
      if (t.token.kind !== 'include') continue
      const target = t.token.path
      if (stack.includes(target)) {
        findings.push({ rule: 'unknown-token', file, line: t.line, message: `include cycle: ${[...stack, target].join(' → ')}` })
        continue
      }
      if (t.token.asFile && (context !== 'skill' && context !== 'fork' || stack.length > 1)) {
        findings.push({ rule: 'token-context', file, line: t.line, message: 'as-file includes belong in a skill body' })
        continue
      }
      reach(target, t.token.asFile ? (context === 'fork' ? 'fork-file' : 'as-file') : context, [...stack, target])
    }
  }
  // A leaf is an agent something delegates to or forks onto: it does one job and returns.
  const leaves = new Set<string>()
  for (const scan of scans.values()) for (const t of scan.tokens) if (t.token.kind === 'delegate-open') leaves.add(t.token.agent)
  for (const [name, file] of lay.skills) {
    const fork = parseSkill(file, name, source.get(file)!, 'claude').meta?.forkAgent
    if (fork) leaves.add(fork)
  }
  for (const [, file] of lay.skills) reach(file, forks.has(file) ? 'fork' : 'skill', [file])
  for (const [name, file] of lay.agents) reach(file, leaves.has(name) ? 'leaf' : 'agent', [file])
  for (const [file, set] of contexts) {
    const scan = scans.get(file)
    if (scan) findings.push(...tokenContexts(file, scan, set))
  }

  const closure = (start: string): ReadonlySet<string> => {
    const seen = new Set<string>()
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const t of scans.get(file)?.tokens ?? []) if (t.token.kind === 'include') walk(t.token.path)
    }
    walk(start)
    return seen
  }
  findings.push(...lintRegistry({ source, scans, skills: lay.skills, externalSkills: new Set(external?.skills ?? []), closure }))
  // Every skill the operator runs directly carries the core rules (the state root, the gates, secrets).
  if (source.has(CORE_RULES)) {
    for (const [name, file] of lay.skills) {
      if (!forks.has(file) && !closure(file).has(CORE_RULES)) {
        findings.push({ rule: 'core-rules', file, line: 0, message: `skill ${name} does not include ${CORE_RULES}` })
      }
    }
  }
  return { layout: lay, scans, findings }
}

/** The rules every directly-run skill includes, when the workflow defines them. */
const CORE_RULES = 'shared/core-rules.md'

/** Source rules only, without rendering (for tools that check a workflow without generating). */
export function lintWorkflow(
  source: WorkflowSource,
  toolNames: ReadonlySet<string> = new Set(manifestToolNames()),
  externalNames?: ExternalNames,
): Finding[] {
  return sortFindings(checkSource(source, toolNames, externalNames).findings)
}

export function generateFromSource(options: GenerateFromSourceOptions): Map<string, string> {
  const { pkg, source, harness, mcpEntry } = options
  const toolNames = options.toolNames ?? new Set(manifestToolNames())
  const checked = checkSource(source, toolNames, options.externalNames)
  const findings = checked.findings
  const target = targetFor(harness)
  if (!target) findings.push({ rule: 'no-target', file: '', line: 0, message: `no generator target for ${harness}` })

  const harnessFile = checked.layout.harnessFiles.get(harness) ?? `harness/${harness}.yaml`
  let harnessData: unknown
  if (target) {
    const raw = source.get(harnessFile)
    if (raw === undefined) findings.push({ rule: 'harness-data', file: harnessFile, line: 0, message: 'missing' })
    else {
      const parsed = parseYaml(raw)
      if ('error' in parsed) findings.push({ rule: 'harness-data', file: harnessFile, line: 0, message: parsed.error })
      else {
        harnessData = parsed.value
        findings.push(...target.checkHarnessData(harnessData, harnessFile))
      }
    }
  }
  if (findings.length > 0 || !target) throw new GeneratorError(sortFindings(findings))

  const registryText = source.get(REGISTRY_FILE)
  const askLayouts = askLayoutsOf(registryText)
  // An agent whose `harnesses` leaves this harness out is not shipped here, and nothing here may start or name it.
  const shippedAgents = new Map<string, ReturnType<typeof parseAgent>>()
  for (const [name, file] of checked.layout.agents) {
    const parsed = parseAgent(file, name, source.get(file)!, harness)
    const only = (parsed.meta as AgentMeta).harnesses
    if (!only || only.includes(harness)) shippedAgents.set(name, parsed)
  }
  const assertShipped = (agent: string) => {
    if (checked.layout.agents.has(agent) && !shippedAgents.has(agent)) throw new Error(`agent ${agent} is not shipped for ${harness} (its harnesses leave it out)`)
  }
  const guarded = (renderer: TokenRenderer): TokenRenderer => ({
    ...renderer,
    delegate: (agent, prompt) => {
      assertShipped(agent)
      return renderer.delegate(agent, prompt)
    },
    inline: (kind, name, inCode) => {
      if (kind === 'agent') assertShipped(name)
      return renderer.inline(kind, name, inCode)
    },
  })
  const render = (file: string, body: string, allowAsFile: boolean, skill?: string, renderer = guarded(target.renderer)) => {
    try {
      return renderText(body, {
        harness,
        renderer,
        shared: (p: string) => source.get(p),
        allowAsFile,
        askLayouts,
        ...(skill ? { skill } : { inAgent: true }),
      })
    } catch (err) {
      findings.push({ rule: 'render', file, line: 0, message: (err as Error).message })
      return { text: '', siblings: new Map<string, string>() }
    }
  }

  const skills: RenderedSkill[] = []
  for (const [name, file] of [...checked.layout.skills].sort(([a], [b]) => byCodePoint(a, b))) {
    const parsed = parseSkill(file, name, source.get(file)!, harness)
    const { text, siblings } = render(file, parsed.body, true, name)
    const forkBodies = new Map<string, string>()
    const fork = parsed.meta?.forkAgent
    if (fork !== undefined && checked.layout.agents.has(fork) && !shippedAgents.has(fork)) {
      findings.push({ rule: 'render', file, line: 0, message: `fork agent ${fork} is not shipped for ${harness} (its harnesses leave it out)` })
    }
    if (parsed.meta?.forkAgent !== undefined) {
      for (const [variant, renderer] of Object.entries(target.forkRenderers ?? {})) {
        forkBodies.set(variant, render(file, parsed.body, true, name, guarded(renderer)).text)
      }
    }
    skills.push({ name, meta: parsed.meta as SkillMeta, body: text, siblings, forkBodies })
  }
  const agents: RenderedAgent[] = []
  for (const [name, parsed] of [...shippedAgents].sort(([a], [b]) => byCodePoint(a, b))) {
    const file = checked.layout.agents.get(name)!
    agents.push({ name, meta: parsed.meta as AgentMeta, body: render(file, parsed.body, false).text })
    for (const tool of unreasonedPromptGrants(name, (parsed.meta as AgentMeta).tools)) {
      findings.push({ rule: 'leaf-grant', file, line: 0, message: `${tool} needs the operator's approval, which nobody can give an agent; record its allowed use or drop the grant` })
    }
  }
  findings.push(...(target.checkInput?.(skills, (name) => checked.layout.skills.get(name) ?? name, agents) ?? []))
  if (findings.length > 0) throw new GeneratorError(sortFindings(findings))

  const files = target.emit({ pkg, skills, agents, harnessData, ...(mcpEntry ? { mcpEntry } : {}), ...(options.settlement ? { settlement: true } : {}) })

  // Output rules.
  for (const skill of skills) {
    const p = target.skillPath(skill.name)
    const dir = p.slice(0, p.lastIndexOf('/') + 1)
    const skillFiles = [...files].filter(([f]) => f.startsWith(dir) && !f.slice(dir.length).includes('/')).map(([, c]) => c)
    const head = files.get(p) ?? ''
    findings.push(...sizeBudget(p, head), ...askCues(p, head, harness, head, askLayouts), ...protocolIncludes(p, skillFiles))
    for (const [f, content] of files) {
      if (f !== p && f.startsWith(dir) && !f.slice(dir.length).includes('/') && f.endsWith('.md')) findings.push(...askCues(f, content, harness, head, askLayouts))
    }
  }
  for (const agent of agents) {
    findings.push(...protocolIncludes(`agents/${agent.name}`, [agent.body]))
    // An agent that asks, whatever form its questions take, carries both gate rules.
    if (/`\[prompt: [a-z0-9-]+\]`/.test(agent.body)) {
      for (const rule of [ASKING_RULE, DISMISSAL_RULE]) {
        if (!agent.body.includes(rule)) findings.push({ rule: 'ask-line', file: `agents/${agent.name}`, line: 0, message: `questions without the rule "${rule}"` })
      }
    }
  }
  for (const [p, content] of files) {
    for (const line of unrenderedTokenLines(content)) findings.push({ rule: 'unrendered-token', file: p, line, message: 'token syntax left in the output' })
    findings.push(...tokenStore(p, content))
    if (harness !== 'claude') findings.push(...claudeLiteralsInOutput(p, content, harness))
    if (harness === 'opencode' && p.endsWith('.md')) findings.push(...openCodeTemplateSafety(p, content))
    if (content.includes('\r') || !content.endsWith('\n')) findings.push({ rule: 'output-format', file: p, line: 0, message: 'output must be LF-only and end with a newline' })
  }
  findings.push(...target.checkOutput(files))
  if (findings.length > 0) throw new GeneratorError(sortFindings(findings))

  const bundle = bundleJson(harness, pkg.version, treeHash(source), files)
  files.set(`${target.bundleRoot}/bundle.json`, `${JSON.stringify(bundle, null, 2)}\n`)
  return new Map([...files.keys()].sort(byCodePoint).map((p) => [p, files.get(p)!]))
}
