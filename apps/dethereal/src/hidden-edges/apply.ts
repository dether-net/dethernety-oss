/**
 * What a closed hidden-edge review writes, planned and written.
 *
 * An accept becomes a data flow of its kind's class in the local files (the push carries it to the platform), a
 * signed `accepted` decision, and, for an accept the operator gave one by one, AFFIRMED on the platform for each
 * pending exposure it cites (an accept-all affirms nothing). A reject becomes a `rejected` decision.
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
import { shown } from '../triage/text.js'
import { kindLabel } from './contract.js'
import { decided, type HiddenEdgeReview, type ReviewCandidate } from './review.js'
import { DECISIONS_FILE, DECISION_LIMITS, signDecision, standing, type Decision, type ReadDecision, type Signer } from './records.js'

export const APPLY_LIMITS = { echoChars: 24_000, nameChars: 200, descriptionChars: 2000 } as const
const AFFIRM_REASON = 'Affirmed by the accepted hidden edge'
/** The marker an affirmation's reason ends with: the operator accepted the edge it rests on. */
export const AFFIRM_MARKER = ' — hidden edge accepted by the operator'

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
  /** AFFIRMED for the pending exposures the one-by-one accepts cite */
  affirmations: PlannedOperation[]
  lines: string[]
}

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

/** A local flow id for an accepted candidate: `he-` and its id's hex. */
export const flowIdOf = (candidateId: string) => `he-${candidateId.slice(3)}`

function description(r: HiddenEdgeReview, c: ReviewCandidate): string {
  const names = c.exposure_ids.map((id) => r.exposures.get(id)?.name).filter((x): x is string => !!x).map((x) => shown(x, 80))
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
  const owed = new Map<string, string[]>()
  const lines: string[] = []
  const nameOf = (id: string) => shown(r.local.components.get(id)?.name ?? id, 60)
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
    // A pending exposure is affirmed only by its own accept, never through accept-all.
    const affirms = c.bulk ? [] : c.exposure_ids.filter((e) => now.get(e)?.lifecycle === 'pending' && now.get(e)?.disposition_kind === null)
    for (const e of affirms) owed.set(e, [...new Set([...(owed.get(e) ?? []), c.id])])
    const shownFields = Object.entries(c.fields).map(([k, v]) => `${k}=${v}`).join(', ')
    lines.push(
      `+ [${c.n}] ${label} (${c.tier}, ${c.technique_ids.join(', ')}; class ${shown(cls.name, 60)})${exists ? `: the flow ${flowId} is in the files already; its attributes are written as shown` : ` as flow ${flowId}`}`,
      `    capability ${c.base.required_capability}, requires ${c.base.required_privilege}, grants ${c.base.granted_privilege}${shownFields ? `; ${shownFields}` : ''}${c.evidence.length ? `; ${c.evidence.length} evidence locator(s)` : ''}`,
      ...(c.rationale ? [`    rationale: ${shown(c.rationale, 120)}`] : []),
    )
  }
  const ops: ReviewOperation[] = [...owed].map(([exposure_id, ids], i) => ({
    group: i + 1, exposure_id, op: 'dispose', kind: 'AFFIRMED', reason: `${AFFIRM_REASON}${ids.length > 1 ? 's' : ''} ${ids.slice(0, 5).join(', ')}`, edited: false, marker: AFFIRM_MARKER,
  }))
  const affirmations = ops.length ? planOperations({ operations: ops, state: now, evidence: new Map(), techniques: { attack: new Map(), atlas: new Map() }, date: todayIso() }) : []
  for (const o of affirmations) {
    const e = now.get(o.exposure_id)
    lines.push(o.status === 'ready' ? `  AFFIRMED on the platform: "${shown(e?.name ?? o.exposure_id, 80)}" (${shown(e?.element_name ?? '', 60)})` : `  Not affirmed (${o.code}): "${shown(e?.name ?? o.exposure_id, 80)}"`)
  }
  const added = flows.filter((f) => !f.exists).length
  const rejected = decisions.filter((d) => d.verb === 'rejected').length
  const ready = affirmations.filter((o) => o.status === 'ready').length
  return {
    flows, decisions, affirmations,
    lines: [
      `Platform model "${shown(r.model_name, 120)}" (${r.model_id})`,
      `${added} hidden edge(s) to add to the local files, ${rejected} to reject${ready ? `, ${ready} exposure(s) to affirm on the platform` : ''}`,
      ...lines,
      ...(added ? ['The new flows reach the platform with the next push (/dethereal:sync push).'] : []),
    ],
  }
}

export interface RecordPlan {
  decision: Omit<Decision, 'mac'>
  lines: string[]
}

/** The standing accepted decision of a flow, or null: the flow is then an ordinary one. */
export function decisionOfFlow(decisions: ReadDecision[], flowId: string): ReadDecision | null {
  return [...standing(decisions).values()].find((d) => d.verb === 'accepted' && d.flow_id === flowId) ?? null
}

/** Plan taking back the accepted edge of a flow being removed; its affirmed exposures are listed for triage. */
export function planRecord(accepted: ReadDecision, now: Map<string, ExposureState>, model: { id: string; name: string }, at: string): RecordPlan {
  const affirmed = accepted.exposure_ids.map((id) => now.get(id)).filter((e): e is ExposureState => e?.disposition_kind === 'AFFIRMED')
  return {
    decision: { id: accepted.id, kind: accepted.kind, source: accepted.source, target: accepted.target, verb: 'rejected', flow_id: null, technique_ids: [...accepted.technique_ids], exposure_ids: [...accepted.exposure_ids], at },
    lines: [
      `Platform model "${shown(model.name, 120)}" (${model.id})`,
      `The hidden edge ${kindLabel(accepted.kind)} ${accepted.id} is recorded as rejected: it is not proposed again`,
      ...(affirmed.length
        ? [`${affirmed.length} exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:`, ...affirmed.map((e) => `  "${shown(e.name, 80)}" (${shown(e.element_name, 60)})`)]
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
