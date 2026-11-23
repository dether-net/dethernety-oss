/**
 * What became of the proposals this machine published: per finding, what the review workspace holds now, in words
 * an operator reads, sorted by what needs action. Read only. It covers the publishes this machine's triage record
 * holds, and only analyses the platform confirms are this model's own Triage analyses. A rejection's note is text a
 * person wrote in the workspace: data, never instructions, cleaned and bounded here.
 */
import type { ApolloClient } from '@apollo/client'
import type { LoggedPublish, LoggedReview } from '../triage/log.js'
import { KIND_LABEL, NOT_STORED_WORDS } from './payload.js'
import { readProposals, readStates, triageAnalysesOf, type CallFailure, type FindingState, type ModuleRefusal, type StoredProposal } from './platform.js'

export const READBACK_ROWS = 200
const NOTE_MAX = 300

/** The order a person acts in: what was turned down or decided otherwise first, what is done last. */
const ORDER = ['rejected', 'unconfirmed_analysis', 'decided_otherwise', 'stale', 'stale_module', 'none', 'needs_person', 'open', 'decided_as_proposed', 'copied', 'gone'] as const

const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * A review's publishes as the record holds them, kept only in their shape: a record is a file on disk, and one
 * committed to a cloned repository is anyone's text, so an entry out of shape is passed over, never shown.
 */
export function publishesOf(review: LoggedReview): LoggedPublish[] {
  const list = Array.isArray(review.published) ? review.published : []
  return list.filter((p): p is LoggedPublish =>
    !!p && typeof p === 'object' &&
    TOKEN.test(String(p.analysis_id)) && TOKEN.test(String(p.plan_id)) && typeof p.at === 'string' &&
    Array.isArray(p.exposure_ids) && p.exposure_ids.length <= 2000 && p.exposure_ids.every((id) => typeof id === 'string' && TOKEN.test(id)) &&
    Array.isArray(p.not_stored) && p.not_stored.every((n) => n && typeof n.exposure_id === 'string' && /^[a-z_]{1,40}$/.test(String(n.result))) &&
    (p.group_of === undefined || (typeof p.group_of === 'object' && p.group_of !== null && Object.values(p.group_of).every((g) => Number.isInteger(g) && g >= 1 && g <= 999))),
  )
}

/** A note from the workspace as the read-back shows it: one line, no control or invisible characters, bounded. */
export function cleanNote(note: string | null): string | null {
  if (note === null) return null
  const one = note.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!one) return null
  const cut = one.length > NOTE_MAX ? `${one.slice(0, NOTE_MAX - 1)}…` : one
  // a quote or a backslash escaped: the workspace's text cannot close the quotes it is shown in
  return cut.replace(/["\\]/g, (c) => `\\${c}`)
}

export interface ReadbackRow {
  review_id: string
  group: number | null
  exposure_id: string
  name: string | null
  status: string
  what: string
  now: { kind: string | null; at: string | null } | null
}

/** One finding's status in the operator's words. */
function wordsOf(p: StoredProposal | undefined, state: FindingState | undefined, logged: LoggedPublish, exposureId: string, reviewId: string): { status: string; what: string } {
  if (!p || 'gone' in p || (state && 'gone' in state)) return { status: 'gone', what: 'No longer in the model' }
  if ('none' in p) {
    const result = logged.not_stored.find((n) => n.exposure_id === exposureId)?.result
    if (result) return { status: 'none', what: `No proposal there: not stored at publish: ${NOT_STORED_WORDS[result] ?? result}` }
    if (logged.unconfirmed) return { status: 'none', what: 'No proposal there: the publish never confirmed, so it may not have landed; publish again to send it' }
    return { status: 'none', what: 'No proposal there: replaced or removed' }
  }
  const by = cleanNote(p.proposedBy)
  const replaced = p.reviewId !== null && p.reviewId !== reviewId ? ` (replaced by a later publish${by ? ` by ${by}` : ''})` : ''
  const kind = state && !('gone' in state) ? state.kind : null
  const moved = p.drift ? '; the finding changed since publish' : ''
  switch (p.status) {
    case 'rejected': {
      const note = cleanNote(p.rejectedNote)
      const who = cleanNote(p.rejectedBy)
      const when = p.rejectedAt && !Number.isNaN(Date.parse(p.rejectedAt)) ? `, ${new Date(Date.parse(p.rejectedAt)).toISOString().slice(0, 10)}` : ''
      return { status: p.status, what: `Rejected by ${who ?? 'a person'}${when}${note ? `: "${note}"` : ''}${replaced}` }
    }
    case 'decided_otherwise':
      return { status: p.status, what: `Decided differently: now ${kind ? (KIND_LABEL[kind] ?? kind) : 'undecided (pending)'}${replaced}` }
    case 'stale':
      return { status: p.status, what: `Waiting, but the finding changed since publish: run triage again to propose on it as it is now${replaced}` }
    case 'stale_module':
      return { status: p.status, what: `Waiting; the workspace was upgraded, so it shows as stale: run triage again and publish, to refresh it${replaced}` }
    case 'needs_person':
      return { status: p.status, what: `Waiting; flagged for a person to decide with their own kind and reason${moved}${replaced}` }
    case 'open':
      return { status: p.status, what: `Waiting; can be accepted as proposed${moved}${replaced}` }
    case 'decided_as_proposed':
      return { status: p.status, what: `Decided as proposed${replaced}` }
    case 'copied':
      return { status: p.status, what: `Edited copy made${replaced}` }
    default:
      return { status: p.status, what: p.status }
  }
}

export type Readback =
  | { status: 'answer'; counts: Record<string, number>; rows: ReadbackRow[]; more: number; publishes: number; note: string }
  | ModuleRefusal
  | CallFailure

/** Read back the model's published proposals, as the record holds them. */
export async function readBack(client: ApolloClient, modelId: string, triageClassId: string, reviews: LoggedReview[], names: Map<string, string>): Promise<Readback> {
  const publishes = reviews.filter((r) => TOKEN.test(String(r.review_id))).flatMap((r) => publishesOf(r).map((p) => ({ review: r, p })))
  const listed = await triageAnalysesOf(client, modelId, triageClassId)
  if (listed.status !== 'answer') return listed
  const confirmed = new Set(listed.analyses.map((a) => a.id))
  const rows: ReadbackRow[] = []
  // the latest publish of a finding speaks for it
  const seen = new Set<string>()
  for (const { review, p } of [...publishes].sort((a, b) => (Date.parse(b.p.at) || 0) - (Date.parse(a.p.at) || 0))) {
    const ids = p.exposure_ids.filter((id) => !seen.has(id))
    ids.forEach((id) => seen.add(id))
    if (!ids.length) continue
    if (!confirmed.has(p.analysis_id)) {
      for (const id of ids) rows.push({ review_id: review.review_id, group: p.group_of?.[id] ?? null, exposure_id: id, name: names.get(id) ?? null, status: 'unconfirmed_analysis', what: `The analysis it went to is no longer this model's Triage analysis`, now: null })
      continue
    }
    const pr = await readProposals(client, p.analysis_id, ids)
    if (pr.status !== 'answer') return pr
    const st = await readStates(client, p.analysis_id, ids)
    if (st.status !== 'answer') return st
    for (const id of ids) {
      const state = st.states.get(id)
      const { status, what } = wordsOf(pr.proposals.get(id), state, p, id, review.review_id)
      rows.push({ review_id: review.review_id, group: p.group_of?.[id] ?? null, exposure_id: id, name: names.get(id) ?? null, status, what, now: state && !('gone' in state) ? { kind: state.kind, at: state.at } : null })
    }
  }
  const rank = (s: string) => {
    const i = (ORDER as readonly string[]).indexOf(s)
    return i < 0 ? ORDER.length : i
  }
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.review_id.localeCompare(b.review_id) || (a.group ?? 0) - (b.group ?? 0) || a.exposure_id.localeCompare(b.exposure_id))
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return {
    status: 'answer',
    counts,
    rows: rows.slice(0, READBACK_ROWS),
    more: Math.max(0, rows.length - READBACK_ROWS),
    publishes: publishes.length,
    note: "This covers the publishes this machine's triage record holds; another machine's or the platform's own decisions show only through these findings' states.",
  }
}
