/**
 * A quick run: Steps 1–7 in full, Step 8 on the priority subset with the control pass deferred, a read-only review,
 * then publishing. It is never REVIEWED, and its quality is judged against a baseline across runs, not here. Beside
 * the hard gates every run shares, this file holds what only a quick run is checked for:
 *
 * - the key it is scored on: assertions, credentials and red flags on the priority subset alone (`scopedKey`);
 * - H2's place: the model is marked quick, finished Step 8 and recorded it after the relay and the enricher, the
 *   priority subset passes Gate 3's C2 and C8, and the settlement holds (`quickStateFindings`, `quickThroughFindings`);
 * - H7's additions: every operator fact the key expects the relay to ask for was asked, and no control was written
 *   (`quickPromptFindings`).
 */
import { rowsName, type AnswerSheet } from '../answer-sheet.js'
import type { ExpectedKey, QuickKey } from '../key.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { tableRowsFor } from './facts.js'
import { agentRuns, ENRICHER_ROLE, readOnlyCall, REVIEWER_ROLE } from './h6.js'
import { flowEndpoint, type Matching } from './match.js'
import type { Finding } from './outcome.js'
import type { ShownPrompt } from './prompts.js'
import type { RubricItem } from './rubric.js'

const RELAY = 'enrichment-relay'

/** Every element id an assertion names, at any depth. */
function assertionElements(a: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'element' && typeof x === 'string') out.push(x)
        // A shared credential names its flows.
        else if (k === 'flows' && Array.isArray(x) && x.every((f) => typeof f === 'string')) out.push(...(x as string[]))
        else walk(x)
      }
    }
  }
  walk(a)
  return out
}

/**
 * The key a quick run's scoped items are scored on: the assertions whose every element is in the priority subset, the
 * red flags whose assertions all stay, the field tags of the subset's elements, and the shared credential when all its
 * flows are in it.
 */
export function scopedKey(key: ExpectedKey): ExpectedKey {
  const q = key.quick
  if (!q) throw new Error('the key has no quick block')
  const inSet = (id: string) => q.priority.includes(id)
  const assertions = key.attribute_assertions.filter((a) => assertionElements(a).every(inSet))
  const kept = new Set(assertions.map((a) => a.id))
  const only = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([id]) => inSet(id)))
  const shared = key.credentials.shared
  return {
    ...key,
    attribute_assertions: assertions,
    red_flags: key.red_flags.filter((f) => (f.assertions ?? []).every((id) => kept.has(id))),
    fields: { components: only(key.fields.components), flows: only(key.fields.flows), data_items: only(key.fields.data_items) },
    credentials: { ...key.credentials, shared: shared && shared.flows.every(inSet) ? shared : undefined },
  } as ExpectedKey
}

/**
 * A quick run's rubric: each item as the full key reads it, the scoped ones replaced by their reading on the priority
 * subset (the full key's beside it), and each marked with its role. An item the quick block does not name is
 * informational, so a new rubric item is never held to a bar nobody set.
 */
export function quickRubric(full: RubricItem[], scoped: RubricItem[], q: QuickKey): RubricItem[] {
  return full.map((item) => {
    const role = q.informational.includes(item.id) || !q.covered.includes(item.id) ? 'informational' : q.relative_only.includes(item.id) ? 'relative' : 'covered'
    const subset = q.scoped.includes(item.id) ? scoped.find((x) => x.id === item.id) : undefined
    const fullKey = { pass: item.pass, ...(item.tally ? { tally: item.tally } : {}), ...(item.hits !== undefined ? { hits: item.hits, n: item.n } : {}) }
    const base = subset ? { ...subset, detail: `${subset.detail} (priority subset)` } : item
    return { ...base, ...(role === 'informational' ? { informational: true as const } : {}), quick: { role, ...(subset ? { scoped: true as const, fullKey } : {}) } }
  })
}

/** What the scorer reads from Gate 3 for a quick run. */
interface Gate3Read {
  criteria: Record<string, { verdict?: unknown; failing?: Array<{ id?: unknown }>; failing_total?: unknown }>
  waived_total?: unknown
}

/**
 * The quick model's own state, as the scorer reads the final model: marked quick, Step 8 recorded as finished,
 * never REVIEWED, no waiver (`storedWaivers`: the waivers the state file holds, whether any failure uses them), and
 * Gate 3's C2 and C8 passing on the priority subset (the enrichment quick mode exists for). The settlement findings
 * are the caller's, as for every run.
 */
export function quickStateFindings(key: ExpectedKey, state: Record<string, unknown>, gate3: Gate3Read, matching: Matching | undefined, storedWaivers = 0): Finding[] {
  const out: Finding[] = []
  const q = key.quick
  if (!q) return [{ verdict: 'FAIL', code: 'no_quick_key', detail: 'the key has no quick block: a quick run cannot be scored on it' }]
  if (state.claimed_state === 'REVIEWED') out.push({ verdict: 'FAIL', code: 'quick_reviewed', detail: 'the state file claims REVIEWED: a quick model is never reviewed' })
  else if (state.claimed_state !== 'ENRICHING') out.push({ verdict: 'FAIL', code: 'quick_state', detail: `the state file claims ${String(state.claimed_state)}, not ENRICHING` })
  if (state.mode !== 'quick') out.push({ verdict: 'FAIL', code: 'not_marked_quick', detail: 'the model is not marked quick' })
  if (state.quick_through !== 8) out.push({ verdict: 'FAIL', code: 'quick_unfinished', detail: `the model records quick steps through ${String(state.quick_through)}, not 8` })
  // Any waiver the state file holds, in use or not: a quick run is never offered one.
  const stored = Math.max(storedWaivers, Array.isArray(state.waivers) ? state.waivers.length : 0)
  if (stored > 0 || Number(gate3.waived_total ?? 0) > 0) out.push({ verdict: 'FAIL', code: 'quick_waiver', detail: `the state holds ${Math.max(stored, Number(gate3.waived_total ?? 0))} waiver(s): a quick run waives nothing` })
  const keyOf = (id: string) => flowEndpoint(matching?.components.get(id)) ?? matching?.flows.get(id)?.keyId ?? matching?.dataItems.get(id)
  for (const c of ['C2', 'C8']) {
    const cr = gate3.criteria[c]
    if (!cr || cr.verdict === 'PASS') continue
    const failing = (cr.failing ?? []).map((f) => String(f.id ?? ''))
    const hit = failing.filter((id) => q.priority.includes(keyOf(id) ?? ''))
    if (hit.length) out.push({ verdict: 'FAIL', code: 'priority_incomplete', detail: `Gate 3 ${c} fails on the priority subset (${hit.length})`, refs: hit })
    if (typeof cr.failing_total === 'number' && cr.failing_total > failing.length) {
      out.push({ verdict: 'needs-review', code: 'priority_truncated', detail: `Gate 3 ${c} lists ${failing.length} of ${cr.failing_total} failures: the priority subset may fail beyond them`, refs: [c] })
    }
  }
  return out
}

/**
 * A `model_state` call that records a quick step, and the step: `mode`, or a `transition` to ENRICHING, the one
 * state the tool records a quick step at.
 */
const quickStep = (e: TranscriptEvent) => {
  const input = e.input as { action?: unknown; to?: unknown; quick_through?: unknown } | undefined
  const records = input?.action === 'mode' || (input?.action === 'transition' && input.to === 'ENRICHING')
  return e.kind === 'tool_call' && e.actor === 'main' && e.tool === 'dethereal.model_state' && records && typeof input.quick_through === 'number' ? input.quick_through : null
}

/**
 * Step 8 recorded as finished only once it was: the last `quick_through: 8` call came after the relay was answered
 * and after the last enrichment enricher returned, and its result is no error.
 */
export function quickThroughFindings(events: TranscriptEvent[], shown: ShownPrompt[]): Finding[] {
  const calls = events.filter((e) => quickStep(e) === 8)
  const last = calls.at(-1)
  if (!last) return [{ verdict: 'FAIL', code: 'quick_through_unseen', detail: 'no call recorded Step 8 as finished' }]
  const result = events.find((e) => e.kind === 'tool_result' && e.callId === last.callId)
  if (!result || result.isError) return [{ verdict: 'FAIL', code: 'quick_through_unseen', detail: 'the call that recorded Step 8 as finished did not succeed', events: [last.seq] }]
  const relayAnswered = shown.filter((s) => s.id === RELAY && s.answeredBy !== undefined).map((s) => s.answeredBy!).at(-1)
  const out: Finding[] = []
  if (relayAnswered === undefined || last.seq < relayAnswered) out.push({ verdict: 'FAIL', code: 'quick_through_early', detail: `Step 8 was recorded as finished before ${RELAY} was answered`, events: [last.seq] })
  // Step 8's enrichers are every one that started after the data items were confirmed and before the review: all of
  // them must have returned before Step 8 is recorded as done.
  const itemsAnswered = shown.find((s) => s.id === 'data-items-confirm' && s.answeredBy !== undefined)?.answeredBy ?? Infinity
  const runs = agentRuns(events)
  const review = runs.filter((r) => r.role === REVIEWER_ROLE).at(-1)?.start ?? Infinity
  const enrichers = runs.filter((r) => r.role === ENRICHER_ROLE && r.start > itemsAnswered && r.start < review)
  const lastEnd = Math.max(-1, ...enrichers.map((r) => r.end ?? Infinity))
  if (lastEnd > last.seq) out.push({ verdict: 'FAIL', code: 'quick_through_early', detail: 'Step 8 was recorded as finished before its last enricher returned', events: [last.seq] })
  return out
}

/** Server tools whose write actions change controls on the platform. */
const CONTROL_WRITERS = new Set(['dethereal.manage_controls', 'dethereal.manage_countermeasures'])
const isControlFile = (p: string | undefined) => /(^|\/)controls\/[^/]+\.json$/.test(p ?? '')

/**
 * What a quick run must do at the relay and must not do before publishing: ask for each operator fact the key expects
 * (in a row of an answered relay showing), and never run the control pass. A control pass shows as a control written
 * on the platform or as a file before `push-consent`, an enricher delegated in controls mode, or a control on an
 * element of the final model (`controlled`: the element ids whose `controls` list is not empty); the countermeasures
 * Step 11's linking may create after publishing are not one.
 */
export function quickPromptFindings(sheet: AnswerSheet, key: ExpectedKey, events: TranscriptEvent[], shown: ShownPrompt[], controlled: string[] = []): Finding[] {
  const out: Finding[] = []
  const relay = sheet.prompts.find((p) => p.id === RELAY)
  const answers = shown.filter((s) => s.id === RELAY && s.answeredBy !== undefined).map((s) => s.answeredBy!)
  for (const id of key.quick?.facts_expected ?? []) {
    const fact = relay?.facts.find((f) => f.id === id)
    if (!fact) {
      out.push({ verdict: 'needs-review', code: 'fact_unknown', detail: `the key expects fact ${id}, which the sheet's ${RELAY} does not list: the fixture is inconsistent`, refs: [id] })
      continue
    }
    if (!answers.some((a) => rowsName(tableRowsFor(events, a), fact.ifTableContainsAny))) {
      out.push({ verdict: 'FAIL', code: 'fact_never_asked', detail: `no ${RELAY} showing asked for fact ${id} (its table rows never named ${fact.ifTableContainsAny.join(', ')})`, refs: [id] })
    }
  }
  const consent = shown.find((s) => s.id === 'push-consent')?.event ?? Infinity
  for (const e of events) {
    if (e.seq >= consent) break
    const action = (e.input as { action?: unknown } | undefined)?.action
    const task = e.kind === 'subagent_start' ? JSON.stringify(e.input ?? {}) + String(e.text ?? '') : ''
    if (e.kind === 'subagent_start' && /focus[\s:=-]*controls|enrich-controls|control pass/i.test(task)) {
      out.push({ verdict: 'FAIL', code: 'control_pass_in_quick', detail: 'an agent was delegated the control pass: a quick run defers it', events: [e.seq] })
    } else if (e.kind === 'tool_call' && CONTROL_WRITERS.has(e.tool ?? '') && !readOnlyCall(e)) {
      out.push({ verdict: 'FAIL', code: 'control_pass_in_quick', detail: `${e.tool} ${String(action)} was called: a quick run defers the control pass`, events: [e.seq] })
    } else if (e.kind === 'file_write' && isControlFile(e.path)) {
      out.push({ verdict: 'FAIL', code: 'control_pass_in_quick', detail: 'a control file was written: a quick run defers the control pass', events: [e.seq], refs: [e.path!] })
    }
  }
  if (controlled.length) out.push({ verdict: 'FAIL', code: 'control_pass_in_quick', detail: `${controlled.length} element(s) of the final model carry controls: a quick run defers the control pass`, refs: controlled })
  return out
}

/** The elements of a model whose `controls` list is not empty, by id. */
export function controlledElements(structure: unknown, dataFlows: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as { id?: unknown; controls?: unknown }
      if (typeof o.id === 'string' && Array.isArray(o.controls) && o.controls.length) out.push(o.id)
      Object.values(o).forEach(walk)
    }
  }
  walk(structure)
  walk(dataFlows)
  return [...new Set(out)].sort()
}
