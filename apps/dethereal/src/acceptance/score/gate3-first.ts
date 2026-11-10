/**
 * The first Gate 3 of a run that follows the answer sheet may fail only where the sheet's own facts are still to
 * come: the key's `gate3_ceiling`, criterion by element by field. It is read from the run's own gates result, the
 * last `validate_model_json` `gates` call of the main session on the model before `gate3-loopback` is first shown,
 * with no model write in between. C2 is judged at the final Gate 3 only. A ceiling field excuses a failure only while
 * its fact is still to come: once an operator reply before that result has given it (the key's sheet excerpt for the
 * field), the run had the fact, and the field leaves the ceiling.
 *
 * A failure outside the ceiling fails (modelling work left unfinished at the first gate), and so does every failure of
 * a criterion the ceiling does not name, element or not. On a criterion it names, a failure needs review instead
 * when the result cannot be read, when a list is cut short, when an element id no longer names an element of the
 * final model, or when an element no key element stands for fails only on fields the ceiling names and sits where
 * a ceiling element does: a flow into the same key element, or a component in the same boundary.
 */
import type { ExpectedKey, FieldTag } from '../key.js'
import { isModelFile, modelDirOf } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import type { Bridge } from './bridges.js'
import { normaliseReply } from './replies.js'
import { namesModel, readOnlyCall } from './h6.js'
import { finalId, type Push } from './id-remap.js'
import { flowEndpoint, type Matching, type RunModel } from './match.js'
import type { Finding } from './outcome.js'
import type { ShownPrompt } from './prompts.js'
import { operatorInputs } from './replies.js'

const GATES_TOOL = 'dethereal.validate_model_json'
const LOOPBACK = 'gate3-loopback'

interface Failing { id?: unknown; detail?: unknown; missing?: unknown; placeholder?: unknown }
interface Criterion { verdict?: unknown; failing?: Failing[]; failing_total?: unknown }

export interface Gate3FirstInput {
  events: TranscriptEvent[]
  shown: ShownPrompt[]
  key: ExpectedKey
  /** The hard gates' matching, by final run ids */
  matching: Matching
  run: RunModel
  pushes: Push[]
  bridges?: Bridge[]
  /** The final model directory, project-relative ('.' for the root) */
  modelRel: string
  projectRoot: string | null
}

/** The fields a Gate 3 failure's detail names: `placeholder: a, b; missing: c`. */
export function gapFields(detail: unknown): { missing: string[]; placeholder: string[] } {
  const out = { missing: [] as string[], placeholder: [] as string[] }
  for (const part of String(detail ?? '').split(';')) {
    const m = /^\s*(missing|placeholder):\s*(.+)$/.exec(part)
    if (m) out[m[1] as 'missing' | 'placeholder'].push(...m[2]!.split(',').map((f) => f.trim()).filter(Boolean))
  }
  return out
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A failure's field gaps: its `missing` and `placeholder` lists where the reply gives them, else read from its `detail`. */
export function failureGaps(f: Failing): { missing: string[]; placeholder: string[] } {
  if (Array.isArray(f.missing) || Array.isArray(f.placeholder)) return { missing: strings(f.missing), placeholder: strings(f.placeholder) }
  return gapFields(f.detail)
}

/** A failure as a finding names it: its detail, or its field lists in the detail's words. */
function failureText(f: Failing): string {
  if (f.detail) return String(f.detail)
  const { missing, placeholder } = failureGaps(f)
  return [placeholder.length ? `placeholder: ${placeholder.join(', ')}` : '', missing.length ? `missing: ${missing.join(', ')}` : ''].filter(Boolean).join('; ')
}

/** The ceiling less every field whose fact an operator input before `before` has given; a criterion left with nothing is dropped. */
function stillToCome(key: ExpectedKey, events: TranscriptEvent[], before: number): Record<string, Record<string, string[]>> {
  const said = operatorInputs(events).filter((i) => i.kind !== 'compaction' && i.event < before).map((i) => normaliseReply(i.text))
  const tags: Record<string, Record<string, FieldTag>> = { ...key.fields.components, ...key.fields.flows, ...key.fields.data_items }
  const given = (keyId: string, field: string) => {
    const t = tags[keyId]?.[field]
    return t?.tag === 'sheet' && said.some((x) => x.includes(normaliseReply(t.excerpt)))
  }
  const out: Record<string, Record<string, string[]>> = {}
  for (const [criterion, elements] of Object.entries(key.gate3_ceiling?.criteria ?? {})) {
    const open = Object.entries(elements).map(([k, fields]) => [k, fields.filter((f) => !given(k, f))] as const).filter(([, fields]) => fields.length)
    if (open.length) out[criterion] = Object.fromEntries(open)
  }
  return out
}

export function gate3First(input: Gate3FirstInput): Finding[] {
  const first = input.shown.find((s) => s.id === LOOPBACK)
  if (!first || !input.key.gate3_ceiling?.criteria) return []
  const review = (code: string, detail: string, events: number[] = [first.event]): Finding[] => [{ verdict: 'needs-review', code, detail, events }]

  const dir = input.modelRel === '.' ? '' : input.modelRel
  const onModel = (p: unknown) => namesModel(p, input.modelRel, input.projectRoot)
  const inModel = (rel: string) => isModelFile(rel) && modelDirOf(rel) === dir
  const callOf = (e: TranscriptEvent) => input.events.find((c) => c.kind === 'tool_call' && c.callId === e.callId)
  let result: TranscriptEvent | undefined
  for (const e of input.events) {
    if (e.seq >= first.event) break
    if (e.kind !== 'tool_result' || e.actor !== 'main' || e.tool !== GATES_TOOL) continue
    const input_ = callOf(e)?.input as { action?: unknown; directory_path?: unknown } | undefined
    if (input_?.action === 'gates' && onModel(input_.directory_path)) result = e
  }
  if (!result) return review('gate3_first_unread', `no gates result of the main session on the model before ${LOOPBACK} was first shown`)
  if (result.isError) return review('gate3_first_unread', 'the last gates result before the first loop-back is an error', [result.seq, first.event])
  // A refused or failed write changed nothing; a server write that names the paths it may touch counts only on this model.
  const between = input.events.find((e) => e.seq > result!.seq && e.seq < first.event && (
    (e.kind === 'server_write' && !readOnlyCall(callOf(e)) && (!e.touches?.length || e.touches.some(inModel))) ||
    (e.kind === 'file_write' && !e.isError && typeof e.path === 'string' && inModel(e.path)) ||
    (e.kind === 'shell' && e.writesModel && !e.denied)))
  if (between) return review('gate3_first_unread', `the model was written (event ${between.seq}) after the last gates result and before the first loop-back`, [result.seq, between.seq, first.event])
  let gate3: { criteria?: Record<string, Criterion> } | undefined
  try {
    const parsed = JSON.parse(result.text ?? '')
    gate3 = parsed?.gate3 ?? parsed?.data?.gate3
  } catch {
    gate3 = undefined
  }
  if (!gate3?.criteria || typeof gate3.criteria !== 'object') return review('gate3_first_unread', 'the gates result before the first loop-back holds no Gate 3 criteria', [result.seq, first.event])
  const ceiling = stillToCome(input.key, input.events, result.seq)

  const names = new Map([...input.run.components, ...input.run.flows, ...input.run.dataItems, ...input.run.boundaries].map((x) => [x.id, x.name] as const))
  const m = input.matching
  // The admin listener's reserved id reads as the orders API it belongs to.
  const keyOf = (id: string) => flowEndpoint(m.components.get(id)) ?? m.flows.get(id)?.keyId ?? m.dataItems.get(id) ?? m.boundaries.get(id) ??
    input.bridges?.find((b) => b.hops.some((h) => h.id === id))?.keyId
  const flowsById = new Map(input.run.flows.map((f) => [f.id, f] as const))
  const boundaryOf = new Map(input.run.components.map((c) => [c.id, c.boundaryId] as const))
  const findings: Finding[] = []
  const fail = (criterion: string, what: string[]) => findings.push({ verdict: 'FAIL', code: 'gate3_first_outside_ceiling', detail: `Gate 3 ${criterion} fails at the first ${LOOPBACK} outside what the sheet's facts leave open${what.length ? `: ${what.join('; ')}` : ''}`, events: [result!.seq, first.event], refs: [criterion] })
  for (const [criterion, c] of Object.entries(gate3.criteria)) {
    if (criterion === 'C2' || c?.verdict === 'PASS') continue
    const failing = Array.isArray(c?.failing) ? c.failing : []
    const allowed = ceiling[criterion]
    // A criterion the ceiling does not name, or one failing with nothing listed, fails as a whole.
    if (!allowed || !failing.length) {
      fail(criterion, failing.map((f) => `${names.get(String(f.id ?? '')) ?? String(f.id ?? '')}${failureText(f) ? ` (${failureText(f)})` : ''}`))
      continue
    }
    const allowedFields = new Set(Object.values(allowed).flat())
    // Where a ceiling element sits: the key elements its flows go into, the run boundaries its components are in.
    const ceilingRunIds = [...names.keys()].filter((id) => { const k = keyOf(id); return !!k && k in allowed })
    const ceilingTargets = new Set(ceilingRunIds.map((id) => flowsById.get(id)).filter((f) => !!f).map((f) => keyOf(f!.target) ?? f!.target))
    const ceilingBoundaries = new Set(ceilingRunIds.map((id) => boundaryOf.get(id)).filter((b) => !!b))
    const besideCeiling = (id: string) => {
      const f = flowsById.get(id)
      return f ? ceilingTargets.has(keyOf(f.target) ?? f.target) : ceilingBoundaries.has(boundaryOf.get(id))
    }
    const outside: string[] = []
    const unkeyed: string[] = []
    for (const f of failing) {
      const runId = finalId(String(f.id ?? ''), input.pushes, result.seq)
      const { missing, placeholder } = failureGaps(f)
      const shown = `${names.get(runId) ?? runId}${failureText(f) ? ` (${failureText(f)})` : ''}`
      if (!names.has(runId)) { unkeyed.push(`${shown}: not an element of the final model`); continue }
      const keyId = keyOf(runId)
      if (!keyId) {
        // An element no key element stands for, beside a ceiling element and failing only where it does, is left to review.
        if (missing.length && !placeholder.length && missing.every((x) => allowedFields.has(x)) && besideCeiling(runId)) unkeyed.push(`${shown}: no key element`)
        else outside.push(shown)
        continue
      }
      const fields = allowed[keyId]
      if (!fields || !missing.length || placeholder.length || !missing.every((x) => fields.includes(x))) outside.push(`${keyId}: ${shown}`)
    }
    if (outside.length) fail(criterion, outside)
    if (unkeyed.length) findings.push({ verdict: 'needs-review', code: 'gate3_first_unkeyed', detail: `Gate 3 ${criterion} at the first ${LOOPBACK}: ${unkeyed.join('; ')}`, events: [result.seq, first.event], refs: [criterion] })
    if (typeof c?.failing_total === 'number' && c.failing_total > failing.length) {
      findings.push({ verdict: 'needs-review', code: 'gate3_first_truncated', detail: `Gate 3 ${criterion} at the first ${LOOPBACK} lists ${failing.length} of ${c.failing_total} failures`, events: [result.seq, first.event], refs: [criterion] })
    }
  }
  return findings
}
