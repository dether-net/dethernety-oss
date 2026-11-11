/**
 * The settlement baseline: which attribute and record values the operator has
 * confirmed.
 *
 * A value counts as the operator's only once it is registered: by settling a
 * pending row (accept, reject, modify), or by confirming a value as it stands
 * (confirm, with the value in the call). Every value that is neither pending
 * nor registered is unregistered, a registered value that is gone is a
 * removal, and either blocks REVIEWED and a push.
 *
 * `.dethereal/settlement-baseline.json` holds, per value, a hash of its
 * normalised form, keyed by the element's id-free label, class and type, the
 * group, the kind (attribute or record) and the field, so a push's new ids leave
 * it valid. It is signed with a subkey of this machine's key and names its model
 * directory only by a keyed hash of the directory's real path. A baseline that
 * does not verify reads as empty. This machine's pointer file (beside the key)
 * holds the last revision it wrote per model hash: an older file reads as
 * rolled back, and a baseline moved or copied from another directory verifies
 * only where this machine never signed one, after which its source is retired.
 *
 * This module holds the pure parts (formats, hashes, drift); the caller
 * supplies the key, the pointer, the pending entries and the element labels.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { flattenStructure } from '@dethernety/dt-core'
import { canonicalJson } from './canonical-json.js'
import { MAC_TAGS, SETTLE_GROUPS, macHex, subkey, verifyMacHex, type ElementRef, type PendingEntry, type PendingGroup, type SettleGroup } from './gates.js'
import { sha256Hex } from './hash.js'
import { hasMixedScriptWord } from './lints.js'
import { StateFileError, readChecked } from './state-store.js'

export const BASELINE_FILE = '.dethereal/settlement-baseline.json'
export const SETTLEMENTS_FILE = '.dethereal/settlements.json'
export const PENDING_FILE_REL = '.dethereal/enrichment-pending.json'
export const GROUPS: readonly PendingGroup[] = ['components', 'dataFlows', 'dataItems', 'boundaries']
export const SETTLE_LIMITS = { items: 50, valueBytes: 4096, entries: 20000, rows: 100, log: 50, logShown: 3, replyChars: 8000, listed: 100 } as const
/** Why a registration's element no longer has it: the one wording the tools and the workflow share. */
export const ORPHAN_CAUSE = 'removed, moved, reclassified, re-pointed or changed'
const ATTRIBUTE_MAX_BYTES = 1024 * 1024
const BASELINE_MAX_BYTES = 4 * 1024 * 1024
const SEP = String.fromCharCode(0)

// =============================================================================
// Canonical values and keys
// =============================================================================

export { canonicalJson }
export const sha256 = sha256Hex
export const valueHash = (v: unknown): string => sha256(canonicalJson(v))
export const sameValue = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)

export type ValueKind = 'attr' | 'record'

/** The baseline key of one value: never the element id. */
export const entryKey = (ref: Pick<ElementRef, 'label' | 'classId' | 'type' | 'group'>, kind: ValueKind, field: string): string =>
  JSON.stringify([ref.label, ref.classId, ref.type, ref.group, kind, field])

/** The element part of a baseline key, for matching keys to the elements that still exist. */
export const elementKey = (ref: Pick<ElementRef, 'label' | 'classId' | 'type' | 'group'>): string =>
  JSON.stringify([ref.label, ref.classId, ref.type, ref.group])

/**
 * The registered values as they apply to the model now. A registration made before its element had a class
 * carries over to the element's first class: the element is the same while its label, type and group are (a
 * data item's label ends in its class, which is compared empty before and ignored after). A class change still
 * orphans, and so does a changed label. The carried keys are written under the new key by the next settle.
 */
export function carryUnclassified(values: Record<string, string>, refs: Record<SettleGroup, Map<string, ElementRef>>, moved?: Map<string, string>): Record<string, string> {
  const labelBase = (group: string, label: string) => (group === 'dataItems' ? label.replace(/#[^#]*$/, '') : label)
  const classified = new Map<string, ElementRef[]>()
  const unclassified = new Set<string>()
  for (const g of GROUPS) {
    for (const r of refs[g].values()) {
      if (!r.classId) { unclassified.add(elementKey(r)); continue }
      const k = JSON.stringify([labelBase(g, r.label), r.type, g])
      classified.set(k, [...(classified.get(k) ?? []), r])
    }
  }
  const out = { ...values }
  for (const [key, hash] of Object.entries(values)) {
    let parts: unknown
    try {
      parts = JSON.parse(key)
    } catch {
      continue
    }
    if (!Array.isArray(parts) || parts.length !== 6) continue
    const [label, classId, type, group, kind, field] = parts as [string, string, string, PendingGroup, ValueKind, string]
    if (classId !== '' || !GROUPS.includes(group)) continue
    if (group === 'dataItems' && !label.endsWith('#')) continue
    // Still unclassified: nothing to carry.
    if (unclassified.has(JSON.stringify([label, '', type, group]))) continue
    const candidates = classified.get(JSON.stringify([labelBase(group, label), type, group])) ?? []
    if (candidates.length !== 1) continue
    const carried = entryKey(candidates[0]!, kind, field)
    if (!(carried in out)) {
      out[carried] = hash
      moved?.set(key, carried)
    }
    delete out[key]
  }
  return out
}

/** A model directory as the baseline names it: a keyed hash of its real path, not linkable to the path. */
export const modelHashOf = (key: Buffer, modelPath: string): string => macHex(subkey(key, MAC_TAGS.modelPath), modelPath)

/** This machine's mark on a baseline of one model: recognisable here, not linkable across models. */
export const keyIdOf = (key: Buffer, modelHash: string): string => macHex(key, `dethereal/key-id${SEP}${modelHash}`).slice(0, 16)

// =============================================================================
// The baseline file
// =============================================================================

/** Who registered a value other than the operator: the machine, carrying over what the platform held or linked. */
export const REGISTRATION_SOURCES = ['pull', 'push-pin', 'greenfield'] as const
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number]

export interface Baseline {
  revision: number
  key_id: string
  model_hash: string
  /** entry key -> sha256 of the value's normalised form */
  values: Record<string, string>
  /** sha256 of the settlement log as this baseline's call wrote it (null: no log) */
  log_digest: string | null
  /** Keys the machine registered, and how; an operator's registration has no entry */
  sources: Record<string, RegistrationSource>
  /** The platform model the `pull` registrations came from (null: none) */
  pull: { model_id: string } | null
  /** Each registered controls list as it was registered (its hash is the key's value): what a changed id is shown against */
  controls_registered: Record<string, unknown>
  /** The format the file was read in: 2 holds operator registrations only, and no controls lists */
  v: 2 | 3
}

const BASELINE_KEYS_V2 = new Set(['version', 'v', 'revision', 'key_id', 'model_hash', 'values', 'log_digest', 'signed_at', 'mac'])
const BASELINE_KEYS_V3 = new Set([...BASELINE_KEYS_V2, 'sources', 'pull', 'controls_registered'])
const MODEL_ID = /^[A-Za-z0-9._:-]{1,256}$/

const macPayload = (b: Baseline): string =>
  b.v === 2
    ? canonicalJson({ v: 2, revision: b.revision, key_id: b.key_id, model_hash: b.model_hash, values: b.values, log_digest: b.log_digest })
    : canonicalJson({
      v: 3, revision: b.revision, key_id: b.key_id, model_hash: b.model_hash, values: b.values, log_digest: b.log_digest,
      sources: b.sources, pull: b.pull, controls_registered: b.controls_registered,
    })

/** What a writer signs: the values, and the machine's own registrations among them. */
export type BaselineContent = Omit<Baseline, 'key_id' | 'model_hash' | 'v'>

/**
 * Keep a baseline's side tables to the values it holds: a source or a controls
 * list of a key that is gone, or registered empty, goes; so does the pull
 * binding once no pull registration is left.
 */
export function trimmedContent(b: BaselineContent): BaselineContent {
  const live = (k: string) => b.values[k] !== undefined && b.values[k] !== ABSENT
  const sources = Object.fromEntries(Object.entries(b.sources).filter(([k]) => live(k)))
  const controls = Object.fromEntries(Object.entries(b.controls_registered).filter(([k, list]) => live(k) && valueHash(list) === b.values[k]))
  return { ...b, sources, controls_registered: controls, pull: Object.values(sources).includes('pull') ? b.pull : null }
}

/** The file content for a baseline, signed for the model directory `modelHash` names. Always written as v3. */
export function signedBaseline(key: Buffer, modelHash: string, content: BaselineContent): string {
  const b = trimmedContent(content)
  const full: Baseline = { ...b, key_id: keyIdOf(key, modelHash), model_hash: modelHash, v: 3 }
  const mac = macHex(subkey(key, MAC_TAGS.attributeBaseline), macPayload(full))
  return `${JSON.stringify({
    version: 3, v: 3, revision: full.revision, key_id: full.key_id, model_hash: full.model_hash, values: full.values, log_digest: full.log_digest,
    sources: full.sources, pull: full.pull, controls_registered: full.controls_registered, signed_at: new Date().toISOString(), mac,
  }, null, 2)}\n`
}

/** A carried baseline, as it is signed for its new directory: the operator's registrations only. */
export function operatorOnly(c: BaselineContent): BaselineContent {
  const values = Object.fromEntries(Object.entries(c.values).filter(([k]) => !c.sources[k]))
  return { ...c, values, sources: {}, pull: null }
}

/** A verified baseline's content, to write again with changes. An empty one for a model that has none. */
export const contentOf = (b: Baseline | null | undefined): BaselineContent =>
  b
    ? { revision: b.revision, values: { ...b.values }, log_digest: b.log_digest, sources: { ...b.sources }, pull: b.pull, controls_registered: { ...b.controls_registered } }
    : { revision: 0, values: {}, log_digest: null, sources: {}, pull: null, controls_registered: {} }

export type BaselineStatus = 'verified' | 'missing' | 'unverified' | 'unavailable'
export type BaselineCode = 'rolled_back' | 'other_key' | 'tampered' | 'malformed' | 'unreadable' | 'pointer_unavailable'

export interface BaselineRead {
  status: BaselineStatus
  code?: string
  /** The verified baseline (only when `verified`) */
  baseline?: Baseline
  /** Verified, but signed for another directory on this machine: the model hash it came from */
  carriedFrom?: string
  /** The file's bytes as read, for the replace check */
  bytes: Buffer | null
}

/** The field part of a baseline key, when the key is well formed. */
function keyField(key: string): { kind: string; field: string } | null {
  try {
    const parts = JSON.parse(key)
    return Array.isArray(parts) && parts.length === 6 && typeof parts[4] === 'string' && typeof parts[5] === 'string' ? { kind: parts[4], field: parts[5] } : null
  } catch {
    return null
  }
}

/** Parse a baseline file strictly; null when it is not the format. */
export function parseBaseline(bytes: Buffer): (Baseline & { mac: string }) | null {
  let doc: any
  try {
    doc = JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  if (doc.v !== 2 && doc.v !== 3) return null
  const allowed = doc.v === 2 ? BASELINE_KEYS_V2 : BASELINE_KEYS_V3
  if (Object.keys(doc).some((k) => !allowed.has(k))) return null
  if (!Number.isSafeInteger(doc.revision) || doc.revision < 0) return null
  if (typeof doc.key_id !== 'string' || !/^[0-9a-f]{16}$/.test(doc.key_id)) return null
  if (typeof doc.model_hash !== 'string' || !/^[0-9a-f]{64}$/.test(doc.model_hash)) return null
  if (doc.log_digest !== null && (typeof doc.log_digest !== 'string' || !/^[0-9a-f]{64}$/.test(doc.log_digest))) return null
  if (typeof doc.mac !== 'string' || !/^[0-9a-f]{64}$/.test(doc.mac)) return null
  const values = doc.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const entries = Object.entries(values)
  if (entries.length > SETTLE_LIMITS.entries || entries.some(([, h]) => typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h))) return null
  const base = { revision: doc.revision, key_id: doc.key_id, model_hash: doc.model_hash, values: values as Record<string, string>, log_digest: doc.log_digest, mac: doc.mac }
  if (doc.v === 2) return { ...base, sources: {}, pull: null, controls_registered: {}, v: 2 }
  // v3: every side table names only registered, non-empty values of its own kind.
  const live = (k: string) => typeof values[k] === 'string' && values[k] !== ABSENT
  const sources = doc.sources
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null
  if (Object.entries(sources).some(([k, src]) => !live(k) || !(REGISTRATION_SOURCES as readonly unknown[]).includes(src))) return null
  const pull = doc.pull
  if (pull !== null && (!pull || typeof pull !== 'object' || Array.isArray(pull) || Object.keys(pull).join() !== 'model_id' || typeof pull.model_id !== 'string' || !MODEL_ID.test(pull.model_id))) return null
  if ((pull === null) === Object.values(sources).includes('pull')) return null
  const controls = doc.controls_registered
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) return null
  for (const [k, list] of Object.entries(controls)) {
    const f = keyField(k)
    if (!live(k) || !f || f.kind !== 'record' || f.field !== 'controls' || valueHash(list) !== values[k]) return null
  }
  return { ...base, sources: sources as Record<string, RegistrationSource>, pull, controls_registered: controls as Record<string, unknown>, v: 3 }
}

/** This machine's pointer file: the last revision it wrote per model hash, or why it cannot be used. */
export type Pointers = { usable: true; revisions: Record<string, number> } | { usable: false }

/**
 * Read and verify a model's baseline. `key` is this machine's key, or null with
 * the reason it is unusable (`keyCode`); `pointers` is this machine's pointer
 * file. The model directory is named by `modelHashOf(key, its real path)`.
 */
export async function readBaseline(
  modelDir: string,
  modelPath: string,
  key: Buffer | null,
  keyCode: string | undefined,
  pointers: Pointers,
): Promise<BaselineRead> {
  // An unusable key or pointer comes first: whatever the file holds, nothing can be verified or signed.
  if (!key && keyCode && keyCode !== 'key_absent') return { status: 'unavailable', code: keyCode, bytes: null }
  if (!pointers.usable) return { status: 'unavailable', code: 'pointer_unavailable', bytes: null }
  let bytes: Buffer | null
  try {
    bytes = await readChecked(path.join(modelDir, ...BASELINE_FILE.split('/')), BASELINE_FILE, BASELINE_MAX_BYTES)
  } catch {
    return { status: 'unverified', code: 'unreadable', bytes: null }
  }
  const current = key ? modelHashOf(key, modelPath) : null
  const pointerOf = (hash: string | null): number | undefined => (hash ? pointers.revisions[hash] : undefined)
  if (bytes === null) return pointerOf(current) !== undefined ? { status: 'missing', code: 'rolled_back', bytes } : { status: 'missing', bytes }
  const parsed = parseBaseline(bytes)
  if (!parsed) return { status: 'unverified', code: 'malformed', bytes }
  if (!key || parsed.key_id !== keyIdOf(key, parsed.model_hash)) return { status: 'unverified', code: 'other_key', bytes }
  const { mac, ...b } = parsed
  if (!verifyMacHex(subkey(key, MAC_TAGS.attributeBaseline), macPayload(b), mac)) return { status: 'unverified', code: 'tampered', bytes }
  if (b.model_hash === current) {
    const last = pointerOf(current)
    if (last !== undefined && b.revision < last) return { status: 'unverified', code: 'rolled_back', bytes }
    return { status: 'verified', baseline: b, bytes }
  }
  // Signed on this machine for another directory: a move or a copy. It carries over only onto a path this
  // machine never signed for, and only while it is not older than what this machine last wrote for its source.
  if (pointerOf(current) !== undefined) return { status: 'unverified', code: 'rolled_back', bytes }
  const source = pointerOf(b.model_hash)
  if (source !== undefined && b.revision < source) return { status: 'unverified', code: 'rolled_back', bytes }
  return { status: 'verified', baseline: b, carriedFrom: b.model_hash, bytes }
}

// =============================================================================
// Attribute files, as the settlement sees them
// =============================================================================

export interface AttributeFile {
  group: PendingGroup
  /** Project-relative within the model: `attributes/<group>/<file>` */
  rel: string
  bytes: Buffer
  doc: Record<string, unknown> | null
  elementId?: string
  /** Not the structured `{elementId, attributes}` form */
  flat: boolean
  attributes: Record<string, unknown>
}

export interface AttributeScan {
  files: AttributeFile[]
  /** `attributes` is a single consolidated file */
  consolidated: boolean
  /** Files that could not be read; a settlement refuses while any exist */
  unreadable: string[]
}

/** Read every attribute file with the store's checks, keeping which file holds what. */
export async function scanAttributeFiles(modelDir: string): Promise<AttributeScan> {
  const out: AttributeScan = { files: [], consolidated: false, unreadable: [] }
  const root = path.join(modelDir, 'attributes')
  const st = await fs.lstat(root).catch(() => null)
  if (!st) return out
  if (st.isSymbolicLink()) return { ...out, unreadable: ['attributes'] }
  if (st.isFile()) return { ...out, consolidated: true }
  for (const group of GROUPS) {
    const dir = path.join(root, group)
    const gst = await fs.lstat(dir).catch(() => null)
    if (!gst) continue
    if (!gst.isDirectory()) {
      out.unreadable.push(`attributes/${group}`)
      continue
    }
    for (const name of (await fs.readdir(dir)).sort()) {
      if (!name.endsWith('.json')) continue
      const rel = `attributes/${group}/${name}`
      let bytes: Buffer | null
      try {
        bytes = await readChecked(path.join(dir, name), rel, ATTRIBUTE_MAX_BYTES)
      } catch {
        out.unreadable.push(rel)
        continue
      }
      if (bytes === null) continue
      let doc: unknown
      try {
        doc = JSON.parse(bytes.toString('utf8'))
      } catch {
        out.unreadable.push(rel)
        continue
      }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        out.unreadable.push(rel)
        continue
      }
      const d = doc as Record<string, unknown>
      const structured = typeof d.elementId === 'string' && d.attributes !== null && typeof d.attributes === 'object' && !Array.isArray(d.attributes)
      out.files.push({
        group, rel, bytes, doc: d, flat: !structured,
        ...(structured ? { elementId: d.elementId as string } : {}),
        attributes: structured ? (d.attributes as Record<string, unknown>) : Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'elementId' && k !== 'elementType' && k !== 'elementName')),
      })
    }
  }
  return out
}

/** Non-null `attributes` written on element objects themselves (a push sends them when no attribute file exists). */
export function inlineAttributes(model: { structure: unknown; dataFlows: unknown[]; dataItems: unknown[] }): Array<{ group: PendingGroup; id: string; attributes: Record<string, unknown> }> {
  const out: Array<{ group: PendingGroup; id: string; attributes: Record<string, unknown> }> = []
  const take = (group: PendingGroup, e: any) => {
    const a = e?.attributes
    if (typeof e?.id === 'string' && a && typeof a === 'object' && !Array.isArray(a)) {
      const set = Object.fromEntries(Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined))
      if (Object.keys(set).length) out.push({ group, id: e.id, attributes: set })
    }
  }
  const structure = model.structure as { defaultBoundary?: unknown } | null
  if (structure?.defaultBoundary) {
    const { boundaries, components } = flattenStructure(structure as never) as { boundaries: unknown[]; components: unknown[] }
    for (const b of boundaries) take('boundaries', b)
    for (const c of components) take('components', c)
  }
  for (const f of model.dataFlows) take('dataFlows', f)
  for (const i of model.dataItems) take('dataItems', i)
  return out
}

// =============================================================================
// Drift: the unregistered values
// =============================================================================

export type RowCode = 'label_collision' | 'orphan_attributes' | 'inline_attributes' | 'ambiguous_attribute_file' | 'unlisted_field'
  | 'off_template_field' | 'no_template' | 'invalid_value'

/** A controls row: the list as registered (or not recorded, for a registration older than the lists) and as it is now. */
export interface ControlsChange {
  from: unknown
  to: unknown
}

export interface DriftRow {
  group: SettleGroup
  element_id: string
  name?: string
  field: string
  kind: ValueKind
  /** A registered value that is gone */
  removed?: true
  /** `placement` rows: the form the operator confirms */
  shown?: string
  code?: RowCode
  /** The baseline key, when the value has one */
  key?: string
  hash: string
  /** A registered controls list that changed: shown against the signed list */
  controls_change?: ControlsChange
  /** An id changed under an unchanged name, or the registered list is not recorded: the operator sees old and new */
  flagged?: true
}

export interface Drift {
  rows: DriftRow[]
  total: number
  digest: string
  /** Rows the operator cannot confirm as they are */
  unsignable: number
  /** Attribute fields the operator left empty (registered absent), still empty, on elements that still exist */
  declined: Array<{ group: PendingGroup; element_id: string; name?: string; field: string }>
  /** Registered values whose element label is gone (renamed, moved or removed), and those elements as shown */
  orphaned: { keys: string[]; elements: OrphanedElement[] }
}

/**
 * Why an element's registrations no longer apply, as far as the model now shows it. `removed` only when no element
 * of its group has its name any more (a rename looks the same); with an element of that name, `reclassified` (its
 * class changed), `moved` (a boundary or component under another path), `re-pointed` (a flow between other
 * elements), or `changed` when none of those tells it.
 */
export type OrphanCause = 'removed' | 'moved' | 'reclassified' | 're-pointed' | 'changed'

/** An element whose registrations no longer apply: its group, its name as shown, why, and how many values. */
export interface OrphanedElement { group: SettleGroup; name: string; cause: OrphanCause; values: number }

/**
 * Whether a baseline label names this element by its name (labels end in the name; a data item's ends in its class).
 * The root boundary's label is `ROOT`, whatever its name; an empty name matches a label that ends in none.
 */
function labelNames(group: SettleGroup, label: string, ref: ElementRef): boolean {
  const name = (ref.name ?? '').trim()
  if (group === 'boundaries' && label === 'ROOT') return ref.label === 'ROOT'
  if (group === 'dataItems') return label.startsWith(`D:${name}#`)
  if (group === 'dataFlows') return label.endsWith(`:${name}`)
  if (group === 'boundaries') return label.endsWith(`/B:${name}`)
  if (group === 'components') return label.endsWith(`/C:${name}`)
  return false
}

/**
 * Why the element a baseline key named is gone, judged against the elements the model now has. Its full label (the
 * boundary path, a flow's endpoints) decides first: the same label under another class is a class change. Then its
 * name: an element of that name counts only when it is new (`registered` holds the element keys the baseline had
 * registrations for), since one that was registered under its own label is another element that was there already.
 */
export function orphanCause(group: SettleGroup, label: string, classId: string, type: string, refs: Map<string, ElementRef>, registered?: ReadonlySet<string>): OrphanCause {
  const base = (l: string) => (group === 'dataItems' ? l.replace(/#[^#]*$/, '') : l)
  const all = [...refs.values()]
  if (all.some((r) => base(r.label) === base(label) && r.type === type && r.classId !== classId)) return 'reclassified'
  const named = all.filter((r) => labelNames(group, label, r) && !registered?.has(elementKey(r)))
  if (!named.length) return 'removed'
  if (group === 'dataItems' && named.some((r) => r.classId !== classId)) return 'reclassified'
  if (group === 'dataFlows' && named.some((r) => r.label !== label && r.classId === classId)) return 're-pointed'
  if ((group === 'components' || group === 'boundaries') && named.some((r) => r.label !== label && r.classId === classId && r.type === type)) return 'moved'
  return 'changed'
}

/** An element's label as the operator reads it: its boundary path, a flow's name, a data item's name. */
function labelShown(group: string, label: string): string {
  if (group === 'model') return 'the model'
  if (group === 'dataFlows') return label.slice(label.lastIndexOf(':') + 1)
  if (group === 'dataItems') return label.replace(/^D:/, '').replace(/#[^#]*$/, '')
  return label.split('/').filter((p) => p !== 'ROOT').map((p) => p.replace(/^[BC]:/, '')).join(' / ')
}

/** The mark a field registered as left empty carries in the baseline (a rejected row, a confirmed removal). */
export const ABSENT = sha256('dethereal/settlement/absent')

/** A current value: an attribute as its file holds it, or a record value with its projection. */
export interface DriftValue {
  group: SettleGroup
  id: string
  field: string
  kind: ValueKind
  value: unknown
  /** Records: the normalised form that is hashed; attributes hash `value` itself */
  projected?: unknown
  shown?: string
  code?: RowCode
}

export interface DriftInput {
  refs: Record<SettleGroup, Map<string, ElementRef>>
  values: DriftValue[]
  /** Fields present in each element's attribute bag (`group SEP id SEP field`), null values included */
  attributeFields: ReadonlySet<string>
  pending: readonly PendingEntry[]
  baseline: Record<string, string>
  /** Record fields a pending row may name (the rest of the pending schema names attributes) */
  pendingRecordFields: ReadonlySet<string>
  /** The registered controls lists (the baseline's), what a changed controls value is shown against */
  controlsRegistered?: Record<string, unknown>
  /** Why an unregistered value could not be registered as it stands (the settle rule), or undefined when it could */
  unregistrable?: (v: DriftValue, ref: ElementRef) => RowCode | undefined
}

const FIELD_SHOWN = /^[A-Za-z0-9_-]{1,128}$/
export const tripleOf = (group: string, id: string, field: string): string => `${group}${SEP}${id}${SEP}${field}`

/** The hash a value is registered under. */
export const hashOf = (v: Pick<DriftValue, 'kind' | 'value' | 'projected'>): string => valueHash(v.kind === 'record' ? v.projected : v.value)

/**
 * Collect the current values of a model: its attribute files, the attributes
 * written on elements themselves, and its record values, with the codes that
 * make a value unsignable as it stands.
 */
export function valuesOf(
  scan: AttributeScan,
  refs: Record<SettleGroup, Map<string, ElementRef>>,
  inline: ReturnType<typeof inlineAttributes>,
  records: ReadonlyArray<{ group: SettleGroup; id: string; field: string; raw: unknown; projected: unknown; shown?: string; code?: 'label_collision' }>,
): { values: DriftValue[]; attributeFields: Set<string> } {
  const values: DriftValue[] = []
  const attributeFields = new Set<string>()
  const perElement = new Map<string, number>()
  for (const f of scan.files) if (f.elementId) perElement.set(`${f.group}${SEP}${f.elementId}`, (perElement.get(`${f.group}${SEP}${f.elementId}`) ?? 0) + 1)
  const labelCount = new Map<string, number>()
  for (const g of GROUPS) for (const r of refs[g].values()) labelCount.set(elementKey(r), (labelCount.get(elementKey(r)) ?? 0) + 1)
  const collides = (ref: ElementRef | undefined) => !!ref && (labelCount.get(elementKey(ref)) ?? 0) > 1
  for (const f of scan.files) {
    const id = f.elementId ?? path.posix.basename(f.rel, '.json')
    const ref = refs[f.group].get(id)
    const code: RowCode | undefined = f.flat || (perElement.get(`${f.group}${SEP}${id}`) ?? 0) > 1 ? 'ambiguous_attribute_file'
      : !ref ? 'orphan_attributes'
        : collides(ref) ? 'label_collision' : undefined
    for (const [field, value] of Object.entries(f.attributes)) {
      attributeFields.add(tripleOf(f.group, id, field))
      if (value === null || value === undefined) continue
      const fieldCode = code ?? (FIELD_SHOWN.test(field) ? undefined : 'unlisted_field')
      values.push({ group: f.group, id, field, kind: 'attr', value, ...(fieldCode ? { code: fieldCode } : {}) })
    }
  }
  for (const e of inline) for (const [field, value] of Object.entries(e.attributes)) values.push({ group: e.group, id: e.id, field, kind: 'attr', value, code: 'inline_attributes' })
  for (const r of records) {
    if (r.projected === null || r.projected === undefined) continue
    const code = collides(refs[r.group].get(r.id)) ? 'label_collision' as const : r.code
    values.push({ group: r.group, id: r.id, field: r.field, kind: 'record', value: r.raw, projected: r.projected, ...(r.shown ? { shown: r.shown } : {}), ...(code ? { code } : {}) })
  }
  return { values, attributeFields }
}

/** A controls list's ids (canonical, any non-null id), and how many entries have none. */
function idsOf(list: unknown): { ids: Set<string>; unpinned: number } {
  const ids = new Set<string>()
  let unpinned = 0
  for (const e of Array.isArray(list) ? list : []) {
    const id = e && typeof e === 'object' && !Array.isArray(e) ? (e as { id?: unknown }).id : undefined
    if (id === undefined || id === null) unpinned++
    else ids.add(canonicalJson(id))
  }
  return { ids, unpinned }
}

/**
 * Whether a controls change needs the operator to see old and new: an id the
 * operator registered is gone and something else took a place in the list
 * (another id, or an entry the push resolves by name), whatever the names say;
 * or the registration is older than the recorded lists. A pure addition, a pure
 * removal and a pin of a name to its id are not flagged.
 */
export function controlsFlagged(change: ControlsChange): boolean {
  if (change.from === NOT_RECORDED) return true
  const before = idsOf(change.from)
  const after = idsOf(change.to)
  const lost = [...before.ids].some((id) => !after.ids.has(id))
  const replaced = [...after.ids].some((id) => !before.ids.has(id)) || after.unpinned > before.unpinned
  return lost && replaced
}

/** What a controls row shows when its registration predates the recorded lists. */
export const NOT_RECORDED = 'not_recorded'

/**
 * Every value neither pending nor registered, and every registered value that
 * is gone from an element that still exists, in a stable order, with a digest
 * binding the set.
 */
export function computeDrift(input: DriftInput): Drift {
  const pending = new Set(input.pending.map((e) => tripleOf(e.group, e.element_id, e.field)))
  // A pending row names a record field only when the element's attribute bag does not hold that field.
  const isPending = (v: Pick<DriftValue, 'group' | 'id' | 'field' | 'kind'>) => {
    const t = tripleOf(v.group, v.id, v.field)
    if (!pending.has(t)) return false
    // A row on a record-named field the attribute bag lacks is the record's (as settle reads it), never the attribute's.
    const recordRow = input.pendingRecordFields.has(v.field) && !input.attributeFields.has(t)
    return v.kind === 'attr' ? !recordRow : recordRow
  }
  const rows: DriftRow[] = []
  const present = new Set<string>()
  const shownField = (field: string) => (FIELD_SHOWN.test(field) ? field : '(unlisted field)')
  for (const v of input.values) {
    const ref = input.refs[v.group].get(v.id)
    // A coded value is still there: its registration is not a removal, though the value cannot be registered as it is.
    if (ref) present.add(entryKey(ref, v.kind, v.field))
    const key = ref && !v.code ? entryKey(ref, v.kind, v.field) : undefined
    if (!v.code && isPending(v)) continue
    const hash = hashOf(v)
    if (key && input.baseline[key] === hash) continue
    // Checked only now: a value already registered stays registered, whatever could be registered today.
    const late = key && ref ? input.unregistrable?.(v, ref) : undefined
    if (late) {
      rows.push({ group: v.group, element_id: v.id, ...(ref?.name ? { name: ref.name } : {}), field: shownField(v.field), kind: v.kind,
        ...(v.shown ? { shown: v.shown } : {}), code: late, hash })
      continue
    }
    // A registered controls list that changed is shown against the list as it was registered.
    const registered = key && v.kind === 'record' && v.field === 'controls' && input.baseline[key] !== undefined && input.baseline[key] !== ABSENT
    const change: ControlsChange | undefined = v.kind === 'record' && v.field === 'controls' && !v.code
      ? { from: registered ? (Object.hasOwn(input.controlsRegistered ?? {}, key!) ? input.controlsRegistered![key!] : NOT_RECORDED) : null, to: v.projected }
      : undefined
    rows.push({
      group: v.group, element_id: v.id, ...(ref?.name ? { name: ref.name } : {}), field: shownField(v.field), kind: v.kind,
      ...(v.shown ? { shown: v.shown } : {}), ...(v.code ? { code: v.code } : {}), ...(key ? { key } : {}), hash,
      ...(change ? { controls_change: change, ...(change.from !== null && controlsFlagged(change) ? { flagged: true as const } : {}) } : {}),
    })
  }
  // Registered values that are gone: the element is still there, the value is not.
  const byElement = new Map<string, ElementRef[]>()
  for (const g of SETTLE_GROUPS) for (const r of input.refs[g].values()) byElement.set(elementKey(r), [...(byElement.get(elementKey(r)) ?? []), r])
  const declined: Drift['declined'] = []
  const orphaned: Drift['orphaned'] = { keys: [], elements: [] }
  const orphanedSeen = new Map<string, OrphanedElement>()
  // A key that is not one the settlement writes names no element.
  const baselineKeys = Object.keys(input.baseline).flatMap((key) => {
    try {
      const parts = JSON.parse(key) as unknown
      return Array.isArray(parts) && parts.length === 6 ? [{ key, parts }] : []
    } catch {
      return []
    }
  })
  // The elements the baseline had registrations for: an element of an orphan's name that is one of them was there already.
  const registeredElements = new Set(baselineKeys.map(({ parts }) => JSON.stringify(parts.slice(0, 4))))
  for (const { key, parts } of baselineKeys) {
    if (present.has(key)) continue
    const [label, classId, type, group, kind, field] = parts as [string, string, string, SettleGroup, ValueKind, string]
    const refs = byElement.get(JSON.stringify([label, classId, type, group])) ?? []
    if (!refs.length) {
      // The element this value was registered for is gone under that label: renamed, moved, re-pointed, reclassified or removed.
      if (input.baseline[key] !== ABSENT) {
        orphaned.keys.push(key)
        const el = JSON.stringify([group, label])
        const seen = orphanedSeen.get(el)
        if (seen) seen.values++
        else {
          const entry: OrphanedElement = { group, name: labelShown(group, label), cause: orphanCause(group, label, classId, type, input.refs[group], registeredElements), values: 1 }
          orphanedSeen.set(el, entry)
          orphaned.elements.push(entry)
        }
      }
      continue
    }
    for (const ref of refs) {
      if (isPending({ group: ref.group, id: ref.id, field, kind })) continue
      if (input.baseline[key] === ABSENT) {
        if (kind === 'attr' && ref.group !== 'model') declined.push({ group: ref.group, element_id: ref.id, ...(ref.name ? { name: ref.name } : {}), field: shownField(field) })
        continue
      }
      const code = refs.length > 1 ? 'label_collision' as const : FIELD_SHOWN.test(field) ? undefined : 'unlisted_field' as const
      rows.push({
        group: ref.group, element_id: ref.id, ...(ref.name ? { name: ref.name } : {}), field: shownField(field), kind, removed: true,
        ...(code ? { code } : {}), ...(code ? {} : { key }), hash: 'removed',
      })
    }
  }
  const order = (r: DriftRow) => [SETTLE_GROUPS.indexOf(r.group), input.refs[r.group].get(r.element_id)?.label ?? `~${r.element_id}`, r.kind, r.field] as const
  rows.sort((a, b) => {
    const [x, y] = [order(a), order(b)]
    return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0)
  })
  const digest = sha256(canonicalJson(rows.map((r) => [r.group, r.element_id, r.field, r.kind, r.removed === true, r.code ?? null, r.hash])))
  const labelOf = (d: { group: SettleGroup; element_id: string }) => input.refs[d.group].get(d.element_id)?.label ?? `~${d.element_id}`
  declined.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (labelOf(a) < labelOf(b) ? -1 : labelOf(a) > labelOf(b) ? 1 : 0) || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
  orphaned.elements.sort((a, b) => SETTLE_GROUPS.indexOf(a.group) - SETTLE_GROUPS.indexOf(b.group) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { rows, total: rows.length, digest, unsignable: rows.filter((r) => r.code).length, declined, orphaned }
}

/** A controls list as `get` shows it: as it is, unless it cannot be shown safely, then only why. */
const shownList = (list: unknown): unknown => {
  if (list === null || list === NOT_RECORDED) return list
  const why = undisplayable(list)
  return why ? `(not shown: ${why})` : list
}

/** The rows as `get` shows them: no attribute values, no hashes, capped; a controls row with its lists. */
export function shownRows(d: Drift): Array<{
  group: SettleGroup; element_id: string; name?: string; field: string; record?: true; removed?: true; shown?: string; code?: RowCode
  controls_change?: ControlsChange; flagged?: true
}> {
  return d.rows.slice(0, SETTLE_LIMITS.rows).map(({ group, element_id, name, field, kind, removed, shown, code, controls_change, flagged }) => ({
    group, element_id, ...(name ? { name } : {}), field, ...(kind === 'record' ? { record: true as const } : {}),
    ...(removed ? { removed } : {}), ...(shown ? { shown } : {}), ...(code ? { code } : {}),
    ...(controls_change ? { controls_change: { from: shownList(controls_change.from), to: shownList(controls_change.to) } } : {}), ...(flagged ? { flagged } : {}),
  }))
}
// =============================================================================
// What may be shown in an approval dialog
// =============================================================================

/** Control, format, default-ignorable and bidi characters: nothing a reader of the dialog could see. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u
const LONE_SURROGATE = /\p{Cs}/u

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    out.push(k)
    strings(x, out)
  }
  return out
}

/** Why a value cannot be shown as it is in an approval dialog, or null. */
export function undisplayable(value: unknown): 'too_large' | 'unclean_value' | null {
  if (value === undefined) return 'unclean_value'
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > SETTLE_LIMITS.valueBytes) return 'too_large'
  // Line breaks and tabs are text (a justification over several lines); the dialog shows them escaped.
  // A carriage return only as part of a line break: alone it can overwrite a line where the value is shown raw.
  for (const s of strings(value)) if (INVISIBLE.test(s.replace(/\r\n|[\n\t]/g, ' ')) || hasMixedScriptWord(s)) return 'unclean_value'
  return null
}

/** The operator's reply may hold newlines, nothing else invisible. */
export function replyProblem(reply: string): string | null {
  const t = reply.trim()
  if (!t || t.length > SETTLE_LIMITS.replyChars) return 'reply_invalid'
  // A lone surrogate (what `\p{Cs}` matches under the u flag) is no visible word, and JSON writes it as six bytes.
  if (LONE_SURROGATE.test(t) || INVISIBLE.test(t.replace(/\r?\n/g, ' '))) return 'reply_invalid'
  return null
}

// =============================================================================
// The log
// =============================================================================

export interface SettleEntry { at: string; action: 'settle' | 'baseline'; items: number; decisions: Record<string, number>; reply: string }
/** Attribute files of elements the model no longer has, deleted by model_state_prune: no reply (the approval is the operator's). */
export interface PruneEntry { at: string; action: 'prune'; files: string[]; element_ids: string[] }
/** What a pull registered as the platform held it: counts and the platform model, no reply (nobody answered). */
export interface PullEntry { at: string; action: 'pull'; model_id: string; prints: string; registered: number; dropped: number }
/** Controls named without an id, pinned to the control the push linked: counts and the platform model. */
export interface PushPinEntry { at: string; action: 'push-pin'; model_id: string; pinned: number }
/** A local control's temporary id replaced by the id the platform gave it, and the registrations carried over. */
export interface GreenfieldEntry { at: string; action: 'greenfield'; temp_id: string; server_id: string; carried: number }
export type LogEntry = SettleEntry | PruneEntry | PullEntry | PushPinEntry | GreenfieldEntry

/** Why a write started the log afresh instead of continuing the one on disk. */
export const LOG_RESTARTS = ['no_baseline', 'digest_mismatch', 'signed_log_missing', 'rolled_back', 'unverified'] as const
export type LogRestart = (typeof LOG_RESTARTS)[number]

const PRUNED_FILE = /^attributes\/(components|dataFlows|dataItems|boundaries)\/[A-Za-z0-9_-]{1,256}\.json$/
const PLATFORM_ID = /^[A-Za-z0-9._:-]{1,256}$/
const COUNT = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0
const isPruneEntry = (e: any): boolean =>
  e?.action === 'prune' && typeof e.at === 'string' && Array.isArray(e.files) && e.files.length <= SETTLE_LIMITS.items &&
  e.files.every((f: unknown) => typeof f === 'string' && PRUNED_FILE.test(f)) &&
  Array.isArray(e.element_ids) && e.element_ids.length === e.files.length &&
  e.element_ids.every((i: unknown, n: number) => typeof i === 'string' && e.files[n] === e.files[n].replace(/[^/]+\.json$/, `${i}.json`))
const isMachineEntry = (e: any): boolean => {
  if (typeof e?.at !== 'string') return false
  if (e.action === 'pull') return PLATFORM_ID.test(e.model_id ?? '') && /^[0-9a-f]{64}$/.test(e.prints ?? '') && COUNT(e.registered) && COUNT(e.dropped)
  if (e.action === 'push-pin') return PLATFORM_ID.test(e.model_id ?? '') && COUNT(e.pinned)
  if (e.action === 'greenfield') return PLATFORM_ID.test(e.temp_id ?? '') && PLATFORM_ID.test(e.server_id ?? '') && COUNT(e.carried)
  return false
}
const ENTRY_FIELDS: Record<LogEntry['action'], readonly string[]> = {
  settle: ['at', 'action', 'items', 'decisions', 'reply'], baseline: ['at', 'action', 'items', 'decisions', 'reply'],
  prune: ['at', 'action', 'files', 'element_ids'], pull: ['at', 'action', 'model_id', 'prints', 'registered', 'dropped'],
  'push-pin': ['at', 'action', 'model_id', 'pinned'], greenfield: ['at', 'action', 'temp_id', 'server_id', 'carried'],
}
const ownFields = (e: any): LogEntry => {
  const out = Object.fromEntries(ENTRY_FIELDS[e.action as LogEntry['action']].map((k) => [k, e[k]])) as LogEntry
  if (out.action === 'settle' || out.action === 'baseline') out.decisions = Object.fromEntries(Object.entries(out.decisions).filter(([, n]) => COUNT(n)))
  return out
}
const isSettleEntry = (e: any): boolean =>
  e && typeof e.at === 'string' && (e.action === 'settle' || e.action === 'baseline') && Number.isInteger(e.items) &&
  e.decisions && typeof e.decisions === 'object' && typeof e.reply === 'string' && replyProblem(e.reply) === null

/** The log as stored: re-validated on read; anything malformed counts, but is not shown. */
export function parseLog(bytes: Buffer | null): { entries: LogEntry[]; total: number; unverified_prior?: number; restart_reason?: LogRestart } {
  if (!bytes) return { entries: [], total: 0 }
  try {
    const doc = JSON.parse(bytes.toString('utf8'))
    const total = Number.isSafeInteger(doc?.total) && doc.total >= 0 ? doc.total : 0
    // Each entry rebuilt from the fields its kind has: nothing else in the file is ever shown.
    const entries = (Array.isArray(doc?.entries) ? doc.entries : []).filter((e: any) => isPruneEntry(e) || isMachineEntry(e) || isSettleEntry(e)).map(ownFields)
    const restart = doc?.version === 2 && COUNT(doc.unverified_prior) && (LOG_RESTARTS as readonly unknown[]).includes(doc.restart_reason)
      ? { unverified_prior: doc.unverified_prior as number, restart_reason: doc.restart_reason as LogRestart }
      : {}
    return { entries: entries.slice(-SETTLE_LIMITS.log), total: Math.max(total, entries.length), ...restart }
  } catch {
    return { entries: [], total: 0 }
  }
}

/** The digest a baseline signs for the log its call wrote. */
export const logDigest = (content: string | null): string | null => (content === null ? null : sha256(content))

/**
 * Why the log on disk may not be continued, or null. A write continues only
 * the log its verified baseline signed; anything else (no baseline, a baseline
 * that does not verify, a log edited or deleted since) starts a fresh log, so
 * a signature never covers entries nobody signed.
 */
export function logRestart(baseline: BaselineRead, logBytes: Buffer | null): LogRestart | null {
  if (baseline.status === 'missing') return baseline.code === 'rolled_back' ? 'rolled_back' : logBytes ? 'no_baseline' : null
  if (baseline.status !== 'verified' || !baseline.baseline) return baseline.code === 'rolled_back' ? 'rolled_back' : 'unverified'
  const signed = baseline.baseline.log_digest
  if (signed === null) return logBytes ? 'digest_mismatch' : null
  if (!logBytes) return 'signed_log_missing'
  return sha256(logBytes) === signed ? null : 'digest_mismatch'
}

/**
 * The log a write signs: the one on disk with `entry` appended, when the
 * verified baseline signed it; otherwise a fresh log holding only `entry`,
 * with the number of entries it did not continue (`unverified_prior`) and why.
 */
export function nextLog(baseline: BaselineRead, logBytes: Buffer | null, entry: LogEntry): { content: string; restarted: LogRestart | null } {
  const restarted = logRestart(baseline, logBytes)
  if (restarted) {
    const prior = Math.min(parseLog(logBytes).total, Number.MAX_SAFE_INTEGER)
    return { content: `${JSON.stringify({ version: 2, total: 1, unverified_prior: prior, restart_reason: restarted, entries: [entry] }, null, 2)}\n`, restarted }
  }
  const log = parseLog(logBytes)
  const header = log.restart_reason ? { version: 2, total: log.total + 1, unverified_prior: log.unverified_prior, restart_reason: log.restart_reason } : { version: 1, total: log.total + 1 }
  return { content: `${JSON.stringify({ ...header, entries: [...log.entries, entry].slice(-SETTLE_LIMITS.log) }, null, 2)}\n`, restarted: null }
}

type ShownEntry = Omit<SettleEntry, 'reply'> | PruneEntry | PullEntry | PushPinEntry | GreenfieldEntry

/** The log for `get`: the total and the last entries, never the reply (agent-supplied, unsigned). */
export function shownLog(bytes: Buffer | null): { settlements_total: number; settlements_recent: ShownEntry[]; settlements_restarted?: { unverified_prior: number; reason: LogRestart } } {
  const log = parseLog(bytes)
  return {
    settlements_total: log.total,
    settlements_recent: log.entries.slice(-SETTLE_LIMITS.logShown).map((e) => (e.action === 'settle' || e.action === 'baseline' ? (({ reply: _reply, ...rest }) => rest)(e) : e)),
    ...(log.restart_reason ? { settlements_restarted: { unverified_prior: log.unverified_prior ?? 0, reason: log.restart_reason } } : {}),
  }
}

// =============================================================================
// Errors
// =============================================================================

export { StateFileError }
