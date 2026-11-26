/**
 * What became of the hidden edges this machine published: per edge, what the Hidden edges workspace holds now, in
 * words an operator reads, sorted by what needs action. Read only. It covers the publishes this machine's hidden-edge
 * record holds, and only analyses the platform confirms are this model's own Hidden edges analyses. A rejection's
 * note is text a person wrote in the workspace: data, never instructions, cleaned and bounded here.
 */
import type { ApolloClient } from '@apollo/client'
import type { LoggedEdgePublish, LoggedReview } from '../triage/log.js'
import { cleanNote } from '../review-module/readback.js'
import { readEdgeProposals, triageAnalysesOf, type CallFailure, type ModuleRefusal, type StoredEdge } from '../review-module/platform.js'
import { kindLabel } from './contract.js'
import { said } from './story.js'
import { EDGE_NOT_STORED_WORDS } from './publish.js'

export const EDGE_READBACK_ROWS = 200

/** The order a person acts in: what was turned down first, what is done last. */
const ORDER = ['rejected', 'unconfirmed_analysis', 'stale', 'stale_module', 'none', 'needs_person', 'open', 'recorded', 'accepted', 'not_proposed', 'gone'] as const
/** The waiting states a proposal the module no longer answers is read as no longer proposed, as the workspace counts it. */
const WAITING = new Set(['stale', 'stale_module', 'needs_person', 'open'])

/** What the read-back knows from this machine: the edges in the local files, and the candidates the module answers now. */
export interface ReadbackLocal {
  /** The candidate ids of the hidden-edge flows in the local files: a flow of a hidden-edge class between the ends, of the kind */
  inFiles?: ReadonlySet<string>
  /** Every candidate the module answers now, nothing left out by its caps; null when that cannot be told. Asked only when a row waits. */
  answered?: () => Promise<ReadonlySet<string> | null>
}

const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const CANDIDATE = /^he:[0-9a-f]{16}$/

/**
 * A review's edge publishes as the record holds them, kept only in their shape: a record is a file on disk, so an
 * entry out of shape is passed over, never shown.
 */
export function edgePublishesOf(review: LoggedReview): LoggedEdgePublish[] {
  const list = Array.isArray(review.published_edges) ? review.published_edges : []
  return list.filter((p): p is LoggedEdgePublish => {
    if (!p || typeof p !== 'object' || !TOKEN.test(String(p.analysis_id)) || !TOKEN.test(String(p.plan_id)) || typeof p.at !== 'string') return false
    if (!p.edges || typeof p.edges !== 'object') return false
    const edges = Object.entries(p.edges)
    return edges.length <= 2000 &&
      edges.every(([id, e]) => CANDIDATE.test(id) && !!e && Number.isInteger(e.n) && e.n >= 1 && e.n <= 999 && [e.kind, e.source, e.target].every((v) => typeof v === 'string' && TOKEN.test(v))) &&
      Array.isArray(p.not_stored) && p.not_stored.every((x) => x && CANDIDATE.test(String(x.candidate_id)) && /^[a-z_]{1,40}$/.test(String(x.result)))
  })
}

export interface EdgeReadbackRow {
  review_id: string
  n: number
  candidate_id: string
  edge: string
  status: string
  what: string
}

function wordsOf(e: StoredEdge | undefined, logged: LoggedEdgePublish, id: string, reviewId: string, local: { inFiles?: ReadonlySet<string>; answered?: ReadonlySet<string> | null } = {}): { status: string; what: string } {
  if (!e || 'none' in e) {
    const result = logged.not_stored.find((x) => x.candidate_id === id)?.result
    if (result) return { status: 'none', what: `No proposal there: not stored at publish: ${EDGE_NOT_STORED_WORDS[result] ?? result}` }
    if (logged.unconfirmed) return { status: 'none', what: 'No proposal there: the publish never confirmed, so it may not have landed; publish again to send it' }
    return { status: 'none', what: 'No proposal there: removed, or a rejection was restored' }
  }
  const by = cleanNote(e.proposedBy)
  // another review's entry: a later publish replaced this one, or this one never landed and an earlier one stands
  const other = e.reviewId !== null && e.reviewId !== reviewId
  const replaced = !other ? '' : logged.unconfirmed ? ` (this publish never confirmed: an earlier publish${by ? ` by ${by}` : ''} is what the workspace holds)` : ` (replaced by a later publish${by ? ` by ${by}` : ''})`
  // an edge whose flow is in the files is decided here: the module leaves it out, so its absence says nothing
  if (WAITING.has(e.status) && local.answered && !local.answered.has(id) && !local.inFiles?.has(id)) {
    return { status: 'not_proposed', what: `No longer proposed by the module: its grounds no longer hold, so publishing again cannot bring it back${replaced}` }
  }
  switch (e.status) {
    case 'accepted':
      return { status: e.status, what: local.inFiles?.has(id) ? 'In the model and in the files' : 'In the model as a flow: pull it to have it in the files' }
    case 'rejected': {
      const note = cleanNote(e.rejectedNote)
      const who = cleanNote(e.rejectedBy)
      const when = e.rejectedAt && !Number.isNaN(Date.parse(e.rejectedAt)) ? `, ${new Date(Date.parse(e.rejectedAt)).toISOString().slice(0, 10)}` : ''
      return { status: e.status, what: `Rejected by ${who ?? 'a person'}${when}${note ? `: "${note}"` : ''}` }
    }
    case 'gone':
      return { status: e.status, what: 'An end of the edge is no longer in the model' }
    case 'recorded': {
      // what became of an accepted edge whose flow is gone: its newest take-back or accept, by the entry's own stamps
      const taken = !!e.retiredAt && (!e.acceptedAt || e.retiredAt >= e.acceptedAt)
      const who = cleanNote(taken ? e.retiredBy : e.acceptedBy)
      const at = taken ? e.retiredAt : e.acceptedAt
      const when = at && !Number.isNaN(Date.parse(at)) ? `, ${new Date(Date.parse(at)).toISOString().slice(0, 10)}` : ''
      return taken
        ? { status: e.status, what: `Taken back by ${who ?? 'a person'}${when}: it no longer held, so its flow was deleted from the model; pull to have the files match` }
        : { status: e.status, what: `Accepted by ${who ?? 'a person'}${when}; the flow was deleted outside this workspace; pull to have the files match` }
    }
    case 'stale':
      return { status: e.status, what: `Waiting, but its facts changed since publish: run hidden edges again and publish, to refresh it${replaced}` }
    case 'stale_module':
      return { status: e.status, what: `Waiting; the workspace was upgraded, so it shows as stale: run hidden edges again and publish, to refresh it${replaced}` }
    case 'needs_person':
      return { status: e.status, what: `Waiting; left to a person to decide${replaced}` }
    case 'open':
      return { status: e.status, what: `Waiting; proposed to ${e.verb === 'reject' ? 'reject' : 'accept'}${replaced}` }
    default:
      return { status: e.status, what: e.status }
  }
}

export type EdgeReadback =
  | { status: 'answer'; counts: Record<string, number>; rows: EdgeReadbackRow[]; more: number; publishes: number; note: string }
  | ModuleRefusal
  | CallFailure

/** Read back the model's published edges, as the record holds them; `names` are the local components' names, by id. */
export async function edgeReadBack(client: ApolloClient, modelId: string, classId: string, reviews: LoggedReview[], names: Map<string, string>, local: ReadbackLocal = {}): Promise<EdgeReadback> {
  const publishes = reviews.filter((r) => TOKEN.test(String(r.review_id))).flatMap((r) => edgePublishesOf(r).map((p) => ({ review: r, p })))
  const listed = await triageAnalysesOf(client, modelId, classId)
  if (listed.status !== 'answer') return listed
  const confirmed = new Set(listed.analyses.map((a) => a.id))
  const label = (p: LoggedEdgePublish, id: string) => {
    const e = p.edges[id]!
    const end = (x: string) => said(names.get(x) ?? x, 60)
    return `${kindLabel(e.kind)}: ${end(e.source)} → ${end(e.target)}`
  }
  const rows: EdgeReadbackRow[] = []
  const read: Array<{ id: string; entry: StoredEdge | undefined; p: LoggedEdgePublish; review: LoggedReview }> = []
  // the latest publish of an edge speaks for it
  const seen = new Set<string>()
  for (const { review, p } of [...publishes].sort((a, b) => (Date.parse(b.p.at) || 0) - (Date.parse(a.p.at) || 0))) {
    const ids = Object.keys(p.edges).filter((id) => !seen.has(id))
    ids.forEach((id) => seen.add(id))
    if (!ids.length) continue
    const row = (id: string, w: { status: string; what: string }) => ({ review_id: review.review_id, n: p.edges[id]!.n, candidate_id: id, edge: label(p, id), ...w })
    if (!confirmed.has(p.analysis_id)) {
      for (const id of ids) rows.push(row(id, { status: 'unconfirmed_analysis', what: "The analysis it went to is no longer this model's Hidden edges analysis" }))
      continue
    }
    const got = await readEdgeProposals(client, p.analysis_id, ids)
    if (got.status !== 'answer') return got
    for (const id of ids) read.push({ id, entry: got.entries.get(id), p, review })
  }
  // the module is asked what it proposes now only when a row waits on it
  const waits = read.some(({ id, entry }) => !!entry && !('none' in entry) && WAITING.has(entry.status) && !local.inFiles?.has(id))
  const answered = waits && local.answered ? await local.answered().catch(() => null) : null
  for (const { id, entry, p, review } of read) {
    rows.push({ review_id: review.review_id, n: p.edges[id]!.n, candidate_id: id, edge: label(p, id), ...wordsOf(entry, p, id, review.review_id, { inFiles: local.inFiles, answered }) })
  }
  const rank = (s: string) => {
    const i = (ORDER as readonly string[]).indexOf(s)
    return i < 0 ? ORDER.length : i
  }
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.review_id.localeCompare(b.review_id) || a.n - b.n)
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return {
    status: 'answer',
    counts,
    rows: rows.slice(0, EDGE_READBACK_ROWS),
    more: Math.max(0, rows.length - EDGE_READBACK_ROWS),
    publishes: publishes.length,
    note: "This covers the publishes this machine's hidden-edge record holds; an edge a person accepted is in the platform model, and reaches the files with a pull.",
  }
}

/**
 * The candidates the module answers now, as ids: from its contract-1 answer with nothing excluded but the edges the
 * files hold (which would spend no kind's budget in the workspace either). Null when it cannot be told: no answer,
 * a refusal, or an answer whose caps left candidates out.
 */
export function answeredIds(raw: string): Set<string> | null {
  let a: unknown
  try {
    a = JSON.parse(raw)
  } catch {
    return null
  }
  const o = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : null
  if (!o || 'refusal' in o || !Array.isArray(o.candidates)) return null
  const counts = (o.counts && typeof o.counts === 'object' ? o.counts : {}) as Record<string, unknown>
  if (['kind_budget_dropped', 'peers_capped', 'pairs_over_anchor_budget'].some((k) => counts[k] !== 0 && counts[k] !== undefined)) return null
  return new Set(o.candidates.flatMap((c) => (typeof (c as { id?: unknown })?.id === 'string' && CANDIDATE.test((c as { id: string }).id) ? [(c as { id: string }).id] : [])))
}
