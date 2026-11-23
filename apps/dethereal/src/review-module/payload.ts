/**
 * A review's proposals as the review workspace takes them, and the lines the operator is shown before they go.
 * Pure: no I/O. The review workspace's publish refuses a whole call for one field it does not take, so every group
 * and finding it would refuse is left out here, each with its reason, and never sent.
 */
import type { ExposureState } from '../triage/exposures.js'
import { PICKABLE_KINDS, type Review, type ReviewGroup } from '../triage/review.js'
import { shown } from '../triage/text.js'

/** The platform's disposition kinds: a finding whose kind is none of these cannot carry its base. */
const PLATFORM_KINDS: ReadonlySet<string> = new Set(['NOT_APPLICABLE', 'FALSE_POSITIVE', 'COMPENSATING_CONTROL', 'RISK_ACCEPTED', 'WAIVED', 'SUPERSEDED', 'AFFIRMED'])

/** The workspace's own words for a kind, as a person sees them there. */
export const KIND_LABEL: Record<string, string> = {
  AFFIRMED: 'Affirmed',
  NOT_APPLICABLE: 'Not applicable',
  FALSE_POSITIVE: 'False positive',
  COMPENSATING_CONTROL: 'Compensating control',
  RISK_ACCEPTED: 'Risk accepted',
  WAIVED: 'Waived',
  SUPERSEDED: 'Superseded',
}

/** The window after open within which fingerprints read later than open still stand for the review's state. */
export const LATE_FINGERPRINT_MS = 30 * 60 * 1000

export interface PayloadFinding {
  exposureId: string
  baseKind: string | null
  baseAt: string | null
  fingerprint?: string
  fpVersion?: number
}
export interface PayloadGroup {
  groupId: string
  proposal?: Record<string, unknown>
  needsHuman: boolean
  perRowOnly: boolean
  ambiguity?: string
  findings: PayloadFinding[]
}
export interface LeftOut {
  group: number
  exposure_id?: string
  why: string
}
export interface Built {
  groups: PayloadGroup[]
  left: LeftOut[]
}

export interface BuildInput {
  review: Review
  /** The findings that changed since the review: never sent */
  drifted: ReadonlySet<string>
  /** True when the fingerprints were read past the window after open: every dispose goes for a person to decide, and no edited copy goes */
  late: boolean
}

const copyFields = ['name', 'description', 'score', 'attackVector', 'category'] as const

/** The proposal as the workspace takes it, for one group: kind and reason only on a dispose, the edits on a supersede. */
function proposalOf(g: ReviewGroup): Record<string, unknown> | undefined {
  const p = g.proposal
  if (!p) return undefined
  const out: Record<string, unknown> = { op: p.op }
  if (p.op === 'dispose') {
    out.kind = p.kind
    out.reason = p.reason
  }
  if (p.op === 'supersede' && p.modifications) {
    const m: Record<string, unknown> = {}
    for (const k of copyFields) if (p.modifications[k] !== undefined) m[k] = p.modifications[k]
    if (p.modifications.techniques) m.techniques = { add: [...p.modifications.techniques.add], remove: [...p.modifications.techniques.remove] }
    out.modifications = m
  }
  if (p.confidence) out.confidence = p.confidence
  if (p.citations?.length) out.citations = [...p.citations]
  if (p.objection !== undefined) out.objection = p.objection
  return out
}

/** The review's groups as the workspace takes them, the fingerprints still to fill in; what is left out, with why. */
export function buildPublish({ review, drifted, late }: BuildInput): Built {
  const groups: PayloadGroup[] = []
  const left: LeftOut[] = []
  for (const g of review.groups.values()) {
    const p = g.proposal
    if (p?.op === 'supersede' && late) {
      left.push({ group: g.group, why: 'an edited copy goes only within 30 minutes of opening the review: open a new review to send it' })
      continue
    }
    if (review.mode === 'stale' && p?.op === 'reaffirm' && g.stale_superseded) {
      left.push({ group: g.group, why: 'a superseded finding is cleared or decided by a person, never reaffirmed' })
      continue
    }
    const findings: PayloadFinding[] = []
    for (const id of g.exposure_ids) {
      if (drifted.has(id)) {
        left.push({ group: g.group, exposure_id: id, why: 'changed since the review: open a new review to judge it again' })
        continue
      }
      const seen = review.seen.get(id)
      const kind = seen?.disposition_kind ?? null
      const at = seen?.dispositioned_at ?? null
      // the workspace takes a base as a kind and its time together, or neither
      if ((kind !== null && (!PLATFORM_KINDS.has(kind) || at === null)) || (kind === null && at !== null)) {
        left.push({ group: g.group, exposure_id: id, why: 'its current decision is one the workspace cannot carry' })
        continue
      }
      if (p?.op === 'reaffirm' && !(PICKABLE_KINDS as readonly (string | null)[]).includes(kind)) {
        left.push({ group: g.group, exposure_id: id, why: 'only a decision a person picked is reaffirmed' })
        continue
      }
      if (p?.op === 'clear' && kind === null) {
        left.push({ group: g.group, exposure_id: id, why: 'it has no decision to clear' })
        continue
      }
      findings.push({ exposureId: id, baseKind: kind, baseAt: at })
    }
    if (!findings.length) continue
    const proposal = proposalOf(g)
    // a group with no proposal is a person's; a late dispose is too; an edited copy never is (the workspace refuses it)
    const needsHuman = !proposal || (proposal.op !== 'supersede' && (g.needs_human === true || late))
    groups.push({
      groupId: String(g.group),
      ...(proposal ? { proposal } : {}),
      needsHuman,
      perRowOnly: g.per_row_only === true,
      ...(g.ambiguity !== undefined ? { ambiguity: g.ambiguity } : {}),
      findings,
    })
  }
  return { groups, left }
}

/** Fill in each finding's fingerprint; a finding the module answers gone, or none for, is left out. */
export function withFingerprints(built: Built, states: Map<string, { fingerprint: string; fpVersion: number }>): Built {
  const left = [...built.left]
  const groups: PayloadGroup[] = []
  for (const g of built.groups) {
    const findings: PayloadFinding[] = []
    for (const f of g.findings) {
      const s = states.get(f.exposureId)
      if (!s) left.push({ group: Number(g.groupId), exposure_id: f.exposureId, why: 'no longer in the model' })
      else findings.push({ ...f, fingerprint: s.fingerprint, fpVersion: s.fpVersion })
    }
    if (findings.length) groups.push({ ...g, findings })
  }
  return { groups, left }
}

/** The payload the workspace's publish takes: the review id, and the groups. */
export const payloadOf = (reviewId: string, built: Built): string => JSON.stringify({ reviewId, groups: built.groups })

/** What each answer for a finding not stored means, in the operator's words: the publish and the read-back say it alike. */
export const NOT_STORED_WORDS: Record<string, string> = {
  rejected: 'a person rejected this proposal and the finding has not changed',
  already_decided: 'a person already decided it',
  changed_since_review: 'someone decided it after the review (in the platform or the workspace), so the proposal no longer applies',
  finding_not_found: 'it is no longer in the model',
}

/** A count and its noun, singular when it is one. */
export const counted = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** A text as a line shows it: cut, a quote or a backslash escaped, so no text can open or close a line's quotes. */
const plain = (t: string, max?: number) => shown(t, max).replace(/["\\]/g, '\\$&')
const quoted = (t: string, max?: number) => `"${plain(t, max)}"`
const NAME_MAX = 160

/** What a group proposes, in the workspace's words: a proposal, never a decision. */
export function askedFor(g: PayloadGroup): string {
  const p = g.proposal
  if (!p) return 'no proposal, for a person to decide'
  const flagged = g.needsHuman ? ', flagged for a person' : ''
  if (p.op === 'dispose') return `proposes ${KIND_LABEL[p.kind as string] ?? String(p.kind)}${flagged}`
  if (p.op === 'reaffirm') return `proposes to reaffirm the decision${flagged}`
  if (p.op === 'clear') return `proposes to clear the decision${flagged}`
  return 'proposes an edited copy'
}

export interface EchoContext {
  modelName: string
  /** The analysis the proposals go to, or null when the publish creates the model's Triage analysis */
  analysisId: string | null
  /** Proposals already waiting on these findings, from an earlier publish; null when they could not be counted */
  pending: number | null
  /** The fingerprints were read past the window after open */
  late: boolean
}

/** A supersede's changes, each with what it replaces, as the disposition echo shows them. */
function copyChanges(review: Review, exposureId: string, m: Record<string, unknown>): string[] {
  const e = review.evidence.get(exposureId)
  const was = (v: string | number | null | undefined) => (v === null || v === undefined ? 'none' : typeof v === 'number' ? String(v) : quoted(v, NAME_MAX))
  const out: string[] = []
  if (typeof m.name === 'string') out.push(`name ${quoted(m.name)}`)
  if (typeof m.description === 'string') out.push(`description ${was(e?.description)} → ${quoted(m.description)}`)
  if (typeof m.score === 'number') out.push(`score ${was(e?.score)} → ${m.score}`)
  if (typeof m.attackVector === 'string') out.push(`attack vector ${was(e?.attack_vector)} → ${quoted(m.attackVector)}`)
  if (typeof m.category === 'string') out.push(`category ${was(e?.category)} → ${quoted(m.category)}`)
  const t = m.techniques as { add?: string[]; remove?: string[] } | undefined
  if (t?.add?.length) out.push(`techniques added ${t.add.map((x) => plain(x)).join(', ')}`)
  if (t?.remove?.length) out.push(`techniques removed ${t.remove.map((x) => plain(x)).join(', ')}`)
  return out
}

/** The lines the operator is shown before a publish: every group's text, what is not sent and why, where they go. */
export function publishLines(review: Review, built: Built, ctx: EchoContext): string[] {
  const lines: string[] = []
  const findings = built.groups.reduce((n, g) => n + g.findings.length, 0)
  const counts = new Map<string, number>()
  for (const g of built.groups) counts.set(askedFor(g), (counts.get(askedFor(g)) ?? 0) + g.findings.length)
  const byKind = [...counts].map(([what, n]) => `${n} ${what}`).join(' · ')
  lines.push(`Publish ${counted(built.groups.length, 'group')} (${counted(findings, 'finding')}) to the Triage workspace of ${quoted(ctx.modelName, NAME_MAX)}, under your name, with the reasons as Dethereal's analysts drafted them. Findings: ${byKind}.`)
  if (ctx.pending === null) lines.push('The proposals still waiting there could not be counted; this publish replaces any that are.')
  else if (ctx.pending > 0) lines.push(`It replaces ${counted(ctx.pending, 'proposal')} still waiting there from an earlier publish (yours or another person's).`)
  if (ctx.late) lines.push('More than 30 minutes have passed since the review opened: every proposal goes flagged for a person, so the workspace shows no Accept and each is decided with Edit or Reject; no edited copy is sent. To avoid this, cancel and run triage again.')
  for (const g of built.groups) {
    const p = g.proposal
    const names = g.findings.map((f) => {
      const s: ExposureState | undefined = review.seen.get(f.exposureId)
      return s ? `${quoted(s.name, NAME_MAX)} on ${quoted(s.element_name, NAME_MAX)} #…${plain(f.exposureId.slice(-8))}` : `#${plain(f.exposureId)}`
    })
    lines.push(`Group ${g.groupId}: ${askedFor(g)}${g.perRowOnly ? ', one at a time' : ''} — ${names.join('; ')}`)
    if (typeof p?.reason === 'string') lines.push(`  Reason: ${quoted(p.reason)}`)
    if (p?.op === 'supersede' && p.modifications) lines.push(`  The copy: ${copyChanges(review, g.findings[0]!.exposureId, p.modifications as Record<string, unknown>).join('; ')}`)
    if (typeof p?.confidence === 'string') lines.push(`  Analyst confidence: ${p.confidence} (an AI estimate, not a verdict)`)
    if (typeof p?.objection === 'string') lines.push(`  Objection: ${quoted(p.objection)}`)
    if (g.ambiguity !== undefined) lines.push(`  What a person must weigh: ${quoted(g.ambiguity)}`)
    if (Array.isArray(p?.citations) && p.citations.length) lines.push(`  Citations: ${(p.citations as string[]).map((c) => plain(c)).join(', ')}`)
  }
  if (built.left.length) {
    lines.push(`Not sent (${counted(built.left.length, 'item')}):`)
    for (const l of built.left) {
      const s = l.exposure_id ? review.seen.get(l.exposure_id) : undefined
      lines.push(`  Group ${l.group}${l.exposure_id ? ` ${s ? quoted(s.name, NAME_MAX) : `#${plain(l.exposure_id)}`}` : ''}: ${l.why}`)
    }
  }
  lines.push(ctx.analysisId ? `To the model's Triage analysis ${plain(ctx.analysisId)}.` : "Creates the model's Triage analysis on the platform (none exists yet).")
  lines.push("Sent with each: the reason as drafted, the analyst's confidence, the objection and what to weigh, an edited copy's fields, the citations (file and line locators, no repository text), and the state it was judged on. No disposition is written.")
  return lines
}
