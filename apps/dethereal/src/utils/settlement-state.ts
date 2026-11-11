/**
 * A model directory's settlement state: its baseline, read and verified with
 * this machine's key and pointer file, and the values nobody registered.
 * `model_state` reports it and blocks REVIEWED on it; `model_state_settle`
 * plans from it; the push gate holds a payload against it.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  elementRefs,
  readBaselinePointers,
  recordProjector,
  waiverKeyState,
  RECORD_FIELDS,
  type BaselinePointers,
  type ElementRef,
  type GateInput,
  type PendingGroup,
  type RecordProjector,
  type SettleGroup,
} from './gates.js'
import { loadPlatformBaseline } from './platform-baseline.js'
import {
  GROUPS,
  SETTLEMENTS_FILE,
  carryUnclassified,
  computeDrift,
  inlineAttributes,
  modelHashOf,
  readBaseline,
  scanAttributeFiles,
  sha256,
  shownLog,
  shownRows,
  valuesOf,
  type AttributeScan,
  type BaselineRead,
  type Drift,
  type RegistrationSource,
} from './settlement.js'
import { readChecked } from './state-store.js'
import { recordRefusal, templateFor, valueRefusal } from './registrable.js'

export interface SettlementState {
  modelPath: string
  /** The directory as baselines name it (null while this machine has no key) */
  modelHash: string | null
  key: Buffer | null
  keyCode?: string
  pointers: BaselinePointers
  baseline: BaselineRead
  scan: AttributeScan
  refs: Record<SettleGroup, Map<string, ElementRef>>
  records: RecordProjector
  /** The registered values that count here, as they apply to the model now (registrations made before a first class carried over) */
  values: Record<string, string>
  /** The machine's registrations among those, by key (the operator's have no entry) */
  sources: Record<string, RegistrationSource>
  /** The registered controls lists of those, by key (a list follows its key to a first class) */
  controls: Record<string, unknown>
  /** How many of those the operator registered, and how many the machine did, by source */
  registered: Record<'operator' | 'pull' | 'push_pin' | 'greenfield', number>
  drift: Drift
  logBytes: Buffer | null
}

type Payload = Pick<GateInput, 'structure' | 'dataFlows' | 'dataItems' | 'attributes'> & { pending?: GateInput['pending']; manifest?: GateInput['manifest'] }

/**
 * The registered values that count, from a verified baseline. Every operator
 * registration counts, and so do the push-pin and greenfield carry-overs (each
 * carries an operator registration to the id the platform gave). A pull's
 * registrations count only for the platform model they came from
 * (`pullModelId`: the model a push writes, or the one this directory's
 * verified sync record names). A baseline carried from another directory
 * keeps only the operator's. Only the operator's registrations follow an
 * element to its first class; the machine's stay under the key they were made
 * for, so none is ever rewritten as the operator's.
 */
export function countedRegistrations(
  read: BaselineRead,
  refs: Record<SettleGroup, Map<string, ElementRef>>,
  pullModelId: string | null,
): { values: Record<string, string>; sources: Record<string, RegistrationSource>; controls: Record<string, unknown>; registered: SettlementState['registered'] } {
  const registered = { operator: 0, pull: 0, push_pin: 0, greenfield: 0 }
  if (read.status !== 'verified' || !read.baseline) return { values: {}, sources: {}, controls: {}, registered }
  const b = read.baseline
  const counts = (source: RegistrationSource): boolean =>
    !read.carriedFrom && (source !== 'pull' || (b.pull !== null && pullModelId === b.pull.model_id))
  const operator: Record<string, string> = {}
  const machine: Record<string, string> = {}
  const sources: Record<string, RegistrationSource> = {}
  for (const [k, h] of Object.entries(b.values)) {
    const source = Object.hasOwn(b.sources, k) ? b.sources[k] : undefined
    if (!source) operator[k] = h
    else if (counts(source)) {
      machine[k] = h
      sources[k] = source
    }
  }
  // A registration carried to its element's first class takes its controls list along.
  const moved = new Map<string, string>()
  const values = { ...carryUnclassified(operator, refs, moved), ...machine }
  const controls: Record<string, unknown> = {}
  for (const [k, list] of Object.entries(b.controls_registered)) {
    const at = moved.get(k) ?? k
    if (Object.hasOwn(values, at)) controls[at] = list
  }
  for (const k of Object.keys(values)) registered[sources[k] === 'push-pin' ? 'push_pin' : sources[k] ?? 'operator']++
  return { values, sources, controls, registered }
}

/** The platform model this directory's pull registrations are bound to here: named in the baseline, and in a sync record that verifies. */
async function boundPullModel(dir: string, read: BaselineRead): Promise<string | null> {
  const id = read.status === 'verified' ? read.baseline?.pull?.model_id : undefined
  if (!id) return null
  return (await loadPlatformBaseline(dir, id).catch(() => null))?.state === 'verified' ? id : null
}

/** Read a model's settlement state. With `create`, a machine with no key yet gets one. */
export async function settlementState(dir: string, input: GateInput, options: { create?: boolean } = {}): Promise<SettlementState> {
  const modelPath = await fs.realpath(dir)
  const keyState = await waiverKeyState(options.create === true, dir)
  const pointers = await readBaselinePointers(dir)
  const baseline = await readBaseline(dir, modelPath, keyState.key, keyState.code, pointers)
  const scan = await scanAttributeFiles(dir)
  const refs = elementRefs(input)
  const records = recordProjector(input)
  const { values, attributeFields } = valuesOf(scan, refs, inlineAttributes({ structure: input.structure, dataFlows: input.dataFlows, dataItems: input.dataItems }), records.values)
  const counted = countedRegistrations(baseline, refs, await boundPullModel(dir, baseline))
  const drift = computeDrift({
    refs, values, attributeFields, pending: input.pending?.all ?? input.pending?.entries ?? [], baseline: counted.values, pendingRecordFields: RECORD_FIELDS,
    controlsRegistered: counted.controls,
    // The rule settle holds a value to, so a row no decision could register shows why.
    unregistrable: (v, ref) => (v.kind === 'record'
      ? recordRefusal(v.group, v.field, v.value)
      : valueRefusal(v.group, v.field, v.value, templateFor(input.classTemplates, ref.classId)))?.code,
  })
  let logBytes: Buffer | null
  try {
    logBytes = await readChecked(path.join(dir, ...SETTLEMENTS_FILE.split('/')), SETTLEMENTS_FILE, 4 * 1024 * 1024)
  } catch {
    logBytes = null
  }
  return {
    modelPath, modelHash: keyState.key ? modelHashOf(keyState.key, modelPath) : null, key: keyState.key,
    ...(keyState.code ? { keyCode: keyState.code } : {}), pointers, baseline, scan, refs, records, values: counted.values, sources: counted.sources, controls: counted.controls, registered: counted.registered, drift, logBytes,
  }
}

/** The values of a model held in memory (a payload pushed, a model pulled), read as its directory's files would be. */
export function payloadValues(payload: Payload): {
  refs: Record<SettleGroup, Map<string, ElementRef>>; records: RecordProjector; values: ReturnType<typeof valuesOf>['values']; attributeFields: Set<string>
} {
  const refs = elementRefs(payload)
  const scan: AttributeScan = { files: [], consolidated: false, unreadable: [] }
  for (const group of GROUPS) {
    const bag = (payload.attributes as Record<string, Record<string, { attributes?: Record<string, unknown> }> | undefined>)[group] ?? {}
    for (const [id, entry] of Object.entries(bag)) {
      scan.files.push({ group, rel: `attributes/${group}/${id}.json`, bytes: Buffer.alloc(0), doc: null, elementId: id, flat: false, attributes: entry?.attributes ?? {} })
    }
  }
  const records = recordProjector(payload)
  const { values, attributeFields } = valuesOf(scan, refs, inlineAttributes({ structure: payload.structure, dataFlows: payload.dataFlows, dataItems: payload.dataItems }), records.values)
  return { refs, records, values, attributeFields }
}

/**
 * Drift of a payload about to be pushed, against a directory's verified baseline (an empty one when it has none).
 * `modelId` is the platform model the push writes (none for a push that creates one): a pull's registrations count only for it.
 */
export async function payloadDrift(dir: string | null, payload: Payload, modelId: string | null = null): Promise<{ drift: Drift; baseline: BaselineRead | null }> {
  let baseline: BaselineRead | null = null
  if (dir) {
    const modelPath = await fs.realpath(dir)
    const keyState = await waiverKeyState(false, dir)
    baseline = await readBaseline(dir, modelPath, keyState.key, keyState.code, await readBaselinePointers(dir))
  }
  const { refs, values, attributeFields } = payloadValues(payload)
  const drift = computeDrift({
    refs, values, attributeFields, pending: payload.pending?.all ?? payload.pending?.entries ?? [],
    ...(() => {
      const counted = baseline ? countedRegistrations(baseline, refs, modelId) : null
      return { baseline: counted?.values ?? {}, controlsRegistered: counted?.controls ?? {} }
    })(),
    pendingRecordFields: RECORD_FIELDS,
  })
  return { drift, baseline }
}

/** Whether the log on disk is the one the verified baseline signed. */
const logVerified = (s: Pick<SettlementState, 'baseline' | 'logBytes'>): boolean =>
  s.baseline.status === 'verified' && s.baseline.baseline!.log_digest === (s.logBytes ? sha256(s.logBytes) : null)

/** The fields `model_state get` reports. */
export function settlementFields(s: SettlementState): Record<string, unknown> {
  return {
    baseline: s.baseline.status,
    ...(s.baseline.code ? { baseline_code: s.baseline.code } : {}),
    ...(s.baseline.carriedFrom ? { baseline_carried: true } : {}),
    unregistered_changes: { rows: shownRows(s.drift), rows_total: s.drift.total, digest: s.drift.digest },
    declined_fields: { rows: s.drift.declined.slice(0, 100), total: s.drift.declined.length },
    orphaned_registrations: { total: s.drift.orphaned.keys.length, elements: s.drift.orphaned.elements.slice(0, 20), elements_total: s.drift.orphaned.elements.length },
    registered: s.registered,
    ...shownLog(s.logBytes),
    settlements_verified: logVerified(s),
  }
}

/** The fields for a model that could not be read: nothing can be counted, and nothing is claimed. */
export function unreadableSettlementFields(): Record<string, unknown> {
  return {
    baseline: 'unverified', baseline_code: 'unreadable', unregistered_changes: { rows: [], rows_total: 0, digest: sha256('unreadable') },
    declined_fields: { rows: [], total: 0 }, orphaned_registrations: { total: 0, elements: [], elements_total: 0 },
    registered: { operator: 0, pull: 0, push_pin: 0, greenfield: 0 }, settlements_total: 0, settlements_recent: [], settlements_verified: false,
  }
}

/** Whether the settlement blocks REVIEWED and a push, and the codes that say why. */
export function settlementBlocks(s: Pick<SettlementState, 'baseline' | 'drift'>): string[] {
  const codes: string[] = []
  if (s.baseline.status === 'unavailable') codes.push(s.baseline.code === 'pointer_unavailable' ? 'pointer_unavailable' : 'baseline_key_unavailable')
  if (s.drift.total > 0) codes.push('unregistered_changes')
  return codes
}

/**
 * Why a payload must not be pushed for its settlement, or null: this machine's
 * key or pointer file cannot be used, or the payload holds values nobody
 * registered (values written on elements themselves, and registered values now
 * gone, included). `dir` is the model directory whose baseline applies (none
 * for a payload that has no directory yet: then every value is unregistered).
 */
export async function settlementPushRefusal(dir: string | null, payload: Payload, modelId: string | null = null): Promise<string | null> {
  const { drift, baseline } = await payloadDrift(dir, payload, modelId)
  if (baseline?.status === 'unavailable') {
    return baseline.code === 'pointer_unavailable'
      ? "Push refused: this machine's settlement pointer file cannot be used, so no rollback can be seen and nothing counts as registered (pointer_unavailable). Fix the file beside the key, then push again."
      : `Push refused: this machine's key cannot be used (${baseline.code}), so no value can be registered (baseline_key_unavailable). Fix the key, then register the values.`
  }
  if (drift.total > 0) {
    return `Push refused: ${drift.total} value${drift.total === 1 ? ' is' : 's are'} not registered as the operator's (unregistered_changes). ` +
      "model_state get with include ['unregistered_rows'] lists the rows; register what the operator confirms with model_state_settle, and move values written on elements themselves into their attribute files."
  }
  return null
}
