/**
 * The rule ledger: every rule extracted from the prose a workflow was migrated from is either
 * placed — its anchor phrase present in every consumer's generated output, for every harness in
 * scope — or dropped with a reason. Nothing disappears in a rewrite without a record.
 *
 * - `ledger/baseline.json` records the denominator: each source's git blob id (so its text stays
 *   retrievable after the source is deleted) and its rule count.
 * - `ledger/<dir>-<name>.yaml`, one per source, holds its rules by id and line. Rule text is not
 *   copied; `--ledger-show` prints it from the source.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import { parseYaml } from './frontmatter.js'
import { generate } from './index.js'
import { extractRules, type Rule } from './rules.js'
import { byCodePoint, normaliseNewlines, readWorkflow } from './source.js'
import { targetFor } from './targets/index.js'
import { filterHarness, renderText, scanTokens } from './tokens.js'
import type { Target } from './targets/types.js'
import { type Finding, type Harness, HARNESSES, type PackageInfo, type WorkflowSource } from './types.js'

export const LEDGER_DIR = 'src/generator/ledger'
export const BASELINE_FILE = `${LEDGER_DIR}/baseline.json`

/** Where the prose being migrated lives, relative to the package root. */
export function listSources(pkgRoot: string): string[] {
  const out: string[] = []
  const skills = path.join(pkgRoot, 'skills')
  if (existsSync(skills)) {
    for (const name of readdirSync(skills)) if (existsSync(path.join(skills, name, 'SKILL.md'))) out.push(`skills/${name}/SKILL.md`)
  }
  for (const dir of ['agents', 'docs']) {
    const abs = path.join(pkgRoot, dir)
    if (existsSync(abs)) for (const name of readdirSync(abs)) if (name.endsWith('.md')) out.push(`${dir}/${name}`)
  }
  return out.sort(byCodePoint)
}

/** Skills and agents still in the pre-migration tree, which workflow tokens may reference. */
export function legacyNames(pkgRoot: string): { skills: Set<string>; agents: Set<string> } {
  const sources = listSources(pkgRoot)
  return {
    skills: new Set(sources.flatMap((p) => p.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1] ?? [])),
    agents: new Set(sources.flatMap((p) => p.match(/^agents\/([^/]+)\.md$/)?.[1] ?? [])),
  }
}

/** The ledger file for a source: `skills/a/SKILL.md` → `skills-a.yaml`, `agents/b.md` → `agents-b.yaml`. */
export function ledgerFileFor(source: string): string {
  const m = source.match(/^skills\/([^/]+)\/SKILL\.md$/) ?? source.match(/^(?:agents|docs)\/([^/]+)\.md$/)
  if (!m) throw new Error(`not a ledger source: ${source}`)
  return `${source.split('/')[0]}-${m[1]}.yaml`
}

/** git's object id for a blob with this (LF) content. */
export function gitBlobId(content: string): string {
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

export interface Baseline {
  readonly total: number
  readonly sources: Readonly<Record<string, { readonly blob: string; readonly rules: number }>>
}

export function computeBaseline(sources: ReadonlyMap<string, string>): Baseline {
  const entries = [...sources.keys()].sort(byCodePoint).map((p) => {
    const text = normaliseNewlines(sources.get(p)!)
    return [p, { blob: gitBlobId(text), rules: extractRules(text).length }] as const
  })
  return { total: entries.reduce((n, [, e]) => n + e.rules, 0), sources: Object.fromEntries(entries) }
}

export interface PlacedRule {
  readonly id: string
  readonly line: number
  readonly anchor: string
  readonly destination: string
  /** Omitted: every skill or agent whose output includes the destination (see derivedConsumers). */
  readonly consumers?: readonly string[]
  readonly harnesses?: readonly Harness[]
}
export interface DroppedRule {
  readonly id: string
  readonly line: number
  readonly dropped: { readonly reason: string; readonly ref: string }
}
export interface PendingRule {
  readonly id: string
  readonly line: number
}
export type LedgerRule = PlacedRule | DroppedRule | PendingRule

export interface LedgerDoc {
  readonly source: string
  readonly blob: string
  readonly migrated: boolean
  readonly rules: readonly LedgerRule[]
}

const isPlaced = (r: LedgerRule): r is PlacedRule => 'anchor' in r
const isDropped = (r: LedgerRule): r is DroppedRule => 'dropped' in r

/** Matching ignores case, whitespace, backticks and emphasis markers. */
export function normaliseForMatch(text: string): string {
  return text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const RULE_KEYS = ['id', 'line', 'anchor', 'destination', 'consumers', 'harnesses', 'dropped']

/** Parses and shape-checks one ledger file. */
export function parseLedger(file: string, text: string): { doc?: LedgerDoc; findings: Finding[] } {
  const findings: Finding[] = []
  const add = (message: string) => findings.push({ rule: 'ledger', file, line: 0, message })
  const parsed = parseYaml(text)
  if ('error' in parsed) {
    add(`does not parse: ${parsed.error}`)
    return { findings }
  }
  const v = parsed.value as Record<string, unknown> | null
  if (!v || typeof v !== 'object') {
    add('must be a mapping')
    return { findings }
  }
  for (const key of Object.keys(v)) if (!['source', 'blob', 'migrated', 'rules'].includes(key)) add(`unknown key ${key}`)
  if (typeof v.source !== 'string') add('source must be a string')
  if (typeof v.blob !== 'string' || !/^[0-9a-f]{40}$/.test(v.blob)) add('blob must be a git blob id')
  if (typeof v.migrated !== 'boolean') add('migrated must be true or false')
  if (!Array.isArray(v.rules)) {
    add('rules must be a list')
    return { findings }
  }
  const rules: LedgerRule[] = []
  for (const [i, raw] of (v.rules as unknown[]).entries()) {
    const r = raw as Record<string, unknown>
    const where = `rule ${i + 1}${r && typeof r.id === 'string' ? ` (${r.id})` : ''}`
    if (!r || typeof r !== 'object') {
      add(`${where} must be a mapping`)
      continue
    }
    for (const key of Object.keys(r)) if (!RULE_KEYS.includes(key)) add(`${where}: unknown key ${key}`)
    if (typeof r.id !== 'string' || !Number.isInteger(r.line)) {
      add(`${where}: needs id and line`)
      continue
    }
    const placedKeys = ['anchor', 'destination', 'consumers', 'harnesses'].filter((k) => k in r)
    if (placedKeys.length && 'dropped' in r) add(`${where}: is both placed and dropped`)
    if ('dropped' in r) {
      const d = r.dropped as Record<string, unknown> | null
      if (!d || typeof d.reason !== 'string' || d.reason.trim().length < 10) add(`${where}: dropped needs a reason of at least 10 characters`)
      if (!d || typeof d.ref !== 'string' || !d.ref.trim()) add(`${where}: dropped needs a ref (a package path or a public document)`)
      rules.push({ id: r.id, line: r.line as number, dropped: { reason: String(d?.reason ?? ''), ref: String(d?.ref ?? '') } })
    } else if (placedKeys.length) {
      const consumers = r.consumers
      const harnesses = r.harnesses
      if (typeof r.anchor !== 'string' || normaliseForMatch(r.anchor).split(' ').length < 3) add(`${where}: anchor must be a phrase of at least 3 words`)
      if (typeof r.destination !== 'string') add(`${where}: destination must be a workflow path`)
      if (consumers !== undefined && !(Array.isArray(consumers) && consumers.length > 0 && consumers.every((c) => typeof c === 'string' && /^(skill|agent):[a-z0-9-]+$/.test(c)))) {
        add(`${where}: consumers, when given, must be a non-empty list of skill:<name> / agent:<name>`)
      }
      if (harnesses !== undefined && !(Array.isArray(harnesses) && harnesses.length > 0 && harnesses.every((h) => (HARNESSES as readonly unknown[]).includes(h)))) {
        add(`${where}: harnesses must list ${HARNESSES.join(', ')}`)
      }
      rules.push({
        id: r.id,
        line: r.line as number,
        anchor: String(r.anchor ?? ''),
        destination: String(r.destination ?? ''),
        ...(Array.isArray(consumers) ? { consumers: consumers as string[] } : {}),
        ...(Array.isArray(harnesses) ? { harnesses: harnesses as Harness[] } : {}),
      })
    } else {
      rules.push({ id: r.id, line: r.line as number })
    }
  }
  if (findings.length) return { findings }
  return { doc: { source: v.source as string, blob: v.blob as string, migrated: v.migrated as boolean, rules }, findings }
}

/** Rendered text per consumer (`skill:x` → the skill and its siblings, `agent:x` → the agent file). */
export type ConsumerOutputs = ReadonlyMap<string, string>

export function consumerOutputs(files: ReadonlyMap<string, string>, target: Target, workflow: WorkflowSource): ConsumerOutputs {
  const out = new Map<string, string>()
  for (const p of workflow.keys()) {
    const skill = p.match(/^skills\/([^/]+)\/SKILL\.md$/)
    if (skill) {
      const dir = path.posix.dirname(target.skillPath(skill[1]!))
      out.set(`skill:${skill[1]}`, [...files].filter(([f]) => path.posix.dirname(f) === dir).map(([, c]) => c).join('\n'))
    }
    const agent = p.match(/^agents\/([^/]+)\.md$/)
    if (agent) {
      const content = files.get(target.agentPath(agent[1]!)) ?? ''
      out.set(`agent:${agent[1]}`, target.agentText ? target.agentText(content) : content)
    }
  }
  return out
}

/** Every shared file rendered on its own for one harness, for rules no skill or agent consumes yet. */
export function renderStandalone(workflow: WorkflowSource, target: Target): Map<string, string> {
  const out = new Map<string, string>()
  for (const [p, text] of workflow) {
    if (!p.startsWith('shared/') || !p.endsWith('.md')) continue
    try {
      out.set(p, renderText(text, { harness: target.harness, renderer: target.renderer, shared: (f) => workflow.get(f), allowAsFile: false }).text)
    } catch {
      out.set(p, '')
    }
  }
  return out
}

const consumerOf = (file: string): string | undefined => {
  const skill = file.match(/^skills\/([^/]+)\/SKILL\.md$/)
  if (skill) return `skill:${skill[1]}`
  const agent = file.match(/^agents\/([^/]+)\.md$/)
  return agent ? `agent:${agent[1]}` : undefined
}

/**
 * For each workflow file, the skills and agents whose output contains it: itself, or every includer,
 * transitively. With a harness, only includes that survive that harness's filtering count.
 */
export function derivedConsumers(workflow: WorkflowSource, harness?: Harness): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  const reach = (file: string, consumer: string, seen: ReadonlySet<string>) => {
    if (seen.has(file)) return
    const set = out.get(file) ?? new Set<string>()
    set.add(consumer)
    out.set(file, set)
    const raw = workflow.get(file)
    if (raw === undefined) return
    let text = raw
    if (harness) {
      try {
        text = filterHarness(raw, harness)
      } catch {
        // A malformed harness block is the generator lint's to report.
      }
    }
    for (const t of scanTokens(file, text).tokens) {
      if (t.token.kind === 'include') reach(t.token.path, consumer, new Set([...seen, file]))
    }
  }
  for (const file of workflow.keys()) {
    const consumer = consumerOf(file)
    if (consumer) reach(file, consumer, new Set())
  }
  return new Map([...out].map(([f, set]) => [f, [...set].sort(byCodePoint)]))
}

export interface LedgerInput {
  readonly baseline: Baseline
  /** Ledger files by file name. */
  readonly ledgers: ReadonlyMap<string, string>
  /** The sources that still exist, by package-relative path. */
  readonly sources: ReadonlyMap<string, string>
  /** The neutral workflow the rules moved into, if it exists. */
  readonly workflow?: WorkflowSource
  /** Per harness that has a generator target: rendered consumer outputs and standalone shared files. */
  readonly outputs: Partial<Record<Harness, ConsumerOutputs>>
  readonly standalone?: Partial<Record<Harness, ReadonlyMap<string, string>>>
  /** Whether a drop's `ref` path exists, relative to the OSS root (the public repository's root). */
  readonly refExists?: (ref: string) => boolean
}

export interface LedgerCounts {
  placed: number
  dropped: number
  pending: number
  /** Anchor checks skipped because the harness has no generator target. */
  unchecked: number
  /** Placed rules whose destination no skill or agent includes yet (checked standalone). */
  unconsumed: number
}

export interface LedgerReport {
  readonly findings: Finding[]
  readonly counts: LedgerCounts
}

export function checkLedgers(input: LedgerInput): LedgerReport {
  const findings: Finding[] = []
  const counts: LedgerCounts = { placed: 0, dropped: 0, pending: 0, unchecked: 0, unconsumed: 0 }
  const add = (file: string, message: string, line = 0) => findings.push({ rule: 'ledger', file, line, message })
  const baselined = input.baseline.sources
  const derived = input.workflow ? derivedConsumers(input.workflow) : new Map<string, string[]>()
  const derivedFor = new Map(HARNESSES.map((h) => [h, input.workflow ? derivedConsumers(input.workflow, h) : new Map<string, string[]>()]))

  // The baseline against the tree.
  for (const [source, text] of input.sources) {
    const entry = baselined[source]
    if (!entry) add(BASELINE_FILE, `${source} is not in the baseline; re-run the baseline`)
    else if (entry.blob !== gitBlobId(normaliseNewlines(text))) add(BASELINE_FILE, `${source} changed since the baseline; re-run the baseline`)
  }
  const docs = new Map<string, LedgerDoc>()
  for (const [file, text] of input.ledgers) {
    const parsed = parseLedger(file, text)
    findings.push(...parsed.findings)
    if (parsed.doc) docs.set(parsed.doc.source, parsed.doc)
    if (parsed.doc && ledgerFileFor(parsed.doc.source) !== file) add(file, `the ledger of ${parsed.doc.source} belongs in ${ledgerFileFor(parsed.doc.source)}`)
  }
  for (const source of Object.keys(baselined)) {
    if (!input.sources.has(source) && !docs.get(source)?.migrated) add(BASELINE_FILE, `${source} is gone but its ledger is missing or not migrated`)
  }

  const known = (consumer: string) => [...Object.values(input.outputs)].some((o) => o?.has(consumer)) || workflowHas(input.workflow, consumer)
  const present = (anchor: string, text: string | undefined) => text !== undefined && normaliseForMatch(text).includes(anchor)

  for (const doc of docs.values()) {
    const file = ledgerFileFor(doc.source)
    const entry = baselined[doc.source]
    if (!entry) {
      add(file, `${doc.source} is not in the baseline`)
      continue
    }
    if (doc.blob !== entry.blob) add(file, 'blob differs from the baseline; re-run the ledger init for this source')

    const text = input.sources.get(doc.source)
    if (text !== undefined) {
      const extracted = extractRules(text)
      const want = extracted.map((r) => `${r.id}@${r.line}`).sort(byCodePoint)
      const have = doc.rules.map((r) => `${r.id}@${r.line}`).sort(byCodePoint)
      if (want.join() !== have.join()) {
        const missing = want.filter((x) => !have.includes(x))
        const extra = have.filter((x) => !want.includes(x))
        add(file, `rules differ from the source (missing ${missing.length}: ${missing.slice(0, 5).join(', ')}; unknown ${extra.length}: ${extra.slice(0, 5).join(', ')})`)
      }
    } else if (doc.rules.length !== entry.rules) {
      add(file, `${doc.rules.length} rules, but the baseline counted ${entry.rules}`)
    }

    for (const rule of doc.rules) {
      if (isDropped(rule)) {
        counts.dropped++
        const refPath = rule.dropped.ref.split(' (')[0]!.trim()
        if (input.refExists && !input.refExists(refPath)) {
          add(file, `rule ${rule.id}: ref ${refPath} does not exist (refs are paths from the OSS root, e.g. apps/dethereal/… or docs/…)`, rule.line)
        }
        continue
      }
      if (!isPlaced(rule)) {
        counts.pending++
        if (doc.migrated) add(file, `rule ${rule.id} is neither placed nor dropped`, rule.line)
        continue
      }
      counts.placed++
      if (!input.workflow?.has(rule.destination)) {
        add(file, `rule ${rule.id}: destination ${rule.destination} is not a workflow file`, rule.line)
        continue
      }
      const anchor = normaliseForMatch(rule.anchor)
      const scope = rule.harnesses ?? HARNESSES
      if (!rule.consumers && (derived.get(rule.destination) ?? []).length === 0) counts.unconsumed++
      for (const consumer of rule.consumers ?? []) {
        if (!known(consumer)) add(file, `rule ${rule.id}: no consumer ${consumer} in the workflow`, rule.line)
      }
      for (const harness of scope) {
        const consumers = (rule.consumers ?? derivedFor.get(harness)?.get(rule.destination) ?? []).filter(known)
        if (consumers.length === 0) {
          // Nothing includes the destination for this harness (yet): hold the anchor to it rendered alone.
          const standalone = input.standalone?.[harness]
          if (!standalone) counts.unchecked++
          else if (!present(anchor, standalone.get(rule.destination))) {
            add(file, `rule ${rule.id}: anchor "${rule.anchor}" is missing from ${rule.destination} for ${harness}`, rule.line)
          }
          continue
        }
        const outputs = input.outputs[harness]
        for (const consumer of consumers) {
          if (!outputs) counts.unchecked++
          else if (!present(anchor, outputs.get(consumer))) {
            add(file, `rule ${rule.id}: anchor "${rule.anchor}" is missing from ${consumer} for ${harness}`, rule.line)
          }
        }
      }
    }
  }
  return { findings, counts }
}

function workflowHas(workflow: WorkflowSource | undefined, consumer: string): boolean {
  if (!workflow) return false
  const [kind, name] = consumer.split(':')
  return workflow.has(kind === 'skill' ? `skills/${name}/SKILL.md` : `agents/${name}.md`)
}

/** Words that differ between harness renderings, so an anchor must not contain them. */
const HARNESS_WORD = /mcp__|\/dethereal:|\bdethereal:|\$ARGUMENTS|\$\{CLAUDE_|\bAgent\(|AskUserQuestion|subagent_type|(^|\s)@\.{1,2}\//
const MAX_ANCHOR_WORDS = 16
const MIN_ANCHOR_WORDS = 8

/**
 * The anchor for a rule that survived verbatim: the longest run of its words (at most 16, at
 * least 8 or the whole rule if shorter, never fewer than 3) with no harness-specific word,
 * present in every rendering of the destination. Undefined when the rule was rewritten.
 */
export function findAnchor(ruleText: string, renderings: readonly string[]): string | undefined {
  const words = ruleText.split(/\s+/).filter(Boolean)
  const segments: string[][] = [[]]
  for (const w of words) {
    if (HARNESS_WORD.test(w)) segments.push([])
    else segments[segments.length - 1]!.push(w)
  }
  const eligible = segments.reduce((n, seg) => n + seg.length, 0)
  const minWords = Math.max(3, Math.min(MIN_ANCHOR_WORDS, eligible))
  const texts = renderings.map(normaliseForMatch)
  const longest = Math.min(MAX_ANCHOR_WORDS, Math.max(0, ...segments.map((seg) => seg.length)))
  for (let len = longest; len >= minWords; len--) {
    for (const seg of segments) {
      for (let i = 0; i + len <= seg.length; i++) {
        const window = seg.slice(i, i + len).join(' ')
        const normal = normaliseForMatch(window)
        if (normal.split(' ').length >= 3 && texts.every((t) => t.includes(normal))) return window
      }
    }
  }
  return undefined
}

/** Places every pending rule of `doc` whose text survives in `destination`; returns the new doc and the count. */
export function autoPlace(doc: LedgerDoc, sourceText: string, destination: string, renderings: readonly string[]): { doc: LedgerDoc; placed: number } {
  const texts = new Map(extractRules(sourceText).map((r) => [r.id, r.text]))
  let placed = 0
  const rules = doc.rules.map((rule): LedgerRule => {
    if (isPlaced(rule) || isDropped(rule)) return rule
    const anchor = findAnchor(texts.get(rule.id) ?? '', renderings)
    if (!anchor) return rule
    placed++
    return { id: rule.id, line: rule.line, anchor, destination }
  })
  return { doc: { ...doc, rules }, placed }
}

export function ledgerYaml(doc: LedgerDoc): string {
  return stringify(doc, { lineWidth: 0 })
}

/** A ledger file for `source`, keeping what an existing ledger says about rules that still exist. */
export function initLedger(source: string, text: string, existing?: LedgerDoc): { yaml: string; removed: string[] } {
  const previous = new Map((existing?.rules ?? []).map((r) => [r.id, r]))
  const rules = extractRules(text).map((r: Rule) => ({ ...previous.get(r.id), id: r.id, line: r.line }))
  const removed = [...previous.keys()].filter((id) => !rules.some((r) => r.id === id))
  const doc = { source, blob: gitBlobId(normaliseNewlines(text)), migrated: existing?.migrated ?? false, rules }
  return { yaml: ledgerYaml(doc), removed }
}

/** Reads everything the ledger check needs from a package root and renders the workflow if needed. */
export function readLedgerInput(pkgRoot: string, pkg: PackageInfo): LedgerInput {
  const baseline = JSON.parse(readFileSync(path.join(pkgRoot, BASELINE_FILE), 'utf8')) as Baseline
  const ledgerDir = path.join(pkgRoot, LEDGER_DIR)
  const ledgers = new Map(
    readdirSync(ledgerDir)
      .filter((f) => f.endsWith('.yaml'))
      .sort(byCodePoint)
      .map((f) => [f, readFileSync(path.join(ledgerDir, f), 'utf8')] as const),
  )
  const sources = new Map(listSources(pkgRoot).map((p) => [p, readFileSync(path.join(pkgRoot, p), 'utf8')] as const))
  const workflowDir = path.join(pkgRoot, 'workflow')
  if (!existsSync(workflowDir)) return { baseline, ledgers, sources, outputs: {} }

  const workflow = readWorkflow(workflowDir)
  const outputs: Partial<Record<Harness, ConsumerOutputs>> = {}
  const standalone: Partial<Record<Harness, ReadonlyMap<string, string>>> = {}
  for (const harness of HARNESSES) {
    const target = targetFor(harness)
    if (!target) continue
    standalone[harness] = renderStandalone(workflow, target)
    // Only a workflow with skills or agents has a bundle; a workflow that does not generate fails
    // here, loudly, rather than as a wall of missing anchors.
    const hasConsumers = [...workflow.keys()].some((p) => consumerOf(p) !== undefined)
    const externalNames = legacyNames(pkgRoot)
    outputs[harness] = hasConsumers ? consumerOutputs(generate({ pkg, workflowDir, harness, externalNames }), target, workflow) : new Map()
  }
  const ossRoot = path.resolve(pkgRoot, '..', '..')
  const refExists = (ref: string) => existsSync(path.join(ossRoot, ref))
  return { baseline, ledgers, sources, workflow, outputs, standalone, refExists }
}
