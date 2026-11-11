/**
 * The prompt registry, `shared/prompts.yaml`: every question the workflow asks, with what it
 * decides. A method reviewer reads it to check that every mandatory prompt is asked, shown after
 * its table, and written only after the reply; the lint holds the workflow to it. A question owned
 * by a skill that is not in the workflow yet may be registered before anything asks it: it is
 * pending until that skill moves in.
 *
 *   prompts:
 *     - id: discovery-confirm            the {{#ask id=…}} id
 *       skill: threat-model              the skill that owns the question
 *       mandatory: true
 *       when: "…"                        the trigger
 *       after: "…"                       what is rendered before the question
 *       decides: "…"                     the write or tool call the answer authorises
 *       options: [confirm, change]       a closed answer set — or `free_text: true`
 *       requires: ["…", …]               phrases the question text must contain; "a | b" is met by any one of them
 *       table: true                      what it follows is a table (Claude checks it was written)
 *       message: true                    asked in one message on every harness: its reply may carry facts
 *
 *   groups:                              questions a phase asks together, in one dialog
 *     - name: discovery                  the phase files name it: Group `discovery`
 *       harnesses: [claude]              where it is asked as a group; elsewhere one question at a time
 *       members: [discovery-confirm, …]  1 to 4 registered questions, in the order asked
 *       repeat: 3                        a single member asked up to this many times, once per subject
 */

import { parseYaml } from './frontmatter.js'
import type { ScanResult } from './tokens.js'
import type { AskLayout } from './ask-cues.js'
import { type Finding, HARNESSES, NAME_PATTERN, type WorkflowSource } from './types.js'

export const REGISTRY_FILE = 'shared/prompts.yaml'

export interface PromptEntry {
  readonly id: string
  readonly skill: string
  readonly mandatory: boolean
  readonly when: string
  readonly after: string
  readonly decides: string
  readonly options?: readonly string[]
  readonly freeText: boolean
  readonly requires: readonly string[]
  /** What the question follows is a table, which must be shown as text before it. */
  readonly table: boolean
  /** Asked in one message on every harness, never a dialog: its reply may carry facts in free text. */
  readonly message: boolean
}

const KEYS = ['id', 'skill', 'mandatory', 'when', 'after', 'decides', 'options', 'free_text', 'requires', 'table', 'message']
const ASK_BODY = /\{\{#ask id=([a-z0-9-]+)( text)?\}\}([\s\S]*?)\{\{\/ask\}\}/g

/** Questions a phase asks together, in one dialog, on the harnesses named. */
export interface PromptGroup {
  readonly name: string
  readonly harnesses: readonly string[]
  readonly members: readonly string[]
  /** A single member asked up to this many times in one dialog, once per subject. */
  readonly repeat?: number
}

const GROUP_KEYS = ['name', 'harnesses', 'members', 'repeat']
const NAME_WORDS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseRegistry(text: string): { entries: PromptEntry[]; groups: PromptGroup[]; findings: Finding[] } {
  const findings: Finding[] = []
  const add = (message: string) => findings.push({ rule: 'registry', file: REGISTRY_FILE, line: 0, message })
  const parsed = parseYaml(text)
  if ('error' in parsed) return { entries: [], groups: [], findings: [{ rule: 'registry', file: REGISTRY_FILE, line: 0, message: `does not parse: ${parsed.error}` }] }
  const doc = parsed.value as { prompts?: unknown; groups?: unknown } | null
  if (!doc || typeof doc !== 'object' || Object.keys(doc).some((k) => k !== 'prompts' && k !== 'groups') || !Array.isArray(doc.prompts)) {
    add('must be a mapping with a `prompts` list and, optionally, a `groups` list')
    return { entries: [], groups: [], findings }
  }
  const entries: PromptEntry[] = []
  const seen = new Set<string>()
  for (const [i, raw] of (doc.prompts as unknown[]).entries()) {
    const e = raw as Record<string, unknown>
    const where = `prompt ${i + 1}${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`
    if (!e || typeof e !== 'object') {
      add(`${where} must be a mapping`)
      continue
    }
    for (const key of Object.keys(e)) if (!KEYS.includes(key)) add(`${where}: unknown key ${key}`)
    const str = (k: string) => typeof e[k] === 'string' && (e[k] as string).trim().length > 0
    if (!(typeof e.id === 'string' && NAME_WORDS.test(e.id))) add(`${where}: id must be lowercase words joined by hyphens`)
    else if (seen.has(e.id)) add(`${where}: id registered twice`)
    else seen.add(e.id)
    if (!(typeof e.skill === 'string' && NAME_PATTERN.test(e.skill))) add(`${where}: skill must be a skill name`)
    if (typeof e.mandatory !== 'boolean') add(`${where}: mandatory must be true or false`)
    for (const k of ['when', 'after', 'decides']) if (!str(k)) add(`${where}: ${k} must be a non-empty string`)
    const options = e.options
    const hasOptions = Array.isArray(options) && options.length >= 2 && options.every((o) => typeof o === 'string' && o.trim())
    if (options !== undefined && !hasOptions) add(`${where}: options must list at least two answers`)
    if (e.free_text !== undefined && e.free_text !== true) add(`${where}: free_text, when given, must be true`)
    if ((e.free_text === true) === hasOptions) add(`${where}: give either options (a closed answer set) or free_text: true`)
    if (e.table !== undefined && e.table !== true) add(`${where}: table, when given, must be true`)
    if (e.table === true && !/\btables?\b/.test(String(e.after ?? ''))) add(`${where}: table: true, but what it follows (after) names no table`)
    if (e.table === true && e.free_text === true) add(`${where}: a free-text question is a plain message that carries its table; table applies to choices only`)
    if (e.message !== undefined && e.message !== true) add(`${where}: message, when given, must be true`)
    if (e.message === true && e.free_text === true) add(`${where}: a free-text question is a plain message already; message applies to choices only`)
    if (e.message === true && e.table === true) add(`${where}: give table or message, not both: message already asks in one message`)
    // A dialog covers what came before it, so a choice that follows a table asks in a plain message (outside a question group).
    if (e.table === undefined && e.message === undefined && e.free_text !== true && hasOptions && /\btables?\b/.test(String(e.after ?? ''))) add(`${where}: what it follows (after) names a table, so it needs table: true`)
    const requires = e.requires ?? []
    if (!(Array.isArray(requires) && requires.every((r) => typeof r === 'string' && r.trim()))) add(`${where}: requires must be a list of phrases`)
    if (typeof e.id === 'string' && typeof e.skill === 'string') {
      entries.push({
        id: e.id,
        skill: e.skill,
        mandatory: e.mandatory === true,
        when: String(e.when ?? ''),
        after: String(e.after ?? ''),
        decides: String(e.decides ?? ''),
        ...(hasOptions ? { options: options as string[] } : {}),
        freeText: e.free_text === true,
        requires: Array.isArray(requires) ? (requires as string[]) : [],
        table: e.table === true,
        message: e.message === true,
      })
    }
  }
  const groups: PromptGroup[] = []
  if (doc.groups !== undefined && !Array.isArray(doc.groups)) add('groups must be a list')
  for (const [i, raw] of (Array.isArray(doc.groups) ? (doc.groups as unknown[]) : []).entries()) {
    const g = raw as Record<string, unknown>
    const where = `group ${i + 1}${g && typeof g.name === 'string' ? ` (${g.name})` : ''}`
    if (!g || typeof g !== 'object') {
      add(`${where} must be a mapping`)
      continue
    }
    for (const key of Object.keys(g)) if (!GROUP_KEYS.includes(key)) add(`${where}: unknown key ${key}`)
    const list = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null)
    const harnesses = list(g.harnesses)
    const members = list(g.members)
    if (!(typeof g.name === 'string' && NAME_WORDS.test(g.name))) add(`${where}: name must be lowercase words joined by hyphens`)
    else if (groups.some((o) => o.name === g.name)) add(`${where}: name registered twice`)
    if (!harnesses?.length || harnesses.some((h) => !(HARNESSES as readonly string[]).includes(h))) add(`${where}: harnesses must be one or more of ${HARNESSES.join(', ')}`)
    if (!members?.length || members.length > 4 || new Set(members).size !== members.length) add(`${where}: members must be 1 to 4 distinct question ids`)
    for (const m of members ?? []) {
      if (!seen.has(m)) add(`${where}: ${m} is not a registered question`)
      else if (groups.some((o) => o.members.includes(m))) add(`${where}: ${m} is in another group too`)
    }
    if (g.repeat !== undefined && !(Number.isInteger(g.repeat) && (g.repeat as number) >= 2 && (g.repeat as number) <= 4 && members?.length === 1)) add(`${where}: repeat is 2 to 4, for a group of one member`)
    if (typeof g.name === 'string' && harnesses && members) groups.push({ name: g.name, harnesses, members, ...(Number.isInteger(g.repeat) ? { repeat: g.repeat as number } : {}) })
  }
  return { entries, groups, findings }
}

/** How each registered choice is asked, for the renderers and the ask lint; unlisted ids are dialogs. */
export function askLayoutsOf(registryText: string | undefined): ReadonlyMap<string, AskLayout> {
  const entries = registryText === undefined ? [] : parseRegistry(registryText).entries
  return new Map(entries.flatMap((e): Array<[string, AskLayout]> => (e.message ? [[e.id, 'message']] : e.table ? [[e.id, 'table']] : [])))
}

export interface RegistryContext {
  readonly source: WorkflowSource
  readonly scans: ReadonlyMap<string, ScanResult>
  /** Workflow skills by name → their SKILL.md path. */
  readonly skills: ReadonlyMap<string, string>
  /** Skills that exist outside the workflow (not yet migrated). */
  readonly externalSkills: ReadonlySet<string>
  /** Every file a skill's text reaches through includes, the skill itself included. */
  readonly closure: (file: string) => ReadonlySet<string>
}

/** Every ask in the workflow: id → where it is asked, whether free text, and its question text. */
function asksOf(ctx: RegistryContext): Map<string, Array<{ file: string; line: number; freeText: boolean; question: string }>> {
  const out = new Map<string, Array<{ file: string; line: number; freeText: boolean; question: string }>>()
  for (const [file, text] of ctx.source) {
    const scan = ctx.scans.get(file)
    if (!scan) continue
    const bodies = [...text.matchAll(ASK_BODY)].map((m) => m[3]!)
    let n = 0
    for (const t of scan.tokens) {
      if (t.token.kind !== 'ask-open') continue
      const list = out.get(t.token.id) ?? []
      list.push({ file, line: t.line, freeText: t.token.freeText, question: bodies[n++] ?? '' })
      out.set(t.token.id, list)
    }
  }
  return out
}

export function lintRegistry(ctx: RegistryContext): Finding[] {
  const asks = asksOf(ctx)
  const text = ctx.source.get(REGISTRY_FILE)
  if (text === undefined) {
    return asks.size === 0 ? [] : [{ rule: 'registry', file: REGISTRY_FILE, line: 0, message: `missing, but the workflow asks ${asks.size} question(s)` }]
  }
  const { entries, findings } = parseRegistry(text)
  const add = (message: string, file = REGISTRY_FILE, line = 0) => findings.push({ rule: 'registry', file, line, message })
  const byId = new Map(entries.map((e) => [e.id, e]))

  for (const [id, uses] of asks) {
    const entry = byId.get(id)
    if (!entry) {
      for (const u of uses) add(`question ${id} is not registered in ${REGISTRY_FILE}`, u.file, u.line)
      continue
    }
    for (const u of uses) {
      if (u.freeText !== entry.freeText) add(`question ${id} is ${u.freeText ? 'free text' : 'a choice'} here but registered as ${entry.freeText ? 'free text' : 'a choice'}`, u.file, u.line)
      const normal = u.question.replace(/\s+/g, ' ').toLowerCase()
      for (const phrase of entry.requires) {
        const alternatives = phrase.split(' | ').map((p) => p.replace(/\s+/g, ' ').toLowerCase())
        if (!alternatives.some((p) => normal.includes(p))) add(`question ${id} must contain "${phrase}"`, u.file, u.line)
      }
    }
  }
  for (const entry of entries) {
    const uses = asks.get(entry.id)
    const skillFile = ctx.skills.get(entry.skill)
    if (!skillFile && !ctx.externalSkills.has(entry.skill)) {
      add(`question ${entry.id}: no skill named ${entry.skill}`)
      continue
    }
    if (!uses) {
      // A question whose owner has not moved into the workflow yet is pending, not missing.
      if (skillFile) add(`registered question ${entry.id} is asked nowhere in the workflow`)
      continue
    }
    // Once the owner is in the workflow, its own text must reach the question — an agent or
    // another skill asking it does not count for the owner.
    if (skillFile) {
      const reach = ctx.closure(skillFile)
      if (!uses.some((u) => reach.has(u.file))) add(`question ${entry.id} is owned by ${entry.skill}, which never asks it`)
    }
  }
  return findings
}
