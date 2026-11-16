/**
 * The views `list_model` gives of a model's exposures, so no answer is larger than the harnesses take inline:
 * the partition (counts only), the triage set grouped by definition, and rows filtered by a selection.
 *
 * The groups and rows views come in pages under a character budget, measured on the result as it is sent. A page
 * carries a `listing`: a hash of the rows it pages over, which the next page's call passes back so that a model that
 * changed between pages is refused rather than joined. Every string a view returns is capped; the full texts stay
 * in `evidence`. All of it is pure: the tool reads the model and hands the fold here.
 */
import { createHash } from 'node:crypto'
import { redactSecrets } from '../auth/redact.js'
import type { ElementKind, ExposureState, ModelExposures } from './exposures.js'

/** The most characters one page's result may take, serialised as sent. */
export const LIST_MODEL_PAGE_CHARS = 24_000
/** The most members one part of a group holds. */
export const GROUP_PART_MAX = 80
/** The most characters one part of a group may take, serialised. */
export const GROUP_PART_CHARS = 20_000
/** The most parts the groups view returns across all its pages. */
export const PARTS_MAX = 999
/** The most elements the partition names when listing those without exposures. */
export const WITHOUT_NAMED_MAX = 10

/**
 * The caps on returned strings: names and other text fields, a member's element name, technique id lists and each
 * id in them, reference lists. A class id is passed back to other tools, so it is never cut below the longest id
 * a tool takes.
 */
export const TEXT_MAX = 200
export const MEMBER_ELEMENT_NAME_MAX = 64
export const IDS_MAX = 50
export const ID_MAX = 32
export const CLASS_ID_MAX = 128
export const REFERENCES_MAX = 5

/**
 * At most `n` characters as the string is sent (its JSON escapes counted), never ending inside a surrogate pair:
 * text full of escaped characters cannot take a page past its budget. Session secrets are redacted before the cut,
 * since a cut through one leaves a piece the result's own redaction no longer recognises.
 */
export function cap(s: string, n: number): string
export function cap(s: string | null, n: number): string | null
export function cap(text: string | null, n: number): string | null {
  if (text == null) return text
  const s = redactSecrets(text)
  if (s.length <= n && JSON.stringify(s).length - 2 <= n) return s
  let length = 0
  let i = 0
  while (i < s.length) {
    const code = s.charCodeAt(i)
    const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    const unit = pair ? s.slice(i, i + 2) : s[i]!
    const add = pair ? 2 : JSON.stringify(unit).length - 2
    if (length + add > n) break
    length += add
    i += unit.length
  }
  return s.slice(0, i)
}

/** An id list cut to its first IDS_MAX entries, each at most ID_MAX long, with its full count when it was cut. */
function cappedIds(ids: string[], key: 'attack_ids' | 'atlas_ids'): Record<string, unknown> {
  const out: Record<string, unknown> = { [key]: ids.slice(0, IDS_MAX).map((id) => cap(id, ID_MAX)) }
  if (ids.length > IDS_MAX) out[`${key}_count`] = ids.length
  return out
}

const isTriage = (r: ExposureState) => r.lifecycle === 'pending' && r.created_by !== 'USER'
const isUserPending = (r: ExposureState) => r.lifecycle === 'pending' && r.created_by === 'USER'

/** Code-unit order, a null before every string: a null and an empty string are two values. */
const cmp = (a: string | null, b: string | null) => {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}
const byDefinition = (a: ExposureState, b: ExposureState) =>
  cmp(a.name, b.name) || cmp(a.type, b.type) || cmp(a.category, b.category) || cmp(a.def_hash, b.def_hash)

function countsOf(rows: ExposureState[]) {
  const totals = { pending: 0, confirmed: 0, disposed: 0, stale: 0, user: 0, system: 0 }
  let triage = 0
  let user_pending = 0
  for (const r of rows) {
    totals[r.lifecycle]++
    if (r.disposition_stale === true) totals.stale++
    if (r.created_by === 'USER') totals.user++
    else totals.system++
    if (isTriage(r)) triage++
    if (isUserPending(r)) user_pending++
  }
  return { exposures: rows.length, totals, triage, user_pending }
}

/** The element `id` names, or undefined when the model has none with that id. */
export function elementOf(model: ModelExposures, id: string): { id: string; name: string; kind: ElementKind } | undefined {
  return model.elements.find((e) => e.id === id)
}

/** The partition view: the model's counts, and those of one element when `elementId` is given. No rows. */
export function partitionView(model: ModelExposures, elementId?: string) {
  const all = countsOf(model.rows)
  const without = model.elements_without_exposures
  const element = elementId === undefined ? undefined : elementOf(model, elementId)
  return {
    model_id: model.model_id,
    model_name: cap(model.model_name, TEXT_MAX),
    view: 'partition' as const,
    ...all,
    elements: model.element_count,
    without_exposures: {
      count: without.length,
      ...(without.length <= WITHOUT_NAMED_MAX ? { elements: without.map((e) => ({ id: e.id, name: cap(e.name, TEXT_MAX), kind: e.kind })) } : {}),
    },
    ...(element
      ? { element: { id: element.id, name: cap(element.name, TEXT_MAX), kind: element.kind, ...countsOf(model.rows.filter((r) => r.element_id === element.id)) } }
      : {}),
  }
}

/** One member of a group part, as the groups view returns it. */
export interface GroupMember {
  exposure_id: string
  element_id: string
  element_name: string
  element_kind: ElementKind
  element_class_id: string | null
  score: number | null
  attack_vector: string | null
  unresolved_references_count: number
}

/** One part of a group of the triage set: `g<k>`, or `g<k>#<m>` when the group comes in more than one part. */
export interface GroupPart {
  group: string
  name: string
  type: string | null
  category: string | null
  def_hash: string
  attack_ids: string[]
  attack_ids_count?: number
  atlas_ids: string[]
  atlas_ids_count?: number
  /** The whole group's member count, across its parts */
  size: number
  members: GroupMember[]
}

function memberOf(r: ExposureState): GroupMember {
  return {
    exposure_id: r.exposure_id,
    element_id: r.element_id,
    element_name: cap(r.element_name, MEMBER_ELEMENT_NAME_MAX),
    element_kind: r.element_kind,
    element_class_id: r.element_class ? cap(r.element_class.id, CLASS_ID_MAX) : null,
    score: r.score,
    attack_vector: cap(r.attack_vector, TEXT_MAX),
    unresolved_references_count: r.unresolved_references?.length ?? 0,
  }
}

const byMember = (a: ExposureState, b: ExposureState) => cmp(a.element_id, b.element_id) || cmp(a.exposure_id, b.exposure_id)

/** The triage set's rows, in listing order: by definition, then element id, then exposure id. */
export function triageRows(rows: ExposureState[], elementId?: string): ExposureState[] {
  return rows
    .filter((r) => isTriage(r) && (elementId === undefined || r.element_id === elementId))
    .sort((a, b) => byDefinition(a, b) || byMember(a, b))
}

/**
 * The triage set — pending rows not created by USER, under `elementId` when given — grouped by the exact tuple
 * (name, type, category, def_hash), the groups in that tuple's order. A group's members are filled into parts in
 * member order until a part holds GROUP_PART_MAX members or the next member would take it past GROUP_PART_CHARS;
 * a part always holds at least one member.
 */
export function groupTriageSet(rows: ExposureState[], elementId?: string): GroupPart[] {
  const sorted = triageRows(rows, elementId)
  const groups: ExposureState[][] = []
  for (const r of sorted) {
    const last = groups[groups.length - 1]
    if (last && byDefinition(last[0]!, r) === 0) last.push(r)
    else groups.push([r])
  }
  const parts: GroupPart[] = []
  groups.forEach((members, i) => {
    const first = members[0]!
    const header = {
      name: cap(first.name, TEXT_MAX),
      type: cap(first.type, TEXT_MAX),
      category: cap(first.category, TEXT_MAX),
      def_hash: first.def_hash,
      ...cappedIds([...first.attack_ids].sort(), 'attack_ids'),
      ...cappedIds([...first.atlas_ids].sort(), 'atlas_ids'),
      size: members.length,
    }
    const chunks: GroupMember[][] = []
    let chunk: GroupMember[] = []
    // The part's length with no members, with the longest label it can carry; each member adds its own length and a comma.
    const base = JSON.stringify({ group: `g${i + 1}#${members.length}`, ...header, members: [] }).length
    let length = base
    for (const r of members) {
      const m = memberOf(r)
      const size = JSON.stringify(m).length
      if (chunk.length && (chunk.length >= GROUP_PART_MAX || length + 1 + size > GROUP_PART_CHARS)) {
        chunks.push(chunk)
        chunk = []
        length = base
      }
      length += size + (chunk.length ? 1 : 0)
      chunk.push(m)
    }
    chunks.push(chunk)
    chunks.forEach((c, j) => parts.push({ group: chunks.length === 1 ? `g${i + 1}` : `g${i + 1}#${j + 1}`, ...header, members: c } as GroupPart))
  })
  return parts
}

/** The rows view's selections. */
export type RowSelect = 'stale' | 'user' | 'all'

const SELECTS: Record<RowSelect, (r: ExposureState) => boolean> = {
  stale: (r) => r.disposition_stale === true,
  user: (r) => r.created_by === 'USER',
  all: () => true,
}

/** The rows `select` picks, under `elementId` when given, in listing order: by definition, then exposure id. */
export function selectRows(rows: ExposureState[], select: RowSelect, elementId?: string): ExposureState[] {
  return rows
    .filter((r) => SELECTS[select](r) && (elementId === undefined || r.element_id === elementId))
    .sort((a, b) => byDefinition(a, b) || cmp(a.exposure_id, b.exposure_id))
}

/** A row as the rows view returns it: every string capped, the reference and id lists cut, the full reason left out. */
export function rowOf(r: ExposureState): Record<string, unknown> {
  const refs = r.unresolved_references
  return {
    exposure_id: r.exposure_id,
    name: cap(r.name, TEXT_MAX),
    type: cap(r.type, TEXT_MAX),
    category: cap(r.category, TEXT_MAX),
    score: r.score,
    attack_vector: cap(r.attack_vector, TEXT_MAX),
    created_by: cap(r.created_by, TEXT_MAX),
    authored_by: cap(r.authored_by, TEXT_MAX),
    disposition_kind: cap(r.disposition_kind, TEXT_MAX),
    disposition_reason: cap(r.disposition_reason, TEXT_MAX),
    dispositioned_by: cap(r.dispositioned_by, TEXT_MAX),
    dispositioned_at: cap(r.dispositioned_at, TEXT_MAX),
    disposition_stale: r.disposition_stale,
    lifecycle: r.lifecycle,
    element_id: r.element_id,
    element_name: cap(r.element_name, TEXT_MAX),
    element_kind: r.element_kind,
    element_class: r.element_class ? { id: cap(r.element_class.id, CLASS_ID_MAX), name: cap(r.element_class.name, TEXT_MAX) } : null,
    ...cappedIds(r.attack_ids, 'attack_ids'),
    ...cappedIds(r.atlas_ids, 'atlas_ids'),
    unresolved_references: refs == null ? null : refs.slice(0, REFERENCES_MAX).map((x) => cap(x, TEXT_MAX)),
    ...(refs != null && refs.length > REFERENCES_MAX ? { unresolved_references_count: refs.length } : {}),
    def_hash: r.def_hash,
  }
}

/**
 * The listing check: sha256 over the paged rows' identity, the fields their order and grouping rest on, and every
 * field of a group member (whose lengths decide where a group's parts split), in listing order, as 16 hex
 * characters. A rename, a new or removed row, or a lifecycle change alters it, and so does any change that would
 * move a part's boundary.
 */
export function listingOf(rows: ExposureState[]): string {
  const hash = createHash('sha256')
  for (const r of rows) {
    hash.update(JSON.stringify([
      r.exposure_id, r.name, r.type, r.category, r.def_hash, r.lifecycle, r.disposition_stale, r.created_by, r.element_id,
      r.element_name, r.element_kind, r.element_class?.id ?? null, r.score, r.attack_vector, r.unresolved_references?.length ?? 0,
    ]))
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * Builds a page's result: `page` its items, `next` the offset of the next page when one follows, `returned` the
 * number of items it reports (the page's own length, except while the page is being measured).
 */
export type PageShape<T> = (page: T[], next: number | undefined, returned: number) => unknown

/**
 * One page of `items` from `offset`: as many whole items as keep the page's result, as it is sent, within
 * LIST_MODEL_PAGE_CHARS. At least one item, when any is left. Each item is measured once: the result's length is
 * that of its shape with no items, plus its items and the commas between them.
 */
export function pageOf<T>(items: T[], offset: number, shape: PageShape<T>): unknown {
  if (offset >= items.length) return shape([], undefined, 0)
  let length = 0
  let k = 0
  for (let i = offset; i < items.length; i++) {
    const add = JSON.stringify(items[i]).length + (k ? 1 : 0)
    const next = i + 1 < items.length ? i + 1 : undefined
    const total = JSON.stringify(shape([], next, k + 1)).length + length + add
    if (k && total > LIST_MODEL_PAGE_CHARS) break
    length += add
    k++
  }
  const end = offset + k
  return shape(items.slice(offset, end), end < items.length ? end : undefined, k)
}
