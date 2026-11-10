/**
 * The skills tail: the plugin's other skills, run after the main walk in the same session, each command logged as
 * a `tail:<skill>` reply (TAIL_IDS order). A command's segment runs from the transcript event it is paired with to
 * the next command's, or the end.
 *
 * - T1 ran: each command was sent and paired, and something answered it: a main-session assistant message, or for
 *   a forked skill (`review`, `surface`) its reviewer's final answer: a fork whose last record is not a message with
 *   text (cut off by its turn limit, say) returned nothing, and the operator saw only that the command completed. A
 *   question it showed and did not wait on, a tool error or refusal (a secret-guard refusal is T4's to report), or a
 *   compaction inside a segment needs review.
 * - T2 read-only: `status`, `view`, `surface` and `review` write nothing, whoever writes, by the reviewer's write
 *   rule: no file write, no server write other than a read, no model-writing shell call, no platform write.
 * - T3 pull in place: `sync` exports the walk's platform model into the walk's model directory (`if_exists:
 *   'backup'`), then merges the pulled state there, writes nowhere else in the project than that directory, the
 *   registry and the backups beside it, and leaves one model directory, on disk and in the registry.
 * - T4 login pending: `login` with `force_new` reports pending, or signed in, within its wait (plus slack) of
 *   being approved; and H3 over the tail finds nothing. Approved by hand, it is timed from the operator's decision
 *   when the run records it; when it does not, a result past the wait from the call may be the dialog waiting on the
 *   operator, and needs review.
 * - T5 direct agent: the main session ran the threat-modeler agent, which ran a specialist (scout, scoped scout,
 *   enricher or reviewer); both returned without an error. Its writes stay in the walk's model directory (and the
 *   backups beside it); a model-writing shell call fails.
 */
import path from 'node:path'
import fs from 'node:fs'
import { modelDirOf, serverWriteScope } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { ENRICHER_ROLE, REVIEWER_ROLE, SCOUT_ROLES, isWrite, roleOf, selfScheduled } from './h6.js'
import { findModelDirs } from './model-gates.js'
import { outcome, type Finding, type GateOutcome } from './outcome.js'
import type { ShownPrompt } from './prompts.js'
import { TAIL_IDS, type ApprovalLine, type ReplyLine, type TailId } from './run-dir.js'
import { SECRET_GUARD_MARKER } from '../../cli/secret-guard.js'

export const THREAT_MODELER_ROLE = 'threat-modeler'
const SPECIALISTS = [...SCOUT_ROLES, ENRICHER_ROLE, REVIEWER_ROLE]
const READ_ONLY_TAIL: TailId[] = ['status', 'view', 'surface', 'review']
const FORKED: TailId[] = ['review', 'surface']

export interface TailInput {
  /** The whole run's events (not cut) */
  events: TranscriptEvent[]
  replies: ReplyLine[]
  /** Reply line (1-based) → the transcript event it answers */
  pairs: Array<{ line: number; event: number }>
  /** Questions shown over the whole run */
  shown: ShownPrompt[]
  /** The walk's model directory, project-relative ('.' for the root) */
  modelRel: string
  projectRoot: string | null
  /** The project as it ended, after the tail */
  finalProject: string
  /** H3 over the tail's own events */
  h3Tail: GateOutcome
  /** Where the tail's events start in the whole run (H3's event refs are the tail's own) */
  cut: number
  /** The run's tool approvals, to time a call from its approval */
  approvals?: ApprovalLine[]
}

/** What a login call may take once approved: its own wait (the longest when it names none), and some slack. */
const LOGIN_SLACK_MS = 5000
/** The login tool's longest wait, in seconds; kept here so the scorer does not load the tool. A test keeps the two equal. */
export const LOGIN_MAX_WAIT_SECONDS = 45

/** Each tail command's segment: [its event, the next command's event or the end). */
export function tailSegments(input: Pick<TailInput, 'events' | 'replies' | 'pairs'>): Array<{ id: TailId; from: number; to: number } | { id: TailId; missing: true }> {
  const byLine = new Map(input.pairs.map((p) => [p.line, p.event]))
  const starts = TAIL_IDS.map((id) => {
    const line = input.replies.findIndex((r) => r.prompt === `tail:${id}`) + 1
    return { id, from: line ? byLine.get(line) : undefined }
  })
  const end = input.events.length
  return starts.map((s, i) => {
    if (s.from === undefined) return { id: s.id, missing: true as const }
    const next = starts.slice(i + 1).find((x) => x.from !== undefined)?.from
    return { id: s.id, from: s.from, to: next ?? end }
  })
}

export function tailChecks(input: TailInput): GateOutcome[] {
  const { events } = input
  const dir = input.modelRel === '.' ? '' : input.modelRel
  const toRel = (p: unknown): string | undefined => {
    if (typeof p !== 'string') return undefined
    const posix = p.split(path.sep).join('/')
    const rel = path.posix.isAbsolute(posix) && input.projectRoot ? path.posix.relative(input.projectRoot, posix) : path.posix.normalize(posix)
    const out = rel.replace(/^\.\/?/, '').replace(/\/+$/, '')
    return out === '.' ? '' : out
  }
  const callOf = (e: TranscriptEvent) => events.find((c) => c.kind === 'tool_call' && c.callId === e.callId)
  const resultOf = (call: TranscriptEvent) => events.find((r) => r.kind === 'tool_result' && r.callId === call.callId)
  const json = (t: string | undefined): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(t ?? '')
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }
  const segments = tailSegments(input)
  const seg = (id: TailId) => segments.find((s) => s.id === id)
  const inSeg = (s: { from: number; to: number }) => events.filter((e) => e.seq >= s.from && e.seq < s.to)
  /**
   * Every write in a segment, by anyone, and the project paths it may have touched. A server call counts once:
   * by its server write when it returned, by the call when it did not. A platform write touches no project path.
   */
  const writes = (s: { from: number; to: number }) => inSeg(s).filter((e) => isWrite(e, callOf)).flatMap((e) => {
    if (e.kind === 'file_write') return [{ e, paths: [toRel(e.path) ?? '(unknown)'] }]
    if (e.kind === 'server_write') return [{ e, paths: e.touches ?? [] }]
    if (e.kind === 'shell') return [{ e, paths: e.touches ?? ['(shell)'] }]
    if (events.some((x) => x.kind === 'server_write' && x.callId === e.callId)) return []
    return [{ e, paths: serverWriteScope(e.tool ?? '', e.input, (p) => toRel(p) ?? p) ?? [] }]
  })
  const backupOf = (p: string) => !!dir && p.startsWith(`${dir}.backup-`)
  const inModelDir = (p: string) => (dir ? p === dir || p.startsWith(`${dir}/`) : !p.includes('/') || modelDirOf(p) === '')
  const out: GateOutcome[] = []

  // T1
  const t1: Finding[] = []
  for (const s of segments) {
    if ('missing' in s) {
      t1.push({ verdict: 'FAIL', code: 'tail_not_sent', detail: `tail:${s.id} was not sent or is not in the transcript`, refs: [s.id] })
      continue
    }
    const evs = inSeg(s)
    const byMain = evs.some((e) => e.seq > s.from && e.actor === 'main' && e.kind === 'assistant')
    // A forked skill answers through its reviewer: each fork's own last record, its final answer or not.
    const forks = FORKED.includes(s.id) ? [...new Set(evs.filter((e) => e.actor !== 'main' && roleOf(e.actor) === REVIEWER_ROLE).map((e) => e.actorId))] : []
    const lastOf = (fork: string) => [...evs].reverse().find((e) => e.actorId === fork)!
    const returned = forks.some((f) => { const l = lastOf(f); return l.kind === 'assistant' && !!l.text?.trim() })
    if (!byMain && forks.length && !returned) {
      t1.push({ verdict: 'FAIL', code: 'tail_no_output', detail: `tail:${s.id} ended without returning its result`, events: forks.map((f) => lastOf(f).seq), refs: [s.id] })
    } else if (!byMain && !returned) t1.push({ verdict: 'FAIL', code: 'tail_no_turn', detail: `tail:${s.id} got no answer`, events: [s.from], refs: [s.id] })
    for (const e of evs.filter((x) => x.kind === 'tool_result' && x.isError && !(x.text ?? '').includes(SECRET_GUARD_MARKER))) {
      t1.push({ verdict: 'needs-review', code: 'tail_tool_error', detail: `tail:${s.id}: ${e.tool ?? 'a tool'} returned an error`, events: [e.seq], refs: [s.id] })
    }
    for (const e of evs.filter((x) => x.kind === 'compaction')) t1.push({ verdict: 'needs-review', code: 'tail_compaction', detail: `tail:${s.id}: the session was compacted`, events: [e.seq], refs: [s.id] })
    for (const q of input.shown.filter((x) => x.event >= s.from && x.event < s.to && x.answeredBy === undefined && !x.dismissed && !x.compacted && x.via === undefined)) {
      t1.push({ verdict: 'needs-review', code: 'tail_prompt_not_awaited', detail: `tail:${s.id}: ${q.id} was shown without waiting for the operator`, events: [q.event], refs: [s.id] })
    }
  }
  const first = segments.find((s): s is { id: TailId; from: number; to: number } => !('missing' in s))
  if (first) t1.push(...selfScheduled(events.filter((e) => e.seq >= first.from), input.shown, 'tail_self_scheduled_turn'))
  out.push(outcome('T1', t1))

  // T2
  const t2: Finding[] = []
  for (const id of READ_ONLY_TAIL) {
    const s = seg(id)
    if (!s || 'missing' in s) continue
    for (const w of writes(s)) t2.push({ verdict: 'FAIL', code: 'tail_wrote', detail: `tail:${id} made a ${w.e.kind}${w.e.tool ? ` (${w.e.tool})` : ''}${w.e.path ? ` to ${toRel(w.e.path)}` : ''}`, events: [w.e.seq], refs: [id] })
  }
  out.push(outcome('T2', t2))

  // T3
  const t3: Finding[] = []
  const sync = seg('sync')
  if (sync && !('missing' in sync)) {
    const calls = inSeg(sync).filter((e) => e.kind === 'tool_call')
    const intoDir = (c: TranscriptEvent) => toRel((c.input as { directory_path?: unknown })?.directory_path) === dir
    const ok = (c: TranscriptEvent) => { const r = resultOf(c); return !!r && !r.isError }
    // A failed attempt followed by a good one is a pull.
    const exports = calls.filter((c) => c.tool === 'dethereal.export_model' && intoDir(c))
    const pulled = exports.filter((c) => ok(c) && (c.input as { if_exists?: unknown }).if_exists === 'backup')
    if (!pulled.length) t3.push({ verdict: 'FAIL', code: 'tail_no_pull', detail: 'tail:sync exported no platform model into the walk\'s model directory (with if_exists: backup)', events: [sync.from], refs: ['sync'] })
    const merged = calls.some((c) => c.tool === 'dethereal.model_state' && (c.input as { action?: unknown })?.action === 'merge_pulled' && intoDir(c) && ok(c) && pulled.some((x) => x.seq < c.seq))
    if (!merged) t3.push({ verdict: 'FAIL', code: 'tail_no_merge', detail: 'tail:sync did not merge the pulled state in the walk\'s model directory after the pull', events: [sync.from], refs: ['sync'] })
    const backups = exports.map((c) => { const b = json(resultOf(c)?.text); return toRel(b?.backup_path ?? (b?.data as Record<string, unknown> | undefined)?.backup_path) }).filter((b): b is string => !!b)
    const allowed = (p: string) => inModelDir(p) || p === '.dethernety' || p.startsWith('.dethernety/') || backups.some((b) => p === b || p.startsWith(`${b}/`)) || backupOf(p)
    for (const w of writes(sync)) {
      const outside = w.paths.map((p) => p.replace(/\/+$/, '')).filter((p) => !allowed(p))
      if (outside.length) t3.push({ verdict: 'FAIL', code: 'tail_pull_outside', detail: `tail:sync wrote outside the walk's model directory: ${outside.join(', ')}`, events: [w.e.seq], refs: ['sync'] })
    }
    const dirs = findModelDirs(input.finalProject).map((d) => path.relative(input.finalProject, d).split(path.sep).join('/') || '.')
    if (dirs.length !== 1 || (dirs[0] === '.' ? '' : dirs[0]) !== dir) t3.push({ verdict: 'FAIL', code: 'tail_model_dirs', detail: `after the tail the project holds ${dirs.length} model directories (${dirs.join(', ') || 'none'}); one, the walk's, is required`, refs: ['sync'] })
    const others = registered(input.finalProject).map((p) => (path.posix.isAbsolute(p) ? toRel(p) : toRel(path.posix.join('.', p)))).filter((p) => p !== dir)
    if (others.length) t3.push({ verdict: 'FAIL', code: 'tail_model_dirs', detail: `after the tail the registry lists another model directory: ${[...new Set(others)].join(', ')}`, refs: ['sync'] })
  }
  out.push(outcome('T3', t3))

  // T4
  const t4: Finding[] = []
  const login = seg('login')
  if (login && !('missing' in login)) {
    const call = inSeg(login).find((e) => e.kind === 'tool_call' && e.tool === 'dethereal.login' && (e.input as { force_new?: unknown })?.force_new === true)
    const result = call && resultOf(call)
    const body = json(result?.text)
    const status = body?.status ?? (body?.data as Record<string, unknown> | undefined)?.status
    if (!call) t4.push({ verdict: 'FAIL', code: 'tail_login_not_new', detail: 'tail:login started no new sign-in (login with force_new)', events: [login.from], refs: ['login'] })
    else if (!result || result.isError || (status !== 'pending' && status !== 'authenticated')) {
      t4.push({ verdict: 'FAIL', code: 'tail_login_not_pending', detail: `tail:login reported ${String(status ?? (result?.isError ? 'an error' : 'nothing'))}, not pending`, events: [call.seq], refs: ['login'] })
    } else if (status === 'authenticated') {
      // Signed in during the call is right if the call kept to its wait: it must never block past it.
      const wait = Number((call.input as { wait?: unknown }).wait)
      const budget = Math.min(Number.isFinite(wait) && wait >= 0 ? wait : LOGIN_MAX_WAIT_SECONDS, LOGIN_MAX_WAIT_SECONDS) * 1000 + LOGIN_SLACK_MS
      const asked = Date.parse(call.ts)
      // The harness names the tool with its own prefix (mcp__plugin_…__login).
      const approval = (input.approvals ?? []).find((a) => a.decision === 'approve' && /(^|_)login$/.test(a.tool) && Date.parse(a.ts) >= asked && Date.parse(a.ts) <= Date.parse(result.ts))
      const took = Date.parse(result.ts) - (approval?.decidedAt ? Date.parse(approval.decidedAt) : asked)
      if (took > budget) {
        const s = Math.round(took / 1000)
        // The operator's own decision, at a dialog or after the autopilot stopped, is timed only when the run recorded it.
        const byHand = !!approval && (!approval.autopilotRule || approval.autopilotRule === 'operator-after-stop')
        if (byHand && !approval!.decidedAt) {
          t4.push({ verdict: 'needs-review', code: 'tail_login_wait_unknown', detail: `tail:login answered ${s} s after the call: the approval dialog waited on the operator, or the call blocked; the run does not record when the operator approved`, events: [call.seq, result.seq], refs: ['login'] })
        } else {
          t4.push({ verdict: 'FAIL', code: 'tail_login_blocked', detail: `tail:login took ${s} s after it was ${approval ? 'approved' : 'called, with no approval recorded'}, past its ${budget / 1000} s wait`, events: [call.seq, result.seq], refs: ['login'] })
        }
      }
    }
  }
  for (const f of input.h3Tail.findings) t4.push({ ...f, code: `tail_${f.code}`, detail: `over the tail: ${f.detail}`, ...(f.events ? { events: f.events.map((e) => e + input.cut) } : {}) })
  out.push(outcome('T4', t4))

  // T5
  const t5: Finding[] = []
  const agent = seg('threat-modeler')
  if (agent && !('missing' in agent)) {
    const evs = inSeg(agent)
    const runOf = (start: TranscriptEvent) => ({ start, end: evs.find((e) => e.kind === 'subagent_end' && e.callId === start.callId) })
    const outer = evs.filter((e) => e.kind === 'subagent_start' && e.actor === 'main' && roleOf(e.text) === THREAT_MODELER_ROLE).map(runOf)
    if (!outer.length) {
      t5.push({ verdict: 'FAIL', code: 'tail_agent_not_exercised', detail: 'the direct mention started no threat-modeler run', events: [agent.from], refs: ['threat-modeler'] })
    } else {
      if (!outer.some((r) => r.end && !r.end.isError)) t5.push({ verdict: 'FAIL', code: 'tail_agent_no_return', detail: 'the threat-modeler run did not return cleanly', events: [outer[0]!.start.seq], refs: ['threat-modeler'] })
      const inner = evs.filter((e) => e.kind === 'subagent_start' && roleOf(e.actor) === THREAT_MODELER_ROLE && SPECIALISTS.includes(roleOf(e.text))).map(runOf)
      if (!inner.some((r) => r.end && !r.end.isError)) {
        t5.push({ verdict: 'FAIL', code: 'tail_agent_no_specialist', detail: 'the threat-modeler ran no specialist that returned cleanly', events: [outer[0]!.start.seq], refs: ['threat-modeler'] })
      }
    }
    for (const w of writes(agent)) {
      const outside = w.paths.map((p) => p.replace(/\/+$/, '')).filter((p) => !inModelDir(p) && !backupOf(p))
      if (outside.length || w.e.kind === 'shell') t5.push({ verdict: 'FAIL', code: 'tail_agent_wrote_outside', detail: `the direct agent run wrote ${w.e.kind === 'shell' ? 'the model through a shell call' : `outside the walk's model directory: ${outside.join(', ')}`}`, events: [w.e.seq], refs: ['threat-modeler'] })
    }
  }
  out.push(outcome('T5', t5))
  return out
}

/** The model paths the project's registry lists (an unreadable registry lists none). */
function registered(project: string): string[] {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(project, '.dethernety', 'models.json'), 'utf8')) as { models?: unknown }
    return Array.isArray(doc.models) ? doc.models.map((m) => (m as { path?: unknown } | null)?.path).filter((p): p is string => typeof p === 'string' && !!p) : []
  } catch {
    return []
  }
}
