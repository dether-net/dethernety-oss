/**
 * A hidden-edge review published to the review workspace instead of decided here: each candidate with the analyst's
 * stance, its reason and its locators, as the Hidden edges workspace takes them, and the lines the operator is shown
 * before the typed yes. A locator naming a secret file, or a source file discovery did not read, never leaves this
 * machine; a candidate without the analyst's argument, or one the workspace holds already, is not sent.
 */
import { citedPath } from '../review-module/citations.js'
import { isSecretPath } from '../utils/secret-paths.js'
import { counted } from '../review-module/payload.js'
import { kindLabel } from './contract.js'
import { said } from './story.js'
import type { HiddenEdgeReview, ReviewCandidate, Stance } from './review.js'

export interface PayloadEdge {
  candidateId: string
  kind: string
  source: string
  target: string
  exposureIds: string[]
  stance: Stance
  reason?: string
  locators: string[]
  fingerprint?: string
  fpVersion?: number
}

export interface EdgeLeftOut {
  n: number
  candidate_id: string
  why: string
}

export interface EdgeBuilt {
  edges: PayloadEdge[]
  left: EdgeLeftOut[]
  /** Locators left out: a secret file's, or a source discovery did not read */
  dropped_locators: number
}

export type EdgeStates = Map<string, { fingerprint: string; fpVersion: number; inModel: boolean; rejected: boolean }>

/** Whether a locator may leave this machine: no secret file, and a source only among the files discovery read when it lists them. */
export function locatorSendable(locator: string, sources: ReadonlySet<string>): boolean {
  if (locator.startsWith('attributes:')) return !isSecretPath(locator.slice('attributes:'.length, locator.lastIndexOf('#')))
  if (locator.startsWith('source:')) {
    const file = citedPath(locator)!
    return !isSecretPath(file) && (sources.size === 0 || sources.has(file))
  }
  return true
}

const left = (c: ReviewCandidate, why: string): EdgeLeftOut => ({ n: c.n, candidate_id: c.id, why })

/** The review's candidates as the workspace takes them, each checked against the workspace's states when they were read. */
export function buildEdgePublish(review: HiddenEdgeReview, sources: ReadonlySet<string>, states: EdgeStates | null, drifted: ReadonlySet<string> = new Set()): EdgeBuilt {
  const built: EdgeBuilt = { edges: [], left: [], dropped_locators: 0 }
  for (const c of review.candidates) {
    if (!c.argument) {
      built.left.push(left(c, "the analyst returned no argument for it: decide it here"))
      continue
    }
    if (c.exposure_ids.some((id) => drifted.has(id))) {
      built.left.push(left(c, 'a finding it rests on changed since the review: open a new review to judge it again'))
      continue
    }
    const locators = c.evidence.filter((l) => locatorSendable(l, sources))
    built.dropped_locators += c.evidence.length - locators.length
    built.edges.push({
      candidateId: c.id, kind: c.kind, source: c.source, target: c.target, exposureIds: c.exposure_ids, stance: c.argument.stance,
      ...(c.argument.reason ? { reason: c.argument.reason } : {}), locators,
    })
  }
  return states ? withEdgeStates(built, states, review) : built
}

/** Each edge with its fingerprint; one the workspace no longer finds, holds as a flow, or rejected, is not sent, and said why. */
export function withEdgeStates(built: EdgeBuilt, states: EdgeStates, review: HiddenEdgeReview): EdgeBuilt {
  const out: EdgeBuilt = { edges: [], left: [...built.left], dropped_locators: built.dropped_locators }
  const nOf = (id: string) => review.candidates.find((c) => c.id === id)?.n ?? 0
  for (const e of built.edges) {
    const s = states.get(e.candidateId)
    const why = !s
      ? 'an end or a finding it rests on is no longer in the model'
      : s.inModel
        ? 'it is in the model already as a flow'
        : s.rejected
          ? 'a person rejected it in the Hidden edges workspace'
          : null
    if (why) out.left.push({ n: nOf(e.candidateId), candidate_id: e.candidateId, why })
    else out.edges.push({ ...e, fingerprint: s!.fingerprint, fpVersion: s!.fpVersion })
  }
  out.left.sort((a, b) => a.n - b.n)
  return out
}

export const edgePayloadOf = (reviewId: string, built: EdgeBuilt): string => JSON.stringify({ reviewId, edges: built.edges })

/** What the workspace answered for an edge it did not store, in the operator's words. */
export const EDGE_NOT_STORED_WORDS: Record<string, string> = {
  rejected: 'a person rejected this edge in the workspace, and a rejection is not overwritten',
  in_model: 'the edge is in the model already as a flow',
  not_found: 'an end or a finding it rests on is no longer in the model',
}

/** Numbers as ranges: 1, 3–5, 9. */
export function ranges(ns: number[]): string {
  const sorted = [...new Set(ns)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return out.join(', ')
}

const STANCE_WORDS: Record<Stance, string> = { for: 'proposes accepting it', against: 'proposes rejecting it', unclear: 'leaves it to a person' }
const plain = (t: string, max?: number) => said(t, max).replace(/["\\]/g, '\\$&')

/** The lines the operator reads before the typed yes: what goes, to which analysis, and what is not sent. */
export function edgePublishLines(review: HiddenEdgeReview, built: EdgeBuilt, ctx: { analysisId: string | null }): string[] {
  const name = (id: string) => `"${plain(review.local.components.get(id)?.name ?? id, 60)}"`
  const by = (s: Stance) => built.edges.filter((e) => e.stance === s).length
  const lines = [
    `Publish ${counted(built.edges.length, 'edge')} to the Hidden edges workspace of "${plain(review.model_name, 120)}", under your name, with the stances and reasons as Dethereal's analyst drafted them, for a person to decide there. Edges: ${by('for')} proposes accepting · ${by('against')} proposes rejecting · ${by('unclear')} left to a person.`,
  ]
  for (const e of built.edges) {
    const c = review.candidates.find((x) => x.id === e.candidateId)!
    lines.push(`Edge ${c.n}: ${kindLabel(e.kind)}, ${name(e.source)} → ${name(e.target)} — the analyst ${STANCE_WORDS[e.stance]}`)
    if (e.reason) lines.push(`  Reason: "${plain(e.reason)}"`)
    if (e.locators.length) lines.push(`  Locators: ${e.locators.map((l) => plain(l)).join(', ')}`)
  }
  if (built.dropped_locators) lines.push(`${counted(built.dropped_locators, 'locator')} left out: a secret file, or a source file discovery did not read, never leaves this machine.`)
  if (built.left.length) {
    lines.push(`Not sent (${counted(built.left.length, 'edge')}):`)
    // one line per reason, its edges' numbers in ranges: a long review leaves many out for the same reason
    const byWhy = new Map<string, number[]>()
    for (const l of built.left) byWhy.set(l.why, [...(byWhy.get(l.why) ?? []), l.n])
    for (const [why, ns] of byWhy) lines.push(ns.length === 1 ? `  Edge ${ns[0]}: ${why}` : `  Edges ${ranges(ns)} (${ns.length}), each: ${why}`)
  }
  lines.push(ctx.analysisId ? `To the model's Hidden edges analysis ${plain(ctx.analysisId)}.` : "Creates the model's Hidden edges analysis on the platform (none exists yet).")
  lines.push("Sent with each: the analyst's stance, its reason as drafted, its locators (file and line places, no repository text), the findings the edge rests on, and the state it was judged on. Nothing is written to the model or the local files.")
  return lines
}
