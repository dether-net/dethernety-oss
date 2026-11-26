/**
 * What a closed hidden-edge review writes, planned and written.
 *
 * An accept becomes a data flow of its kind's class in the local files (the push carries it to the platform), a
 * signed `accepted` decision, and AFFIRMED on the platform for each cited finding the operator named in
 * `accept <n> affirm <k>`, still pending with no disposition (any other accept affirms nothing). A reject becomes a
 * `rejected` decision.
 *
 * The local writes run under the model's state lock: the flows' attribute files, then `dataflows.json`, then the
 * decisions, each replaced only while its bytes are still what was read. A flow without its decision counts as an
 * ordinary flow, and a decision is never written for a flow that is not there; an attribute file a failed commit
 * left behind, with no flow of its id, is taken over by the next. An accept of an edge whose flow is already in the
 * files (pushed, or written without its decision) is bound to that flow: its attributes are written as shown, and
 * no second flow is made. The affirmations are written last.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertRealModelTree } from '../utils/path-confinement.js'
import { deleteDetherealFile, HIDDEN_EDGE_TARGET, withSettlementLock } from '../utils/state-store.js'
import { planOperations, todayIso, type PlannedOperation } from '../triage/dispositions.js'
import type { ExposureState } from '../triage/exposures.js'
import type { ReviewOperation } from '../triage/review.js'
import { kindLabel } from './contract.js'
import { said } from './story.js'
import { AFFIRM_MARKER, affirmReason, affirmSuffix, decided, type HiddenEdgeReview, type ReviewCandidate } from './review.js'
import { DECISIONS_FILE, DECISION_LIMITS, signDecision, standing, type Decision, type ReadDecision, type Signer } from './records.js'

export const APPLY_LIMITS = { echoChars: 24_000, nameChars: 200, descriptionChars: 2000 } as const
export { AFFIRM_MARKER }

export interface PlannedFlow {
  n: number
  flow_id: string
  /** The flow is already in the files (re-accepted here): only the decision is written */
  exists: boolean
  flow: Record<string, unknown>
  attributes: Record<string, unknown>
}

export interface ApplyPlan {
  flows: PlannedFlow[]
  /** The decisions to add, unsigned */
  decisions: Array<Omit<Decision, 'mac'>>
  /** AFFIRMED for the pending exposures the accepts name to affirm */
  affirmations: PlannedOperation[]
  lines: string[]
}

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

/** A local flow id for an accepted candidate: `he-` and its id's hex. */
export const flowIdOf = (candidateId: string) => `he-${candidateId.slice(3)}`

function description(r: HiddenEdgeReview, c: ReviewCandidate): string {
  const names = c.exposure_ids.map((id) => r.exposures.get(id)?.name).filter((x): x is string => !!x).map((x) => said(x, 80))
  return [
    `Inferred ${c.kind.replace(/-/g, ' ')} edge, reviewed by the operator in Dethereal.`,
    `Techniques: ${c.technique_ids.join(', ')}.`,
    names.length ? `From exposures: ${names.join('; ')}.` : '',
    c.facts.length ? `Facts: ${c.facts.join(', ')}.` : '',
    c.evidence.length ? `Evidence: ${c.evidence.join(', ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, APPLY_LIMITS.descriptionChars)
}

/** Plan the writes of a closed review against the platform's exposures now. */
export function planApply(r: HiddenEdgeReview, now: Map<string, ExposureState>, at: string): ApplyPlan {
  const flows: PlannedFlow[] = []
  const decisions: Array<Omit<Decision, 'mac'>> = []
  const owed = new Map<string, ReviewCandidate>()
  const gone: string[] = []
  const lines: string[] = []
  const nameOf = (id: string) => said(r.local.components.get(id)?.name ?? id, 60)
  for (const c of decided(r)) {
    const label = `${kindLabel(c.kind)}: ${nameOf(c.source)} → ${nameOf(c.target)}`
    if (c.choice === 'reject') {
      decisions.push({ id: c.id, kind: c.kind, source: c.source, target: c.target, verb: 'rejected', flow_id: null, technique_ids: [...c.technique_ids], exposure_ids: [...c.exposure_ids], at })
      lines.push(`- [${c.n}] reject ${label}: not proposed again (a finding it rests on is triaged in /dethereal:triage)`)
      continue
    }
    const cls = c.class
    const existing = [...r.local.flows.values()].find((f) => f.classId === cls.id && f.source === c.source && f.target === c.target)
    const exists = !!existing
    const flowId = existing?.id ?? flowIdOf(c.id)
    const name = label.slice(0, APPLY_LIMITS.nameChars)
    const attributes: Record<string, unknown> = {
      ...c.fields,
      ...c.base,
      hidden_edge_kind: c.kind,
      technique_ids: [...c.technique_ids],
      source_exposure_ids: [...c.exposure_ids],
      proposed_by: c.edited ? 'operator' : 'rule',
      tier: c.tier,
      ...(c.rationale ? { rationale: c.rationale } : {}),
    }
    flows.push({
      n: c.n, flow_id: flowId, exists,
      flow: { id: flowId, name, description: description(r, c), source: { id: c.source }, target: { id: c.target }, classData: { id: cls.id, name: cls.name, module: { id: cls.module.id, name: cls.module.name } } },
      attributes: { elementId: flowId, elementType: 'dataFlow', elementName: name, classData: { id: cls.id, name: cls.name }, attributes },
    })
    decisions.push({ id: c.id, kind: c.kind, source: c.source, target: c.target, verb: 'accepted', flow_id: flowId, technique_ids: [...c.technique_ids], exposure_ids: [...c.exposure_ids], at })
    // Only the findings the operator named, and only while still pending with no disposition.
    for (const e of c.bulk ? [] : c.affirm) {
      if (now.get(e)?.lifecycle === 'pending' && now.get(e)?.disposition_kind === null) {
        if (!owed.has(e)) owed.set(e, c)
      } else gone.push(e)
    }
    const shownFields = Object.entries(c.fields).map(([k, v]) => `${k}=${v}`).join(', ')
    lines.push(
      `+ [${c.n}] ${label} (${c.tier}, ${c.technique_ids.join(', ')}; class ${said(cls.name, 60)})${exists ? `: the flow ${flowId} is in the files already; its attributes are written as shown` : ` as flow ${flowId}`}`,
      `    capability ${c.base.required_capability}, requires ${c.base.required_privilege}, grants ${c.base.granted_privilege}${shownFields ? `; ${shownFields}` : ''}${c.evidence.length ? `; ${c.evidence.length} evidence locator(s)` : ''}`,
      ...(c.rationale ? [`    rationale: ${said(c.rationale, 120)}`] : []),
    )
  }
  const ops: ReviewOperation[] = [...owed].map(([exposure_id, c], i) => ({
    group: i + 1, exposure_id, op: 'dispose', kind: 'AFFIRMED', reason: affirmReason(c.note, c.id), edited: false, marker: AFFIRM_MARKER,
  }))
  const affirmations = ops.length ? planOperations({ operations: ops, state: now, evidence: new Map(), techniques: { attack: new Map(), atlas: new Map() }, date: todayIso() }) : []
  // by accept: the reason its findings are written with, in full, once, as the operator answers yes to it; then each
  const told = new Set<string>()
  for (const o of [...affirmations].sort((a, b) => owed.get(a.exposure_id)!.n - owed.get(b.exposure_id)!.n)) {
    const c = owed.get(o.exposure_id)!
    if (!told.has(c.id)) {
      told.add(c.id)
      lines.push(`  Affirmed with [${c.n}], reason: ${said(`${affirmReason(c.note, c.id)}${AFFIRM_MARKER}`)}`)
    }
    const e = now.get(o.exposure_id)
    lines.push(o.status === 'ready' ? `  AFFIRMED on the platform: "${said(e?.name ?? o.exposure_id, 80)}" (${said(e?.element_name ?? '', 60)})` : `  Not affirmed (${o.code}): "${said(e?.name ?? o.exposure_id, 80)}"`)
  }
  for (const id of new Set(gone)) lines.push(`  Not affirmed (no longer pending with no disposition): "${said(now.get(id)?.name ?? r.exposures.get(id)?.name ?? id, 80)}"`)
  const added = flows.filter((f) => !f.exists).length
  const rejected = decisions.filter((d) => d.verb === 'rejected').length
  const ready = affirmations.filter((o) => o.status === 'ready').length
  return {
    flows, decisions, affirmations,
    lines: [
      `Platform model "${said(r.model_name, 120)}" (${r.model_id})`,
      `${added} hidden edge(s) to add to the local files, ${rejected} to reject${ready ? `, ${ready} exposure(s) to affirm on the platform` : ''}`,
      ...lines,
      ...(added ? ['The new flows reach the platform with the next push (/dethereal:sync push).'] : []),
    ],
  }
}

export interface RecordPlan {
  /** The decision the take-back writes, its verb the operator's answer: rejected or released */
  decision: Omit<Decision, 'mac' | 'verb'>
  lines: string[]
}

/** The answers a take-back takes, and what each records. */
export const TAKE_BACK_VERBS = { reject: 'rejected', release: 'released' } as const
export type TakeBack = keyof typeof TAKE_BACK_VERBS

/** The standing accepted decision of a flow, or null: the flow is then an ordinary one. */
export function decisionOfFlow(decisions: ReadDecision[], flowId: string): ReadDecision | null {
  return [...standing(decisions).values()].find((d) => d.verb === 'accepted' && d.flow_id === flowId) ?? null
}

/**
 * Whether a finding's reason is an affirmation by the accept of edge `id`: the generated reason, its marker last,
 * naming that edge in its own place. A note the operator wrote before it may name any edge: it does not count.
 * The reasons 0.7.0 wrote ("Affirmed by the accepted hidden edge(s) <id>, …") count too.
 */
export function affirmedByEdge(reason: string | null | undefined, id: string): boolean {
  if (!reason?.endsWith(AFFIRM_MARKER)) return false
  const body = reason.slice(0, -AFFIRM_MARKER.length)
  if (body === affirmReason(null, id) || body.endsWith(affirmSuffix(id))) return true
  const old = /^Affirmed by the accepted hidden edges? (he:[0-9a-f]{16}(?:, he:[0-9a-f]{16})*)$/.exec(body)
  return !!old && old[1]!.split(', ').includes(id)
}

/**
 * Plan taking back the accepted edge of a flow being removed: as a reject (the edge was never real) or a release (it
 * was fixed, or is no longer wanted), the operator's answer deciding which. The exposures this edge's accept
 * affirmed are listed for triage (an exposure affirmed otherwise, in triage, is not this edge's to mention); when the
 * platform could not be read (`unread` says why), the lines say they could not be listed.
 */
export function planRecord(accepted: ReadDecision, now: Map<string, ExposureState>, model: { id: string; name: string | null }, at: string, unread?: string): RecordPlan {
  const affirmed = accepted.exposure_ids.map((id) => now.get(id)).filter((e): e is ExposureState => !!e && e.disposition_kind === 'AFFIRMED' && affirmedByEdge(e.full_reason, accepted.id))
  return {
    decision: { id: accepted.id, kind: accepted.kind, source: accepted.source, target: accepted.target, flow_id: null, technique_ids: [...accepted.technique_ids], exposure_ids: [...accepted.exposure_ids], at },
    lines: [
      model.name === null ? `Platform model ${model.id}` : `Platform model "${said(model.name, 120)}" (${model.id})`,
      `Taking back the hidden edge ${kindLabel(accepted.kind)} ${accepted.id}, flow ${accepted.flow_id}: the flow is removed only after a reject or a release is recorded`,
      '  reject: the edge was never real; it is kept as a reject, and is not proposed again',
      '  release: it was fixed, or is no longer wanted; it is not kept out, and if its grounds return the module proposes it again',
      '  cancel: nothing is recorded, and the flow stays, accepted',
      ...(unread !== undefined
        ? [`The findings this edge affirmed could not be listed (${unread}); check them in /dethereal:triage`]
        : affirmed.length
        ? [`${affirmed.length} exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:`, ...affirmed.map((e) => `  "${said(e.name, 80)}" (${said(e.element_name, 60)})`)]
        : []),
    ],
  }
}

export class ApplyWriteError extends Error {
  constructor(readonly code: 'files_changed' | 'flow_exists', message: string) {
    super(message)
  }
}

/** What the files must still hold for a commit: the hashes prepare read. */
export interface FilesBound {
  dataflows: string
  decisions: string
}

export async function filesBound(dir: string): Promise<FilesBound> {
  const read = async (rel: string) => fs.readFile(path.join(dir, rel)).then((b) => sha(b), () => '')
  return { dataflows: await read('dataflows.json'), decisions: await read(`.dethereal/${DECISIONS_FILE}`) }
}

/** The flows file's entries, from either shape it is read in. */
function flowsOf(bytes: Buffer | null): unknown[] {
  if (!bytes) return []
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown
  if (Array.isArray(parsed)) return parsed
  const list = (parsed as { dataFlows?: unknown } | null)?.dataFlows
  if (!Array.isArray(list)) throw new ApplyWriteError('files_changed', 'dataflows.json is malformed; nothing was written')
  return list
}

/** Write the plan's local part under the state lock: the attribute files, `dataflows.json`, then the decisions. */
export async function writeApply(dir: string, plan: Pick<ApplyPlan, 'flows' | 'decisions'>, signer: Signer, bound: FilesBound): Promise<{ flows: number; decisions: number }> {
  await assertRealModelTree(dir)
  const newFlows = plan.flows.filter((f) => !f.exists)
  if (plan.flows.length) {
    await fs.mkdir(path.join(dir, 'attributes', 'dataFlows'), { recursive: true })
    await assertRealModelTree(dir)
  }
  const decisionsRel = `.dethereal/${DECISIONS_FILE}`
  const written = await withSettlementLock(dir, async (io) => {
    const flowsBytes = await io.read('dataflows.json')
    const decisionsBytes = await io.read(decisionsRel)
    if ((flowsBytes ? sha(flowsBytes) : '') !== bound.dataflows || (decisionsBytes ? sha(decisionsBytes) : '') !== bound.decisions) {
      throw new ApplyWriteError('files_changed', 'the flows or the decisions changed since prepare; nothing was written: prepare again')
    }
    const existing = flowsOf(flowsBytes)
    const ids = new Set(existing.map((f) => (f as { id?: unknown })?.id))
    if (newFlows.some((f) => ids.has(f.flow_id))) throw new ApplyWriteError('flow_exists', 'a flow with a planned id is in the files already; nothing was written: prepare again')
    if (plan.flows.some((f) => f.exists && !ids.has(f.flow_id))) throw new ApplyWriteError('files_changed', 'a flow the plan binds to is no longer in the files; nothing was written: prepare again')
    // Every attribute file read before any is written: what is there is replaced only as read (a new flow's is absent,
    // or left behind by a failed commit with no flow of its id).
    const attributeBytes = new Map<string, Buffer | null>()
    for (const f of plan.flows) attributeBytes.set(f.flow_id, await io.read(`attributes/dataFlows/${f.flow_id}.json`))
    // The entries already there are kept as they are, a malformed one too: only this commit's are added.
    const doc = decisionsBytes ? (JSON.parse(decisionsBytes.toString('utf8')) as { version?: unknown; decisions?: unknown }) : { version: 1, decisions: [] }
    if (doc.version !== 1 || !Array.isArray(doc.decisions)) throw new ApplyWriteError('files_changed', 'the decisions file is malformed; nothing was written: move it aside, then open again')
    const entries = [...doc.decisions, ...plan.decisions.map((d) => signDecision(signer, d))]
    const decisionsNext = JSON.stringify({ version: 1, decisions: entries }, null, 2)
    if (entries.length > DECISION_LIMITS.decisions || Buffer.byteLength(decisionsNext, 'utf8') > DECISION_LIMITS.bytes) {
      throw new ApplyWriteError('files_changed', 'the decisions file would be over its size: nothing was written')
    }
    for (const f of plan.flows) await io.replace(`attributes/dataFlows/${f.flow_id}.json`, JSON.stringify(f.attributes, null, 2), attributeBytes.get(f.flow_id) ?? null)
    if (newFlows.length) await io.replace('dataflows.json', JSON.stringify({ dataFlows: [...existing, ...newFlows.map((f) => f.flow)] }, null, 2), flowsBytes)
    await io.replace(decisionsRel, decisionsNext, decisionsBytes)
    return { flows: newFlows.length, decisions: plan.decisions.length }
  }, { targets: HIDDEN_EDGE_TARGET })
  // The measures cached for the model do not hold for the new files.
  if (plan.flows.length) await deleteDetherealFile(dir, 'quality.json').catch(() => undefined)
  return written
}
