/**
 * The machine's registrations: values registered without an operator's call,
 * each carrying over what the platform held or linked.
 *
 * - `registerPulled`: a pull registers what the platform returned (the model in
 *   memory, never the files on disk), bound to that platform model. An
 *   operator's registration of the same value stays theirs.
 * - `registerPushPin`: a control a push linked by its exact name gets the id
 *   the platform linked, where the operator registered the list as pushed.
 * - `carryGreenfield`: a local control's temporary id replaced by the id the
 *   platform gave it carries the registrations that named it.
 *
 * Each writer holds this machine's pointer lock, then the model's settlement
 * lock, re-checks that the directory is still where it was, and writes the log,
 * then the baseline that signs it, then the pointer. None throws: each returns
 * what it did, and a failure registers nothing, so the values stay rows, which
 * blocks REVIEWED and a push until the operator settles them.
 *
 * With the settlement off, none of them registers anything: a pull and a push
 * only keep this machine's files out of git.
 */
import fs from 'node:fs/promises'
import {
  isDeferredControlEntry,
  normaliseControlName,
  type ResolvedControl,
  type SplitModel,
} from '@dethernety/dt-core'
import { LockBusyError, type FileLockHandle } from './file-lock.js'
import {
  gateInputFromModel,
  loadGateInput,
  pendingFromRaw,
  readBaselinePointers,
  recordProjector,
  updateBaselinePointers,
  waiverKeyState,
  withPointerLock,
  MODEL_REF_ID,
  type SettleGroup,
} from './gates.js'
import {
  ABSENT,
  BASELINE_FILE,
  PENDING_FILE_REL,
  SETTLEMENTS_FILE,
  SETTLE_LIMITS,
  canonicalJson,
  contentOf,
  entryKey,
  hashOf,
  logDigest,
  modelHashOf,
  nextLog,
  operatorOnly,
  readBaseline,
  sha256,
  signedBaseline,
  tripleOf,
  undisplayable,
  valueHash,
  type BaselineContent,
  type BaselineRead,
  type LogEntry,
} from './settlement.js'
import { countedRegistrations, payloadValues } from './settlement-state.js'
import { settlementOn, type SettlementMode } from './settlement-switch.js'
import { StateFileError, withSettlementLock, type SettlementIO } from './state-store.js'

/**
 * What a writer did. `failed` registers nothing: the values stay rows until the operator settles them. A failure
 * part-way can leave a log no baseline signs (the next write starts it afresh) or a carried source retired; both
 * only keep things blocked.
 */
export interface Registration {
  status: 'registered' | 'nothing' | 'failed'
  code?: string
  /** Values registered by this call */
  registered?: number
  /** Registrations the call dropped (a pull: values the platform no longer holds) */
  dropped?: number
  /** Why the settlement log started afresh */
  log_restarted?: string
  /** `.dethereal/.gitignore`: written, already covering the per-machine files, or refused (a link or not a file) */
  gitignore?: 'written' | 'present' | 'refused'
  warning?: string
}

/** The files the server keeps out of git: they hold this machine's attestations and records, never shared. */
export const PER_MACHINE_FILES = ['settlement-baseline.json', 'settlements.json', 'sync.json', 'control-audit.log', 'relay/'] as const
const GITIGNORE_REL = '.dethereal/.gitignore'

interface Context {
  io: SettlementIO
  lock: FileLockHandle
  key: Buffer
  modelPath: string
  modelHash: string
  pointers: Record<string, number>
  read: BaselineRead
}

/** Run a writer under the locks, with the directory's baseline read inside them; any error becomes `failed`. */
async function guarded(dir: string, write: (ctx: Context) => Promise<Registration>): Promise<Registration> {
  try {
    const modelPath = await fs.realpath(dir)
    const keyState = await waiverKeyState(true, dir)
    if (!keyState.key) return { status: 'failed', code: 'baseline_key_unavailable' }
    const key = keyState.key
    return await withPointerLock((lock) => withSettlementLock(dir, async (io) => {
      // The directory the caller named is still the one it was: nothing is signed for a path swapped in between.
      if ((await fs.realpath(dir)) !== modelPath) return { status: 'failed', code: 'moved' }
      const pointers = await readBaselinePointers(dir)
      if (!pointers.usable) return { status: 'failed', code: 'pointer_unavailable' }
      const read = await readBaseline(dir, modelPath, key, undefined, pointers)
      if (read.status === 'unavailable') return { status: 'failed', code: read.code ?? 'baseline_key_unavailable' }
      return write({ io, lock, key, modelPath, modelHash: modelHashOf(key, modelPath), pointers: pointers.revisions, read })
    }))
  } catch (err) {
    if (err instanceof LockBusyError) return { status: 'failed', code: 'busy' }
    if (err instanceof StateFileError) return { status: 'failed', code: err.code }
    return { status: 'failed', code: 'io' }
  }
}

/**
 * Sign `content` for this directory: a carried baseline's source retired
 * first, then the log with `entry`, then the baseline that signs it, then
 * this machine's pointer. Returns why the log restarted, and a warning when
 * only the pointer could not be updated (the next write catches it up).
 */
async function sign(ctx: Context, content: BaselineContent, entry: LogEntry): Promise<{ log_restarted?: string; warning?: string }> {
  const { io, lock, read, modelHash, pointers } = ctx
  const logBytes = await io.read(SETTLEMENTS_FILE)
  const verified = read.status === 'verified' ? read.baseline! : null
  const carried = read.carriedFrom
  // Only what verified counts: the signed revision and this machine's pointer, never a number in a file anyone can write.
  const revision = Math.max(verified?.revision ?? 0, pointers[modelHash] ?? 0, carried ? pointers[carried] ?? 0 : 0) + 1
  if (!Number.isSafeInteger(revision)) throw new StateFileError('too_large', BASELINE_FILE)
  if (carried && verified) await updateBaselinePointers({ [carried]: Math.max(pointers[carried] ?? 0, verified.revision + 1) }, lock, ctx.modelPath)
  const log = nextLog(read, logBytes, entry)
  await io.replace(SETTLEMENTS_FILE, log.content, logBytes)
  // Replaced only while it is still the file this call verified (or found missing).
  await io.replace(BASELINE_FILE, signedBaseline(ctx.key, modelHash, { ...content, revision, log_digest: logDigest(log.content) }), read.bytes)
  let warning: string | undefined
  try {
    await updateBaselinePointers({ [modelHash]: revision }, lock, ctx.modelPath)
  } catch {
    warning = "the values were registered, but this machine's settlement pointer could not be updated; the next settlement updates it"
  }
  return { ...(log.restarted ? { log_restarted: log.restarted } : {}), ...(warning ? { warning } : {}) }
}

/**
 * Keep this machine's settlement files out of git: create `.dethereal/.gitignore`
 * when there is none, else append only the lines it lacks. A line the user wrote
 * is never rewritten, reordered or removed; a link or anything but a file there
 * is refused and left alone.
 */
export async function ensureGitignore(io: SettlementIO): Promise<'written' | 'present' | 'refused'> {
  try {
    const bytes = await io.read(GITIGNORE_REL)
    const text = bytes ? bytes.toString('utf8') : ''
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()))
    const missing = PER_MACHINE_FILES.filter((f) => !have.has(f) && !have.has(`/${f}`))
    if (!missing.length) return 'present'
    const prefix = text === '' ? '# Written by Dethereal: the settlement, sync and control audit records of this machine, and the relay files of its specialists, never shared.\n' : text.endsWith('\n') ? '' : '\n'
    await io.replace(GITIGNORE_REL, `${text}${prefix}${missing.join('\n')}\n`, bytes)
    return 'written'
  } catch {
    return 'refused'
  }
}

/**
 * `.dethereal/.gitignore` as `ensureGitignore` keeps it, under the model's own lock and with no key: what a pull, a
 * push and a state write do with the settlement off. Never throws.
 */
export async function keepMachineFilesOut(dir: string): Promise<'written' | 'present' | 'refused'> {
  try {
    return await withSettlementLock(dir, (io) => ensureGitignore(io))
  } catch {
    return 'refused'
  }
}

/** Said when `.dethereal/.gitignore` could not be kept: the per-machine files may then be committed. */
export const GITIGNORE_REFUSED_WARNING =
  ".dethereal/.gitignore could not be written (a link, not a file, or the model busy): this machine's sync and audit files are not kept out of git"

/** What a writer does with the settlement off: nothing registered, the per-machine files kept out of git. */
async function settlementOff(dir: string): Promise<Registration> {
  return (await keepMachineFilesOut(dir)) === 'refused' ? { status: 'nothing', warning: GITIGNORE_REFUSED_WARNING } : { status: 'nothing' }
}

/** The mode a writer runs with: the caller's, or the environment's. */
interface WriterOptions { settlement?: SettlementMode }

// =============================================================================
// A pull
// =============================================================================

/**
 * Register what a pull wrote, as the platform returned it: `split` is the
 * model in memory, exactly as it was written. Every value registers as `pull`,
 * bound to `platform.modelId`, except one the operator registered as it now
 * stands, which stays theirs. A registration the platform no longer holds is
 * dropped; a field the operator registered as left empty stays so while the
 * platform holds nothing there either. Values the operator could not register
 * as they are (coded, undisplayable) and fields with pending enrichment are left
 * as rows. Anything on disk that differs from `split` is a row as well.
 */
export async function registerPulled(dir: string, split: SplitModel, platform: { modelId: string; prints: unknown }, options: WriterOptions = {}): Promise<Registration> {
  if (!settlementOn(options.settlement)) return settlementOff(dir)
  if (!PLATFORM_ID.test(platform.modelId)) return { status: 'failed', code: 'model_id_invalid' }
  return guarded(dir, async (ctx) => {
    const pendingBytes = await ctx.io.read(PENDING_FILE_REL)
    let pendingRaw: unknown = null
    if (pendingBytes) {
      try {
        pendingRaw = JSON.parse(pendingBytes.toString('utf8'))
      } catch {
        return { status: 'failed', code: 'pending_enrichment' }
      }
    }
    const pending = pendingFromRaw(pendingRaw as Record<string, unknown> | null)
    if (pending.state === 'unreadable') return { status: 'failed', code: 'pending_enrichment' }
    const pendingTriples = new Set((pending.all ?? pending.entries).map((e) => tripleOf(e.group, e.element_id, e.field)))

    const { refs, values } = payloadValues(gateInputFromModel(split))
    const verified = ctx.read.status === 'verified' ? contentOf(ctx.read.baseline) : contentOf(null)
    const raw = ctx.read.carriedFrom ? operatorOnly(verified) : verified
    const next: BaselineContent = { revision: 0, values: {}, log_digest: null, sources: {}, pull: { model_id: platform.modelId }, controls_registered: {} }
    let registered = 0
    // Every key the platform holds a value for, registered or not: an operator's "left empty" is kept only elsewhere.
    const held = new Set<string>()
    for (const v of values) {
      const ref = refs[v.group].get(v.id)
      if (!ref) continue
      const key = entryKey(ref, v.kind, v.field)
      held.add(key)
      if (v.code || pendingTriples.has(tripleOf(v.group, v.id, v.field)) || undisplayable(v.value)) continue
      const hash = hashOf(v)
      next.values[key] = hash
      if (raw.values[key] !== hash || Object.hasOwn(raw.sources, key)) {
        next.sources[key] = 'pull'
        registered++
      }
      if (v.kind === 'record' && v.field === 'controls') next.controls_registered[key] = v.projected
    }
    // The operator's "left empty", where the platform holds nothing either and the element is still there.
    const elements = new Set(Object.values(refs).flatMap((m) => [...m.values()].map((r) => JSON.stringify([r.label, r.classId, r.type, r.group]))))
    for (const [key, hash] of Object.entries(raw.values)) {
      if (hash !== ABSENT || held.has(key)) continue
      const parts = JSON.parse(key) as unknown[]
      if (elements.has(JSON.stringify(parts.slice(0, 4)))) next.values[key] = ABSENT
    }
    const dropped = Object.entries(raw.values).filter(([k, h]) => h !== ABSENT && !held.has(k)).length
    if (Object.keys(next.values).length > SETTLE_LIMITS.entries) return { status: 'failed', code: 'too_large' }
    const prints = sha256(canonicalJson(platform.prints ?? null))
    const signed = await sign(ctx, next, { at: new Date().toISOString(), action: 'pull', model_id: platform.modelId, prints, registered, dropped })
    const gitignore = await ensureGitignore(ctx.io)
    return { status: 'registered', registered, dropped, gitignore, ...signed }
  })
}

// =============================================================================
// A push that linked controls by name
// =============================================================================

type ControlEntry = { id?: unknown; name?: unknown } & Record<string, unknown>

/**
 * A pushed controls list with each entry named without an id given the id the
 * push linked (`resolved`: the linked controls in list order, local temporary
 * ids left out). Null when the list and what was linked do not line up, or a
 * pinned name is not the linked control's; then nothing is pinned.
 */
export function pinList(list: unknown, resolved: readonly ResolvedControl[] | undefined): ControlEntry[] | null {
  if (!Array.isArray(list) || !resolved) return null
  let j = 0
  const out: ControlEntry[] = []
  for (const entry of list as ControlEntry[]) {
    if (isDeferredControlEntry(entry)) {
      out.push(entry)
      continue
    }
    const linked = resolved[j++]
    if (!linked || !entry || typeof entry !== 'object') return null
    if (entry.id === null || entry.id === undefined) {
      if (normaliseControlName(entry.name) === null || normaliseControlName(entry.name) !== normaliseControlName(linked.name)) return null
      out.push({ ...entry, id: linked.id })
    } else {
      if (entry.id !== linked.id) return null
      out.push(entry)
    }
  }
  return j === resolved.length ? out : null
}

/** Every controls list of a split model, with the ref a push reports it under (the element id, or the model's own). */
function controlLists(model: SplitModel): Array<{ group: SettleGroup; id: string; holder: Record<string, unknown> }> {
  const out: Array<{ group: SettleGroup; id: string; holder: Record<string, unknown> }> = []
  const walk = (b: any, root: boolean) => {
    if (!b || typeof b !== 'object') return
    if (!root && typeof b.id === 'string') out.push({ group: 'boundaries', id: b.id, holder: b })
    for (const c of b.components ?? []) if (c && typeof c.id === 'string') out.push({ group: 'components', id: c.id, holder: c })
    for (const n of b.boundaries ?? []) walk(n, false)
  }
  walk((model.structure as any)?.defaultBoundary, true)
  const flows = Array.isArray(model.dataFlows) ? model.dataFlows : (model.dataFlows as any)?.dataFlows ?? []
  for (const f of flows) if (f && typeof f.id === 'string') out.push({ group: 'dataFlows', id: f.id, holder: f })
  const items = Array.isArray(model.dataItems) ? model.dataItems : (model.dataItems as any)?.dataItems ?? []
  for (const i of items) if (i && typeof i.id === 'string') out.push({ group: 'dataItems', id: i.id, holder: i })
  if (model.manifest?.model) out.push({ group: 'model', id: MODEL_REF_ID, holder: model.manifest.model as unknown as Record<string, unknown> })
  return out.filter((e) => Array.isArray(e.holder.controls))
}

/**
 * The model a push wrote, with the controls it linked by name pinned to the
 * linked ids: what a create or import writes to its directory, so that the
 * files hold what the platform linked.
 */
export function pinnedModel(pushed: SplitModel, resolved: Record<string, readonly ResolvedControl[]>): SplitModel {
  const model = structuredClone(pushed)
  for (const { group, id, holder } of controlLists(model)) {
    const pinned = pinList(holder.controls, resolved[group === 'model' ? MODEL_REF_ID : id])
    if (pinned) holder.controls = pinned
  }
  return model
}

/**
 * Register the ids a push linked for controls named without one. Only a list
 * the operator registered exactly as it was pushed is carried, and only where
 * the directory now holds that list with the linked ids pinned (as the push
 * wrote it back); everything else stays a row. `pushed` is the payload as sent,
 * `resolved` the push's linked controls by the refs the payload held, and
 * `idMapping` the ids the platform gave new elements.
 */
export async function registerPushPin(
  dir: string,
  pushed: SplitModel,
  resolved: Record<string, readonly ResolvedControl[]>,
  idMapping: Map<string, string> | undefined,
  modelId: string,
  options: WriterOptions = {},
): Promise<Registration> {
  if (!settlementOn(options.settlement)) return settlementOff(dir)
  if (!PLATFORM_ID.test(modelId)) return { status: 'failed', code: 'model_id_invalid' }
  return guarded(dir, async (ctx) => {
    if (ctx.read.status !== 'verified' || ctx.read.carriedFrom) return { status: 'nothing' }
    const { refs, records } = payloadValues(gateInputFromModel(pushed))
    const counted = countedRegistrations(ctx.read, refs, modelId)
    let disk
    try {
      disk = recordProjector(await loadGateInput(dir))
    } catch {
      return { status: 'failed', code: 'unreadable' }
    }
    const onDisk = new Map(disk.values.filter((v) => v.field === 'controls').map((v) => [`${v.group}\u0000${v.id}`, v.projected]))
    const next = contentOf(ctx.read.baseline)
    let pinned = 0
    for (const { group, id, holder } of controlLists(pushed)) {
      const ref = refs[group].get(id)
      if (!ref) continue
      const key = entryKey(ref, 'record', 'controls')
      const before = records.project(group, id, 'controls', holder.controls)
      // An operator's registration, or one already carried from theirs; a pull's stays bound to its platform model.
      if (counted.values[key] !== valueHash(before) || !Object.hasOwn(next.values, key) || next.sources[key] === 'pull') continue
      const list = pinList(holder.controls, resolved[group === 'model' ? MODEL_REF_ID : id])
      if (!list) continue
      const after = records.project(group, id, 'controls', list)
      if (canonicalJson(after) === canonicalJson(before)) continue
      const diskId = group === 'model' ? MODEL_REF_ID : idMapping?.get(id) ?? id
      if (canonicalJson(onDisk.get(`${group}\u0000${diskId}`) ?? null) !== canonicalJson(after)) continue
      next.values[key] = valueHash(after)
      next.sources[key] = 'push-pin'
      next.controls_registered[key] = after
      pinned++
    }
    if (!pinned) return { status: 'nothing' }
    const signed = await sign(ctx, next, { at: new Date().toISOString(), action: 'push-pin', model_id: modelId, pinned })
    return { status: 'registered', registered: pinned, gitignore: await ensureGitignore(ctx.io), ...signed }
  })
}

// =============================================================================
// A local control created on the platform
// =============================================================================

const PLATFORM_ID = /^[A-Za-z0-9._:-]{1,256}$/

/**
 * Carry the registrations that named a local control by its temporary id to
 * the id the platform gave it. A registered list is carried only when the
 * directory now holds exactly that list with that one id replaced; anything
 * else stays a row, flagged, for the operator. Idempotent: once carried, no
 * registered list names the temporary id.
 */
export async function carryGreenfield(dir: string, op: { tempId: string; serverId: string }, options: WriterOptions = {}): Promise<Registration> {
  if (!settlementOn(options.settlement)) return { status: 'nothing' }
  if (!isDeferredControlEntry({ id: op.tempId }) || !PLATFORM_ID.test(op.serverId) || isDeferredControlEntry({ id: op.serverId })) return { status: 'nothing' }
  return guarded(dir, async (ctx) => {
    if (ctx.read.status !== 'verified' || ctx.read.carriedFrom) return { status: 'nothing' }
    let input
    try {
      input = await loadGateInput(dir)
    } catch {
      return { status: 'failed', code: 'unreadable' }
    }
    const { refs, records } = payloadValues(input)
    const counted = countedRegistrations(ctx.read, refs, null)
    const next = contentOf(ctx.read.baseline)
    let carried = 0
    for (const v of records.values) {
      if (v.field !== 'controls') continue
      const ref = refs[v.group].get(v.id)
      if (!ref) continue
      const key = entryKey(ref, 'record', 'controls')
      const list = Object.hasOwn(counted.controls, key) ? counted.controls[key] : undefined
      if (!Array.isArray(list) || !list.some((e) => (e as ControlEntry)?.id === op.tempId)) continue
      const expected = records.project(v.group, v.id, 'controls', list.map((e) => ((e as ControlEntry)?.id === op.tempId ? { ...(e as ControlEntry), id: op.serverId } : e)))
      // Only a registration stored under the key it counts under (one carried to a first class stays a row until settled).
      if (canonicalJson(v.projected) !== canonicalJson(expected) || !Object.hasOwn(next.values, key)) continue
      next.values[key] = valueHash(expected)
      next.sources[key] = 'greenfield'
      next.controls_registered[key] = expected
      carried++
    }
    if (!carried) return { status: 'nothing' }
    const signed = await sign(ctx, next, { at: new Date().toISOString(), action: 'greenfield', temp_id: op.tempId, server_id: op.serverId, carried })
    return { status: 'registered', registered: carried, ...signed }
  })
}
