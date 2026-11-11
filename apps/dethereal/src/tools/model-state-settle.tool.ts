/**
 * model_state_settle — records the operator's decisions on attribute and
 * record values, so that a value counts as theirs.
 *
 * `settle` takes up to 50 items, each naming its value: a pending row accepted
 * (its value shown in the call), rejected (its previous state restored, the
 * field registered as left empty) or modified (the operator's value written),
 * a value confirmed as it stands on disk, a registered value confirmed as
 * gone, or a value the operator confirmed in the chat set directly (`set`).
 * The call always asks for approval, and every value it registers is in its
 * arguments. All or nothing: a call with any refused item writes nothing.
 *
 * Not every harness shows the call's values in its approval dialog, so the
 * result echoes every registration it made: the value, the value the file held
 * before, and how that value was registered. The workflow shows the echo back,
 * and a restore is another `set` batch built from it. A confirm or accept that
 * registers the value the file already holds, on a field unregistered or the
 * operator's, is echoed under its element with its value only (the value it
 * replaced is the same, and nothing about its registration changes hands).
 *
 * Registration-only decisions may also come as two maps, `confirm` and
 * `accept`, keyed `<group>/<element_id>/<field>`: each entry is the item it
 * stands for, its value still in the arguments; and the pending rows of one
 * range of the pending file may be accepted as shown (`accept_rows`), bound to
 * the file's digest, with the rows left out named.
 *
 * `prepare` checks a call as `settle` would and writes nothing: it returns a
 * plan id and the lines that say what the call records, rendered here. `commit`
 * runs that plan once, with the operator's reply, and writes only while the
 * model is what the plan was checked against.
 */
import { z } from 'zod'
import { resultText, ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import { Refusal, recordDiffersOf } from './model-state.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { LockBusyError, LockLostError, type FileLockHandle } from '../utils/file-lock.js'
import {
  loadGateInput,
  pendingRowJudge,
  pendingFromRaw,
  FLOOR_KEYS,
  safeErrorMessage,
  updateBaselinePointers,
  waiverKeyState,
  withPointerLock,
  MODEL_REF_ID,
  PENDING_FIELD,
  PENDING_GROUPS,
  RECORD_FIELDS,
  SETTLE_GROUPS,
  SETTLED_RECORD_FIELDS,
  type PendingEntry,
  type PendingGroup,
  type SettledRecordField,
} from '../utils/gates.js'
import { ELEMENT_ID } from '../utils/lints.js'
import { SETTABLE_RECORDS, fieldRefusal, recordRefusal, templateFor, valueRefusal } from '../utils/registrable.js'
import {
  ABSENT,
  BASELINE_FILE,
  PENDING_FILE_REL,
  SETTLEMENTS_FILE,
  NOT_RECORDED,
  ORPHAN_CAUSE,
  SETTLE_LIMITS,
  canonicalJson,
  contentOf,
  controlsFlagged,
  elementKey,
  entryKey,
  logDigest,
  nextLog,
  replyProblem,
  sameValue,
  signedBaseline,
  undisplayable,
  valueHash,
  type AttributeFile,
  type BaselineContent,
  type ValueKind,
} from '../utils/settlement.js'
import { settlementState, type SettlementState } from '../utils/settlement-state.js'
import { ensureGitignore } from '../utils/settlement-writers.js'
import { StateFileError, withSettlementLock, type SettlementIO, type SettlementOptions } from '../utils/state-store.js'
import { PLAN_ID, PLAN_LIMITS, SettlePlanStore, type PlanBound, type SettlePlan } from '../utils/settle-plans.js'
import { cell, hashedText } from '../utils/pending-table.js'
import { renderedCovers } from '../utils/rendered-pages.js'
import { sha256Hex } from '../utils/hash.js'

/** What the schema takes before trimming: room around the cap, so a longer reply meets the refusal below, not a schema error. */
const REPLY_INPUT_MAX = 2 * SETTLE_LIMITS.replyChars + 384

/** Why a reply was refused, with what to send instead. */
export function replyRefusal(reply: string): string {
  const t = reply.trim()
  const rule = `reply must be the operator's words (1–${SETTLE_LIMITS.replyChars} characters, newlines allowed, no invisible or control characters)`
  return t.length > SETTLE_LIMITS.replyChars
    ? `reply has ${t.length} characters, over ${SETTLE_LIMITS.replyChars}: send the operator's whole reply when it fits; when it does not, ` +
      'a verbatim excerpt that holds these decisions (the operator\'s words unchanged, never reworded), with […] where text was cut'
    : rule
}

const ItemSchema = z.object({
  row: z.number().int().min(1).optional().describe('The pending row as shown to the operator (advisory)'),
  group: z.enum(SETTLE_GROUPS).describe(`An element group, or "model" (element_id "${MODEL_REF_ID}", field "controls") for the model's own controls`),
  element_id: z.string().max(256),
  field: z.string().max(256),
  decision: z.enum(['accept', 'reject', 'modify', 'confirm', 'set']),
  element_name: z.string().max(512).optional().describe("set: the element's name as the model holds it (checked)"),
  value: z.unknown().optional().describe('accept, modify, confirm: the value as the file holds it (null with removed); set: the value to write'),
  absent: z.boolean().optional().describe('set only: remove the field (it held nothing before); no value'),
  record: z.boolean().optional().describe("The field is the element's record (classData, zone, placement, …), not an attribute: needed only where a record and an attribute share the name, and on set"),
  removed: z.boolean().optional().describe('confirm only: the registered value is gone (value null)'),
  previous: z.unknown().optional()
    .describe('controls only: the registered list exactly as model_state get (include [\'unregistered_rows\']) showed it in controls_change.from (null where it showed "not_recorded"); required on a flagged row'),
}).strict()

/**
 * The compact form's limits: entries short enough to read in a dialog, and items plus entries at most `decisions`, so
 * one call can carry every decision of one operator answer.
 */
export const MAP_LIMITS = { decisions: 250, valueBytes: 256, chars: 24_000 } as const
const DecisionMap = z.record(z.string().max(600), z.unknown())

/** One range of the pending file, accepted as shown: rows `from`–`to` as get numbers them, but those in `except`. */
const AcceptRowsSchema = z.object({
  from: z.number().int().min(1).max(100_000),
  to: z.number().int().min(1).max(100_000),
  digest: z.string().regex(/^[0-9a-f]{64}$/).describe("The pending file's digest, as get gave it with the rows shown"),
  except: z.array(z.number().int().min(1).max(100_000)).max(MAP_LIMITS.decisions).optional()
    .describe('The rows of the range not accepted here (always given, [] for none): rows answered as items, or left pending'),
}).strict()

/** The decisions of the call that hold only the plan: the operator's reply comes with the commit. */
const PLAN_FIELDS = ['items', 'confirm', 'accept', 'accept_rows', 'orphaned_acknowledged'] as const

const InputSchema = z.object({
  action: z.enum(['settle', 'prepare', 'commit'])
    .describe("'settle' records the decisions now, with the reply; 'prepare' checks them and returns a plan and the lines to show, " +
      "writing nothing; 'commit' records a prepared plan, with the operator's reply"),
  directory_path: z.string().max(4096).describe('Model directory'),
  items: z.array(ItemSchema).max(SETTLE_LIMITS.items).optional().describe("settle and prepare: the decisions, up to 50, each naming its value ([] when the maps or rows hold them all)"),
  confirm: DecisionMap.optional().describe(
    'Registration-only confirms, { "<group>/<element_id>/<field>": value } with the value as the file holds it: each entry is ' +
    'exactly a confirm item. A record field (placement, classData, zone, …) is read as the record unless the element\'s ' +
    'attribute bag holds a field of that name; then name it as an item with record: true. Values of 256 bytes at most; ' +
    'controls, removals and longer values go as items.'),
  accept: DecisionMap.optional().describe('Pending rows accepted, keyed and limited as confirm: each entry is exactly an accept item with that value.'),
  accept_rows: AcceptRowsSchema.optional()
    .describe("settle and prepare: one range of pending rows accepted as shown, by get's row numbers and digest; every row of a field " +
      'goes the same way, and a row of the range named as an item must be in except'),
  reply: z.string().max(REPLY_INPUT_MAX).optional()
    .describe(`settle and commit: the operator's reply, quoted verbatim (1–${SETTLE_LIMITS.replyChars} characters); only when it is longer, a verbatim excerpt that holds these decisions, with […] where text was cut`),
  orphaned_acknowledged: z.number().int().min(0).optional()
    .describe(`orphaned_registrations.total from model_state get, shown to the operator: those registrations of ${ORPHAN_CAUSE} elements are dropped`),
  plan_id: z.string().regex(PLAN_ID).optional().describe('commit: the plan prepare returned'),
  lines: z.array(z.string().max(16_000)).max(1_000).optional()
    .describe("commit: the plan's lines exactly as prepare returned them, the operator having been shown them: the approval shows what is recorded"),
}).strict()

type Input = z.infer<typeof InputSchema>
type Item = z.infer<typeof ItemSchema>

interface Refused {
  index: number | null
  code: string
  message: string
  key?: string
  /** The pending rows an accepted range turned into this item */
  rows?: number[]
  /** A placement confirm: the value as the model files show it */
  expected?: unknown
  /** How the item is sent instead */
  fix?: { record: boolean }
}

/** Record values only the operator settles directly, in the main session: never through a plan. */
const TRUST_FIELDS = new Set(['zone', 'planes', 'conduits', 'crownJewel'])

/** What a call is: a settle now, a plan, or the commit of one. */
type Run =
  | { mode: 'settle'; reply: string }
  | { mode: 'prepare' }
  | { mode: 'commit'; reply: string; plan: SettlePlan<Input>; progress: { started: boolean; wrote: boolean } }

/** Refusals on this machine's own state: no decision of the plan is at fault, and the same plan commits once it is fixed. */
const MACHINE_REFUSALS = new Set(['pointer_unavailable', 'baseline_key_unavailable', 'attribute_issues', 'consolidated_attributes', 'pending_enrichment', 'unreadable', 'busy'])

/** What one call will change. */
interface Plan {
  /** attribute file rel -> the file as read and its new attributes */
  files: Map<string, { file: AttributeFile; attributes: Record<string, unknown> }>
  /** pending entry indices to remove */
  removePending: Set<number>
  set: Map<string, string>
  /** Controls lists registered in this call, as projected: the list a later change is shown against */
  controls: Map<string, unknown>
  decisions: Record<string, number>
  alreadySettled: number[]
  /** Record values set in this call, with the value each field held when planned */
  records: Array<{ group: string; id: string; field: string; value: unknown; absent: boolean; before: unknown }>
  /** Every registration this call makes, in call order */
  echo: Array<Record<string, unknown>>
  /** Set by the write: the baseline revision it signed (the batch's id) */
  revision?: number
  /** Set by the write: why the log started afresh */
  logRestarted?: string | null
  /** Set by the write: `.dethereal/.gitignore` as the write left it */
  gitignore?: 'written' | 'present' | 'refused'
}

const SEP = String.fromCharCode(0)

/** The largest result, as sent (compact), that still carries the whole echo: half the smallest inline tool result measured. */
export const ECHO_BUDGET = 24_000

/**
 * The echo as returned. An accept of a pending row whose value the file already held, on a field nobody had
 * registered, is only counted (`acceptedUnchanged`): the value is the row's, as the operator was shown it. A confirm,
 * or an accept over the operator's own registration, of the value the file already held, with a displayable element
 * name, is listed under its element (`<group>/<element_id>`) with its value, records apart from attributes.
 * Everything else keeps its full entry: a changed value, a set, a modify, a reject, a removal, a registration that
 * changes hands, a controls list, an undisplayable name or value.
 */
export function splitEcho(echo: Array<Record<string, unknown>>): {
  full: Array<Record<string, unknown>>
  unchanged: Record<string, { name: string; attributes?: Record<string, unknown>; records?: Record<string, unknown> }>
  acceptedUnchanged: number
} {
  const full: Array<Record<string, unknown>> = []
  const unchanged: Record<string, { name: string; attributes?: Record<string, unknown>; records?: Record<string, unknown> }> = {}
  let acceptedUnchanged = 0
  for (const e of echo) {
    const value = e.value as { value?: unknown } | undefined
    const prev = e.previous as { value?: unknown } | undefined
    const reg = e.previous_registered as string | { state?: string; by?: string } | undefined
    const owned = reg === 'unregistered' || (typeof reg === 'object' && reg?.state === 'registered' && reg.by === 'operator')
    const same = !!value && Object.hasOwn(value, 'value') && !!prev && Object.hasOwn(prev, 'value') && canonicalJson(value.value) === canonicalJson(prev.value)
    if ((e.decision === 'confirm' || e.decision === 'accept') && same && owned && typeof e.element_name === 'string' && e.field !== 'controls') {
      if (e.decision === 'accept' && reg === 'unregistered') {
        acceptedUnchanged++
        continue
      }
      const k = `${String(e.group)}/${String(e.element_id)}`
      const slot = (unchanged[k] ??= { name: e.element_name })
      ;(e.record ? (slot.records ??= {}) : (slot.attributes ??= {}))[String(e.field)] = value.value
    } else full.push(e)
  }
  return { full, unchanged, acceptedUnchanged }
}

/** A value as the echo shows it: absent, neutralised when it cannot be shown safely, or as it is. */
function shown(v: unknown): Record<string, unknown> {
  if (v === undefined) return { absent: true }
  if (undisplayable(v)) return { undisplayable: true, sha256: valueHash(v) }
  return { value: v }
}

/** Whether an item is a record or an attribute, or why its call is refused. */
type KindRead = { kind: ValueKind } | { code: string; message: string; fix?: { record: boolean } }

/**
 * Record or attribute: as the item says, else read from the name where it can be only one. `held` is whether the
 * element's attribute file or class template has a field of that name. set, modify and reject say which; a record
 * they cannot write is refused as such, never sent back with a flag that would be refused next.
 */
function readKind(item: Item, held: boolean): KindRead {
  const recordName = item.group === 'model' || (SETTLED_RECORD_FIELDS as readonly string[]).includes(item.field)
  if (item.record === true) {
    return recordName ? { kind: 'record' } : { code: 'record_flag', message: `${item.field} is not a record of the element: send it without record: true`, fix: { record: false } }
  }
  if (item.record === false) {
    return recordName && !held
      ? { code: 'record_flag', message: `${item.field} is a record of the element, and no attribute has that name: send it with record: true`, fix: { record: true } }
      : { kind: 'attr' }
  }
  if (!recordName) return { kind: 'attr' }
  if (held) return { code: 'ambiguous_field', message: `the element's attribute file or class template holds a field named ${item.field}: say record: true for the record, false for the attribute` }
  if (item.decision === 'accept' || item.decision === 'confirm' || item.group === 'model') return { kind: 'record' }
  if (item.decision !== 'set') return { code: 'record_field', message: `${item.field} is a record field: edit it through the workflow, then confirm it` }
  if (!SETTABLE_RECORDS[item.field]) return { code: 'record_field', message: `${item.field} is set through the workflow, then confirmed` }
  return { code: 'record_flag', message: `${item.field} is a record of the element: set names it with record: true`, fix: { record: true } }
}

/** A second commit of a plan a commit already ran: what became of it. */
function spentRefusal(end: 'committed' | 'stale' | 'failed'): Refusal {
  if (end === 'committed') return new Refusal('the plan was committed already: its values are registered, nothing to redo', { codes: ['plan_used'] })
  if (end === 'stale') return new Refusal('the plan was found stale and nothing was written: prepare again', { codes: ['plan_stale'] })
  return new Refusal("the plan's commit failed after part of its write: get the model's state, then prepare again", { codes: ['plan_failed'] })
}

/** Where the lines a commit passed differ from the plan's, as short excerpts; null when they are the same. */
function linesDiffer(planned: readonly string[], given: readonly string[] | undefined): { index: number; expected: string | null; got: string | null } | null {
  if (given === undefined) return { index: 0, expected: planned[0]?.slice(0, 200) ?? null, got: null }
  const n = Math.max(planned.length, given.length)
  for (let i = 0; i < n; i++) {
    if (planned[i] !== given[i]) return { index: i, expected: planned[i]?.slice(0, 200) ?? null, got: given[i]?.slice(0, 200) ?? null }
  }
  return null
}

/** A commit whose plan no longer holds: nothing was written, and the plan is used up. */
function stale(what: string): Refusal {
  return new Refusal(`the plan no longer holds (${what} changed since prepare); nothing was written: prepare again`, { codes: ['plan_stale'] })
}

/** A failed call as the tool reports it. */
function failure(err: unknown): ToolResult<Record<string, unknown>> {
  if (err instanceof Refusal) return { success: false, error: err.message, ...(Object.keys(err.details).length ? { data: err.details } : {}) }
  if (err instanceof LockBusyError) return { success: false, error: 'another settlement is writing (this model, or this machine\'s settlement pointer); retry', data: { codes: ['busy'] } }
  if (err instanceof StateFileError) return { success: false, error: err.message, data: { codes: [err.code === 'changed' ? 'changed' : 'unreadable'] } }
  return { success: false, error: safeErrorMessage(err, 'model_state_settle failed') }
}

export class ModelStateSettleTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'model_state_settle'
  readonly description =
    "Record the operator's decisions on attribute and record values, so they count as the operator's. Up to 50 items, each " +
    "naming its value: accept a pending row (with its value), reject it (restore the previous state), modify it (write the " +
    "operator's value), confirm a value as the file holds it, or confirm that a registered value is gone (value null, " +
    "removed: true). A record field (classData, zone, placement, …) is read from its name, except on set, modify and reject, " +
    "and where an attribute shares the name: say record: true or false there. Quote the operator's reply; never " +
    'call this on your own. set writes a value the operator confirmed in the chat (element_name must be the element\'s ' +
    'name; absent: true removes a field). Confirms and accepts of values as the file holds them may instead go in the ' +
    'confirm and accept maps, keyed "<group>/<element_id>/<field>" (up to 250 decisions and 24,000 map characters per call ' +
    'with the items: one call can carry every decision of one answer), and one range of pending rows may be accepted as ' +
    'shown with accept_rows {from, to, digest, except}, by the row numbers and digest of the table get gave. The result ' +
    'echoes every value registered: in echo, each change with the value it replaced; in registered_unchanged, by element, ' +
    'each value confirmed as it stood; accepted_unchanged counts the rows accepted as they stood. Show them to the operator. ' +
    'On some harnesses the approval dialog does not show the values; the chat table and this result are what the operator ' +
    "sees. All or nothing: a call with any refused item writes nothing. prepare checks the same call, writes nothing and " +
    "returns plan_id and lines to show the operator as they are; commit {plan_id, reply} records that plan once, from the " +
    'main session, and refuses (plan_stale) when the model moved since prepare. Trust decisions (zone, planes, conduits, ' +
    'crownJewel) are never prepared: settle them directly.'
  readonly inputSchema = InputSchema

  /** Tests only: passed to the store so a retry can be proven to converge. */
  storeOptions: SettlementOptions = {}

  /** Prepared plans, in this server process only. */
  readonly plans = new SettlePlanStore<Input>()

  async execute(input: Input, _context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      if (input.action === 'commit') return await this.commit(dir, input)
      if (input.plan_id !== undefined) throw new Refusal('plan_id goes with commit only', { codes: ['plan_on_commit'] })
      if (input.lines !== undefined) throw new Refusal('lines go with commit only', { codes: ['plan_on_commit'] })
      if (input.action === 'prepare' && input.reply !== undefined) {
        throw new Refusal("prepare takes no reply: the operator's reply goes with the commit, from the main session", { codes: ['reply_on_commit'] })
      }
      if (input.action === 'settle' && (input.reply === undefined || replyProblem(input.reply))) {
        throw new Refusal(replyRefusal(input.reply ?? ''), { codes: ['reply_invalid'] })
      }
      if (input.items === undefined) throw new Refusal('items is required ([] when the maps or rows hold every decision)', { codes: ['items_required'] })
      const rows = input.accept_rows
      const ranged = rows && rows.from <= rows.to ? rows.to - rows.from + 1 - new Set((rows.except ?? []).filter((r) => r >= rows.from && r <= rows.to)).size : 0
      const total = input.items.length + Object.keys(input.confirm ?? {}).length + Object.keys(input.accept ?? {}).length + ranged
      // Dropping the registrations of gone elements is a decision of its own: a call may hold nothing else.
      const dropsOrphans = (input.orphaned_acknowledged ?? 0) > 0
      if (total === 0 && !rows && !dropsOrphans) throw new Refusal(`name 1–${SETTLE_LIMITS.items} items, or confirm/accept entries`, { codes: ['too_many_items'] })
      if (total > MAP_LIMITS.decisions) throw new Refusal(`name at most ${MAP_LIMITS.decisions} decisions in one call (items, map entries and accepted rows together)`, { codes: ['too_many_items'] })
      const mapChars = JSON.stringify(input.confirm ?? {}).length + JSON.stringify(input.accept ?? {}).length
      if (mapChars > MAP_LIMITS.chars) throw new Refusal(`the confirm and accept maps hold ${mapChars} characters, more than ${MAP_LIMITS.chars}: split the call`, { codes: ['too_many_items'] })
      await this.keyReady(dir)
      const run: Run = input.action === 'prepare' ? { mode: 'prepare' } : { mode: 'settle', reply: input.reply! }
      const data = await withPointerLock((lock) => withSettlementLock(dir, (io) => this.settle(dir, input, io, lock, run), this.storeOptions))
      return { success: true, data }
    } catch (err) {
      return failure(err)
    }
  }

  /** The key first (created on a fresh machine): the pointer lock lives beside it. */
  private async keyReady(dir: string): Promise<void> {
    const key = await waiverKeyState(true, dir)
    if (!key.key) throw new Refusal(`this machine's key cannot be used (${key.code ?? 'key_absent'}), so nothing can be registered; fix the key first`, { codes: ['baseline_key_unavailable'] })
  }

  /**
   * A prepared plan, recorded with the operator's reply and the plan's own lines (so the approval shows what is
   * recorded). The plan is taken before anything is awaited, so two commits of it never both run. It is used up when
   * the commit records it, finds it stale (nothing written), or fails after part of its write; it stays committable
   * when the commit could not start, or was refused on the machine's own state, by a lock or by a state file before
   * any write.
   */
  private async commit(dir: string, input: Input): Promise<ToolResult<Record<string, unknown>>> {
    const extra = PLAN_FIELDS.filter((f) => input[f] !== undefined)
    if (extra.length) throw new Refusal(`commit takes the plan, its lines, the directory and the reply only (${extra.join(', ')} given): the decisions are the plan's`, { codes: ['commit_takes_plan_only'] })
    if (input.plan_id === undefined) throw new Refusal('commit names the plan prepare returned (plan_id)', { codes: ['plan_required'] })
    if (input.reply === undefined || replyProblem(input.reply)) throw new Refusal(replyRefusal(input.reply ?? ''), { codes: ['reply_invalid'] })
    const taken = this.plans.take(input.plan_id, dir)
    if (taken.status !== 'ok') {
      if (taken.status === 'spent') throw spentRefusal(taken.end)
      if (taken.status === 'running') throw new Refusal('a commit of this plan is running now: commit it again once, and the answer says how that commit ended', { codes: ['busy'] })
      const why = {
        not_found: 'no such plan in this session (a restart forgets plans): prepare again',
        expired: `the plan is older than ${PLAN_LIMITS.ttlMs / 60_000} minutes: prepare again`,
        other_model: 'the plan was prepared for another model directory',
      }[taken.status]
      throw new Refusal(why, { codes: [`plan_${taken.status}`] })
    }
    const plan = taken.plan
    const differs = linesDiffer(plan.lines, input.lines)
    if (differs) {
      this.plans.release(plan)
      throw new Refusal("commit passes the plan's lines exactly as prepare returned them, as the operator was shown them; nothing was written", { codes: ['lines_differ'], ...differs })
    }
    const progress = { started: false, wrote: false }
    try {
      await this.keyReady(dir)
      const data = await withPointerLock((lock) => withSettlementLock(dir, (io) => {
        progress.started = true
        return this.settle(dir, plan.input, io, lock, { mode: 'commit', reply: input.reply!, plan, progress })
      }, this.storeOptions))
      this.plans.consume(plan, 'committed')
      return { success: true, data }
    } catch (err) {
      if (!progress.started) {
        this.plans.release(plan)
        return failure(err)
      }
      // Nothing was written, and the machine's own state refused it: fixed, the same plan commits.
      const codes = err instanceof Refusal ? ((err.details.codes as string[] | undefined) ?? []) : []
      if (!progress.wrote && (codes.some((c) => MACHINE_REFUSALS.has(c)) || err instanceof StateFileError || err instanceof LockBusyError || err instanceof LockLostError)) {
        this.plans.release(plan)
        return failure(err)
      }
      if (progress.wrote) {
        this.plans.consume(plan, 'failed')
        return failure(new Refusal(`the commit failed after part of its write (${safeErrorMessage(err)}): get the model's state, then prepare again`, { codes: ['plan_failed'] }))
      }
      this.plans.consume(plan, 'stale')
      if (err instanceof Refusal && !codes.includes('plan_stale')) {
        return failure(new Refusal(`the plan no longer holds (${err.message}); nothing was written: prepare again`, { codes: ['plan_stale'], refused_with: err.details }))
      }
      return failure(err)
    }
  }

  /**
   * One range of the pending file as accept items: every row from `from` to `to` but those in `except`, each field's
   * rows as one item, refused whole when any row of the range cannot be accepted as it was shown. The rows are file
   * positions, as get numbers them, and the file must still be the one shown (its digest).
   */
  private acceptRows(
    r: z.infer<typeof AcceptRowsSchema>,
    ctx: {
      dir: string
      st: SettlementState
      pending: ReturnType<typeof pendingFromRaw>
      pendingRaw: Record<string, unknown> | null
      gate: Awaited<ReturnType<typeof loadGateInput>>
    },
  ): { items: Array<{ item: Item; rows: number[] }>; fields: Set<string> } {
    if (r.except === undefined) throw new Refusal('accept_rows names the rows it leaves out: give except, [] when it leaves none', { codes: ['except_required'] })
    const size = Array.isArray(ctx.pendingRaw?.entries) ? (ctx.pendingRaw!.entries as unknown[]).length : 0
    if (r.from > r.to || r.to > size) throw new Refusal(`the range is rows ${r.from}–${r.to}, but the pending file holds rows 1–${size}`, { codes: ['range_invalid'] })
    const except = new Set(r.except)
    if ([...except].some((x) => x < r.from || x > r.to)) throw new Refusal('except names rows outside the range', { codes: ['except_outside_range'] })
    if ((ctx.pending.digest ?? null) !== r.digest) {
      throw new Refusal('the pending file is not the one the rows were shown from: get the rows again and show them', { codes: ['digest_changed'] })
    }
    // Only rows of a table page rendered here can have been shown to the operator.
    const shown = renderedCovers(ctx.dir, r.digest, r.from, r.to)
    if (!shown.covered) {
      throw new Refusal(`rows ${r.from}–${r.to} were not all on a table page rendered for this pending file: show the page they are on (get with pending_render 'table'), then accept within it`,
        { codes: ['rows_not_rendered'], rendered: shown.rendered })
    }
    const all = ctx.pending.all ?? ctx.pending.entries
    const byIndex = new Map(all.map((e) => [e.index, e]))
    const tripleOf = (e: { group: string; element_id: string; field: string }) => `${e.group}${SEP}${e.element_id}${SEP}${e.field}`
    const rowsOfField = new Map<string, number[]>()
    for (const e of all) rowsOfField.set(tripleOf(e), [...(rowsOfField.get(tripleOf(e)) ?? []), e.index + 1])
    const bad: Array<{ row: number; reason: string }> = []
    const chosen = new Map<string, { item: Item; rows: number[] }>()
    const judge = pendingRowJudge(ctx.gate, { recordDiffers: recordDiffersOf(ctx.st) })
    for (let row = r.from; row <= r.to; row++) {
      if (except.has(row)) continue
      const e = byIndex.get(row - 1)
      if (!e) { bad.push({ row, reason: 'malformed' }); continue }
      const t = tripleOf(e)
      const done = chosen.get(t)
      if (done) { done.rows.push(row); continue }
      const { problem, record } = judge(e)
      if (problem === 'element_gone') { bad.push({ row, reason: problem }); continue }
      // Every row of a field goes one way: a field with a row left out, or outside the range, is not accepted here.
      if (rowsOfField.get(t)!.some((x) => except.has(x) || x < r.from || x > r.to)) { bad.push({ row, reason: 'field_rows_split' }); continue }
      if (problem) { bad.push({ row, reason: problem }); continue }
      chosen.set(t, { item: { group: e.group, element_id: e.element_id, field: e.field, decision: 'accept', value: e.value, record }, rows: [row] })
    }
    if (bad.length) {
      throw new Refusal(`${bad.length} row(s) of the range cannot be accepted as shown: put them in except and answer them as items (or leave them pending)`,
        { codes: ['row_not_acceptable'], rows: bad.slice(0, 100), rows_total: bad.length })
    }
    return { items: [...chosen.values()], fields: new Set(chosen.keys()) }
  }

  /** Read everything under the locks, and refuse what no decision can fix. */
  private async load(dir: string, io: SettlementIO) {
    let gate
    try {
      gate = await loadGateInput(dir)
    } catch (err) {
      throw new Refusal(`the model could not be read (${safeErrorMessage(err)})`, { codes: ['attribute_issues'] })
    }
    const pendingBytes = await io.read(PENDING_FILE_REL)
    let pendingRaw: Record<string, unknown> | null = null
    if (pendingBytes) {
      try {
        pendingRaw = JSON.parse(pendingBytes.toString('utf8'))
      } catch {
        throw new Refusal('the pending-enrichment file cannot be read; it must be repaired before anything is settled', { codes: ['pending_enrichment'] })
      }
    }
    const pending = pendingFromRaw(pendingRaw)
    if (pending.state === 'unreadable') throw new Refusal(`the pending-enrichment file cannot be read (${pending.code})`, { codes: ['pending_enrichment'] })
    gate = { ...gate, pending }
    const st = await settlementState(dir, gate)
    if (st.baseline.status === 'unavailable' || !st.key || !st.modelHash || !st.pointers.usable) {
      if (st.baseline.code === 'pointer_unavailable' || !st.pointers.usable) {
        throw new Refusal("this machine's settlement pointer file cannot be used, so no rollback can be seen and nothing can be registered; fix the file beside the key first", { codes: ['pointer_unavailable'] })
      }
      throw new Refusal(`this machine's key cannot be used (${st.baseline.code ?? st.keyCode ?? 'key_absent'}), so nothing can be registered; fix the key first`, { codes: ['baseline_key_unavailable'] })
    }
    if (st.scan.consolidated) throw new Refusal('the model keeps its attributes in one attributes.json; split it into per-element files first', { codes: ['consolidated_attributes'] })
    if (gate.attributeIssues.length || st.scan.unreadable.length) {
      throw new Refusal(`${gate.attributeIssues.length + st.scan.unreadable.length} attribute file(s) cannot be read; fix them first`, { codes: ['attribute_issues'] })
    }
    const baselineBytes = await io.read(BASELINE_FILE)
    const logBytes = await io.read(SETTLEMENTS_FILE)
    return { gate, st, pending, pendingRaw, pendingBytes, baselineBytes, logBytes }
  }

  private async settle(dir: string, input: Input, io: SettlementIO, pointerLock: FileLockHandle, run: Run): Promise<Record<string, unknown>> {
    const { gate, st, pending, pendingRaw, pendingBytes, baselineBytes, logBytes } = await this.load(dir, io)
    const bound: PlanBound = { baseline_revision: st.baseline.status === 'verified' ? st.baseline.baseline!.revision : null, pending_digest: pending.digest ?? null }
    // A plan holds only while the model is what it was checked against: the baseline and the pending file first.
    if (run.mode === 'commit' && canonicalJson(bound) !== canonicalJson(run.plan.bound)) throw stale('the baseline or the pending file')
    const bagHasField = (group: string, id: string, field: string) => st.scan.files.some((f) => f.group === group &&
      (f.elementId ?? f.rel.slice(f.rel.lastIndexOf('/') + 1, -'.json'.length)) === id && Object.prototype.hasOwnProperty.call(f.attributes, field))
    const templateHasField = (group: string, id: string, field: string) => {
      const lookup = templateFor(gate.classTemplates, st.refs[group as PendingGroup]?.get(id)?.classId)
      return lookup.state === 'ok' && lookup.template.fields.includes(field)
    }
    /** A record field's name is ambiguous when the element's attribute bag or its class template holds it too. */
    const nameHeld = (group: string, id: string, field: string) => group !== 'model' && (bagHasField(group, id, field) || templateHasField(group, id, field))
    // The map entries, as the items they stand for, numbered after the items in the order the call gives them.
    const mapRefused: Refused[] = []
    const keyOf = new Map<number, string>()
    const items: Item[] = [...(input.items ?? [])]
    const given = items.length
    for (const [decision, map] of [['confirm', input.confirm], ['accept', input.accept]] as const) {
      for (const [mapKey, value] of Object.entries(map ?? {})) {
        const parts = mapKey.split('/')
        const [group, element_id, field] = parts
        // A refused entry refuses the call, so it is named by its key alone.
        const bad = (code: string, message: string) => mapRefused.push({ index: null, code, message, key: mapKey })
        if (parts.length !== 3 || !(SETTLE_GROUPS as readonly string[]).includes(group!) || group === 'model' || !ELEMENT_ID.test(element_id!) || !PENDING_FIELD.test(field!)) {
          bad('bad_key', 'a map key is "<group>/<element_id>/<field>" (the model\'s own controls go as an item)')
          continue
        }
        if (field === 'controls') { bad('record_field', 'controls go as items, with previous where model_state get flags them'); continue }
        if (value === null || value === undefined) { bad('value_required', `${decision} entries carry the value; a removal goes as an item`); continue }
        if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAP_LIMITS.valueBytes) { bad('too_large', `a map value is at most ${MAP_LIMITS.valueBytes} bytes: send it as an item`); continue }
        const recordField = (SETTLED_RECORD_FIELDS as readonly string[]).includes(field!)
        if (recordField && nameHeld(group!, element_id!, field!)) {
          bad('ambiguous_field', `the element's attribute file or class template holds a field named ${field}: send it as an item, with record: true for the record or false for the attribute`)
          continue
        }
        keyOf.set(items.length, mapKey)
        items.push({ group: group as Item['group'], element_id: element_id!, field: field!, decision, value, ...(recordField ? { record: true } : {}) })
      }
    }
    const mapped = items.length
    // One range of the pending file, accepted as shown: each field's rows as one accept item, after the maps.
    const range = input.accept_rows ? this.acceptRows(input.accept_rows, { dir, st, pending, pendingRaw, gate }) : null
    const rowsOf = new Map<number, number[]>()
    if (range) {
      // A field of the range is decided by the range: an item or entry for it is refused unless its rows were left out.
      const named = new Set<string>()
      for (let i = 0; i < mapped; i++) {
        const it = items[i]!
        const t = `${it.group}${SEP}${it.element_id}${SEP}${it.field}`
        if (range.fields.has(t)) {
          named.add(t)
          mapRefused.push({ index: i < given ? i : null, code: 'row_in_range', message: 'this field has rows in the accepted range: put them in except to answer them here', ...(keyOf.has(i) ? { key: keyOf.get(i)! } : {}) })
        }
      }
      for (const r of range.items) {
        if (named.has(`${r.item.group}${SEP}${r.item.element_id}${SEP}${r.item.field}`)) continue
        rowsOf.set(items.length, r.rows)
        items.push(r.item)
      }
    }
    // Registrations of elements that are gone are dropped only with the operator's acknowledgement in the call.
    const orphaned = st.drift.orphaned
    const acknowledged = input.orphaned_acknowledged ?? 0
    if (orphaned.keys.length !== acknowledged) {
      const shown = orphaned.elements.slice(0, 20).map((e) => e.name)
      throw new Refusal(orphaned.keys.length
        ? `${orphaned.keys.length} registered value(s) belong to elements that were ${ORPHAN_CAUSE} (${shown.join('; ')}); ` +
          `show them to the operator and pass orphaned_acknowledged: ${orphaned.keys.length}. Nothing was written.`
        : `no registered value belongs to a ${ORPHAN_CAUSE} element: leave out orphaned_acknowledged. Nothing was written.`,
      { codes: ['orphaned_unacknowledged'], orphaned_registrations: { total: orphaned.keys.length, elements: orphaned.elements.slice(0, 20), elements_total: orphaned.elements.length } })
    }
    // As they apply now: a registration made before its element's first class is carried to the classified key.
    const base = st.baseline.status === 'verified' ? { ...st.values } : {}
    const plan: Plan = { files: new Map(), removePending: new Set(), set: new Map(), controls: new Map(), decisions: {}, alreadySettled: [], records: [], echo: [] }
    // Class templates, for what an attribute value may be registered as.
    const templates = gate.classTemplates
    // Who registered a value (the operator unless a source says otherwise), for the echo.
    const sources = st.baseline.status === 'verified' ? st.baseline.baseline!.sources : {}
    const refused: Refused[] = [...mapRefused]
    const seen = new Set<string>()
    const all = pending.all ?? pending.entries
    const inline = new Set<string>()
    for (const g of PENDING_GROUPS) for (const e of listOf(g, gate)) {
      const a = (e as { attributes?: unknown }).attributes
      if (a && typeof a === 'object' && !Array.isArray(a)) for (const [k, v] of Object.entries(a)) if (v !== null && v !== undefined) inline.add(`${g}${SEP}${e.id}${SEP}${k}`)
    }
    const labelCount = new Map<string, number>()
    for (const g of PENDING_GROUPS) for (const r of st.refs[g].values()) labelCount.set(elementKey(r), (labelCount.get(elementKey(r)) ?? 0) + 1)
    const recordOnDisk = new Map(st.records.values.map((r) => [`${r.group}${SEP}${r.id}${SEP}${r.field}`, r]))

    const kinds: ValueKind[] = []
    items.forEach((item, index) => {
      const refuse = (code: string, message: string, extra: Pick<Refused, 'expected' | 'fix'> = {}) => refused.push({
        index, code, message, ...(keyOf.has(index) ? { key: keyOf.get(index)! } : {}), ...(rowsOf.has(index) ? { rows: rowsOf.get(index)! } : {}), ...extra,
      })
      const read = readKind(item, nameHeld(item.group, item.element_id, item.field))
      if (!('kind' in read)) return refuse(read.code, read.message, read.fix ? { fix: read.fix } : {})
      const kind = read.kind
      kinds[index] = kind
      if (run.mode === 'prepare' && kind === 'record' && TRUST_FIELDS.has(item.field)) {
        return refuse('trust_field', `${item.field} is a trust decision: it is settled directly, with the operator's reply, from the main session`)
      }
      const triple = `${item.group}${SEP}${item.element_id}${SEP}${item.field}`
      if (seen.has(`${kind}${SEP}${triple}`)) return refuse('duplicate_pending', 'the call names this field twice')
      seen.add(`${kind}${SEP}${triple}`)
      if (item.group === 'model') {
        if (item.element_id !== MODEL_REF_ID || item.field !== 'controls' || kind !== 'record') return refuse('not_found', `the model's own record holds only its controls (element_id "${MODEL_REF_ID}", field "controls", record: true)`)
      } else if (!ELEMENT_ID.test(item.element_id)) return refuse('not_found', 'no such element')
      if (item.previous !== undefined && !(kind === 'record' && item.field === 'controls')) return refuse('not_found', 'previous goes with a controls item only')
      if (!PENDING_FIELD.test(item.field)) return refuse('unlisted_field', 'the field name holds characters other than letters, digits, _ or -: rename it in the attribute file')
      if (kind === 'record' && item.group !== 'model' && !(SETTLED_RECORD_FIELDS as readonly string[]).includes(item.field)) return refuse('not_found', 'no such record field')
      const decision = item.decision
      const removal = item.removed === true
      const absent = item.absent === true
      if (removal && decision !== 'confirm') return refuse('not_found', 'removed goes with confirm only')
      if (removal && item.value !== null) return refuse('value_differs', 'a removal carries value null')
      if (absent && decision !== 'set') return refuse('not_found', 'absent goes with set only')
      if (absent && item.value !== undefined) return refuse('value_differs', 'absent carries no value')
      if (decision === 'set' && typeof item.element_name !== 'string') return refuse('name_mismatch', "set names its element as the model holds it (element_name)")
      if (!removal && !absent && decision !== 'reject' && item.value === undefined) return refuse('value_required', `${decision} needs the value`)
      if (!removal && !absent && decision !== 'reject') {
        const why = undisplayable(item.value)
        if (why) return refuse(why, why === 'too_large' ? 'the value is larger than 4 KiB' : 'the value holds invisible, control, bidi or mixed-script characters; modify it to a clean value')
      }
      const ref = st.refs[item.group].get(item.element_id)
      const key = ref ? entryKey(ref, kind, item.field) : undefined
      const bagHas = st.scan.files.some((f) => f.group === item.group && (f.elementId ?? f.rel.slice(f.rel.lastIndexOf('/') + 1, -'.json'.length)) === item.element_id &&
        Object.prototype.hasOwnProperty.call(f.attributes, item.field))
      // A pending row names the record only while the element's attribute bag does not hold a field of that name.
      const recordRow = RECORD_FIELDS.has(item.field) && !bagHas
      const entries = (kind === 'record') === recordRow && item.group !== 'model'
        ? all.filter((e) => e.group === item.group && e.element_id === item.element_id && e.field === item.field)
        : []
      const settled = () => plan.alreadySettled.push(index)
      const removeEntries = () => entries.forEach((e) => plan.removePending.add(e.index))
      /**
       * Counts the decision and echoes it: the value now registered (undefined: the field left empty), the value the
       * file held before (undefined: absent) and how that one was registered (by its hash; records by their projection).
       */
      const count = (now: unknown, before: unknown, beforeHash: string | undefined) => {
        plan.decisions[removal ? 'removal' : decision] = (plan.decisions[removal ? 'removal' : decision] ?? 0) + 1
        const registered = key === undefined ? undefined : base[key]
        const name = ref?.name
        plan.echo.push({
          index,
          decision: removal ? 'removal' : decision,
          group: item.group,
          element_id: item.element_id,
          element_name: name === undefined ? null : undisplayable(name) ? { undisplayable: true, sha256: valueHash(name) } : name,
          field: item.field,
          ...(kind === 'record' ? { record: true } : {}),
          value: shown(now),
          previous: shown(before),
          previous_registered: registered === undefined ? 'unregistered'
            : registered === ABSENT ? 'registered_empty'
            : { state: registered === beforeHash ? 'registered' : 'registered_other', by: Object.hasOwn(sources, key!) ? sources[key!] : 'operator' },
        })
      }
      // The element's label collides, or (a links record) one of the items it links cannot be told from another.
      const linkCollision = kind === 'record' && !!recordOnDisk.get(triple)?.code
      const collision = (ref && (labelCount.get(elementKey(ref)) ?? 0) > 1) || linkCollision ? 'label_collision' as const : undefined
      const collisionMessage = linkCollision
        ? 'two of the data items this element links have the same name and class: rename or reclassify one of them'
        : 'this value cannot be registered as it is'
      /** What refuses a `set` on any field; null when it may go on. */
      const setRefusal = (): [string, string] | null => {
        if (item.group === 'model') return ['record_field', "the model's own controls are set through the workflow, then confirmed"]
        if (!ref) return ['not_found', 'the element is gone']
        if (collision) return [collision, collisionMessage]
        if (item.element_name !== ref.name) return ['name_mismatch', "element_name is not the element's name in the model"]
        if (entries.length) return ['duplicate_pending', 'the field has a pending row: accept, reject or modify that row']
        return null
      }

      if (kind === 'record') {
        if (decision === 'set') {
          const why = setRefusal()
          if (why) return refuse(...why)
          const rule = SETTABLE_RECORDS[item.field]
          if (!rule) return refuse('record_field', `${item.field} is set through the workflow, then confirmed`)
          if (rule.group !== item.group) return refuse('not_found', `${item.field} belongs to ${rule.group}`)
          // Only a value the settlement projects can be registered: anything else would leave a row nothing matches.
          const onDisk = recordOnDisk.get(triple)
          if (!onDisk) return refuse('not_found', 'the settlement holds no record value for this element and field (the root boundary carries none)')
          const beforeProjected = onDisk?.projected ?? null
          const nowProjected = absent ? null : st.records.project(item.group, item.element_id, item.field as SettledRecordField, item.value)
          const nowHash = absent ? ABSENT : valueHash(nowProjected)
          if (canonicalJson(beforeProjected) === canonicalJson(nowProjected) && base[key!] === nowHash) return settled()
          if (!absent && !rule.valid(item.value)) return refuse('invalid_value', rule.message)
          plan.records.push({ group: item.group, id: item.element_id, field: item.field, value: item.value, absent, before: onDisk?.raw })
          plan.set.set(key!, nowHash)
          return count(absent ? undefined : item.value, onDisk?.raw ?? undefined, valueHash(beforeProjected))
        }
        // A record's value on disk and in the call are compared as the settlement hashes them (normalised, id-free).
        if (decision === 'modify' || decision === 'reject') return refuse('record_field', `${item.field} is a record field: edit it through the workflow, then confirm it`)
        if (!ref) return refuse('not_found', 'the element is gone')
        if (collision) return refuse(collision, collisionMessage)
        const disk = recordOnDisk.get(triple)?.projected ?? null
        const hash = valueHash(disk)
        if (removal) {
          if (entries.length) return refuse('duplicate_pending', 'the field has a pending row: accept that row')
          if (disk !== null) return refuse('not_removed', 'the field holds a value: confirm that value instead')
          if (base[key!] === undefined || base[key!] === ABSENT) return settled()
          plan.set.set(key!, ABSENT)
          return count(undefined, recordOnDisk.get(triple)?.raw ?? undefined, hash)
        }
        const given = st.records.project(item.group, item.element_id, item.field as SettledRecordField, item.value)
        // A registered controls list that changed: the call names the list it replaces, as registered, whenever old
        // and new need the operator's eyes (an id changed under an unchanged name, or the old list is not recorded).
        if (item.field === 'controls' && key !== undefined && base[key] !== undefined && base[key] !== ABSENT && base[key] !== valueHash(given)) {
          const from = Object.hasOwn(st.controls, key) ? st.controls[key] : NOT_RECORDED
          if (item.previous !== undefined && item.previous !== null && !isControlList(item.previous)) {
            return refuse('previous_differs', 'previous is a list of controls, each exactly { id, name }, as model_state get shows it')
          }
          const named = item.previous === undefined ? undefined
            : item.previous === null ? NOT_RECORDED : st.records.project(item.group, item.element_id, 'controls', item.previous)
          if (named === undefined ? controlsFlagged({ from, to: given }) : canonicalJson(named) !== canonicalJson(from)) {
            return refuse('previous_differs', 'the controls list changed under a name the operator registered, or its registration predates the recorded lists: show the operator the old and the new list, and pass previous exactly as model_state get shows it')
          }
        }
        else if (item.previous !== undefined) return refuse('previous_differs', 'previous names a registered list this value replaces: this one has none, or is unchanged')
        const registerControls = () => { if (item.field === 'controls') plan.controls.set(key!, given) }
        if (decision === 'accept') {
          if (!entries.length) return base[key!] === hash && canonicalJson(given) === canonicalJson(disk) ? settled() : refuse('not_found', 'no pending row for this field')
          const projectedEntries = entries.map((e) => canonicalJson(st.records.project(item.group, item.element_id, item.field as SettledRecordField, e.value)))
          if (projectedEntries.some((p) => p !== projectedEntries[0])) return refuse('duplicate_pending', 'the field has pending rows with different values')
          if (projectedEntries[0] !== canonicalJson(given)) return refuse('value_differs', 'the value is not the pending row\'s value')
          if (canonicalJson(given) !== canonicalJson(disk)) return refuse('value_changed', 'the value on disk changed since the row was written')
          const invalid = recordRefusal(item.group, item.field, item.value)
          if (invalid) return refuse(invalid.code, invalid.message)
          if (disk !== null) {
            plan.set.set(key!, hash)
            registerControls()
          }
          removeEntries()
          return count(item.value, recordOnDisk.get(triple)?.raw ?? undefined, hash)
        }
        // confirm
        if (entries.length) return refuse('duplicate_pending', 'the field has a pending row: accept that row')
        if (disk === null) return refuse('not_found', 'the field holds no value')
        if (canonicalJson(given) !== canonicalJson(disk)) {
          // A placement is the text the rows show: the one record a model writes out by hand.
          const shownText = item.field === 'placement' ? recordOnDisk.get(triple)?.shown : undefined
          return refuse('value_differs', 'the value is not the value in the model file',
            shownText === undefined ? {} : { expected: undisplayable(shownText) ? { undisplayable: true, sha256: valueHash(shownText) } : shownText })
        }
        if (base[key!] === hash) return settled()
        const invalid = recordRefusal(item.group, item.field, item.value)
        if (invalid) return refuse(invalid.code, invalid.message)
        plan.set.set(key!, hash)
        registerControls()
        return count(item.value, recordOnDisk.get(triple)?.raw ?? undefined, hash)
      }

      // An attribute value, in the element's attribute file.
      const files = st.scan.files.filter((f) => f.group === item.group && (f.elementId ?? f.rel.slice(f.rel.lastIndexOf('/') + 1, -'.json'.length)) === item.element_id)
      const file = files.length === 1 && !files[0]!.flat ? files[0]! : undefined
      const current = plan.files.get(file?.rel ?? '')?.attributes ?? file?.attributes
      const disk = current?.[item.field]
      const elementCode = files.length > 1 || files.some((f) => f.flat) ? 'ambiguous_attribute_file'
        : collision ?? (inline.has(triple) ? 'inline_attributes' : undefined)
      const diskHash = disk === undefined ? undefined : valueHash(disk)
      const lookup = templateFor(templates, ref?.classId)
      /** The rule every registered value meets: a field of the class, or a key the workflow asks for, with a value that fits. */
      const unregistrable = (value: unknown) => valueRefusal(item.group, item.field, value, lookup)

      if (decision === 'set') {
        const why = setRefusal()
        if (why) return refuse(...why)
        if (elementCode) return refuse(elementCode, 'this value cannot be registered as it is')
        if (!file) return refuse('no_attribute_file', 'the element has no attribute file: generate its stubs first')
        const nowHash = absent ? ABSENT : valueHash(item.value)
        if ((absent ? disk === undefined : sameValue(disk, item.value)) && base[key!] === nowHash) return settled()
        // Removing a field never registers a value: it is how a value no decision could register is dropped.
        if (!absent) {
          const why = unregistrable(item.value)
          if (why) return refuse(why.code, why.message)
        }
        const next = { ...(current ?? {}) }
        if (absent) delete next[item.field]
        else next[item.field] = item.value
        plan.files.set(file.rel, { file, attributes: next })
        plan.set.set(key!, nowHash)
        return count(absent ? undefined : item.value, disk, diskHash)
      }

      if (removal) {
        if (!ref) return refuse('not_found', 'the element is gone')
        if (elementCode) return refuse(elementCode, 'this value cannot be registered as it is')
        if (entries.length) return refuse('duplicate_pending', 'the field has a pending row: accept, reject or modify that row')
        if (disk !== null && disk !== undefined) return refuse('not_removed', 'the field holds a value: confirm that value instead')
        if (base[key!] === undefined || base[key!] === ABSENT) return settled()
        plan.set.set(key!, ABSENT)
        return count(undefined, disk, diskHash)
      }
      if (decision === 'accept') {
        if (!entries.length) {
          if (key !== undefined && base[key] === valueHash(item.value) && sameValue(disk, item.value)) return settled()
          return refuse('not_found', 'no pending row for this field')
        }
        if (entries.some((e) => !sameValue(e.value, entries[0]!.value))) return refuse('duplicate_pending', 'the field has pending rows with different values')
        if (!sameValue(entries[0]!.value, item.value)) return refuse('value_differs', 'the value is not the pending row\'s value')
        if (!sameValue(disk, item.value)) return refuse('value_changed', 'the value on disk changed since the row was written')
        if (!ref) return refuse('not_found', 'the element is gone')
        if (elementCode) return refuse(elementCode, 'this value cannot be registered as it is')
        const why = unregistrable(item.value)
        if (why) return refuse(why.code, why.code === 'invalid_value' ? `${why.message}: modify the row to a value that fits, or reject it` : `${why.message}; answer this row with reject`)
        plan.set.set(key!, valueHash(item.value))
        removeEntries()
        return count(item.value, disk, diskHash)
      }
      if (decision === 'reject') {
        if (!entries.length) {
          if (!ref || ((disk === undefined || disk === null) && (key === undefined || base[key] === undefined || base[key] === ABSENT))) return settled()
          return refuse('not_found', 'no pending row for this field')
        }
        if (!ref) {
          removeEntries()
          return count(undefined, disk, diskHash)
        }
        if (entries.some((e) => e.previous !== entries[0]!.previous)) return refuse('duplicate_pending', 'the field has pending rows with different previous states')
        if (key !== undefined && base[key] !== undefined && base[key] !== ABSENT && !fieldRefusal(item.group, item.field, lookup)) {
          return refuse('previous_contradicts_baseline', 'the row says the field was empty, but a confirmed value was registered for it')
        }
        if (elementCode) return refuse(elementCode, 'this value cannot be changed here as it is')
        if (file) {
          const next = { ...(current ?? {}) }
          if (entries[0]!.previous === 'absent') delete next[item.field]
          else next[item.field] = null
          plan.files.set(file.rel, { file, attributes: next })
        }
        // The operator left the field empty: registered, so it is neither asked again nor filled unnoticed.
        plan.set.set(key!, ABSENT)
        removeEntries()
        return count(file && entries[0]!.previous !== 'absent' ? null : undefined, disk, diskHash)
      }
      if (!ref) return refuse('orphan_attributes', 'the element is gone')
      if (elementCode) return refuse(elementCode, 'this value cannot be registered as it is')
      if (decision === 'modify') {
        if (!entries.length) {
          if (key !== undefined && base[key] === valueHash(item.value) && sameValue(disk, item.value)) return settled()
          return refuse('not_found', 'no pending row for this field')
        }
        if (!file) return refuse('not_found', 'the element has no attribute file')
        const why = unregistrable(item.value)
        if (why) return refuse(why.code, why.code === 'invalid_value' ? why.message : `${why.message}; answer this row with reject`)
        plan.files.set(file.rel, { file, attributes: { ...(current ?? {}), [item.field]: item.value } })
        plan.set.set(key!, valueHash(item.value))
        removeEntries()
        return count(item.value, disk, diskHash)
      }
      // confirm
      if (entries.length) return refuse('duplicate_pending', 'the field has a pending row: accept, reject or modify that row')
      if (disk === undefined || disk === null) return refuse('not_found', 'the field holds no value')
      if (!sameValue(disk, item.value)) return refuse('value_differs', 'the value is not the value on disk')
      if (base[key!] === valueHash(item.value)) return settled()
      const why = unregistrable(item.value)
      if (why) return refuse(why.code, why.message)
      plan.set.set(key!, valueHash(item.value))
      return count(item.value, disk, diskHash)
    })

    if (refused.length) {
      throw new Refusal(`settle refused: ${refused.length} item${refused.length === 1 ? '' : 's'} cannot be recorded; nothing was written`, {
        codes: [...new Set(refused.map((r) => r.code))], refused,
      })
    }
    const changed = plan.set.size + plan.removePending.size + plan.files.size + plan.records.length + orphaned.keys.length
    if (Object.keys(settledContent(st, base, plan).values).length > SETTLE_LIMITS.entries) {
      throw new Refusal('the baseline would hold too many values; nothing was written', { codes: ['too_large'] })
    }
    // The echo is shown whole or not at all: a result it would push past the budget is refused before any write.
    const nameShown = (n: string) => (undisplayable(n) ? { undisplayable: true, sha256: valueHash(n) } : n)
    const { full, unchanged, acceptedUnchanged } = splitEcho(plan.echo)
    const echoed = {
      echo: full,
      ...(Object.keys(unchanged).length ? { registered_unchanged: unchanged } : {}),
      ...(acceptedUnchanged ? { accepted_unchanged: acceptedUnchanged } : {}),
      ...(orphaned.keys.length ? {
        orphaned_dropped_elements: orphaned.elements.slice(0, 20).map((e) => nameShown(e.name)),
        orphaned_dropped_elements_total: orphaned.elements.length,
      } : {}),
    }
    // Measured as sent: compact.
    const size = resultText({ recorded: plan.echo.length, decisions: plan.decisions, already_settled: plan.alreadySettled, ...echoed, revision: Number.MAX_SAFE_INTEGER }).length
    if (size > ECHO_BUDGET) {
      const largest = full.map((e) => ({ index: e.index as number, characters: resultText(e).length }))
        .sort((a, b) => b.characters - a.characters).slice(0, 10)
      throw new Refusal(`the result would be ${size} characters, more than the ${ECHO_BUDGET} the echo may take; split the call (largest items listed). Nothing was written.`,
        { codes: ['echo_too_large'], items: largest })
    }
    if (run.mode !== 'settle') {
      const fingerprint = fingerprintOf(st, base, plan, orphaned.keys, pendingBytes)
      if (run.mode === 'prepare') {
        const lines = decisionLines({ items, mapped, kinds, st, range: input.accept_rows, rangeValues: range?.items.length ?? 0, orphaned: orphaned.keys.length ? orphaned.elements : [] })
        const planned = {
          // A prepare registers nothing, so it echoes nothing: what a commit would register is in its lines.
          echo: [] as unknown[],
          decisions: plan.decisions,
          already_settled: plan.alreadySettled,
          ...(acceptedUnchanged ? { accepted_unchanged: acceptedUnchanged } : {}),
          ...(orphaned.keys.length ? { orphaned_to_drop: orphaned.keys.length } : {}),
          bound,
          lines,
        }
        const shownSize = resultText({ ...planned, plan_id: '0'.repeat(32), expires_at: new Date().toISOString() }).length
        if (shownSize > ECHO_BUDGET) {
          throw new Refusal(`the plan's lines would take ${shownSize} characters, more than ${ECHO_BUDGET}: split the call. Nothing was planned.`, { codes: ['echo_too_large'] })
        }
        const stored = this.plans.add(dir, input, bound, fingerprint, lines)
        return { plan_id: stored.id, expires_at: stored.expiresAtIso, ...planned }
      }
      if (fingerprint !== run.plan.fingerprint) throw stale('the model files or the registrations')
    }
    // A commit notes its first write: a failure before it leaves the plan to be committed again.
    const progress = run.mode === 'commit' ? run.progress : { started: true, wrote: false }
    const tracked: SettlementIO = {
      ...io,
      replace: async (rel, content, expected) => { await io.replace(rel, content, expected); progress.wrote = true },
      remove: async (rel, expected) => { await io.remove(rel, expected); progress.wrote = true },
    }
    const warning = changed
      ? await this.write(tracked, st, base, plan, { pendingRaw, pendingBytes, baselineBytes, logBytes }, run.reply, items.length, pointerLock, progress)
      : await catchUpPointer(st, pointerLock)
    const restarted = st.baseline.status === 'unverified' || (st.baseline.status === 'missing' && !!st.baseline.code)
    return {
      recorded: Object.values(plan.decisions).reduce((a, b) => a + b, 0),
      ...(orphaned.keys.length ? { orphaned_dropped: orphaned.keys.length } : {}),
      decisions: plan.decisions,
      already_settled: plan.alreadySettled,
      ...(restarted && changed ? { note: `the baseline here did not verify (${st.baseline.code}): values registered before it are not recognised and are confirmed again` } : {}),
      ...(plan.logRestarted ? { log_restarted: plan.logRestarted } : {}),
      ...(plan.gitignore && plan.gitignore !== 'present' ? { gitignore: plan.gitignore } : {}),
      ...(warning ? { warning } : {}),
      // What was registered, and what each value replaced: show it to the operator.
      ...echoed,
      ...(plan.revision !== undefined ? { revision: plan.revision } : {}),
    }
  }

  /**
   * A carried baseline's source retired on this machine's pointer, then attribute files, then the log, then the
   * baseline (which signs the log), then the pending file, then this machine's pointer for this path. A call that fails part-way leaves its pending rows in place, so repeating it converges;
   * a failure after the log leaves a logged entry the repeat applies and logs again. Returns a warning when
   * only the pointer could not be updated (the next call catches it up).
   */
  private async write(
    io: SettlementIO, st: SettlementState, base: Record<string, string>, plan: Plan,
    read: { pendingRaw: Record<string, unknown> | null; pendingBytes: Buffer | null; baselineBytes: Buffer | null; logBytes: Buffer | null },
    reply: string, items: number, pointerLock: FileLockHandle, progress: { wrote: boolean },
  ): Promise<string | undefined> {
    const pointers = st.pointers.usable ? st.pointers.revisions : {}
    const verified = st.baseline.status === 'verified' ? st.baseline.baseline! : null
    const carried = st.baseline.carriedFrom
    // A baseline moved or copied here: its source is retired first, before anything is written, so a later
    // failure can only leave this copy unverified (confirmed again), never both directories verified.
    if (carried && verified) {
      try {
        await updateBaselinePointers({ [carried]: Math.max(pointers[carried] ?? 0, verified.revision + 1) }, pointerLock, st.modelPath)
        progress.wrote = true
      } catch {
        throw new Refusal("this machine's settlement pointer could not be updated, so nothing was written; fix the file beside the key first", { codes: ['pointer_unavailable'] })
      }
    }
    // Record values set: every field must still hold what it held when the call was planned. All of them are read and
    // checked before the first write, so a field that moved refuses the call with nothing written.
    const recordDocs: Array<{ rel: 'structure.json' | 'data-items.json'; bytes: Buffer; doc: unknown }> = []
    for (const rel of ['structure.json', 'data-items.json'] as const) {
      const mine = plan.records.filter((r) => (r.group === 'dataItems') === (rel === 'data-items.json'))
      if (!mine.length) continue
      const bytes = await io.read(rel)
      if (!bytes) throw new StateFileError('changed', rel)
      let doc: unknown
      try {
        doc = JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new StateFileError('changed', rel)
      }
      for (const r of mine) {
        const holder = recordHolder(doc, r.group, r.id)
        if (!holder || !sameValue(holder[r.field] ?? null, r.before ?? null)) throw new StateFileError('changed', rel)
        if (r.absent) delete holder[r.field]
        else holder[r.field] = r.value
      }
      recordDocs.push({ rel, bytes, doc })
    }
    for (const { file, attributes } of plan.files.values()) {
      const doc = { ...(file.doc ?? {}), attributes }
      await io.replace(file.rel, `${JSON.stringify(doc, null, 2)}${file.bytes.toString('utf8').endsWith('\n') ? '\n' : ''}`, file.bytes)
    }
    for (const { rel, bytes, doc } of recordDocs) {
      await io.replace(rel, `${JSON.stringify(doc, null, 2)}${bytes.toString('utf8').endsWith('\n') ? '\n' : ''}`, bytes)
    }
    const content = settledContent(st, base, plan)
    const log = nextLog(st.baseline, read.logBytes, { at: new Date().toISOString(), action: 'settle', items, decisions: plan.decisions, reply: reply.trim() })
    await io.replace(SETTLEMENTS_FILE, log.content, read.logBytes)
    plan.logRestarted = log.restarted
    const revision = Math.max(verified?.revision ?? 0, pointers[st.modelHash!] ?? 0, carried ? pointers[carried] ?? 0 : 0) + 1
    plan.revision = revision
    await io.replace(BASELINE_FILE, signedBaseline(st.key!, st.modelHash!, { ...content, revision, log_digest: logDigest(log.content) }), read.baselineBytes)
    // This machine's settlement files stay out of git (a refusal is reported, and changes nothing else).
    plan.gitignore = await ensureGitignore(io)
    // The rows go last among the model files: until they are gone a repeated call finds them and settles them again.
    if (plan.removePending.size && read.pendingRaw && read.pendingBytes) {
      const entries = (read.pendingRaw.entries as unknown[]).filter((_, i) => !plan.removePending.has(i))
      await io.replace(PENDING_FILE_REL, `${JSON.stringify({ ...read.pendingRaw, entries }, null, 2)}\n`, read.pendingBytes)
    }
    // This machine's pointer for this path (the next call catches it up if this fails: the file now names this path).
    try {
      await updateBaselinePointers({ [st.modelHash!]: revision }, pointerLock, st.modelPath)
      return undefined
    } catch {
      return "the decisions were recorded, but this machine's settlement pointer could not be updated; the next settlement updates it"
    }
  }
}

/**
 * The baseline this call signs. It starts from what counts here (`base`), plus
 * the machine's registrations that do not count here but still apply to this
 * directory (a pull's, for another binding), minus the acknowledged orphans.
 * The call's registrations are the operator's: each drops its source. A
 * baseline carried from another directory keeps only the operator's.
 */
function settledContent(st: SettlementState, base: Record<string, string>, plan: Plan): BaselineContent {
  const raw = contentOf(st.baseline.status === 'verified' ? st.baseline.baseline : null)
  const carried = !!st.baseline.carriedFrom
  const kept = carried ? {} : Object.fromEntries(Object.entries(raw.values).filter(([k]) => Object.hasOwn(raw.sources, k) && !Object.hasOwn(base, k)))
  const values: Record<string, string> = { ...kept, ...base }
  const sources = carried ? {} : Object.fromEntries(Object.entries(raw.sources).filter(([k]) => Object.hasOwn(values, k)))
  // The lists of what counts (carried with their keys), and of the machine's registrations kept as they were.
  const controls = { ...(carried ? {} : raw.controls_registered), ...st.controls }
  for (const k of st.drift.orphaned.keys) delete values[k]
  for (const [k, h] of plan.set) {
    values[k] = h
    delete sources[k]
    if (plan.controls.has(k)) controls[k] = plan.controls.get(k)
    else delete controls[k]
  }
  return { revision: raw.revision, values, log_digest: raw.log_digest, sources, pull: carried ? null : raw.pull, controls_registered: controls }
}

/**
 * Everything a call would write and register, as one hash: the signed content (values, sources, controls), every
 * attribute file it rewrites (its bytes as read, and what it becomes), the record values, the pending rows it clears,
 * the echo, the orphans it drops, the model's key and the pending file. A commit writes only when its hash is the plan's.
 */
function fingerprintOf(st: SettlementState, base: Record<string, string>, plan: Plan, orphans: readonly string[], pendingBytes: Buffer | null): string {
  return sha256Hex(canonicalJson({
    content: settledContent(st, base, plan),
    files: [...plan.files.entries()].map(([rel, f]) => [rel, sha256Hex(f.file.bytes), f.attributes]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    records: plan.records,
    removePending: [...plan.removePending].sort((a, b) => a - b),
    alreadySettled: plan.alreadySettled,
    echo: plan.echo,
    orphans: [...orphans].sort(),
    model: st.modelHash,
    key: st.key ? sha256Hex(st.key).slice(0, 16) : null,
    pending: pendingBytes ? sha256Hex(pendingBytes) : null,
  }))
}

const shownName = (name: string | undefined): string =>
  name === undefined ? '(gone)' : undisplayable(name) ? hashedText(name) : cell(name)

const shownLineValue = (v: unknown): string => (undisplayable(v) ? hashedText(v) : cell(canonicalJson(v)))

/**
 * The lines a plan records, as the main session shows them before the commit: the orphaned elements dropped, then
 * each item and map entry in call order, then the accepted range. Every value is canonical JSON on one line.
 */
function decisionLines(c: {
  items: Item[]
  mapped: number
  kinds: ValueKind[]
  st: SettlementState
  range: z.infer<typeof AcceptRowsSchema> | undefined
  rangeValues: number
  orphaned: ReadonlyArray<{ group: string; name: string; cause: string; values: number }>
}): string[] {
  const lines: string[] = []
  for (const e of c.orphaned) {
    lines.push(`Removed: ${shownName(e.name)} (${e.group}, ${e.cause}) — ${e.values} registered value${e.values === 1 ? '' : 's'} dropped`)
  }
  c.items.slice(0, c.mapped).forEach((item, i) => {
    const name = c.st.refs[item.group]?.get(item.element_id)?.name ?? (item.group === 'model' ? 'the model' : undefined)
    const value = item.removed === true || item.absent === true ? '(removed)' : item.decision === 'reject' ? '(previous)' : shownLineValue(item.value)
    lines.push(`Recording: ${shownName(name)} (${cell(item.element_id)}) · ${cell(item.field)}${c.kinds[i] === 'record' ? ' (record)' : ''} · ${item.decision} → ${value}`)
  })
  if (c.range) {
    const except = [...new Set(c.range.except ?? [])].sort((a, b) => a - b)
    lines.push(`Recording: accept rows ${c.range.from}–${c.range.to} as shown (pending ${c.range.digest.slice(0, 12)}), except rows ${except.length ? except.join(', ') : 'none'}: ${c.rangeValues} value${c.rangeValues === 1 ? '' : 's'}`)
  }
  return lines
}

/** The element a record value lives on, in the structure (a boundary or component) or the data items. */
function recordHolder(doc: unknown, group: string, id: string): Record<string, unknown> | null {
  if (group === 'dataItems') {
    const list = Array.isArray(doc) ? doc : (doc as { dataItems?: unknown })?.dataItems
    const hit = Array.isArray(list) ? list.find((d) => d && typeof d === 'object' && (d as { id?: unknown }).id === id) : undefined
    return (hit as Record<string, unknown>) ?? null
  }
  let found: Record<string, unknown> | null = null
  const walk = (b: any) => {
    if (!b || typeof b !== 'object' || found) return
    if (group === 'boundaries' && b.id === id) found = b
    if (group === 'components') for (const c of Array.isArray(b.components) ? b.components : []) if (c && c.id === id) found = c
    for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n)
  }
  walk((doc as { defaultBoundary?: unknown })?.defaultBoundary)
  return found
}

/** A controls list as `get` shows one: entries of exactly `{ id, name }`, strings or null. */
function isControlList(v: unknown): boolean {
  const field = (x: unknown) => x === null || typeof x === 'string'
  return Array.isArray(v) && v.every((e) => e && typeof e === 'object' && !Array.isArray(e) &&
    Object.keys(e).every((k) => k === 'id' || k === 'name') && field((e as { id?: unknown }).id ?? null) && field((e as { name?: unknown }).name ?? null))
}

/** A call that failed after signing the baseline never recorded it on this machine: record it now. */
async function catchUpPointer(st: SettlementState, lock: FileLockHandle): Promise<string | undefined> {
  const b = st.baseline.baseline
  if (st.baseline.status !== 'verified' || !b || st.baseline.carriedFrom || !st.pointers.usable || !st.modelHash) return undefined
  if ((st.pointers.revisions[st.modelHash] ?? -1) >= b.revision) return undefined
  try {
    await updateBaselinePointers({ [st.modelHash]: b.revision }, lock, st.modelPath)
    return undefined
  } catch {
    return "this machine's settlement pointer could not be updated; the next settlement updates it"
  }
}

function listOf(group: PendingGroup, gate: { structure: any; dataFlows: any[]; dataItems: any[] }): Array<{ id: string }> {
  if (group === 'dataFlows') return gate.dataFlows
  if (group === 'dataItems') return gate.dataItems
  const out: Array<{ id: string }> = []
  const walk = (b: any, isRoot: boolean) => {
    if (!b) return
    if (group === 'boundaries' && !isRoot) out.push(b)
    if (group === 'components') for (const c of b.components ?? []) out.push(c)
    for (const n of b.boundaries ?? []) walk(n, false)
  }
  walk(gate.structure?.defaultBoundary, true)
  if (group === 'boundaries' && gate.structure?.defaultBoundary) out.push(gate.structure.defaultBoundary)
  return out
}

export type { PendingEntry, Item }

export const modelStateSettleTool = new ModelStateSettleTool()
