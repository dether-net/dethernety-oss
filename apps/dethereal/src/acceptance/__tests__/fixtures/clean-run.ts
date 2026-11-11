/**
 * A synthetic, clean acceptance run on the synthetic fixture: a Claude Code
 * transcript that walks the guided workflow and writes the key model, the run
 * directory around it, and the exports. It follows every rule the scorer
 * checks, so each test can break exactly one.
 *
 * `edits` lets a test change the script before it is written: the events are
 * plain records in the order they happen.
 */
import { execFileSync } from 'node:child_process'
import type { SettlementOffExport } from '../../score/run-dir.js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleJson } from '../../../generator/bundle-json.js'
import { chooseReply, invocationFor, parseAnswerSheet, promptInMode, requiredIn, tableRows, type ReplyMode } from '../../answer-sheet.js'
import type { FullKey } from '../full-key.js'
import { treeHash } from '../../snapshot.js'
import { pinClassCache, readModuleClasses } from '../../score/model-gates.js'
import { readRegistry } from '../../score/prompts.js'
import { loadGateInput, reviewContentHash } from '../../../utils/gates.js'
import { initProjectRoot, resetProjectRoot } from '../../../utils/project-root.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURE = path.resolve(__dirname, '../../fixtures/synthetic')
export const MODULE = path.resolve(__dirname, '../../../../../../modules/dethernety-general/data/dethernety-general')
export const REGISTRY = path.resolve(__dirname, '../../../../workflow/shared/prompts.yaml')
export const PROJECT_PATH = '/work/project'
export const MODEL = 'threat-model'

export const key = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'key', 'expected.json'), 'utf8')) as FullKey
/** The module the key model's manifest lists: what a clean run's class cache names for each class. */
export const KEY_MODULE = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'key', 'model', 'manifest.json'), 'utf8')).modules[0] as { id: string; name: string }
export const sheet = parseAnswerSheet(fs.readFileSync(path.join(FIXTURE, 'key', 'answer-sheet.yaml'), 'utf8'))
const registry = readRegistry(REGISTRY)

/** One step of the script. */
export type Step =
  | { kind: 'prompt'; id: string; text?: string; reply?: string; variant?: number; logAs?: string }
  | { kind: 'say'; text: string }
  | { kind: 'user'; text: string; prompt: string }
  /** An agent run; `nested` is a specialist the agent itself runs */
  | { kind: 'agent'; role: string; error?: boolean; writes?: Array<{ file: string; content: string }>; nested?: string; reads?: string[] }
  /** A forked skill: its agent runs from the skill, with no spawn in the main session; `cutOff` ends it on a tool result, its answer never written */
  | { kind: 'fork'; role: string; text: string; cutOff?: boolean }
  | { kind: 'write'; files: string[] }
  /** A whole-file write; `before` overrides the content the harness records it replaced (a change the transcript never showed) */
  | { kind: 'write-content'; file: string; content: string; before?: string }
  /** A server tool call (`native`: one of the harness's own tools, by its name); `result` is the text its result carries */
  | {
    kind: 'tool'; name: string; input: Record<string, unknown>; result?: string; isError?: boolean; native?: boolean
    /** Seconds between the call and its result */
    waitSeconds?: number
    /** An approval line for the call: asked a second after it; `decidedAfter` seconds after the call, the operator decided */
    approval?: { decidedAfter?: number; autopilotRule?: string }
  }
  /** A shell call; `cwd` is the working directory its record carries (the result's may differ), `denied` a refusal as the harness records it */
  | { kind: 'bash'; command: string; cwd?: string; resultCwd?: string; denied?: string }
  /** A compaction: the operator's `/compact` by default; `auto`, one Claude Code started on its own (no operator line) */
  | { kind: 'compact'; trigger?: 'auto' }
  /** A question dialog that came back unanswered, recorded the way Claude Code records each case */
  | { kind: 'dismiss'; id: string; shape: 'rejected' | 'dismissed' | 'failed' | 'invalid' }

/** Proposal tables for the ratification prompts, as an honest run would show them. */
export const TABLES: Record<string, string> = {
  'boundary-trust': [
    'Trust classification (proposed from discovery + scope)',
    '| Boundary | Zone | Role (plane) | Resolved |', '|---|---|---|---|',
    '| Internet | Open internet [hi] | Undecided | declared |', '| Vetted partners | Open internet | Undecided | declared |',
    '| Edge | Internet-facing [hi] | Workload | declared |', '| Orders application | DMZ [med] | Workload | declared |',
    '| Database subnet | Internal | Workload | inherited · OrderDesk |', '| Operations subnet | Internet-facing | Management | declared |',
    '',
    'Enforcement posture',
    '| Boundary | Implicit deny | Any inbound | Egress |', '|---|---|---|---|',
    '| Edge | no | yes | allow_all |',
    '',
    'Proposed from discovery + scope. Accept all, or adjust specific rows?',
  ].join('\n'),
  'approved-channels': ['| Channel | Why |', '|---|---|', '| Vetted partners (Trusted external) → Orders application (Internal) | the payment webhook |'].join('\n'),
  // The relay's tables, as the workflow lays them out: the boundary enforcement and credential headers, and open
  // fields on the database account and password, ask for the platform facts; nothing names the secret store.
  'enrichment-relay': [
    'Credentials',
    '| F# | flow | credential | also reaches | on failure |', '|---|---|---|---|---|',
    '| F1 | Orders API → Log platform | ingest key | — | not shown |',
    '',
    'Boundary enforcement',
    '| boundary | implicit_deny_enabled | allow_any_inbound | egress_filtering | basis |', '|---|---|---|---|---|',
    '| Orders application | not shown | no | not shown | NetworkPolicy manifests |',
    '',
    'Open fields',
    '| Q# | element | field | question | allowed values |', '|---|---|---|---|---|',
    '| 1 | Orders database | least_privilege_access_enforced | Which account do the services log in as? | true, false |',
    '| 2 | Orders database | db_credentials_in_secret_manager | Where is the database password kept? | true, false |',
  ].join('\n'),
  'crown-jewel-confirm': [
    '| Crown jewel | Element |', '|---|---|',
    '| Customer order records with payment card data | Orders database |',
    '| Customer order records with payment card data | Customer order records |',
    '| Customer order records with payment card data | Payment card data |',
  ].join('\n'),
}

/** The questions a clean run shows, in the answer sheet's order. */
// The key model has the vendor webhook's external-ingress crossing, so a clean run is asked to ratify it; and its
// Gate 3 passes, so it is asked to record the review.
const shownIdsIn = (mode: ReplyMode) => sheet.prompts.filter((p) => promptInMode(p, mode) && ['always', 'fixture', 'if_external_ingress', 'if_reviewable'].includes(requiredIn(p, mode))).map((p) => p.id)

export const MODEL_FILES = (() => {
  const out: string[] = []
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), r)
      else out.push(r)
    }
  }
  walk(path.join(FIXTURE, 'key', 'model'), '')
  return out.sort()
})()
const ATTRIBUTE_FILES = MODEL_FILES.filter((f) => f.startsWith('attributes/'))

/**
 * The fields the operator's platform facts settle, by attribute file: those whose sheet excerpt is one of the relay's
 * facts. A loopback run gives them in the first loop-back reply, so a clean one leaves them empty until then.
 */
export const LOOPBACK_FIELDS: Map<string, string[]> = (() => {
  const out = new Map<string, string[]>()
  const facts = sheet.prompts.find((p) => p.id === 'enrichment-relay')!.facts
  for (const [group, dir] of [['components', 'components'], ['flows', 'dataFlows'], ['data_items', 'dataItems']] as const) {
    for (const [id, fields] of Object.entries(key.fields[group])) {
      for (const [field, tag] of Object.entries(fields)) {
        if (tag.tag === 'sheet' && facts.some((f) => f.text.includes(tag.excerpt))) out.set(`attributes/${dir}/${id}.json`, [...(out.get(`attributes/${dir}/${id}.json`) ?? []), field])
      }
    }
  }
  return out
})()

/** A gates result as the run's server returns it: every criterion passes except the failures given. */
export function gatesResult(failing: Record<string, Array<{ id: string; detail?: string }>> = {}): string {
  const criteria: Record<string, unknown> = {}
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']) {
    const f = failing[c] ?? []
    criteria[c] = { verdict: f.length ? 'FAIL' : 'PASS', failing: f.map((x) => ({ id: x.id, name: x.id, ...(x.detail ? { detail: x.detail } : {}), waivable: true })), failing_total: f.length }
  }
  return JSON.stringify({ lints: [], gate1: { verdict: 'PASS' }, gate2: { verdict: 'PASS' }, gate3: { verdict: Object.keys(failing).some((c) => failing[c]!.length) ? 'FAIL' : 'PASS', criteria } })
}

/** What a clean run's first Gate 3 fails: the key's ceiling, and nothing else. */
export const CEILING_FAILURES: Record<string, Array<{ id: string; detail: string }>> = Object.fromEntries(
  Object.entries(key.gate3_ceiling!.criteria).map(([c, els]) => [c, Object.entries(els).map(([id, fields]) => ({ id, detail: `missing: ${fields.join(', ')}` }))]))

/**
 * The script of a clean run: a loopback run by default, its facts given at the first loop-back; a bar run gets them
 * at the relay, so its first Gate 3 passes and it is never asked to loop back. A quick run marks the model quick
 * after Step 1, records Steps 7 and 8 as done, enriches with the relay's facts, has its review read-only and
 * publishes: no gates verdict, no loop-back, no review record and no control pass.
 */
/** A campaign run's script: the forced compaction and the operator's message after it left out. */
export function withoutCompaction(s: Step[]): void {
  const at = s.findIndex((x) => x.kind === 'compact')
  if (at < 0 || s[at + 1]?.kind !== 'user' || (s[at + 1] as { prompt?: string }).prompt !== 'after-compact') throw new Error('no forced compaction to leave out')
  s.splice(at, 2)
}

export function cleanScript(mode: ReplyMode = 'loopback'): Step[] {
  const shownIds = shownIdsIn(mode)
  const s: Step[] = []
  const prompt = (id: string) => s.push({ kind: 'prompt', id })
  const upTo = (id: string) => {
    while (shownIds.length && next < shownIds.length && shownIds[next] !== id) prompt(shownIds[next++]!)
    if (shownIds[next] === id) prompt(shownIds[next++]!)
  }
  let next = 0
  const invocation = invocationFor(sheet, mode === 'quick' ? 'quick' : 'full', 'claude')!
  s.push({ kind: 'user', prompt: 'invocation', text: `<command-name>/dethereal:threat-model</command-name>\n<command-args>${invocation.replace(/^\/dethereal:threat-model /, '')}</command-args>` })
  upTo('scope')
  s.push({ kind: 'write', files: ['manifest.json'] })
  const markQuick = (input: Record<string, unknown>) => s.push({ kind: 'tool', name: 'model_state', input: { action: 'mode', directory_path: `${PROJECT_PATH}/${MODEL}`, ...input } })
  if (mode === 'quick') markQuick({ mode: 'quick' })
  s.push({ kind: 'agent', role: 'infrastructure-scout' })
  upTo('approved-channels')
  s.push({ kind: 'write', files: ['structure.json:no-crown-jewel', 'dataflows.json', 'data-items.json'] })
  // A quick run goes on without the session break: its mode never asks it.
  if (shownIds.includes('session-break')) upTo('session-break')
  // The classification pass proposes nothing new, so it asks no classification question.
  s.push({ kind: 'agent', role: 'security-enricher' })
  upTo('crown-jewel-confirm')
  s.push({ kind: 'write', files: ['structure.json', '.dethereal/scope.json'] })
  s.push({ kind: 'compact' })
  s.push({ kind: 'user', prompt: 'after-compact', text: sheet.fixed['after-compact']! })
  s.push({ kind: 'tool', name: 'model_state', input: { action: 'get', directory_path: `${PROJECT_PATH}/${MODEL}` } })
  upTo('data-items-confirm')
  if (mode === 'quick') markQuick({ quick_through: 7 })
  s.push({ kind: 'agent', role: 'security-enricher' })
  upTo('enrichment-relay')
  // A loopback run's platform facts are unknown until the loop-back: those fields stay empty. A bar run has them.
  s.push({ kind: 'write', files: mode === 'loopback' ? ATTRIBUTE_FILES.map((f) => (LOOPBACK_FIELDS.has(f) ? `${f}:loopback-empty` : f)) : ATTRIBUTE_FILES })
  if (mode === 'quick') {
    markQuick({ quick_through: 8 })
    s.push({ kind: 'agent', role: 'model-reviewer' })
    s.push({ kind: 'say', text: `Review findings:\n${key.red_flags.map((f) => `- ${f.step9_phrases[0]}`).join('\n')}` })
    upTo('push-consent')
    return s
  }
  upTo('control-pass-offer')
  s.push({ kind: 'agent', role: 'model-reviewer' })
  s.push({ kind: 'say', text: `Review findings:\n${key.red_flags.map((f) => `- ${f.step9_phrases[0]}`).join('\n')}` })
  const gates = { action: 'gates', directory_path: `${PROJECT_PATH}/${MODEL}` }
  if (mode === 'bar') s.push({ kind: 'tool', name: 'validate_model_json', input: gates, result: gatesResult() })
  else {
    s.push({ kind: 'tool', name: 'validate_model_json', input: gates, result: gatesResult(CEILING_FAILURES) })
    upTo('gate3-loopback')
    s.push({ kind: 'write', files: [...LOOPBACK_FIELDS.keys()] })
    s.push({ kind: 'tool', name: 'validate_model_json', input: gates, result: gatesResult() })
  }
  upTo('review-record')
  s.push({ kind: 'write', files: ['.dethereal/state.json'] })
  upTo('push-consent')
  return s
}

export interface BuiltRun {
  dir: string
  /** The final model directory */
  model: string
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** An unanswered dialog's tool result, `toolUseResult` and `toolDenialKind`, as Claude Code records it. */
const UNANSWERED: Record<'rejected' | 'dismissed' | 'failed' | 'invalid', [string, string, string | undefined]> = {
  rejected: [
    "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
    'User rejected tool use', 'user-rejected',
  ],
  dismissed: ['The user dismissed the question without answering.', 'Error: The user dismissed the question without answering.', 'permission-rule'],
  failed: ['Tool permission request failed: AbortError: Stream closed', 'Error: Tool permission request failed: AbortError: Stream closed', 'permission-rule'],
  // A call the harness rejected on its input, before showing anything: no denial kind.
  invalid: [
    '<tool_use_error>InputValidationError: [\n  {\n    "origin": "array",\n    "code": "too_small",\n    "path": [\n      "questions", 0, "options"\n    ],\n    "message": "Too small: expected array to have >=2 items"\n  }\n]</tool_use_error>',
    'InputValidationError: [\n  {\n    "origin": "array",\n    "code": "too_small"\n  }\n]', undefined,
  ],
}

/** Build the run directory for a script. `mutate` may change the final project before the transcript is written. */
let gitDir: string | undefined
/**
 * A git directory whose index tracks every fixture source file, as the run kit's project repository does; built
 * once per process with no user or system git configuration.
 */
function sourceGit(): string {
  if (gitDir) return gitDir
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-source-git-')))
  process.once('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
  const repo = path.join(tmp, 'repo')
  fs.cpSync(path.join(FIXTURE, 'source'), repo, { recursive: true })
  const env = { PATH: process.env.PATH ?? '', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'none') }
  execFileSync('git', ['init', '-q'], { cwd: repo, env })
  execFileSync('git', ['add', '-A'], { cwd: repo, env })
  gitDir = path.join(repo, '.git')
  return gitDir
}

export async function buildRun(dir: string, script: Step[] = cleanScript(), options: {
  mutate?: (modelDir: string) => void; runExport?: unknown; bundleFiles?: string[]; push?: boolean; afterPush?: (modelDir: string) => void; stateExport?: unknown
  /** A skills tail after the walk: its script, and what it does to the project after the walk's snapshot */
  tail?: Step[]; afterTail?: (project: string) => void
  /** The run's sheet mode, written to run.json; absent, none is written (a loopback run) */
  sheetMode?: 'bar' | 'loopback'
  /** A quick run: run.json says so, and the final state is a quick model at ENRICHING with Step 8 done */
  quick?: boolean
  /** The final state file instead of the one the run's kind writes */
  state?: Record<string, unknown>
  /** A baseline of an earlier release: run.json says so, it ships no bundle.json and has no state export of this release's shape */
  baseline?: boolean
  /** A server with the settlement off: run.json says so, and the state export carries the mark and no settlement field */
  settlement?: 'off'
} = {}): Promise<BuiltRun> {
  fs.mkdirSync(dir, { recursive: true })
  fs.cpSync(path.join(FIXTURE, 'source'), path.join(dir, 'start'), { recursive: true })
  const project = path.join(dir, 'project')
  fs.cpSync(path.join(FIXTURE, 'source'), project, { recursive: true })
  fs.cpSync(sourceGit(), path.join(project, '.git'), { recursive: true })
  const model = path.join(project, MODEL)
  fs.cpSync(path.join(FIXTURE, 'key', 'model'), model, { recursive: true })
  // Each entry names the model's module, as a clean run's stubs record it.
  pinClassCache(model, readModuleClasses(MODULE), { fallback: KEY_MODULE })
  options.mutate?.(model)
  fs.writeFileSync(path.join(model, '.dethereal', 'state.json'), JSON.stringify(options.state ?? (options.quick
    ? { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], revision: 6, mode: 'quick', quickThrough: 8 }
    : {
      currentState: 'REVIEWED', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED'],
      revision: 6, reviewHash: await reviewHashOf(dir, project, model), reviewedAt: '2026-01-01T00:00:00.000Z',
    }), null, 2))

  const lines: string[] = []
  const replies: string[] = []
  let n = 0
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString()
  const uuid = () => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const line = (o: Record<string, unknown>) => lines.push(JSON.stringify({ timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, ...o }))
  // A baseline's earlier release tags no question.
  const say = (text: string) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: options.baseline ? text.replace(/\[prompt: [a-z0-9-]+\] ?/g, '') : text }] } })
  const user = (text: string, prompt: string, variant?: number) => {
    line({ type: 'user', message: { role: 'user', content: text } })
    const t = prompt === 'fixed:compact' ? '/compact' : text.replace(/^<command-name>(\/\S+)<\/command-name>\n<command-args>([\s\S]*)<\/command-args>$/, '$1 $2').trim()
    replies.push(JSON.stringify({ ts: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), prompt, ...(variant ? { variant } : {}), text: t, sha256: sha(t) }))
  }
  let call = 0
  const approvals: string[] = []
  const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString()
  const tool = (name: string, input: Record<string, unknown>, result = 'ok', extra: Record<string, unknown> = {}) => {
    const id = `toolu_${String(++call).padStart(24, '0')}`
    const calledAt = n
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, ...(extra.cwd ? { cwd: extra.cwd } : {}) })
    const approval = extra.approval as { decidedAfter?: number; autopilotRule?: string } | undefined
    if (approval) {
      approvals.push(JSON.stringify({
        ts: at(calledAt + 1), tool: name, decision: 'approve', ...(approval.autopilotRule ? { autopilotRule: approval.autopilotRule } : {}),
        ...(approval.decidedAfter !== undefined ? { decidedAt: at(calledAt + approval.decidedAfter) } : {}),
      }))
    }
    if (typeof extra.waitSeconds === 'number') n += extra.waitSeconds
    line({
      ...(extra.resultCwd ?? extra.cwd ? { cwd: extra.resultCwd ?? extra.cwd } : {}),
      type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, ...(extra.is_error ? { is_error: true } : {}) }] },
      ...(extra.toolUseResult ? { toolUseResult: extra.toolUseResult } : {}), ...(extra.toolDenialKind ? { toolDenialKind: extra.toolDenialKind } : {}),
    })
  }
  const known = new Map<string, string>()
  const subagents: Array<{ agentId: string; role: string; lines: string[] }> = []
  const write = (rel: string, content: string, claimedBefore?: string) => {
    const before = claimedBefore ?? known.get(rel)
    tool('Write', { file_path: `${PROJECT_PATH}/${MODEL}/${rel}`, content }, 'File written', { toolUseResult: { originalFile: before ?? null } })
    known.set(rel, content)
  }
  const final = (rel: string) => fs.readFileSync(path.join(model, rel), 'utf8')

  const showings = new Map<string, number>()
  for (const step of options.tail ? [...script, ...options.tail] : script) {
    if (step.kind === 'prompt') {
      const entry = registry.get(step.id)
      const table = TABLES[step.id] ? `${TABLES[step.id]}\n\n` : ''
      const text = step.text ?? `${table}[prompt: ${step.id}] ${(entry?.requires ?? []).join(' ')}`
      say(text)
      const p = sheet.prompts.find((x) => x.id === step.id)!
      showings.set(step.id, (showings.get(step.id) ?? 0) + 1)
      // The reply the run kit pastes: chosen from this turn's table rows, its facts filled in.
      const chosen = chooseReply(p, { showing: showings.get(step.id)!, rows: tableRows([text]), mode: options.quick ? 'quick' : options.baseline ? 'bar' : options.sheetMode ?? 'loopback' })
      user(step.reply ?? (step.variant ? p.variants[step.variant - 1]!.reply : chosen.text), step.logAs ?? step.id, step.variant ?? (step.reply === undefined ? chosen.variant : undefined))
    } else if (step.kind === 'dismiss') {
      const entry = registry.get(step.id)
      const question = `${TABLES[step.id] ? `${TABLES[step.id]}\n\n` : ''}[prompt: ${step.id}] ${(entry?.requires ?? []).join(' ')}`
      const [result, toolUseResult, toolDenialKind] = UNANSWERED[step.shape]
      tool('AskUserQuestion', { questions: [{ question, header: 'Question', options: [{ label: 'Yes' }, { label: 'No' }] }] }, result, { is_error: true, toolUseResult, toolDenialKind })
      // A rejected dialog stops the turn: the harness says so in the operator's place.
      if (step.shape === 'rejected') line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } })
    } else if (step.kind === 'fork') {
      const agentId = `agent-a${String(subagents.length + 1).padStart(16, '0')}`
      const lines = [JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'text', text: step.text }] } })]
      if (step.cutOff) {
        const gid = `toolu_${String(++call).padStart(24, '0')}`
        lines.push(JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'tool_use', id: gid, name: 'Grep', input: { pattern: 'exposure', path: PROJECT_PATH } }] } }))
        lines.push(JSON.stringify({ type: 'user', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: gid, content: 'No matches found' }] } }))
      }
      subagents.push({ agentId, role: step.role, lines })
    } else if (step.kind === 'say') say(step.text)
    else if (step.kind === 'user') user(step.text, step.prompt)
    else if (step.kind === 'agent') {
      const id = `toolu_${String(++call).padStart(24, '0')}`
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: `dethereal:${step.role}`, prompt: 'Do the step.' } }] } })
      if (step.writes?.length || step.nested || step.reads?.length) {
        const agentId = `agent-a${String(subagents.length + 1).padStart(16, '0')}`
        const sub: string[] = []
        if (step.nested) {
          const nid = `toolu_${String(++call).padStart(24, '0')}`
          sub.push(JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'tool_use', id: nid, name: 'Agent', input: { subagent_type: `dethereal:${step.nested}`, prompt: 'Check these attributes.' } }] } }))
          const nestedId = `agent-a${String(subagents.length + 2).padStart(16, '0')}`
          subagents.push({ agentId: nestedId, role: step.nested, lines: [JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'text', text: 'Checked.' }] } })] })
          sub.push(JSON.stringify({ type: 'user', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: nid, content: 'Done.' }] } }))
        }
        // Project files the agent reads, project-relative, with their content as the harness records it.
        for (const r of step.reads ?? []) {
          const rid = `toolu_${String(++call).padStart(24, '0')}`
          const content = fs.readFileSync(path.join(project, r), 'utf8')
          const numLines = content.split('\n').length
          sub.push(JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'tool_use', id: rid, name: 'Read', input: { file_path: `${PROJECT_PATH}/${r}` } }] } }))
          sub.push(JSON.stringify({ type: 'user', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: rid, content }] }, toolUseResult: { type: 'text', file: { filePath: `${PROJECT_PATH}/${r}`, content, numLines, startLine: 1, totalLines: numLines } } }))
        }
        for (const w of step.writes ?? []) {
          const wid = `toolu_${String(++call).padStart(24, '0')}`
          sub.push(JSON.stringify({ type: 'assistant', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'assistant', content: [{ type: 'tool_use', id: wid, name: 'Write', input: { file_path: `${PROJECT_PATH}/${MODEL}/${w.file}`, content: w.content } }] } }))
          sub.push(JSON.stringify({ type: 'user', timestamp: ts(), uuid: uuid(), cwd: PROJECT_PATH, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: wid, content: 'File written' }] }, toolUseResult: { originalFile: known.get(w.file) ?? null } }))
          known.set(w.file, w.content)
        }
        subagents.splice(step.nested ? subagents.length - 1 : subagents.length, 0, { agentId, role: step.role, lines: sub })
      }
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: step.error ? 'failed' : 'Done.', ...(step.error ? { is_error: true } : {}) }] } })
    } else if (step.kind === 'write') {
      for (const f of step.files) {
        if (f === 'structure.json:no-crown-jewel') {
          const s = JSON.parse(final('structure.json'))
          const strip = (b: any) => {
            for (const c of b.components ?? []) delete c.crownJewel
            for (const x of b.boundaries ?? []) strip(x)
          }
          strip(s.defaultBoundary)
          write('structure.json', JSON.stringify(s, null, 2))
        } else if (f.endsWith(':loopback-empty')) {
          const rel = f.slice(0, -':loopback-empty'.length)
          const doc = JSON.parse(final(rel))
          const attrs = doc.attributes ?? doc
          for (const field of LOOPBACK_FIELDS.get(rel) ?? []) attrs[field] = null
          write(rel, JSON.stringify(doc, null, 2))
        } else write(f, final(f))
      }
    } else if (step.kind === 'write-content') write(step.file, step.content, step.before)
    else if (step.kind === 'tool') {
      tool(step.native ? step.name : `mcp__plugin_dethereal_dethereal__${step.name}`, step.input, step.result, {
        ...(step.isError ? { is_error: true } : {}), ...(step.waitSeconds !== undefined ? { waitSeconds: step.waitSeconds } : {}), ...(step.approval ? { approval: step.approval } : {}),
      })
    }
    else if (step.kind === 'bash') {
      tool('Bash', { command: step.command }, step.denied ? "The user doesn't want to proceed with this tool use. The tool use was rejected." : 'ok', {
        ...(step.cwd ? { cwd: step.cwd } : {}), ...(step.resultCwd ? { resultCwd: step.resultCwd } : {}),
        ...(step.denied ? { is_error: true, toolUseResult: 'User rejected tool use', toolDenialKind: step.denied } : {}),
      })
    }
    else if (step.kind === 'compact') {
      if (step.trigger !== 'auto') user('<command-name>/compact</command-name>\n<command-args></command-args>', 'fixed:compact')
      line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: step.trigger ?? 'manual' } })
    }
  }
  if (options.push) applyPush(model)
  options.afterPush?.(model)
  if (options.tail) {
    fs.cpSync(project, path.join(dir, 'walk', 'project'), { recursive: true })
    options.afterTail?.(project)
  }
  fs.mkdirSync(path.join(dir, 'transcripts'))
  fs.writeFileSync(path.join(dir, 'transcripts', '00000000-0000-4000-8000-000000000001.jsonl'), `${lines.join('\n')}\n`)
  if (subagents.length) {
    const subDir = path.join(dir, 'transcripts', '00000000-0000-4000-8000-000000000001', 'subagents')
    fs.mkdirSync(subDir, { recursive: true })
    for (const a of subagents) {
      fs.writeFileSync(path.join(subDir, `${a.agentId}.jsonl`), `${a.lines.join('\n')}\n`)
      fs.writeFileSync(path.join(subDir, `${a.agentId}.meta.json`), JSON.stringify({ agentType: `dethereal:${a.role}` }))
    }
  }
  fs.writeFileSync(path.join(dir, 'replies.jsonl'), `${replies.join('\n')}\n`)
  fs.writeFileSync(path.join(dir, 'approvals.jsonl'), approvals.length ? `${approvals.join('\n')}\n` : '')
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    schemaVersion: 1, runId: 'clean-1', harness: 'claude', fixture: 'synthetic', projectPath: PROJECT_PATH, model: 'model-a',
    startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z',
    ...(options.tail ? { tail_start: { transcript: '00000000-0000-4000-8000-000000000001.jsonl' }, walk_snapshot: 'walk/project' } : {}),
    ...(options.sheetMode ? { sheet_mode: options.sheetMode } : {}),
    ...(options.quick ? { run_mode: 'quick' } : {}),
    ...(options.baseline ? { run_mode: 'baseline', baseline_version: '0.4.11' } : {}),
    ...(options.settlement ? { settlement: options.settlement } : {}),
  }))
  fs.mkdirSync(path.join(dir, 'export'))
  const keyExport = platformExport(path.join(FIXTURE, 'key', 'model'))
  fs.writeFileSync(path.join(dir, 'export', 'run-model.json'), JSON.stringify(options.runExport ?? keyExport))
  fs.writeFileSync(path.join(dir, 'export', 'key-model.json'), JSON.stringify(keyExport))
  // With a tail, the exports are the walk's: taken from its snapshot.
  const walkProject = options.tail ? path.join(dir, 'walk', 'project') : project
  const onExport = options.quick ? { ...VERIFIED_STATE, state: 'ENRICHING', claimed_state: 'ENRICHING', mode: 'quick', quick_through: 8 } : VERIFIED_STATE
  const exported = options.settlement === 'off' ? offExport(onExport) : onExport
  fs.writeFileSync(path.join(dir, 'export', 'model-state.json'), JSON.stringify(options.stateExport ?? (options.baseline ? { absent: 'baseline run: no model state of this release' } : { ...exported, content_hash: await reviewHashOf(dir, walkProject, path.join(walkProject, MODEL)) })))
  fs.mkdirSync(path.join(dir, 'installed', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'installed', 'dist', 'index.js'), '// dist\n')
  const roles = options.bundleFiles ?? ['infrastructure-scout', 'infrastructure-scout-scoped', 'security-enricher', 'model-reviewer', 'threat-modeler'].map((r) => `bundles/claude/agents/${r}.md`)
  const files = new Map(roles.map((p) => [p, `agent ${p}\n`]))
  const bundle = bundleJson('claude', '1.0.0', 'w'.repeat(64), files)
  if (!options.baseline) fs.writeFileSync(path.join(dir, 'installed', 'bundle.json'), JSON.stringify(bundle))
  for (const [rel, text] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, 'installed', 'bundle', rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, 'installed', 'bundle', rel), text)
  }
  return { dir, model }
}

/** A clean skills tail: every command, each answered as the plugin answers it. */
export function tailScript(): Step[] {
  const command = (name: string, args = '') => `<command-name>/dethereal:${name}</command-name>\n<command-args>${args}</command-args>`
  const dirPath = `${PROJECT_PATH}/${MODEL}`
  return [
    { kind: 'user', prompt: 'tail:status', text: command('status') }, { kind: 'say', text: 'Signed in; one local model, REVIEWED.' },
    { kind: 'user', prompt: 'tail:view', text: command('view') }, { kind: 'say', text: 'The model, as a tree.' },
    { kind: 'user', prompt: 'tail:surface', text: command('surface') }, { kind: 'fork', role: 'model-reviewer', text: 'The attack surface.' },
    { kind: 'user', prompt: 'tail:review', text: command('review') }, { kind: 'fork', role: 'model-reviewer', text: 'The review.' },
    { kind: 'user', prompt: 'tail:sync', text: command('sync', `pull m-1 ${MODEL}`) },
    { kind: 'tool', name: 'export_model', input: { model_id: 'm-1', directory_path: dirPath, if_exists: 'backup' }, result: JSON.stringify({ backup_path: `${MODEL}.backup-2026-01-01T00-00-00-000Z`, registered: true }) },
    { kind: 'tool', name: 'model_state', input: { action: 'merge_pulled', directory_path: dirPath }, result: JSON.stringify({ merged: true }) },
    { kind: 'say', text: 'Pulled into the existing directory, with a backup.' },
    { kind: 'user', prompt: 'tail:login', text: command('login', '--new') },
    { kind: 'tool', name: 'login', input: { force_new: true }, result: JSON.stringify({ status: 'pending', message: 'Open the sign-in page to finish.' }) },
    { kind: 'say', text: 'A new sign-in is waiting in the browser.' },
    { kind: 'user', prompt: 'tail:threat-modeler', text: "@agent-dethereal:threat-modeler Re-check the Ops Bastion's security attributes against the repository." },
    { kind: 'agent', role: 'threat-modeler', nested: 'security-enricher' }, { kind: 'say', text: 'The bastion is re-checked.' },
  ]
}

/**
 * What a push leaves in the project: a backup of the model directory beside
 * it, the platform's ids written into every model file, and the attribute
 * files renamed after them.
 */
export function applyPush(model: string): void {
  fs.cpSync(model, `${model}.backup-2026-01-01T00-59-00-000Z`, { recursive: true })
  const s = JSON.parse(fs.readFileSync(path.join(model, 'structure.json'), 'utf8'))
  const ids: string[] = []
  const walk = (b: any) => {
    ids.push(b.id)
    for (const c of b.components ?? []) ids.push(c.id)
    for (const x of b.boundaries ?? []) walk(x)
  }
  walk(s.defaultBoundary)
  for (const f of ['dataflows.json', 'data-items.json']) for (const e of JSON.parse(fs.readFileSync(path.join(model, f), 'utf8'))) ids.push(e.id)
  const map = new Map(ids.map((id) => [id, `srv-${id}`]))
  const rewrite = (text: string) => text.replace(/"([^"\\]+)"/g, (m, v: string) => (map.has(v) ? JSON.stringify(map.get(v)) : m))
  const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'class-cache' ? [] : files(path.join(d, e.name))) : [path.join(d, e.name)]))
  for (const f of files(model)) {
    if (!f.endsWith('.json')) continue
    fs.writeFileSync(f, rewrite(fs.readFileSync(f, 'utf8')))
    const m = /^(.*\/attributes\/[^/]+\/)([^/]+)\.json$/.exec(f)
    if (m && map.has(m[2]!)) fs.renameSync(f, `${m[1]}${map.get(m[2]!)}.json`)
  }
  fs.writeFileSync(path.join(model, '.dethereal', 'sync.json'), JSON.stringify({ platform_model_id: 'm' }))
}

/** The run's own model_state get after the push, as a clean run's kit takes it. */
export const VERIFIED_STATE = { state: 'REVIEWED', claimed_state: 'REVIEWED', baseline: 'verified', unregistered_changes: { rows: [], rows_total: 0 } }

/** The dist hash `buildRun` produces. */
export const distHashOf = (dir: string) => treeHash(path.join(dir, 'installed', 'dist'))

/** The bundle hash `buildRun` produces. */
export const bundleHashOf = (dir: string) => (JSON.parse(fs.readFileSync(path.join(dir, 'installed', 'bundle.json'), 'utf8')) as { contentHash: string }).contentHash

/** A platform export of a model directory, with ten exposures spread over its components. */
export function platformExport(modelDir: string): unknown {
  const files: Record<string, unknown> = {}
  for (const f of ['manifest.json', 'structure.json', 'dataflows.json', 'data-items.json']) files[f] = JSON.parse(fs.readFileSync(path.join(modelDir, f), 'utf8'))
  const exposures: Record<string, unknown[]> = {}
  const names = ['Weak authentication', 'Unencrypted transport', 'Exposed admin interface', 'Credential in code', 'Missing MFA']
  const on = ['c-orders-api', 'c-orders-db']
  let i = 0
  for (const id of on) exposures[id] = names.map((name) => ({ id: `e${i++}`, name, exploitedBy: ['T1078', 'T1190'] }))
  return { schemaVersion: 1, modelId: 'm', exportedAt: '2026-01-01T00:00:00.000Z', files, exposures }
}

async function reviewHashOf(dir: string, project: string, model: string): Promise<string> {
  const saved = { HOME: process.env.HOME, DETHEREAL_PROJECT_ROOT: process.env.DETHEREAL_PROJECT_ROOT }
  fs.mkdirSync(path.join(dir, '.home'), { recursive: true })
  process.env.HOME = path.join(dir, '.home')
  process.env.DETHEREAL_PROJECT_ROOT = project
  initProjectRoot()
  try {
    return reviewContentHash(await loadGateInput(model))
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetProjectRoot()
    fs.rmSync(path.join(dir, '.home'), { recursive: true, force: true })
  }
}

/** A state export as a server with the settlement off gives it: the mark, and no settlement or pending field. */
export function offExport(on: Record<string, unknown>): SettlementOffExport {
  const { baseline: _b, unregistered_changes: _u, pending_enrichment: _p, settlement: _s, ...rest } = on
  return { ...rest, settlement: 'off' } as SettlementOffExport
}
