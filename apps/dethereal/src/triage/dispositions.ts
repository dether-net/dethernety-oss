/**
 * Disposition plans: what a closed review would write, checked against the platform, and the write itself.
 *
 * `prepare` reads the model's exposures once and checks each operation of the review against what it finds: the
 * exposure is still as the review saw it when it was opened, its disposition allows the operation, the reason
 * fits, a supersede's techniques exist. It writes nothing and returns the plan's echo: one entry per operation and
 * the lines the operator is shown, which say what each write does. `commit` reads the model again and writes only
 * when no exposure of the plan changed since `prepare`.
 *
 * The echo is bounded: the review is refused at open, and an edit when it is given, if the plan could outgrow
 * `ECHO_BUDGET` (`echoBoundOf`, measured as the echo is).
 */
import { createHash } from 'node:crypto'
import { gql } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'
import { DtExposure, executeSupersedeFlow, SupersedeCloneError, SupersedeDisposeError } from '@dethernety/dt-core'
import type { DispositionKind, ExposureTechniqueLinks, TechniqueLink } from '@dethernety/dt-core'
import { OPERATOR_ONLY_KINDS, PICKABLE_KINDS, type Modifications, type Review, type ReviewOperation } from './review.js'
import type { ExposureEvidence, ExposureState } from './exposures.js'
import { shown } from './text.js'

/** The platform's limit on a disposition reason, marker included. */
export const REASON_MAX = 2000
/** Appended to every reason triage writes: the proposal as approved, or as the operator changed it. */
export const MARKER_APPROVED = ' — AI-assisted triage, operator-approved'
export const MARKER_EDITED = ' — AI-assisted triage, operator-edited'
/** The suffix of a supersede copy's name. */
export const CLONE_SUFFIX = ' (custom)'
/** The largest echo, in characters of compact JSON, that still reaches the operator whole: half the smallest inline tool result measured. */
export const ECHO_BUDGET = 24_000
/** A platform text in a line is cut to this many characters (an exposure's name, a replaced reason). */
export const SHOWN_MAX = 160

export type PlannedOp = 'dispose' | 'reaffirm' | 'clear' | 'supersede'

/** Why prepare does not apply an operation, as its line says. */
export const WHY = {
  not_in_model: 'the exposure is not in this model on the platform',
  target_changed: 'the exposure changed since the review was opened: open a new review',
  target_superseded: 'the exposure is superseded: its copy is the live finding',
  target_disposed: 'a supersede needs the exposure undisposed or affirmed',
  evidence_unread: 'the exposure\'s evidence could not be read',
  kind_not_pickable: 'the kind cannot be set here',
  reason_empty: 'the reason is empty',
  reason_too_long: `the reason is over ${REASON_MAX} characters with its marker`,
  not_disposed: 'the exposure has no disposition to reaffirm',
  technique_not_verified: "a technique to add is not among the proposal's verified ids, or is no ATT&CK or ATLAS technique on the platform",
  remove_not_present: 'a technique to remove is not on the exposure',
  empty_supersede: 'the supersede changes no field and no technique',
  copy_exists: 'the element already has an exposure with the copy\'s name',
  copy_name_invalid: 'the copy\'s name would hold a single quote',
} as const
export type RejectCode = keyof typeof WHY

/** What a supersede creates: the copy, as the finish export will show it. */
export interface CloneDescription {
  source_exposure_id: string
  source_name: string
  /** The element the copy is created on, and its name */
  element_id: string
  element_name: string | null
  name: string
  /** The fields the copy takes from the modifications; every other field is the source's */
  changes: Partial<Pick<Modifications, 'name' | 'description' | 'score' | 'attackVector' | 'category'>>
  /** The copy's description: the changed one or the source's, ending with the note naming the source */
  description: { from: 'changes' | 'source'; note: string }
  /** Internal ids: the ones added and removed, and the copy's links by framework */
  techniques: { add: string[]; remove: string[]; attack: string[]; atlas: string[] }
  /** The content fields copied from the source, and the copy's technique list (its links' MITRE ids) */
  content: { copied: string[]; techniques: string[] }
  /** The source is marked SUPERSEDED with this reason */
  source_reason: string
}

export interface PlannedOperation {
  index: number
  group: number
  exposure_id: string
  name: string | null
  /** The name of the element the exposure is on */
  element: string | null
  op: PlannedOp
  kind?: string
  reason?: string
  /** A dispose or supersede over a disposition: the one it replaces */
  replacing?: { kind: string; reason: string | null }
  /** A clear: the kind it clears */
  clearing?: string | null
  clone?: CloneDescription
  /** A supersede: the source's values its changes replace, and the MITRE ids of the techniques added and removed */
  before?: { description: string | null; score: number | null; attackVector: string | null; category: string | null }
  mitre?: { add: string[]; remove: string[] }
  status: 'ready' | 'rejected'
  code?: RejectCode
  /** The rejection in detail, for a refusal at open */
  detail?: string
}

/** One operation as the echo carries it; its line says the rest. */
export interface EchoOperation {
  index: number
  group: number
  exposure_id: string
  op: PlannedOp
  kind?: string
  status: 'ready' | 'rejected'
  code?: RejectCode
  clone?: CloneDescription
}

export interface Echo {
  count: number
  operations: EchoOperation[]
  lines: string[]
}

export interface PlanModel {
  model_id: string
  model_name: string
}

/** The part of an exposure a review and a plan are bound to: a write goes ahead only while these are unchanged. */
const boundOf = (s: ExposureState | undefined): Record<string, unknown> =>
  s
    ? { kind: s.disposition_kind, stale: s.disposition_stale, def_hash: s.def_hash, reason: s.full_reason, at: s.dispositioned_at, name: s.name, score: s.score, attack_vector: s.attack_vector }
    : { gone: true }
const sameBound = (a: ExposureState | undefined, b: ExposureState | undefined) => JSON.stringify(boundOf(a)) === JSON.stringify(boundOf(b))

/** sha256 over the bound state of every exposure the ready operations touch. */
export function fingerprintOf(ops: PlannedOperation[], byId: Map<string, ExposureState>): string {
  const ids = [...new Set(ops.filter((o) => o.status === 'ready').map((o) => o.exposure_id))].sort()
  return createHash('sha256').update(JSON.stringify(ids.map((id) => [id, boundOf(byId.get(id))]))).digest('hex')
}

/** The exposures of a plan that changed between two reads, by id. */
export function changedSince(ops: PlannedOperation[], before: Map<string, ExposureState>, after: Map<string, ExposureState>): string[] {
  const ids = [...new Set(ops.filter((o) => o.status === 'ready').map((o) => o.exposure_id))]
  return ids.filter((id) => !sameBound(before.get(id), after.get(id)))
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MARKER_END = new RegExp(`(${escape(MARKER_APPROVED)}|${escape(MARKER_EDITED)})$`)
const RENEWED_END = / \[re-affirmed \d{4}-\d{2}-\d{2} after model change\]$/

/** A reaffirm keeps the reason it renews, without its marker or an earlier renewal note, and says when it was renewed, as approved. */
export function reaffirmReason(current: string, date: string): string {
  let body = current.replace(MARKER_END, '')
  while (RENEWED_END.test(body)) body = body.replace(RENEWED_END, '')
  return `${body} [re-affirmed ${date} after model change]${MARKER_APPROVED}`
}

export { shown }

/** The technique ids the platform knows, by framework: what a supersede may add. */
export const TECHNIQUE_IDS = gql`
  query TriageTechniqueIds($ids: [ID!]!) {
    mitreAttackTechniques(where: { id: { in: $ids } }) { id attack_id }
    mitreAtlasTechniques(where: { id: { in: $ids } }) { id atlas_id }
  }
`

export interface KnownTechniques {
  attack: Map<string, string | null>
  atlas: Map<string, string | null>
}

export async function readTechniques(client: ApolloClient, ids: string[]): Promise<KnownTechniques> {
  if (!ids.length) return { attack: new Map(), atlas: new Map() }
  const r = (await client.query({ query: TECHNIQUE_IDS, variables: { ids }, fetchPolicy: 'no-cache' })) as {
    data?: { mitreAttackTechniques?: Array<{ id: string; attack_id: string | null }>; mitreAtlasTechniques?: Array<{ id: string; atlas_id: string | null }> }
  }
  return {
    attack: new Map((r.data?.mitreAttackTechniques ?? []).map((t) => [t.id, t.attack_id])),
    atlas: new Map((r.data?.mitreAtlasTechniques ?? []).map((t) => [t.id, t.atlas_id])),
  }
}

export interface PrepareInput {
  operations: ReviewOperation[]
  /** The model's exposures now, by id */
  state: Map<string, ExposureState>
  /** As the review saw them at open; an exposure that differs is not written */
  seen?: Map<string, ExposureState>
  evidence: Map<string, ExposureEvidence>
  techniques: KnownTechniques
  /** Today, as the reaffirm reason dates it (YYYY-MM-DD) */
  date: string
}

const reject = (base: Omit<PlannedOperation, 'status'>, code: RejectCode, detail: string = WHY[code]): PlannedOperation => ({ ...base, status: 'rejected', code, detail })

/** Check each operation of a closed review against the platform's state; nothing is written. */
export function planOperations(input: PrepareInput): PlannedOperation[] {
  // The copies this plan creates, by element and name: two of them may not share one.
  const copies = new Set<string>()
  return input.operations.map((o, index) => {
    const s = input.state.get(o.exposure_id)
    // Named as the review saw it: a line's length is then what the review was bounded with, whatever the platform renamed.
    const was = input.seen?.get(o.exposure_id) ?? s
    const base = { index, group: o.group, exposure_id: o.exposure_id, name: was?.name ?? null, element: was?.element_name ?? null, op: o.op as PlannedOp }
    if (!s) return reject(base, 'not_in_model')
    if (input.seen && !sameBound(input.seen.get(o.exposure_id), s)) return reject(base, 'target_changed')
    if (o.op === 'clear') return { ...base, clearing: s.disposition_kind, status: 'ready' }
    if (o.op === 'dispose') {
      if (!o.kind || !(PICKABLE_KINDS as readonly string[]).includes(o.kind)) return reject(base, 'kind_not_pickable', `the kind is one of ${PICKABLE_KINDS.join(', ')}`)
      if (OPERATOR_ONLY_KINDS.has(o.kind) && !o.edited) return reject({ ...base, kind: o.kind }, 'kind_not_pickable', `${o.kind} is the operator's to choose, in an edit with a rationale`)
      if (s.disposition_kind === 'SUPERSEDED') return reject({ ...base, kind: o.kind }, 'target_superseded')
      const body = (o.reason ?? '').trim()
      if (!body) return reject({ ...base, kind: o.kind }, 'reason_empty')
      // The operator-edited marker only on a reason the operator wrote: a proposed reason stays approved.
      const reason = `${body}${o.marker ?? (o.operator_reason ? MARKER_EDITED : MARKER_APPROVED)}`
      if (reason.length > REASON_MAX) return reject({ ...base, kind: o.kind }, 'reason_too_long', `the reason is ${reason.length} characters with its marker; at most ${REASON_MAX}`)
      const replacing = s.disposition_kind ? { replacing: { kind: s.disposition_kind, reason: s.full_reason } } : {}
      return { ...base, kind: o.kind, reason, ...replacing, status: 'ready' }
    }
    if (o.op === 'reaffirm') {
      const kind = s.disposition_kind
      if (!kind) return reject(base, 'not_disposed')
      if (kind === 'SUPERSEDED') return reject(base, 'target_superseded', 'a superseded exposure is cleared or skipped, not reaffirmed')
      if (!(PICKABLE_KINDS as readonly string[]).includes(kind)) return reject(base, 'kind_not_pickable', `its kind ${kind} cannot be set again here`)
      const reason = reaffirmReason(s.full_reason ?? '', input.date)
      // The renewal was proposed and the operator approved it; its reason is the one already written.
      if (reason.length > REASON_MAX) return reject({ ...base, kind }, 'reason_too_long', `the renewed reason is ${reason.length} characters; at most ${REASON_MAX}`)
      return { ...base, kind, reason, status: 'ready' }
    }
    const planned = planSupersede(base, o, s, input)
    if (planned.status !== 'ready') return planned
    const key = JSON.stringify([planned.clone!.element_id, planned.clone!.name])
    if (copies.has(key)) return reject(base, 'copy_exists', `another supersede of this plan creates "${planned.clone!.name}" on the same element`)
    copies.add(key)
    return planned
  })
}

function planSupersede(base: Omit<PlannedOperation, 'status'>, o: ReviewOperation, s: ExposureState, input: PrepareInput): PlannedOperation {
  if (s.disposition_kind === 'SUPERSEDED') return reject(base, 'target_superseded')
  if (s.disposition_kind !== null && s.disposition_kind !== 'AFFIRMED') return reject(base, 'target_disposed', `the exposure is ${s.disposition_kind}: a supersede needs it undisposed or affirmed`)
  const e = input.evidence.get(o.exposure_id)
  if (!e) return reject(base, 'evidence_unread')
  // The copy goes on the row's element, from the model read: an element of this model, and the one the review named.
  // Never from an interface relationship field (Exposure.element), which can list elements of other models.
  const seenRow = input.seen?.get(o.exposure_id)
  if (seenRow && (seenRow.element_id !== s.element_id || seenRow.element_name !== s.element_name)) return reject(base, 'target_changed', 'the element the copy would be created on changed since the review was opened')
  const element = { id: s.element_id, name: s.element_name }
  // The evidence is a second read: it must be the exposure the rows are bound to.
  if (e.def_hash !== s.def_hash || e.name !== s.name || e.score !== s.score || e.attack_vector !== s.attack_vector) return reject(base, 'target_changed', 'the exposure changed between the model read and its evidence read')
  const m = o.modifications ?? {}
  const add = [...new Set(m.techniques?.add ?? [])]
  const remove = [...new Set(m.techniques?.remove ?? [])]
  const verified = new Set(o.verified_technique_ids ?? [])
  const unverified = add.filter((id) => !verified.has(id))
  if (unverified.length) return reject(base, 'technique_not_verified', `technique ${unverified.join(', ')} is not among the proposal's verified_technique_ids: only ids listed there are added`)
  const unknown = add.filter((id) => !input.techniques.attack.has(id) && !input.techniques.atlas.has(id))
  if (unknown.length) return reject(base, 'technique_not_verified', `technique ${unknown.join(', ')} is no ATT&CK or ATLAS technique on the platform`)
  const originalAttack = e.exploited_by.map((t) => t.id)
  const originalAtlas = e.exploited_by_atlas.map((t) => t.id)
  const absent = remove.filter((id) => !originalAttack.includes(id) && !originalAtlas.includes(id))
  if (absent.length) return reject(base, 'remove_not_present', `technique ${absent.join(', ')} is not on the exposure`)
  const changes: CloneDescription['changes'] = {}
  for (const k of ['name', 'description', 'score', 'attackVector', 'category'] as const) if (m[k] !== undefined) (changes as Record<string, unknown>)[k] = m[k]
  if (!Object.keys(changes).length && !add.length && !remove.length) return reject(base, 'empty_supersede')
  const name = `${changes.name ?? e.name}${CLONE_SUFFIX}`
  // The platform finds a copy's source by the copy's name in single quotes.
  if (name.includes("'")) return reject(base, 'copy_name_invalid', `the copy's name "${name}" would hold a single quote: give the copy a name without one`)
  if ([...input.state.values()].some((r) => r.element_id === element.id && r.name === name)) return reject(base, 'copy_exists', `the element already has an exposure named "${name}"`)
  const attack = [...originalAttack.filter((id) => !remove.includes(id)), ...add.filter((id) => input.techniques.attack.has(id) && !originalAttack.includes(id))]
  const atlas = [...originalAtlas.filter((id) => !remove.includes(id)), ...add.filter((id) => input.techniques.atlas.has(id) && !input.techniques.attack.has(id) && !originalAtlas.includes(id))]
  const mitreOf = (id: string) =>
    e.exploited_by.find((t) => t.id === id)?.attack_id ?? e.exploited_by_atlas.find((t) => t.id === id)?.atlas_id ?? input.techniques.attack.get(id) ?? input.techniques.atlas.get(id) ?? id
  const externalIds = [...attack, ...atlas].map(mitreOf).filter((x) => x !== '')
  const clone: CloneDescription = {
    source_exposure_id: e.exposure_id,
    source_name: e.name,
    element_id: element.id,
    element_name: element.name ?? null,
    name,
    changes,
    description: { from: changes.description !== undefined ? 'changes' : 'source', note: `(custom of '${e.name}')` },
    techniques: { add, remove, attack, atlas },
    content: { copied: ['references', 'mitigation_suggestions', 'detection_methods', 'tags'], techniques: externalIds },
    source_reason: `Superseded by user-authored exposure '${name}'`,
  }
  return {
    ...base,
    clone,
    ...(s.disposition_kind ? { replacing: { kind: s.disposition_kind, reason: s.full_reason } } : {}),
    before: { description: e.description, score: e.score, attackVector: e.attack_vector, category: e.category },
    mitre: { add: add.map(mitreOf), remove: remove.map(mitreOf) },
    status: 'ready',
  }
}

/** A text as shown, cut to `max`, with a quote or a backslash escaped: no text can open or close a line's quotes. */
const plain = (s: string, max?: number) => shown(s, max).replace(/["\\]/g, '\\$&')
/** A text in double quotes, as `plain` shows it. */
const quoted = (s: string, max?: number) => `"${plain(s, max)}"`

/**
 * How a line tells exposures apart: the shortest tail of the id, at least 8 characters, that differs between every
 * exposure of the plan. A smaller plan never needs a longer one.
 */
function idsOf(ops: PlannedOperation[]): (id: string) => string {
  const ids = [...new Set(ops.map((o) => o.exposure_id))]
  const longest = Math.max(0, ...ids.map((id) => id.length))
  let n = 8
  while (n < longest && new Set(ids.map((id) => id.slice(-n))).size < ids.length) n++
  return (id) => (id.length <= n ? `#${plain(id)}` : `#…${plain(id.slice(-n))}`)
}
type IdOf = (id: string) => string

/** An exposure as a line names it: its name and its element, as the review saw them, and its short id. */
const nameOf = (o: PlannedOperation, idOf: IdOf) =>
  `${quoted(o.name ?? o.exposure_id, SHOWN_MAX)} on ${o.element === null ? 'an unknown element' : quoted(o.element, SHOWN_MAX)} ${idOf(o.exposure_id)}`
const replaced = (o: PlannedOperation) => (o.replacing ? ` (replacing ${plain(o.replacing.kind)}: ${quoted(o.replacing.reason ?? '', SHOWN_MAX)})` : '')
/** A value a supersede replaces, or none. */
const old = (v: string | null) => (v === null ? 'none' : quoted(v, SHOWN_MAX))

function supersedeLine(o: PlannedOperation, idOf: IdOf): string {
  const c = o.clone!
  const b = o.before!
  const on = c.element_name === null ? 'an unknown element' : quoted(c.element_name, SHOWN_MAX)
  const parts = [`Group ${o.group}: supersede ${nameOf(o, idOf)}${replaced(o)}: create ${quoted(c.name)} on ${on}`]
  if (c.changes.name !== undefined) parts.push(`name ${quoted(c.changes.name)}`)
  if (c.changes.description !== undefined) parts.push(`description ${old(b.description)} → ${quoted(c.changes.description)}`)
  if (c.changes.score !== undefined) parts.push(`score ${b.score ?? 'none'} → ${c.changes.score}`)
  if (c.changes.attackVector !== undefined) parts.push(`attack vector ${old(b.attackVector)} → ${quoted(c.changes.attackVector)}`)
  if (c.changes.category !== undefined) parts.push(`category ${old(b.category)} → ${quoted(c.changes.category)}`)
  if (o.mitre!.add.length) parts.push(`techniques added ${o.mitre!.add.map((t) => plain(t)).join(', ')}`)
  if (o.mitre!.remove.length) parts.push(`techniques removed ${o.mitre!.remove.map((t) => plain(t)).join(', ')}`)
  parts.push(`references, mitigations, detections and tags copied; the description ends with ${quoted(c.description.note)}`)
  parts.push(`${nameOf(o, idOf)} marked SUPERSEDED with ${quoted(c.source_reason)}`)
  return parts.join('; ')
}

/** The second line: what the plan writes, counted, so its head says what matters even where the rest is cut. */
function summaryOf(ops: PlannedOperation[]): string {
  const ready = ops.filter((o) => o.status === 'ready')
  const count = (op: PlannedOp) => ready.filter((o) => o.op === op).length
  const replacing = ready.filter((o) => o.replacing).length
  const operatorOnly = ready.filter((o) => o.op === 'dispose' && o.kind !== undefined && OPERATOR_ONLY_KINDS.has(o.kind)).length
  return `${ready.length} write(s): ${count('dispose')} dispose, ${count('supersede')} supersede, ${count('clear')} clear, ${count('reaffirm')} reaffirm; ` +
    `${replacing} replace a disposition; ${operatorOnly} set COMPENSATING_CONTROL or RISK_ACCEPTED; ${ops.length - ready.length} not applied`
}

/**
 * The lines the operator is shown before the apply question: the platform model, what the plan writes counted,
 * then each group's writes in order, then what is not applied, by why.
 */
export function linesOf(model: PlanModel, ops: PlannedOperation[]): string[] {
  const lines = [`Platform model ${quoted(model.model_name)} (${plain(model.model_id)})`, summaryOf(ops)]
  const idOf = idsOf(ops)
  const ready = ops.filter((o) => o.status === 'ready')
  const groups = [...new Set(ready.map((o) => o.group))]
  for (const g of groups) {
    const inGroup = ready.filter((o) => o.group === g)
    const disposes = new Map<string, PlannedOperation[]>()
    for (const o of inGroup.filter((x) => x.op === 'dispose')) {
      const key = JSON.stringify([o.kind, o.reason])
      disposes.set(key, [...(disposes.get(key) ?? []), o])
    }
    for (const same of disposes.values()) {
      const items = same.map((o) => `${nameOf(o, idOf)}${replaced(o)}`)
      lines.push(`Group ${g}: dispose as ${same[0]!.kind} with ${quoted(same[0]!.reason!)}: ${items.join('; ')}`)
    }
    const clears = inGroup.filter((o) => o.op === 'clear')
    if (clears.length) lines.push(`Group ${g}: clear the disposition of ${clears.map((o) => `${nameOf(o, idOf)} (${plain(o.clearing ?? 'none')})`).join('; ')}`)
    for (const o of inGroup.filter((x) => x.op === 'reaffirm')) lines.push(`Group ${g}: reaffirm ${nameOf(o, idOf)} as ${o.kind} with ${quoted(o.reason!)}`)
    for (const o of inGroup.filter((x) => x.op === 'supersede')) lines.push(supersedeLine(o, idOf))
  }
  const rejected = ops.filter((o) => o.status === 'rejected')
  for (const code of [...new Set(rejected.map((o) => o.code!))]) {
    lines.push(`${rejectedHead(code)}${rejected.filter((o) => o.code === code).map((o) => nameOf(o, idOf)).join('; ')}`)
  }
  return lines
}

const rejectedHead = (code: RejectCode) => `Not applied (${code}): ${WHY[code]}: `

const entryOf = (o: PlannedOperation): EchoOperation => ({
  index: o.index,
  group: o.group,
  exposure_id: o.exposure_id,
  op: o.op,
  ...(o.kind !== undefined && o.status === 'ready' ? { kind: o.kind } : {}),
  status: o.status,
  ...(o.code ? { code: o.code } : {}),
  ...(o.clone && o.status === 'ready' ? { clone: o.clone } : {}),
})

/** What prepare returns of a plan: the count of ready operations, each operation, and the lines. */
export function echoOf(model: PlanModel, ops: PlannedOperation[]): Echo {
  return { count: ops.filter((o) => o.status === 'ready').length, operations: ops.map(entryOf), lines: linesOf(model, ops) }
}

/** The echo's size, as it is sent. */
export const echoSize = (echo: Echo): number => JSON.stringify(echo).length

const LONGEST_CODE = (Object.keys(WHY) as RejectCode[]).reduce((a, b) => (b.length > a.length ? b : a))

/**
 * The largest echo a plan of these operations can have, each of them ready as here or rejected: the echo as here,
 * plus what a rejection could add. A rejected operation's line names it as its ready line did, with a separator,
 * its entry gains a code, and each why heads a line of its own.
 */
export function echoBoundOf(model: PlanModel, ops: PlannedOperation[]): number {
  let bound = echoSize(echoOf(model, ops))
  for (const o of ops) {
    const ready = JSON.stringify(entryOf(o)).length
    const rejected = JSON.stringify(entryOf({ ...o, status: 'rejected', code: LONGEST_CODE })).length
    bound += Math.max(0, rejected - ready) + '; '.length
  }
  for (const code of Object.keys(WHY) as RejectCode[]) bound += JSON.stringify(rejectedHead(code)).length + ','.length
  // The summary's counts only shrink from all ready, except "not applied", which grows by at most two digits.
  return bound + 2
}

/** The longest kind a dispose may write. */
const LONGEST_KIND = PICKABLE_KINDS.reduce((a, b) => (b.length > a.length ? b : a))

/**
 * The operations a review can still come to, at their largest, for its echo bound: decided groups as decided; a
 * pending group as accepted (a stale one both reaffirmed and cleared); a group that waits for the operator's edit
 * with the longest kind and its proposed reason. An edit is checked against the bound when it is given.
 */
export function boundOperationsOf(review: Review): ReviewOperation[] {
  const out: ReviewOperation[] = []
  for (const [n, g] of review.groups) {
    const d = review.decisions.get(n)!
    if (d.decision === 'skip') continue
    for (const exposure_id of g.exposure_ids) {
      if (review.mode === 'stale') {
        const ops: Array<'reaffirm' | 'clear'> = d.decision === 'pending' ? ['reaffirm', 'clear'] : d.decision === 'reaffirm' || d.decision === 'clear' ? [d.decision] : []
        for (const op of ops) out.push({ group: n, exposure_id, op, edited: false })
        continue
      }
      const p = g.proposal
      if (p?.op === 'supersede') {
        out.push({ group: n, exposure_id, op: 'supersede', edited: false, modifications: p.modifications, verified_technique_ids: p.verified_technique_ids ?? [] })
        continue
      }
      const edited = d.decision === 'edit'
      const kind = (edited ? d.kind : undefined) ?? (g.needs_human && d.decision === 'pending' ? LONGEST_KIND : p?.kind ?? LONGEST_KIND)
      const own = edited && d.rationale !== undefined
      const reason = (own ? d.rationale : undefined) ?? p?.reason ?? ''
      out.push({ group: n, exposure_id, op: 'dispose', edited, operator_reason: own, kind, reason })
    }
  }
  return out
}

/** The echo bound of a review as it stands, against what it saw at open. */
export function reviewEchoBound(review: Review, date: string): number {
  const ops = planOperations({ operations: boundOperationsOf(review), state: review.seen, evidence: review.evidence, techniques: review.techniques, date })
  return echoBoundOf(review, ops)
}

/** What a commit did with one operation. */
export interface Outcome {
  index: number
  exposure_id: string
  op: PlannedOp
  status: 'applied' | 'failed' | 'partial'
  kind?: string | null
  reason?: string | null
  clone_id?: string | null
  clone_name?: string
  content_warning?: string
  error?: string
  error_code?: string
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Write the ready operations, in order, continuing past a failure. */
export async function writeOperations(client: ApolloClient, ops: PlannedOperation[], evidence: Map<string, ExposureEvidence>): Promise<Outcome[]> {
  const dt = new DtExposure(client)
  const outcomes: Outcome[] = []
  for (const o of ops) {
    if (o.status !== 'ready') continue
    const head = { index: o.index, exposure_id: o.exposure_id, op: o.op }
    try {
      if (o.op === 'supersede') {
        outcomes.push(await writeSupersede(dt, o, evidence.get(o.exposure_id)!))
        continue
      }
      const r = o.op === 'clear'
        ? await dt.clearDisposition({ exposureId: o.exposure_id })
        : await dt.disposeExposure({ exposureId: o.exposure_id, kind: o.kind as DispositionKind, reason: o.reason! })
      outcomes.push(r.success
        ? { ...head, status: 'applied', kind: r.dispositionKind, reason: r.dispositionReason }
        : { ...head, status: 'failed', error: r.errorMessage ?? 'the platform refused the write', ...(r.errorCode ? { error_code: r.errorCode } : {}) })
    } catch (err) {
      outcomes.push({ ...head, status: 'failed', error: messageOf(err) })
    }
  }
  return outcomes
}

async function writeSupersede(dt: DtExposure, o: PlannedOperation, e: ExposureEvidence): Promise<Outcome> {
  const c = o.clone!
  const head = { index: o.index, exposure_id: o.exposure_id, op: o.op, clone_name: c.name }
  // The source's links as they are now, with their justifications; the copy keeps the kept ones as they are.
  const current = await dt.getExposureTechniqueLinks({ exposureId: o.exposure_id })
  if (!current) return { ...head, status: 'failed', error: 'the exposure is gone: nothing was created' }
  const keep = (links: TechniqueLink[], wanted: string[]) => wanted.map((id) => links.find((l) => l.id === id) ?? { id })
  const techniqueLinks: ExposureTechniqueLinks = { exploitedBy: keep(current.exploitedBy, c.techniques.attack), exploitedByAtlas: keep(current.exploitedByAtlas, c.techniques.atlas) }
  try {
    const r = await executeSupersedeFlow({
      systemExposureId: o.exposure_id,
      // The source's name, which the copy's description note names; the copy is named by `copyName`.
      systemExposure: {
        id: e.exposure_id,
        name: e.name,
        description: c.changes.description ?? e.description ?? undefined,
        type: e.type ?? undefined,
        category: c.changes.category ?? e.category ?? undefined,
        score: c.changes.score ?? e.score ?? undefined,
        attackVector: c.changes.attackVector ?? e.attack_vector ?? undefined,
      },
      elementId: c.element_id,
      dtExposure: dt,
      copyName: c.name,
      techniqueLinks,
      cloneContent: { references: e.references, mitigationSuggestions: e.mitigation_suggestions, detectionMethods: e.detection_methods, tags: e.tags, techniques: c.content.techniques },
    })
    const cloneId = r.userCopy?.id ?? null
    const warning = r.contentWarning ? { content_warning: r.contentWarning } : {}
    if (!r.systemDispositionResult.success) return { ...head, status: 'partial', clone_id: cloneId, error: r.systemDispositionResult.errorMessage ?? 'the source could not be marked SUPERSEDED', ...warning }
    const marked = { clone_id: cloneId, kind: r.systemDispositionResult.dispositionKind, reason: r.systemDispositionResult.dispositionReason }
    // The approved line promised the copied content: a copy without it is not what was approved.
    if (r.contentWarning) {
      const copy = cloneId ? `the copy ${cloneId}` : 'the copy'
      const error = `${copy} was created and the source marked SUPERSEDED, but the copy lacks the source's references, mitigations, detections and tags: add them to the copy on the platform; preparing again does not`
      return { ...head, status: 'partial', ...marked, content_warning: r.contentWarning, error }
    }
    return { ...head, status: 'applied', ...marked }
  } catch (err) {
    if (err instanceof SupersedeDisposeError) return { ...head, status: 'partial', clone_id: err.cloneId, error: err.message, ...(err.contentWarning ? { content_warning: err.contentWarning } : {}) }
    if (err instanceof SupersedeCloneError) return { ...head, status: 'failed', clone_id: err.cloneId, error: err.message }
    return { ...head, status: 'failed', error: messageOf(err) }
  }
}

/** Today in UTC, as a reaffirm reason dates it (YYYY-MM-DD). */
export const todayIso = (): string => new Date().toISOString().slice(0, 10)

/** The reply to the apply question, as the commit reads it: yes, cancel, or neither. */
export function applyAnswer(reply: string): 'yes' | 'cancel' | null {
  const t = reply.trim().toLowerCase().replace(/ \(recommended\)$/, '').trim()
  return t === 'yes' ? 'yes' : t === 'cancel' ? 'cancel' : null
}
