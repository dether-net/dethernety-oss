/**
 * The workflow's layout and its neutral frontmatter.
 *
 *   skills/<name>/SKILL.md   agents/<name>.md   shared/**.md   harness/<harness>.yaml
 *
 * Frontmatter may hold harness blocks, so it is parsed once per harness. A key or tool entry
 * that only one harness understands must sit in a block for that harness alone.
 */

import { parseYaml, splitFrontmatter } from './frontmatter.js'
import { filterHarness } from './tokens.js'
import { type Finding, type Harness, HARNESSES, NAME_PATTERN, type WorkflowSource } from './types.js'

/** The neutral tool vocabulary; anything else in a tools list is a harness literal. */
export const TOOL_GROUPS = ['fs-read', 'fs-search', 'fs-write', 'shell'] as const
export type ToolGroup = (typeof TOOL_GROUPS)[number]

export type Effort = 'low' | 'medium' | 'high'
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high']
const MEMORY = ['user', 'project', 'local'] as const

const SKILL_KEYS = ['name', 'description', 'argument-hint', 'allowed-tools', 'context', 'agent']
const AGENT_KEYS = ['name', 'description', 'effort', 'maxTurns', 'memory', 'tools', 'harnesses']

/** Documented keys a harness understands that have no neutral meaning, passed through as written. */
export const OWN_KEYS: Readonly<Record<Harness, { readonly skill: readonly string[]; readonly agent: readonly string[] }>> = {
  claude: {
    skill: ['when_to_use', 'disable-model-invocation', 'user-invocable', 'model'],
    agent: ['disallowedTools', 'skills', 'background', 'isolation', 'color', 'omitClaudeMd'],
  },
  codex: { skill: [], agent: [] },
  opencode: { skill: [], agent: [] },
}

export interface SkillMeta {
  readonly name: string
  readonly description: string
  readonly argumentHint?: string
  readonly allowedTools?: readonly string[]
  /** `context: fork` with this workflow agent. */
  readonly forkAgent?: string
  /** Harness-only keys in source order. */
  readonly own: ReadonlyArray<readonly [string, unknown]>
}

export interface AgentMeta {
  readonly name: string
  readonly description: string
  readonly effort?: Effort
  readonly maxTurns?: number
  readonly memory?: (typeof MEMORY)[number]
  readonly tools: readonly string[]
  /** The harnesses whose bundles ship this agent; absent, every harness. */
  readonly harnesses?: readonly Harness[]
  readonly own: ReadonlyArray<readonly [string, unknown]>
}

export interface Layout {
  readonly skills: ReadonlyMap<string, string>
  readonly agents: ReadonlyMap<string, string>
  readonly shared: readonly string[]
  readonly harnessFiles: ReadonlyMap<Harness, string>
  readonly findings: readonly Finding[]
}

/** Sorts the workflow's files into their roles; anything else is a finding. */
export function layout(source: WorkflowSource): Layout {
  const skills = new Map<string, string>()
  const agents = new Map<string, string>()
  const shared: string[] = []
  const harnessFiles = new Map<Harness, string>()
  const findings: Finding[] = []
  const add = (file: string, message: string) => findings.push({ rule: 'layout', file, line: 0, message })

  for (const file of source.keys()) {
    let m: RegExpMatchArray | null
    if ((m = file.match(/^skills\/([^/]+)\/SKILL\.md$/))) {
      if (NAME_PATTERN.test(m[1]!)) skills.set(m[1]!, file)
      else add(file, `bad skill name ${m[1]}`)
    } else if ((m = file.match(/^agents\/([^/]+)\.md$/))) {
      if (NAME_PATTERN.test(m[1]!)) agents.set(m[1]!, file)
      else add(file, `bad agent name ${m[1]}`)
    } else if (/^shared\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.md$/.test(file)) {
      shared.push(file)
    } else if (file === 'shared/prompts.yaml') {
      // The prompt registry: read by the registry lint.
    } else if ((m = file.match(/^harness\/([a-z]+)\.yaml$/)) && (HARNESSES as readonly string[]).includes(m[1]!)) {
      harnessFiles.set(m[1] as Harness, file)
    } else {
      add(file, 'not a skill, agent, shared fragment or harness file')
    }
  }
  return { skills, agents, shared: shared.sort(), harnessFiles, findings }
}

interface Parsed<M> {
  readonly meta?: M
  readonly body: string
  readonly findings: readonly Finding[]
  /** Keys present in this harness's view, for cross-harness checks. */
  readonly keys: readonly string[]
  /** Tool entries (tools / allowed-tools) that are not in the vocabulary. */
  readonly literals: readonly string[]
}

function isVocabulary(entry: string): boolean {
  return (TOOL_GROUPS as readonly string[]).includes(entry) || /^mcp:(\*|[a-z][a-z0-9_]*)$/.test(entry)
}

function frontmatterOf(file: string, text: string, harness: Harness) {
  const findings: Finding[] = []
  const add = (message: string) => findings.push({ rule: 'frontmatter', file, line: 1, message })
  const split = splitFrontmatter(filterHarness(text, harness))
  if (split.yaml === null) {
    add('missing frontmatter')
    return { findings, add, body: split.body, doc: null }
  }
  const parsed = parseYaml(split.yaml)
  if ('error' in parsed) {
    add(`frontmatter does not parse (${harness}): ${parsed.error}`)
    return { findings, add, body: split.body, doc: null }
  }
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    add('frontmatter is not a mapping')
    return { findings, add, body: split.body, doc: null }
  }
  return { findings, add, body: split.body, doc: parsed.value as Record<string, unknown> }
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0) ? value : null
}

function checkKeys(doc: Record<string, unknown>, neutral: readonly string[], own: readonly string[], add: (m: string) => void) {
  for (const key of Object.keys(doc)) {
    if (!neutral.includes(key) && !own.includes(key)) add(`unknown frontmatter key ${key}`)
  }
}

function ownEntries(doc: Record<string, unknown>, own: readonly string[]): Array<[string, unknown]> {
  return Object.entries(doc).filter(([k]) => own.includes(k))
}

export function parseSkill(file: string, name: string, text: string, harness: Harness): Parsed<SkillMeta> {
  const { findings, add, body, doc } = frontmatterOf(file, text, harness)
  if (!doc) return { body, findings, keys: [], literals: [] }
  checkKeys(doc, SKILL_KEYS, OWN_KEYS[harness].skill, add)

  if (doc.name !== name) add(`name must be ${name}, the skill's directory`)
  if (typeof doc.description !== 'string' || !doc.description.trim()) add('description must be a non-empty string')
  if (doc['argument-hint'] !== undefined && typeof doc['argument-hint'] !== 'string') add('argument-hint must be a string')
  let allowedTools: string[] | undefined
  if (doc['allowed-tools'] !== undefined) {
    allowedTools = stringList(doc['allowed-tools']) ?? undefined
    if (!allowedTools) add('allowed-tools must be a non-empty list of strings')
  }
  if (doc.context !== undefined && doc.context !== 'fork') add('context may only be fork')
  if (doc.context === 'fork' && typeof doc.agent !== 'string') add('context: fork needs an agent')
  if (doc.agent !== undefined && doc.context !== 'fork') add('agent is only meaningful with context: fork')
  if (doc.agent !== undefined && (typeof doc.agent !== 'string' || !NAME_PATTERN.test(doc.agent))) add('agent must be a workflow agent name')

  const meta: SkillMeta = {
    name,
    description: String(doc.description ?? ''),
    ...(typeof doc['argument-hint'] === 'string' ? { argumentHint: doc['argument-hint'] } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(doc.context === 'fork' && typeof doc.agent === 'string' ? { forkAgent: doc.agent } : {}),
    own: ownEntries(doc, OWN_KEYS[harness].skill),
  }
  return { meta, body, findings, keys: Object.keys(doc), literals: (allowedTools ?? []).filter((t) => !isVocabulary(t)) }
}

export function parseAgent(file: string, name: string, text: string, harness: Harness): Parsed<AgentMeta> {
  const { findings, add, body, doc } = frontmatterOf(file, text, harness)
  if (!doc) return { body, findings, keys: [], literals: [] }
  checkKeys(doc, AGENT_KEYS, OWN_KEYS[harness].agent, add)

  if (doc.name !== name) add(`name must be ${name}, the agent's file name`)
  if (typeof doc.description !== 'string' || !doc.description.trim()) add('description must be a non-empty string')
  if (doc.effort !== undefined && !EFFORTS.includes(doc.effort as Effort)) add(`effort must be one of ${EFFORTS.join(', ')}`)
  if (doc.maxTurns !== undefined && !(Number.isInteger(doc.maxTurns) && (doc.maxTurns as number) > 0)) add('maxTurns must be a positive integer')
  if (doc.memory !== undefined && !(MEMORY as readonly unknown[]).includes(doc.memory)) add(`memory must be one of ${MEMORY.join(', ')}`)
  const tools = stringList(doc.tools)
  if (!tools) add('tools must be a non-empty list of strings')
  const harnesses = doc.harnesses === undefined ? undefined : stringList(doc.harnesses)
  if (harnesses === null || harnesses?.some((h) => !(HARNESSES as readonly string[]).includes(h))) add(`harnesses must be a non-empty list of ${HARNESSES.join(', ')}`)

  const meta: AgentMeta = {
    name,
    description: String(doc.description ?? ''),
    ...(EFFORTS.includes(doc.effort as Effort) ? { effort: doc.effort as Effort } : {}),
    ...(Number.isInteger(doc.maxTurns) ? { maxTurns: doc.maxTurns as number } : {}),
    ...((MEMORY as readonly unknown[]).includes(doc.memory) ? { memory: doc.memory as AgentMeta['memory'] } : {}),
    tools: tools ?? [],
    ...(harnesses ? { harnesses: harnesses as Harness[] } : {}),
    own: ownEntries(doc, OWN_KEYS[harness].agent),
  }
  return { meta, body, findings, keys: Object.keys(doc), literals: (tools ?? []).filter((t) => !isVocabulary(t)) }
}

/** `mcp:<tool>` entries of a tools list (not the wildcard). */
export function mcpToolsOf(entries: readonly string[]): string[] {
  return entries.filter((t) => /^mcp:[a-z]/.test(t)).map((t) => t.slice(4))
}

/**
 * Cross-harness frontmatter rules: a harness-only key, and a tool literal, must each be visible
 * to exactly one harness — that is, sit in a block for that harness alone.
 */
export function crossHarnessFindings(
  file: string,
  kind: 'skill' | 'agent',
  views: ReadonlyMap<Harness, { keys: readonly string[]; literals: readonly string[] }>,
): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()
  const add = (message: string) => {
    if (seen.has(message)) return
    seen.add(message)
    findings.push({ rule: 'frontmatter', file, line: 1, message })
  }
  for (const [harness, view] of views) {
    const own = OWN_KEYS[harness][kind]
    for (const key of view.keys.filter((k) => own.includes(k))) {
      const leaks = [...views].filter(([h, v]) => h !== harness && v.keys.includes(key)).map(([h]) => h)
      if (leaks.length) add(`${key} is a ${harness}-only key but ${leaks.join(', ')} also see it; put it in a {{#harness ${harness}}} block`)
    }
    for (const literal of view.literals) {
      const others = [...views].filter(([h, v]) => h !== harness && v.literals.includes(literal)).map(([h]) => h)
      if (others.length) add(`tool entry ${literal} is not in the neutral vocabulary and is visible to ${[harness, ...others].join(', ')}; put it in a single-harness block`)
    }
  }
  return findings
}
