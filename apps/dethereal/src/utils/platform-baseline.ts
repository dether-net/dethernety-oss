/**
 * What the platform model looked like at the last pull or push, so a push can
 * tell whether someone changed it there since.
 *
 * A push REPLACEs each element it sends: its controls, data-item links,
 * attributes and asset context become exactly the local ones. A change made on
 * the platform after the last pull would be undone without a word. So every
 * pull and push records a fingerprint of the platform model, per element and per
 * class of field, and a push first compares the live platform model with it.
 *
 * - Fingerprints are always taken from a platform export, never from local
 *   files, so both sides go through the same normalisation. Each push compares
 *   only the field classes it writes (`update_model` never writes a data item's
 *   attributes, `update_attributes` writes nothing but attributes), so a push's
 *   own writes never read as a platform change, and a change it does not
 *   overwrite never refuses it.
 * - The record lives in `.dethereal/sync.json`, signed with a key derived from
 *   this machine's waiver key and bound to the model id, the platform URL and
 *   the model directory's real path. A record that fails any of that is treated
 *   as missing: every element then counts as changed.
 * - Overwriting a change needs the exact changed ids and the revision the refusal
 *   gave. The revision only proves the platform has not changed again since the
 *   refusal; it is not an authorisation — the tool's own approval prompt is.
 */

import { promises as fs } from 'node:fs'
import { DtExportSplit } from '@dethernety/dt-core'
import type { SplitModel, StructureBoundary, StructureComponent } from '@dethernety/dt-core'
import { getConfig } from '../config.js'
import { loadWaiverKey, MAC_TAGS, macHex, subkey, verifyMacHex, waiverKeyRefusal } from './gates.js'
import { canonicalJsonOmit } from './canonical-json.js'
import { sha256Hex } from './hash.js'
import { readSyncJson, writeSyncJson, MAX_SYNC_BYTES, type SyncMetadata } from './sync-utils.js'

/** The pseudo-element for the model's own fields: name, description, modules, controls, scope. */
export const MODEL_ELEMENT_ID = '@model'
/** Most changes listed in detail in a refusal. */
export const MAX_LISTED_CHANGES = 500
/** Most changed ids an overwrite can name. */
export const MAX_ACKNOWLEDGED_CHANGES = 5000
export const PLATFORM_CHANGED_CODE = 'PLATFORM_CHANGED_SINCE_SYNC'

export type ElementKind = 'model' | 'boundary' | 'component' | 'flow' | 'data_item'
export type FieldClass = 'properties' | 'structure' | 'layout' | 'controls' | 'data_items' | 'attributes' | 'asset_context' | 'item_attributes'

/** The field classes `update_model` writes: all but a data item's attributes, which it drops. */
export const MODEL_PUSH_FIELDS: readonly FieldClass[] = ['properties', 'structure', 'layout', 'controls', 'data_items', 'attributes', 'asset_context']
/** The field classes `update_attributes` writes. */
export const ATTRIBUTE_PUSH_FIELDS: readonly FieldClass[] = ['attributes', 'item_attributes']

/**
 * What a push can overwrite, and so what its check compares: the field classes it
 * writes and, when it writes only some elements, their ids.
 */
export interface CheckScope {
  fields: readonly FieldClass[]
  ids?: ReadonlySet<string>
}
export type BaselineState = 'verified' | 'missing' | 'legacy' | 'unverifiable'
export type ChangeKind = 'modified' | 'deleted_on_platform' | 'added_on_platform' | 'no_baseline'

export interface ElementPrint {
  k: ElementKind
  n: string
  f: Partial<Record<FieldClass, string>>
}
export type PlatformPrints = Record<string, ElementPrint>

export interface PlatformBaselineRecord {
  v: 1
  model_id: string
  recorded_at: string
  elements: PlatformPrints
  mac: string
}

export interface PlatformChange {
  id: string
  kind: ElementKind
  name: string
  change: ChangeKind
  fields?: FieldClass[]
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

/** JSON with object keys sorted and undefined dropped: equal values give equal text. */
export const canonicalJson = canonicalJsonOmit

const print = (value: unknown): string => sha256Hex(canonicalJson(value ?? null)).slice(0, 16)

/** Referenced ids as a sorted set; an absent list and an empty one are the same. */
function idSet(refs: readonly unknown[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const ref of refs ?? []) {
    const id = typeof ref === 'string' ? ref : (ref as { id?: unknown } | null)?.id
    if (typeof id === 'string') out.add(id)
  }
  return [...out].sort()
}

/** A list whose order carries no meaning, in a fixed order. */
const unordered = (list: readonly unknown[] | null | undefined): unknown[] =>
  (list ?? []).map((x) => canonicalJson(x)).sort().map((x) => JSON.parse(x))

const orNull = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v)

type AttributeBag = Record<string, { classData?: { id?: string } | null; attributes?: unknown } | undefined> | undefined

/** An element's attribute entry as the push writes it: its class and values (not its display name or timestamp). */
function attributesOf(bag: AttributeBag, id: string): unknown {
  const entry = bag?.[id]
  return entry ? { classId: orNull(entry.classData?.id), attributes: entry.attributes ?? {} } : null
}

/** The field class each attribute group's values are printed under. */
const ATTRIBUTE_GROUP_FIELDS = {
  components: 'attributes',
  boundaries: 'attributes',
  dataFlows: 'attributes',
  dataItems: 'item_attributes',
} as const satisfies Record<string, FieldClass>

/**
 * Prints of the attribute values a push sends, per element and field class, as
 * fingerprintSplitModel prints them on an export: pass the values as sent (after
 * filtering and withheld nulls), never the local files.
 */
export function sentAttributePrints(
  sent: Partial<Record<keyof typeof ATTRIBUTE_GROUP_FIELDS, unknown>>
): Record<string, Partial<Record<FieldClass, string>>> {
  const out: Record<string, Partial<Record<FieldClass, string>>> = Object.create(null)
  for (const [group, field] of Object.entries(ATTRIBUTE_GROUP_FIELDS) as [keyof typeof ATTRIBUTE_GROUP_FIELDS, FieldClass][]) {
    const bag = sent[group] as AttributeBag
    for (const id of Object.keys(bag ?? {})) (out[id] ??= {})[field] = print(attributesOf(bag, id))
  }
  return out
}

/**
 * Conduits as the push writes them: OUTBOUND membership and its justification,
 * by peer. INBOUND entries mirror a peer's OUTBOUND ones; names and control refs
 * are not written.
 */
function conduitsOf(boundary: StructureBoundary): unknown[] {
  return (boundary.conduits ?? [])
    .filter((c) => c?.direction === 'OUTBOUND' && typeof c.peerId === 'string')
    .map((c) => ({ peerId: c.peerId, justification: orNull(c.justification) }))
    .sort((a, b) => (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0))
}

/**
 * Fingerprints of a platform export, per element and field class. Call it on the
 * export as returned, before anything merges local data into it or strips fields.
 */
export function fingerprintSplitModel(split: SplitModel): PlatformPrints {
  const prints: PlatformPrints = {}
  const attrs = split.attributes ?? {}
  const model = split.manifest.model

  prints[MODEL_ELEMENT_ID] = {
    k: 'model',
    n: model.name ?? '',
    f: {
      properties: print({ name: model.name ?? '', description: orNull(model.description), modules: idSet(split.manifest.modules) }),
      controls: print(idSet(model.controls)),
      asset_context: print(orNull(model.scope)),
    },
  }

  const component = (c: StructureComponent, parent: string | null) => {
    prints[c.id] = {
      k: 'component',
      n: c.name ?? '',
      f: {
        properties: print({ name: c.name ?? '', description: orNull(c.description), type: orNull(c.type), classId: orNull(c.classData?.id) }),
        structure: print({ parent }),
        layout: print({ x: orNull(c.positionX), y: orNull(c.positionY) }),
        controls: print(idSet(c.controls)),
        data_items: print(idSet(c.dataItemIds)),
        attributes: print(attributesOf(attrs.components as AttributeBag, c.id)),
        asset_context: print({ crownJewel: c.crownJewel === true }),
      },
    }
  }

  const boundary = (b: StructureBoundary, parent: string | null) => {
    prints[b.id] = {
      k: 'boundary',
      n: b.name ?? '',
      f: {
        properties: print({ name: b.name ?? '', description: orNull(b.description), classId: orNull(b.classData?.id) }),
        structure: print({ parent }),
        layout: print({
          x: orNull(b.positionX),
          y: orNull(b.positionY),
          width: orNull(b.dimensionsWidth),
          height: orNull(b.dimensionsHeight),
        }),
        controls: print(idSet(b.controls)),
        data_items: print(idSet(b.dataItemIds)),
        attributes: print(attributesOf(attrs.boundaries as AttributeBag, b.id)),
        asset_context: print({
          zone: orNull(b.zone),
          domains: unordered(b.domains),
          planes: unordered(b.planes),
          conduits: conduitsOf(b),
        }),
      },
    }
    for (const child of b.boundaries ?? []) boundary(child, b.id)
    for (const c of b.components ?? []) component(c, b.id)
  }
  // The default boundary is an element too: the push writes it under its platform id.
  if (split.structure?.defaultBoundary?.id) boundary(split.structure.defaultBoundary, null)

  for (const flow of split.dataFlows ?? []) {
    prints[flow.id] = {
      k: 'flow',
      n: flow.name ?? '',
      f: {
        properties: print({ name: flow.name ?? '', description: orNull(flow.description), classId: orNull(flow.classData?.id) }),
        structure: print({
          source: orNull(flow.source?.id),
          target: orNull(flow.target?.id),
          sourceHandle: orNull(flow.sourceHandle),
          targetHandle: orNull(flow.targetHandle),
        }),
        controls: print(idSet(flow.controls)),
        data_items: print(idSet(flow.dataItemIds)),
        attributes: print(attributesOf(attrs.dataFlows as AttributeBag, flow.id)),
      },
    }
  }

  // A data item's attributes have their own class: update_attributes writes them, update_model does not.
  for (const item of split.dataItems ?? []) {
    prints[item.id] = {
      k: 'data_item',
      n: item.name ?? '',
      f: {
        properties: print({ name: item.name ?? '', description: orNull(item.description), classId: orNull(item.classData?.id) }),
        // origin and is_credential are printed only when answered, so an item with neither keeps the print a
        // baseline recorded before these fields existed holds. An answered false is an answer.
        asset_context: print({
          sensitivity: orNull(item.sensitivity),
          regulatory_flags: unordered(item.regulatory_flags),
          origin: item.origin ?? undefined,
          is_credential: typeof item.is_credential === 'boolean' ? item.is_credential : undefined,
        }),
        item_attributes: print(attributesOf(attrs.dataItems as AttributeBag, item.id)),
        // Printed only when the item has controls, so an item without any keeps the print a baseline recorded
        // before data items carried controls holds; a push replaces a listed item's controls.
        ...(item.controls?.length ? { controls: print(idSet(item.controls)) } : {}),
      },
    }
  }
  return prints
}

// ---------------------------------------------------------------------------
// The signed record
// ---------------------------------------------------------------------------

async function baselineKey(create: boolean, modelDir: string): Promise<Buffer | null> {
  const waiverKey = await loadWaiverKey(create, modelDir)
  return waiverKey ? subkey(waiverKey, MAC_TAGS.platformBaseline) : null
}

const macPayload = (modelId: string, dirReal: string, elements: PlatformPrints): string =>
  canonicalJson({ v: 1, model_id: modelId, platform_url: getConfig().baseUrl, dir: dirReal, elements })

/** Room left in sync.json for its other fields. */
const OTHER_SYNC_FIELDS_BYTES = 256 * 1024

/**
 * A signed record of `prints` for this model directory, or null with the reason:
 * this machine keeps no key for the model (`waiverKeyRefusal`), or the record would
 * not fit in sync.json.
 */
export async function signPlatformBaseline(
  modelDir: string,
  modelId: string,
  prints: PlatformPrints
): Promise<{ record: PlatformBaselineRecord | null; reason?: string }> {
  const key = await baselineKey(true, modelDir)
  if (!key) return { record: null, reason: waiverKeyRefusal(modelDir) ?? 'no_key' }
  const dirReal = await fs.realpath(modelDir)
  const record: PlatformBaselineRecord = {
    v: 1,
    model_id: modelId,
    recorded_at: new Date().toISOString(),
    elements: prints,
    mac: macHex(key, macPayload(modelId, dirReal, prints)),
  }
  if (Buffer.byteLength(JSON.stringify(record, null, 2)) > MAX_SYNC_BYTES - OTHER_SYNC_FIELDS_BYTES) {
    return { record: null, reason: 'too_large' }
  }
  return { record }
}

function isPrints(value: unknown): value is PlatformPrints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (p) => p && typeof p === 'object' && typeof (p as ElementPrint).k === 'string' && typeof (p as ElementPrint).n === 'string' &&
      (p as ElementPrint).f !== null && typeof (p as ElementPrint).f === 'object'
  )
}

/** The recorded baseline for this model directory and model, and whether it can be trusted. */
export async function loadPlatformBaseline(
  modelDir: string,
  modelId: string
): Promise<{ state: BaselineState; elements: PlatformPrints | null; mac?: string; reason?: string }> {
  const sync = await readSyncJson(modelDir)
  if (!sync) return { state: 'missing', elements: null }
  const record = (sync as { platform_baseline?: unknown }).platform_baseline as Partial<PlatformBaselineRecord> | undefined
  if (!record) return { state: 'legacy', elements: null }
  if (record.v !== 1 || record.model_id !== modelId || !isPrints(record.elements) || typeof record.mac !== 'string' || !/^[0-9a-f]{64}$/.test(record.mac)) {
    return { state: 'unverifiable', elements: null }
  }
  const key = await baselineKey(false, modelDir)
  if (!key) return { state: 'unverifiable', elements: null, reason: waiverKeyRefusal(modelDir) ?? 'no_key' }
  const dirReal = await fs.realpath(modelDir)
  if (!verifyMacHex(key, macPayload(modelId, dirReal, record.elements), record.mac)) return { state: 'unverifiable', elements: null }
  return { state: 'verified', elements: record.elements, mac: record.mac }
}

// ---------------------------------------------------------------------------
// Comparison and the push check
// ---------------------------------------------------------------------------

const KIND_ORDER: ElementKind[] = ['model', 'boundary', 'component', 'flow', 'data_item']

function byKindThenName(a: PlatformChange, b: PlatformChange): number {
  const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  if (k !== 0) return k
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * What changed on the platform since the recorded baseline, within what the push
 * can overwrite (`scope`). Without a trusted baseline, every live element in scope
 * counts as changed. An element on the platform that the baseline does not hold is
 * listed when the push would delete it (`includeAdded`), or when the push writes
 * it by id (it is in `scope.ids`).
 */
export function platformChanges(
  state: BaselineState,
  recorded: PlatformPrints | null,
  live: PlatformPrints,
  options: { includeAdded: boolean; scope: CheckScope }
): PlatformChange[] {
  const { ids, fields } = options.scope
  const inScope = (id: string) => !ids || ids.has(id)
  const changes: PlatformChange[] = []
  if (state !== 'verified' || !recorded) {
    for (const [id, p] of Object.entries(live)) if (inScope(id)) changes.push({ id, kind: p.k, name: p.n, change: 'no_baseline' })
    return changes.sort(byKindThenName)
  }
  for (const [id, before] of Object.entries(recorded)) {
    if (!inScope(id)) continue
    const now = live[id]
    if (!now) {
      changes.push({ id, kind: before.k, name: before.n, change: 'deleted_on_platform' })
      continue
    }
    const changed = fields.filter((c) => before.f[c] !== now.f[c]).sort()
    if (changed.length > 0) changes.push({ id, kind: now.k, name: now.n, change: 'modified', fields: changed })
  }
  for (const [id, now] of Object.entries(live)) {
    if (recorded[id]) continue
    if (options.includeAdded ? inScope(id) : ids?.has(id)) changes.push({ id, kind: now.k, name: now.n, change: 'added_on_platform' })
  }
  return changes.sort(byKindThenName)
}

/**
 * Identifies this set of changes as the platform shows them now, in the field
 * classes the push compares; any further change there gives another. A change
 * outside those classes leaves it as it is.
 */
export function changeRevision(
  modelId: string,
  state: BaselineState,
  changes: PlatformChange[],
  live: PlatformPrints,
  scope: CheckScope
): string {
  const fields = [...scope.fields].sort()
  const rows = changes.map((c) => {
    const now = live[c.id]
    return [c.id, c.change, now ? canonicalJson(Object.fromEntries(fields.map((f) => [f, now.f[f] ?? null]))) : null]
  })
  return sha256Hex(canonicalJson({ model_id: modelId, baseline: state, fields, changes: rows }))
}

function sameIdSet(given: readonly string[], expected: readonly string[]): boolean {
  const set = new Set(given)
  if (set.size !== given.length || set.size !== expected.length) return false
  return expected.every((id) => set.has(id))
}

export interface PlatformChangeRefusal {
  message: string
  data: {
    code: typeof PLATFORM_CHANGED_CODE
    baseline: BaselineState
    revision: string
    changes_total: number
    changes: PlatformChange[]
    changed_ids: string[]
    acknowledgement?: 'stale'
  }
}

export interface PlatformCheck {
  refusal?: PlatformChangeRefusal
  /** `accepted`: the named changes are overwritten; `unused`: an acknowledgement was passed with nothing changed. */
  acknowledgement?: 'accepted' | 'unused'
  /** The ids whose platform change the operator named: a push that re-signs part of the record keeps their old prints. */
  overwritten?: ReadonlySet<string>
  /** The record the check compared against, for a push that re-signs part of it. */
  baseline: { state: BaselineState; elements: PlatformPrints | null; mac?: string }
}

/**
 * The check a push runs before writing anything: the live platform model against
 * the recorded baseline, within what the push can overwrite, and the operator's
 * acknowledgement against the changes.
 */
export async function checkPlatformChanges(
  modelDir: string,
  modelId: string,
  live: PlatformPrints,
  input: { includeAdded: boolean; scope: CheckScope; overwriteChanged?: readonly string[]; overwriteRevision?: string }
): Promise<PlatformCheck> {
  const baseline = await loadPlatformBaseline(modelDir, modelId)
  const loaded = { state: baseline.state, elements: baseline.elements, ...(baseline.mac ? { mac: baseline.mac } : {}) }
  const changes = platformChanges(baseline.state, baseline.elements, live, { includeAdded: input.includeAdded, scope: input.scope })
  const acknowledged = input.overwriteChanged !== undefined || input.overwriteRevision !== undefined
  if (changes.length === 0) return acknowledged ? { acknowledgement: 'unused', baseline: loaded } : { baseline: loaded }

  const revision = changeRevision(modelId, baseline.state, changes, live, input.scope)
  const ids = changes.map((c) => c.id)
  const tooMany = changes.length > MAX_ACKNOWLEDGED_CHANGES
  if (!tooMany && acknowledged && input.overwriteRevision === revision && sameIdSet(input.overwriteChanged ?? [], ids)) {
    return { acknowledgement: 'accepted', overwritten: new Set(ids), baseline: loaded }
  }

  const n = changes.length
  const why =
    baseline.state === 'verified'
      ? `The platform model changed since your last pull or push: ${n} element(s).`
      : baseline.reason && baseline.reason !== 'no_key'
        ? `No record of the platform model can be kept on this machine (${baseline.reason}), so every element counts as changed: ${n}.`
        : `There is no usable record of the platform model from your last pull or push (${baseline.state}), so every element counts as changed: ${n}.`
  const next = tooMany
    ? ` More than ${MAX_ACKNOWLEDGED_CHANGES} changes cannot be named: pull first.`
    : ' Pull first, or overwrite them by naming them (overwrite_changed with changed_ids, and overwrite_revision).'
  const stale = acknowledged ? 'The overwrite no longer matches the platform. ' : ''
  return {
    baseline: loaded,
    refusal: {
      message: stale + why + next,
      data: {
        code: PLATFORM_CHANGED_CODE,
        baseline: baseline.state,
        revision,
        changes_total: n,
        changes: changes.slice(0, MAX_LISTED_CHANGES),
        changed_ids: tooMany ? [] : ids,
        ...(acknowledged ? { acknowledgement: 'stale' as const } : {}),
      },
    },
  }
}

/**
 * The baseline to write with a successful pull or push. Without one (`prints`
 * null: the export failed), the record passed is `null`, which removes a stale
 * one, so the push's own writes never read as platform changes later.
 */
export async function baselineForSync(
  modelDir: string,
  modelId: string,
  prints: PlatformPrints | null
): Promise<{ record: PlatformBaselineRecord | null; status: 'recorded' | 'not_recorded'; warning?: string }> {
  let reason = 'export_failed'
  if (prints) {
    try {
      const signed = await signPlatformBaseline(modelDir, modelId, prints)
      if (signed.record) return { record: signed.record, status: 'recorded' }
      reason = signed.reason ?? 'no_key'
    } catch {
      reason = 'unwritable'
    }
  }
  return { record: null, status: 'not_recorded', warning: notRecorded(reason) }
}

export type BaselineForSync = Awaited<ReturnType<typeof baselineForSync>>

const notRecorded = (reason: string) =>
  `The platform model was not recorded (${reason}): the next push treats every element as changed on the platform.`

/** What a kept, outdated record makes the next push report, by what wrote it. */
const KEPT_RECORD = {
  push: 'sync.json could not be written: the record of the platform model from before this push was kept, so the next push lists ' +
    "this push's own changes as platform changes; pull to refresh it.",
  pull: 'sync.json could not be written: the record of the platform model from before this pull was kept, so the next push lists ' +
    'the changes this pull brought in as platform changes; pull again to refresh it.',
} as const

/**
 * Write sync.json with the baseline a pull or push produced, and say what the next
 * push will compare against. When the write fails, the old record would stay behind
 * and read this sync's own changes as the platform's, so it is removed; when even
 * that fails, the warning says the old record was kept.
 */
export async function recordSyncBaseline(
  modelDir: string,
  fields: Partial<Omit<SyncMetadata, 'platform_baseline'>>,
  baseline: BaselineForSync,
  after: keyof typeof KEPT_RECORD
): Promise<{ status: 'recorded' | 'not_recorded'; warning?: string }> {
  try {
    await writeSyncJson(modelDir, { ...fields, platform_baseline: baseline.record })
    return baseline.status === 'recorded' ? { status: 'recorded' } : { status: 'not_recorded', warning: baseline.warning }
  } catch {
    const had = await readSyncJson(modelDir).then((s) => !!s?.platform_baseline, () => true)
    if (!had) return { status: 'not_recorded', warning: notRecorded('unwritable') }
    try {
      await writeSyncJson(modelDir, { platform_baseline: null })
      return { status: 'not_recorded', warning: notRecorded('unwritable') }
    } catch {
      return { status: 'not_recorded', warning: KEPT_RECORD[after] }
    }
  }
}

/**
 * The record after a push that wrote only part of the model (`update_attributes`):
 * the record the check compared against, with the scoped field classes of the
 * elements written taken from the platform as the push left it. An element whose
 * platform change the operator named takes the platform's print only where the
 * platform holds exactly what the push sent (`sent`, from sentAttributePrints):
 * nothing of the change it overwrote survives there. Elsewhere it keeps its old
 * print, so whatever else changed there still reads as changed; everything outside
 * the push stays as recorded. With no trusted record there is nothing to carry
 * forward and nothing is written (`write` false); a record rewritten since the
 * check is not trusted either and is removed.
 */
export async function partialPushBaseline(
  modelDir: string,
  modelId: string,
  check: PlatformCheck,
  written: Iterable<string>,
  fields: readonly FieldClass[],
  postPush: PlatformPrints | null,
  sent: Record<string, Partial<Record<FieldClass, string>>>
): Promise<BaselineForSync & { write: boolean }> {
  if (check.baseline.state !== 'verified' || !check.baseline.elements) {
    return { write: false, record: null, status: 'not_recorded', warning: notRecorded(check.baseline.state) }
  }
  const now = await loadPlatformBaseline(modelDir, modelId)
  if (now.state !== 'verified' || now.mac !== check.baseline.mac) {
    return { write: true, record: null, status: 'not_recorded', warning: notRecorded('changed_during_push') }
  }
  const elements = structuredClone(check.baseline.elements)
  for (const id of written) {
    const entry = elements[id]
    if (!entry) continue
    const overwritten = check.overwritten?.has(id) ?? false
    for (const f of fields) {
      // Without the post-push export the class is dropped: it then reads as changed, never as unchanged.
      const after = postPush?.[id]?.f[f]
      if (after === undefined) delete entry.f[f]
      else if (!overwritten || sent[id]?.[f] === after) entry.f[f] = after
    }
  }
  return { write: true, ...(await baselineForSync(modelDir, modelId, elements)) }
}

/** Fingerprints of the platform model as it is now, or null when it cannot be exported. */
export async function exportPlatformPrints(
  apolloClient: ConstructorParameters<typeof DtExportSplit>[0],
  modelId: string
): Promise<PlatformPrints | null> {
  try {
    return fingerprintSplitModel(await new DtExportSplit(apolloClient).exportModelToSplit(modelId))
  } catch {
    return null
  }
}
