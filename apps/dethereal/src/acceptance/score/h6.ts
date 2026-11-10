/**
 * H6: the work was delegated as the workflow says, and the review changed
 * nothing.
 *
 * Agent roles are the bundle's own: each agent file under `agents/` in the
 * installed `bundle.json`, named without its extension and a `dethereal-`
 * prefix. A subagent run is a `subagent_start` of the main session paired with
 * its `subagent_end`; its role is the agent it started, read the same way.
 *
 * Required, each having returned without an error:
 * - the scout (`infrastructure-scout`, or its scoped variant), before the
 *   discovery table's question (`discovery-confirm`) is first shown;
 * - the enricher (`security-enricher`) for classification, before
 *   `classification-confirm` or `data-items-confirm` (Step 7) is first shown,
 *   whichever comes first (a classification pass that proposes nothing asks no
 *   `classification-confirm`). A quick run may skip that pass when nothing was
 *   left to classify: it showed neither `classification-confirm` nor
 *   `classification-gap`, and the main session's last `quality` result on the
 *   model before the first `data-items-confirm` is no error, reads
 *   `attribute_residual.unclassified_open: 0`, and still held there: nothing
 *   but crown-jewel flags changed in the files that decide it since;
 * - the enricher again for enrichment, started after the operator first
 *   answered `data-items-confirm` (so a classification pass run again on a
 *   resume never counts), returned before `review-record` is first shown;
 * - the reviewer (`model-reviewer`), returned before `review-record` is first
 *   shown.
 *
 * The reviewer writes nothing: no file write, server write, model-writing
 * command or model-writing server tool call by it. A tracked model change with
 * no observed write while a reviewer ran needs review. A run that started an
 * agent and never saw it return, or saw it fail, needs review.
 *
 * The workflow waits for the operator and never wakes itself: a call to the harness's scheduling tools
 * (`ScheduleWakeup`, `CronCreate`, `RemoteTrigger`) by any actor fails.
 *
 * A quick run shows no `review-record`: its enricher and reviewer return before `push-consent` instead. Its review
 * must read the model it relays: the last enrichment enricher returned before the last reviewer started, and no
 * model content was written from that start until `push-consent` was first shown.
 */
import path from 'node:path'
import { covers, isModelFile, serverWriteScope } from '../transcripts/replay.js'
import type { ParsedRun, TranscriptEvent } from '../transcripts/types.js'
import { outcome, refusal, type Finding, type GateOutcome } from './outcome.js'
import type { ShownPrompt } from './prompts.js'

export const SCOUT_ROLES = ['infrastructure-scout', 'infrastructure-scout-scoped']
export const ENRICHER_ROLE = 'security-enricher'
export const REVIEWER_ROLE = 'model-reviewer'

/** An agent name as the harness spells it (`dethereal:x`, `dethereal-x`, a path, a file) → the role. */
export function roleOf(name: string | undefined): string {
  const base = path.posix.basename(String(name ?? '').replace(/\\/g, '/')).split(':').pop() ?? ''
  return base.replace(/\.(md|toml)$/, '').replace(/^dethereal-/, '')
}

/** The roles a bundle installs. */
export function bundleRoles(bundle: { files?: Array<{ path?: unknown }> }): Set<string> {
  const out = new Set<string>()
  for (const f of bundle.files ?? []) {
    const p = String(f.path ?? '')
    const m = /(?:^|\/)agents\/([^/]+)\.(?:md|toml)$/.exec(p)
    if (m) out.add(roleOf(m[1]))
  }
  return out
}

export interface AgentRun {
  role: string
  start: number
  end?: number
  isError?: boolean
}

/** The subagent runs the main session started, in order. */
export function agentRuns(events: TranscriptEvent[]): AgentRun[] {
  const runs: AgentRun[] = []
  const open = new Map<string, AgentRun>()
  for (const e of events) {
    if (e.actor !== 'main') continue
    const input = (e.input ?? {}) as Record<string, unknown>
    if (e.kind === 'subagent_start') {
      const run: AgentRun = { role: roleOf((e.text as string | undefined) ?? (input.subagent_type as string | undefined) ?? (input.agent as string | undefined)), start: e.seq }
      runs.push(run)
      if (e.callId) open.set(e.callId, run)
    } else if (e.kind === 'subagent_end' && e.callId && open.has(e.callId)) {
      const run = open.get(e.callId)!
      run.end = e.seq
      if (e.isError) run.isError = true
      open.delete(e.callId)
    }
  }
  return runs
}

/** Server tools that change the platform through an action other than a read (their read actions are kept for older transcripts). */
const PLATFORM_WRITERS = new Set(['dethereal.manage_exposures', 'dethereal.manage_countermeasures', 'dethereal.manage_controls', 'dethereal.manage_analyses'])
const READ_ACTIONS = new Set(['get', 'list'])
/** Server tools that only read the platform, whatever their action. */
const PLATFORM_READERS = new Set(['dethereal.query_exposures', 'dethereal.query_controls', 'dethereal.query_countermeasures'])

/** A server call that only reads: `model_state get`, a platform query, or a read action of a platform tool. */
export function readOnlyCall(call: TranscriptEvent | undefined): boolean {
  if (!call) return false
  const action = (call.input as { action?: unknown } | undefined)?.action
  if (call.tool === 'dethereal.model_state') return action === 'get'
  if (PLATFORM_READERS.has(call.tool ?? '')) return true
  if (PLATFORM_WRITERS.has(call.tool ?? '')) return typeof action === 'string' && READ_ACTIONS.has(action)
  return false
}

/**
 * A write, attempted or done: any file write, a server write that is not a read, a model-writing shell
 * call, or a server call that writes files or the platform.
 */
export function isWrite(e: TranscriptEvent, callOf: (e: TranscriptEvent) => TranscriptEvent | undefined): boolean {
  return e.kind === 'file_write' || (e.kind === 'server_write' && !readOnlyCall(callOf(e))) || (e.kind === 'shell' && e.writesModel === true) ||
    (e.kind === 'tool_call' && !readOnlyCall(e) && (serverWriteScope(e.tool ?? '', e.input, (p) => p) !== null || PLATFORM_WRITERS.has(e.tool ?? '')))
}

/** The harness's own scheduling tools: a call to one wakes the session later, with no operator. */
export const SCHEDULERS = new Set(['ScheduleWakeup', 'CronCreate', 'RemoteTrigger'])

/**
 * The workflow waits for the operator and never wakes itself: every call to a scheduling tool, by any actor,
 * fails, named with the question that was waiting then.
 */
export function selfScheduled(events: TranscriptEvent[], shown: ShownPrompt[], code = 'self_scheduled_turn'): Finding[] {
  return events.filter((e) => e.kind === 'tool_call' && SCHEDULERS.has(e.tool ?? '')).map((e) => {
    // The question shown last before the call, if it had not been answered by then.
    const last = shown.filter((s) => s.event < e.seq).at(-1)
    const waiting = last && (last.answeredBy === undefined || last.answeredBy > e.seq) ? last : undefined
    return { verdict: 'FAIL' as const, code, detail: `${e.actor} called ${e.tool}${waiting ? ` while ${waiting.id} was waiting for the operator` : ''}`, events: [e.seq] }
  })
}

export interface H6Input {
  parsed: ParsedRun
  bundle: { files?: Array<{ path?: unknown }> }
  shown: ShownPrompt[]
  /** A quick run: its review comes before publishing, with no review record */
  quick?: boolean
  /** The model directory, project-relative ('.' for the root): a quick run's skipped classification is read on it */
  modelRel?: string
  projectRoot?: string | null
}

const VALIDATE_TOOL = 'dethereal.validate_model_json'

/** Whether a tool's `directory_path` names the model directory (an absolute path without a project root, by its ending). */
export function namesModel(p: unknown, modelRel: string, projectRoot: string | null | undefined): boolean {
  if (typeof p !== 'string') return false
  const dir = modelRel === '.' ? '' : modelRel
  const trimmed = p.split(path.sep).join('/').replace(/\/+$/, '')
  if (path.isAbsolute(p) && !projectRoot) return dir !== '' && trimmed.endsWith(`/${dir}`)
  const rel = path.posix.normalize(path.isAbsolute(p) ? path.relative(projectRoot!, p).split(path.sep).join('/') : trimmed).replace(/\/+$/, '')
  return (rel === '.' ? '' : rel) === dir
}

/** The files that decide what is left to classify: the elements, their classes, and the ones left unclassified. */
const CLASSIFICATION_FILES = ['structure.json', 'dataflows.json', 'data-items.json', '.dethereal/discovery.json']
/** A crown-jewel flag: the one change Step 6 makes after its reading and before Step 7. */
const CROWN_JEWEL_FLAG = (file: string, pointer: string) => /(^|\/)structure\.json$/.test(file) && /\/crownJewel$/.test(pointer)
/** Server tools that write only the state, attribute files and caches, never the files that decide what is left to classify. */
const NEVER_CLASSIFIES = new Set(['dethereal.model_state', 'dethereal.model_state_waive', 'dethereal.update_attributes', 'dethereal.generate_attribute_stubs'])

/**
 * A quick run with nothing left to classify: neither classification question shown, and the main session's last
 * `quality` result on the model before `before` is no error and reads `attribute_residual.unclassified_open: 0`,
 * with no change since to the files that decide it but crown-jewel flags.
 */
function nothingToClassify(parsed: ParsedRun, shown: ShownPrompt[], before: number, modelRel: string, projectRoot: string | null | undefined): boolean {
  const { events } = parsed
  if (shown.some((s) => s.id === 'classification-confirm' || s.id === 'classification-gap')) return false
  const callOf = (e: TranscriptEvent) => events.find((c) => c.kind === 'tool_call' && c.callId === e.callId)
  const result = events.filter((e) => {
    if (e.seq >= before || e.kind !== 'tool_result' || e.tool !== VALIDATE_TOOL) return false
    const call = callOf(e)
    const input = call?.input as { action?: unknown; directory_path?: unknown } | undefined
    return call?.actor === 'main' && input?.action === 'quality' && namesModel(input.directory_path, modelRel, projectRoot)
  }).at(-1)
  if (!result || result.isError) return false
  let open: unknown
  try {
    const parsed = JSON.parse(result.text ?? '')
    open = parsed?.error === undefined ? (parsed?.attribute_residual ?? parsed?.data?.attribute_residual)?.unclassified_open : undefined
  } catch {
    open = undefined
  }
  return open === 0 && !changedSince(parsed, result.seq, before, modelRel)
}

/**
 * Whether the model's classification files may have changed between two events: any write that may reach them but an
 * edit the replay followed whose every change is a crown-jewel flag.
 */
function changedSince(parsed: ParsedRun, from: number, to: number, modelRel: string): boolean {
  const dir = modelRel === '.' ? '' : modelRel
  const files = CLASSIFICATION_FILES.map((f) => (dir ? `${dir}/${f}` : f))
  const decides = (p: string) => files.includes(p)
  // A write that names no path, or a path or pattern covering one of the files, may have changed them.
  const reaches = (touches: string[] | undefined) => !touches?.length || touches.some((t) => files.some((f) => covers(t, f)))
  const within = (seq: number) => seq > from && seq < to
  const callOf = (e: TranscriptEvent) => parsed.events.find((c) => c.kind === 'tool_call' && c.callId === e.callId)
  // An edit the replay followed: changed only crown-jewel flags. One it could not follow (no change recorded) may have
  // changed anything.
  const followed = (e: TranscriptEvent) => {
    const changes = parsed.attributions.filter((a) => a.event === e.seq && a.path === e.path)
    return changes.length > 0 && changes.every((a) => CROWN_JEWEL_FLAG(a.path, a.pointer))
  }
  if (parsed.reconciliation.unobserved.some((u) => decides(u.path) && u.window[0] < to && u.window[1] > from)) return true
  // A file found to differ from the replay inside the window, the change not explained by a write before the reading.
  if (parsed.opaque.some((o) => decides(o.path) && within(o.resyncedAt) && (o.since === -1 || o.since > from))) return true
  return parsed.events.some((e) => within(e.seq) && (
    (e.kind === 'file_write' && !e.isError && (e.fileOp?.op === 'move'
      ? decides(e.path ?? '') || /(^|[\\/])(structure|dataflows|data-items|discovery)\.json$/.test(e.fileOp.to)
      : decides(e.path ?? '') && !followed(e))) ||
    (e.kind === 'shell' && e.writesModel === true && !e.denied && reaches(e.touches)) ||
    (e.kind === 'server_write' && !readOnlyCall(callOf(e)) && !NEVER_CLASSIFIES.has(e.tool ?? '') && reaches(e.touches))))
}

/** The run's own bookkeeping beside the model: state, pending values, caches, settlement, sync and the project registry. */
const BOOKKEEPING = /(^|\/)\.dethereal\/(state|enrichment-pending|quality|sync|loop-back|settlement-baseline|settlements|pending-id-rewrite)\.json$|(^|\/)\.dethereal\/(control-audit\.log|\.gitignore|class-cache\/|template-fields\/)|(^|\/)\.dethernety\//
/** A write of model content: the model files and the scope (the crown-jewel mapping the review reads), not the bookkeeping. */
const isContentFile = (p: string) => isModelFile(p) && !BOOKKEEPING.test(p)

export function h6({ parsed, bundle, shown, quick = false, modelRel, projectRoot }: H6Input): GateOutcome {
  const { events } = parsed
  const findings: Finding[] = []
  const roles = bundleRoles(bundle)
  for (const r of [SCOUT_ROLES[0]!, ENRICHER_ROLE, REVIEWER_ROLE]) {
    if (!roles.has(r)) findings.push({ verdict: 'FAIL', code: 'role_not_in_bundle', detail: `the installed bundle has no ${r} agent` })
  }
  const runs = agentRuns(events)
  for (const r of runs) {
    if (!roles.has(r.role)) findings.push({ verdict: 'needs-review', code: 'unknown_role', detail: `an agent the bundle does not install was started (${r.role || 'unnamed'})`, events: [r.start] })
    if (r.end === undefined) findings.push({ verdict: 'needs-review', code: 'no_return', detail: `a ${r.role} run never returned`, events: [r.start] })
    else if (r.isError) findings.push({ verdict: 'needs-review', code: 'returned_error', detail: `a ${r.role} run returned an error`, events: [r.start, r.end] })
  }
  const ok = (r: AgentRun) => r.end !== undefined && !r.isError
  const first = (id: string) => shown.find((s) => s.id === id)
  const firstEvent = (id: string) => first(id)?.event ?? Infinity
  // Step 6 ends at classification-confirm, or at Step 7's first data-items-confirm when that comes first (a pass
  // that proposes nothing asks no classification-confirm); enrichment starts after the first answered
  // data-items-confirm (its first showing may have been dismissed or compacted).
  const classified = firstEvent('classification-confirm') < firstEvent('data-items-confirm') ? 'classification-confirm' : 'data-items-confirm'
  const itemsAnswered = shown.find((s) => s.id === 'data-items-confirm' && s.answeredBy !== undefined)?.answeredBy ?? Infinity
  const reviewed = quick ? 'push-consent' : 'review-record'
  // A quick run that read nothing left to classify skips the classification pass.
  const skipped = quick && modelRel !== undefined && first('data-items-confirm') !== undefined &&
    nothingToClassify(parsed, shown, firstEvent('data-items-confirm'), modelRel, projectRoot)
  const required: Array<{ id: string; slot: string; hit: (r: AgentRun) => boolean }> = [
    { id: 'scout', slot: 'the scout before discovery-confirm', hit: (r) => SCOUT_ROLES.includes(r.role) && r.end! < firstEvent('discovery-confirm') },
    { id: 'classification', slot: `the enricher before ${classified}`, hit: (r) => r.role === ENRICHER_ROLE && r.end! < firstEvent(classified) },
    { id: 'enrichment', slot: 'the enricher for enrichment (started after data-items-confirm was first answered)', hit: (r) => r.role === ENRICHER_ROLE && r.start > itemsAnswered && r.end! < firstEvent(reviewed) },
    { id: 'review', slot: `the reviewer before ${reviewed}`, hit: (r) => r.role === REVIEWER_ROLE && r.end! < firstEvent(reviewed) },
  ]
  for (const { id, slot, hit } of required) {
    if (id === 'classification' && skipped) continue
    if (!runs.some((r) => ok(r) && hit(r))) findings.push({ verdict: 'FAIL', code: 'missing_delegation', detail: `no run of ${slot} returned`, refs: [id] })
  }

  const callOf = (e: TranscriptEvent) => events.find((c) => c.kind === 'tool_call' && c.callId === e.callId)
  for (const e of events) {
    if (roleOf(e.actor) !== REVIEWER_ROLE) continue
    if (isWrite(e, callOf)) findings.push({ verdict: 'FAIL', code: 'reviewer_wrote', detail: `the reviewer made a ${e.kind}${e.tool ? ` (${e.tool})` : ''}${refusal(e)}`, events: [e.seq] })
  }
  const reviewerWindows = runs.filter((r) => r.role === REVIEWER_ROLE).map((r) => [r.start, r.end ?? Infinity] as const)
  for (const u of parsed.reconciliation.unobserved) {
    if (reviewerWindows.some(([a, b]) => u.window[0] < b && u.window[1] > a)) {
      findings.push({ verdict: 'needs-review', code: 'unobserved_write_during_review', detail: 'a tracked model change with no observed write while the reviewer ran', events: [u.harnessEvent], refs: [u.path] })
    }
  }
  if (quick) findings.push(...quickReviewOrder(events, runs, firstEvent('push-consent'), itemsAnswered, callOf))
  findings.push(...selfScheduled(events, shown))
  return outcome('H6', findings)
}

/** A quick run's review reads the model it relays: enriched before it, unchanged after it until publishing. */
function quickReviewOrder(events: TranscriptEvent[], runs: AgentRun[], consent: number, itemsAnswered: number, callOf: (e: TranscriptEvent) => TranscriptEvent | undefined): Finding[] {
  const reviewer = runs.filter((r) => r.role === REVIEWER_ROLE && r.start < consent).at(-1)
  if (!reviewer) return []
  const out: Finding[] = []
  const enricher = runs.filter((r) => r.role === ENRICHER_ROLE && r.start > itemsAnswered && r.start < consent).at(-1)
  if (enricher && (enricher.end ?? Infinity) > reviewer.start) {
    out.push({ verdict: 'FAIL', code: 'review_before_enrichment', detail: 'the last enricher had not returned when the last review started', events: [enricher.start, reviewer.start] })
  }
  const writes = events.filter((e) => e.seq > reviewer.start && e.seq < consent && (
    (e.kind === 'file_write' && !e.isError && typeof e.path === 'string' && isContentFile(e.path)) ||
    (e.kind === 'shell' && e.writesModel === true && !e.denied) ||
    (e.kind === 'server_write' && !readOnlyCall(callOf(e)) && (e.touches ?? []).some(isContentFile))))
  for (const w of writes) out.push({ verdict: 'FAIL', code: 'write_after_review', detail: `the model was written (${w.kind}${w.tool ? `, ${w.tool}` : ''}) after its review started and before publishing: the review relayed another model`, events: [reviewer.start, w.seq] })
  return out
}
