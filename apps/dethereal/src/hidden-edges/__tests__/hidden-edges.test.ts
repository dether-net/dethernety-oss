/**
 * The hidden-edge core without a platform: the answer as untrusted input, the signed decisions, the review's
 * grammar, and the apply's plan and write order.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { MAC_TAGS } from '../../utils/gates.js'
import type { ExposureState } from '../../triage/exposures.js'
import { validateAnswer, type Candidate } from '../answer.js'
import { candidateId } from '../contract.js'
import { readLocalModel, type LocalModel } from '../local.js'
import { decisionOf, readDecisions, remapDecisions, signDecision, signerFor, standing, verifyDecision, isSigner, type Decision, type Signer } from '../records.js'
import { applyHiddenEdgeReply, bulkAcceptable, ReplyRefusal, type HiddenEdgeReview, type ReviewCandidate } from '../review.js'
import { filesBound, flowIdOf, planApply, planRecord, writeApply } from '../apply.js'
import { isLocator } from '../analyst.js'
import { answerOf, candidate, CLASSES, REMOTE, syncedModel } from './fixture.js'

let tmp: string
let repo: string
let seq = 0
const realHome = process.env.HOME

beforeAll(() => {
  // The signing key lives in the home directory: never the real one here.
  process.env.HOME = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-home-')))
})
afterAll(() => {
  fs.rmSync(process.env.HOME!, { recursive: true, force: true })
  process.env.HOME = realHome
})
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-core-')))
  repo = path.join(tmp, 'repo')
  fs.mkdirSync(repo)
  initProjectRoot({ cwd: repo, env: {} })
})
afterEach(() => {
  resetProjectRoot()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const exposure = (id: string, element: string, lifecycle: ExposureState['lifecycle'], over: Partial<ExposureState> = {}): ExposureState => ({
  exposure_id: id, name: `exp ${id}`, type: null, category: null, score: null, attack_vector: null, created_by: 'SYSTEM', authored_by: null,
  disposition_kind: lifecycle === 'confirmed' ? 'AFFIRMED' : lifecycle === 'disposed' ? 'FALSE_POSITIVE' : null, disposition_reason: null,
  dispositioned_by: lifecycle === 'pending' ? null : 'someone', dispositioned_at: null, disposition_stale: null, lifecycle, element_id: element,
  element_name: element, element_kind: element === 'SEG' ? 'securityBoundary' : 'component', element_class: null, attack_ids: ['T1021'], atlas_ids: [],
  unresolved_references: null, def_hash: 'h', full_reason: null, ...over,
})

async function context(): Promise<{ local: LocalModel; exposures: Map<string, ExposureState>; dir: string }> {
  const dir = await syncedModel(repo, `m${seq++}`)
  const exposures = new Map([['e1', exposure('e1', 'B', 'pending')], ['e2', exposure('e2', 'SEG', 'confirmed')], ['e3', exposure('e3', 'B', 'disposed')]])
  return { local: await readLocalModel(dir), exposures, dir }
}
const components = new Set(['A', 'B', 'D', 'X'])

describe('the answer, as untrusted input', () => {
  it('keeps a well-formed candidate, marks one on pending findings only, and counts the four numbers', async () => {
    const { local, exposures } = await context()
    const r = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e2']), candidate('remote-service', 'B', 'A', ['e1'])]), { local, components, exposures, excluded: new Set<string>(), classes: CLASSES })
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.candidates.map((c) => [c.source, c.target, c.pending_only])).toEqual([['A', 'B', false], ['B', 'A', true]])
    // The class is the platform's, with its module: what an accepted edge is written with.
    expect(r.candidates.map((c) => c.class)).toEqual([REMOTE, REMOTE])
    expect(r.counts).toMatchObject({ excluded_by_decision: 2, kind_budget_dropped: 1 })
    expect(r.dropped).toBe(0)
  })

  it('keeps a candidate on a risk-accepted or compensated exposure: the weakness is still there', async () => {
    const { local, exposures } = await context()
    exposures.set('e5', exposure('e5', 'B', 'disposed', { disposition_kind: 'RISK_ACCEPTED' }))
    exposures.set('e6', exposure('e6', 'B', 'disposed', { disposition_kind: 'COMPENSATING_CONTROL' }))
    const r = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e5']), candidate('remote-service', 'B', 'A', ['e6'])]), { local, components, exposures, excluded: new Set<string>(), classes: CLASSES })
    expect(r.status === 'ok' && r.candidates.map((c) => [c.source, c.target, c.pending_only])).toEqual([['A', 'B', false], ['B', 'A', true]])
    expect(r.status === 'ok' && r.dropped).toBe(0)
  })

  it('drops a candidate that does not hold, and counts it', async () => {
    const { local, exposures } = await context()
    const bad = [
      { ...candidate('remote-service', 'A', 'B', ['e2']), id: candidateId('remote-service', 'B', 'A') }, // id not its ends'
      candidate('unknown-kind', 'A', 'B', ['e2'], { class: { id: 'cls-unknown-kind', name: 'x' } }),
      candidate('remote-service', 'A', 'Z', ['e2']), // an end not in the model
      candidate('remote-service', 'X', 'X', ['e2']),
      candidate('remote-service', 'A', 'B', ['e3']), // disposed
      candidate('remote-service', 'A', 'B', ['nope']),
      candidate('remote-service', 'A', 'B', ['e2'], { facts: ['attributes:../x#k'] }),
      candidate('remote-service', 'A', 'B', ['e2'], { fields: { tier: 'high' } }),
      candidate('remote-service', 'A', 'B', ['e2'], { extra: 1 }),
      candidate('remote-service', 'A', 'B', ['e2'], { kg: 'unreadable' }),
      candidate('credential-reuse', 'A', 'B', ['e2'], { class: { id: 'cls-not-on-the-platform', name: REMOTE.name } }), // not the module's class
      candidate('remote-service', 'A', 'B', ['e2'], { class: { id: REMOTE.id, name: REMOTE.name, module: 'x' } }),
      candidate('remote-service', 'A', 'B', ['e2'], { class: REMOTE.id }),
    ]
    const r = validateAnswer(answerOf(bad), { local, components, exposures, excluded: new Set<string>(), classes: CLASSES })
    expect(r.status === 'ok' && r.candidates).toEqual([])
    expect(r.status === 'ok' && r.dropped).toBe(bad.length)
  })

  it('drops a candidate between two external entities, and one resting on a hidden-edge flow', async () => {
    const { local, exposures } = await context()
    local.components.set('Y', { id: 'Y', name: 'y', type: 'EXTERNAL_ENTITY' })
    local.flows.set('hf', { id: 'hf', source: 'A', target: 'B', classId: REMOTE.id })
    exposures.set('e4', exposure('e4', 'hf', 'confirmed', { element_kind: 'dataFlow' }))
    const r = validateAnswer(answerOf([candidate('remote-service', 'X', 'Y', ['e2']), candidate('remote-service', 'A', 'B', ['e4'])]), { local, components: new Set([...components, 'Y']), exposures, excluded: new Set<string>(), classes: CLASSES })
    expect(r.status === 'ok' && r.dropped).toBe(2)
  })

  it('refuses the answer whole on a wrong envelope, and maps an in-band refusal', async () => {
    const { local, exposures } = await context()
    const ctx = { local, components, exposures, excluded: new Set<string>(), classes: CLASSES }
    expect(validateAnswer('not json', ctx)).toMatchObject({ status: 'refused', code: 'answer_invalid' })
    expect(validateAnswer(answerOf([], { contract: 2 }), ctx)).toMatchObject({ status: 'refused', code: 'contract_mismatch' })
    expect(validateAnswer(answerOf([], { kinds: [] }), ctx)).toMatchObject({ status: 'refused', code: 'answer_invalid' })
    expect(validateAnswer(answerOf([{ id: 7 }]), ctx)).toMatchObject({ status: 'refused', code: 'answer_invalid' })
    expect(validateAnswer(answerOf(Array.from({ length: 201 }, () => candidate('remote-service', 'A', 'B', ['e2']))), ctx)).toMatchObject({ status: 'refused' })
    expect(validateAnswer(JSON.stringify({ contract: 1, module: 'dethernety-hidden-edges', version: '0.1.0', refusal: { code: 'busy' } }), ctx)).toMatchObject({ status: 'refused', code: 'module_busy' })
  })

  it('refuses an answer that names one class for two kinds, or two classes for one kind', async () => {
    const { local, exposures } = await context()
    const OTHER = { id: 'cls-he-host-escape', name: 'Hidden Edge: Host Escape', module: REMOTE.module }
    const ctx = { local, components, exposures, excluded: new Set<string>(), classes: new Map([...CLASSES, [OTHER.id, OTHER]]) }
    const sameClass = [candidate('remote-service', 'A', 'B', ['e2']), candidate('host-escape', 'A', 'B', ['e2'])]
    const twoClasses = [candidate('remote-service', 'A', 'B', ['e2']), candidate('remote-service', 'B', 'A', ['e1'], { class: { id: OTHER.id, name: OTHER.name } })]
    for (const list of [sameClass, twoClasses]) expect(validateAnswer(answerOf(list), ctx)).toMatchObject({ status: 'refused', code: 'answer_invalid' })
    const r = validateAnswer(answerOf([sameClass[0], candidate('host-escape', 'A', 'B', ['e2'], { class: { id: OTHER.id, name: OTHER.name } })]), ctx)
    expect(r.status === 'ok' && r.candidates.map((c) => [c.kind, c.class.id])).toEqual([['remote-service', REMOTE.id], ['host-escape', OTHER.id]])
  })
})

describe('the decisions', () => {
  const signer: Signer = { key: randomBytes(32), modelHash: 'm'.repeat(64) }
  const accepted = (over: Partial<Decision> = {}): Omit<Decision, 'mac'> => ({
    id: candidateId('remote-service', 'A', 'B'), kind: 'remote-service', source: 'A', target: 'B', verb: 'accepted', flow_id: flowIdOf(candidateId('remote-service', 'A', 'B')),
    technique_ids: ['T1021'], exposure_ids: ['e2'], at: '2026-11-17T00:00:00.000Z', ...over,
  })

  it('signs only an accept, verifies it with this key and model only, and refuses an edited one', () => {
    const d = signDecision(signer, accepted())
    expect(verifyDecision(signer, d)).toBe(true)
    expect(verifyDecision({ ...signer, modelHash: 'n'.repeat(64) }, d)).toBe(false)
    expect(verifyDecision(signer, { ...d, exposure_ids: ['e2', 'e1'] })).toBe(false)
    const r = signDecision(signer, { ...accepted(), id: candidateId('remote-service', 'A', 'B'), verb: 'rejected', flow_id: null })
    expect(r.mac).toBeNull()
    expect(verifyDecision(signer, r)).toBe(false)
    expect(new Set(Object.values(MAC_TAGS)).size).toBe(Object.values(MAC_TAGS).length)
    expect(MAC_TAGS.hiddenEdgeDecision.startsWith('{')).toBe(false)
  })

  it('reads only well-formed entries: exact keys, its id its kind and ends, an accept with a flow and a MAC, a reject with neither', () => {
    const ok = signDecision(signer, accepted())
    expect(decisionOf(ok)).toEqual(ok)
    expect(decisionOf({ ...ok, extra: 1 })).toBeNull()
    expect(decisionOf({ ...ok, source: 'X' })).toBeNull()
    expect(decisionOf({ ...ok, mac: null })).toBeNull()
    expect(decisionOf({ ...ok, verb: 'rejected' })).toBeNull()
    expect(decisionOf({ ...ok, verb: 'rejected', flow_id: null, mac: null })).not.toBeNull()
    expect(decisionOf({ ...ok, kind: 'trusted-relationship', id: candidateId('trusted-relationship', 'A', 'B') })).toBeNull()
  })

  it('lets a verified accept or any reject stand, never an unverified accept', () => {
    const verified = { ...signDecision(signer, accepted()), verified: true }
    const foreign = { ...signDecision(signer, accepted({ id: candidateId('remote-service', 'B', 'A'), source: 'B', target: 'A' })), verified: false }
    const rejected = { ...signDecision(signer, { ...accepted({ id: candidateId('remote-service', 'A', 'D'), target: 'D' }), verb: 'rejected', flow_id: null }), verified: false }
    expect([...standing([verified, foreign, rejected]).keys()].sort()).toEqual([verified.id, rejected.id].sort())
  })

  it('re-keys after a push: an accept this machine signed follows its flow, re-signed; any other entry is left as it is', async () => {
    const dir = await syncedModel(repo, 'remap')
    const s = await signerFor(dir, true)
    expect(isSigner(s)).toBe(true)
    if (!isSigner(s)) return
    const mine = signDecision(s, accepted())
    const foreign = signDecision(signer, accepted({ id: candidateId('remote-service', 'B', 'A'), source: 'B', target: 'A', flow_id: 'he-other' }))
    fs.writeFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), JSON.stringify({ version: 1, decisions: [mine, foreign] }))
    const warnings = await remapDecisions(dir, new Map([[mine.flow_id!, 'p-flow-1'], ['he-other', 'p-flow-2']]))
    expect(warnings).toHaveLength(1)
    const read = await readDecisions(dir, s)
    expect(read.status === 'ok' && read.decisions.map((d) => [d.flow_id, d.verified])).toEqual([['p-flow-1', true], ['he-other', false]])
  })
})

function review(local: LocalModel, exposures: Map<string, ExposureState>, candidates: Candidate[], dir = '/x'): HiddenEdgeReview {
  return {
    id: 'r'.repeat(32), dir, model_id: 'model-1', model_name: 'Shop', opened_at: '', local, exposures, decisions: [],
    candidates: candidates.map((c, i): ReviewCandidate => ({ ...c, n: i + 1, choice: 'open', rationale: null, base: { ...c.defaults }, evidence: [], edited: false, bulk: false })),
    seen: { fingerprint: '', local_hash: '', decisions_hash: '', exposures }, header: {}, closed: false, touched: 0,
  }
}

async function candidates() {
  const { local, exposures, dir } = await context()
  const r = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e2']), candidate('remote-service', 'B', 'A', ['e1']), candidate('remote-service', 'A', 'X', ['e2', 'e1'])]), { local, components, exposures, excluded: new Set<string>(), classes: CLASSES })
  if (r.status !== 'ok') throw new Error('fixture refused')
  return { local, exposures, dir, list: r.candidates }
}

describe('the review grammar', () => {
  it('takes accept, skip and reject by number; accept-all holds candidates on pending findings only and edited ones', async () => {
    const { local, exposures, list } = await candidates()
    const r = review(local, exposures, list)
    expect(applyHiddenEdgeReply(r, 'edit 3 granted: admin')).toEqual({ verb: 'edit', n: 3, field: 'granted' })
    expect(r.candidates[2]!.base.granted_privilege).toBe('admin')
    expect(applyHiddenEdgeReply(r, 'accept-all')).toEqual({ verb: 'accept-all', accepted: [1], held: [2, 3] })
    expect(r.closed).toBe(true)
    expect(r.candidates[0]).toMatchObject({ choice: 'accept', bulk: true })
    expect(() => applyHiddenEdgeReply(r, 'accept 2')).toThrow(ReplyRefusal)
    expect(bulkAcceptable(r.candidates[1]!)).toBe(false)
  })

  it('refuses what it cannot take, naming why, never echoing a value', async () => {
    const { local, exposures, list } = await candidates()
    const r = review(local, exposures, list)
    const code = (reply: string) => {
      try {
        applyHiddenEdgeReply(r, reply)
        return null
      } catch (err) {
        return (err as ReplyRefusal).code
      }
    }
    expect(code('accept 9')).toBe('candidate_unknown')
    expect(code('accept one')).toBe('reply_unparsed')
    expect(code('edit 1 granted: root')).toBe('argument_invalid')
    expect(code('edit 1 direction: reverse')).toBe('argument_invalid')
    expect(code('edit 1 tier: high')).toBe('argument_invalid')
    expect(code('frobnicate')).toBe('reply_unparsed')
    expect(applyHiddenEdgeReply(r, 'reject 2,3')).toEqual({ verb: 'reject', ns: [2, 3] })
    expect(applyHiddenEdgeReply(r, 'done')).toEqual({ verb: 'done' })
  })
})

describe('the apply', () => {
  const signer = (): Signer => ({ key: randomBytes(32), modelHash: 'm'.repeat(64) })

  it('plans a flow of the class the module named, with its module, and a signed accept per accept, an unsigned reject, and affirms only a one-by-one accept’s pending findings', async () => {
    const { local, exposures, list, dir } = await candidates()
    const r = review(local, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 2')
    applyHiddenEdgeReply(r, 'reject 3')
    applyHiddenEdgeReply(r, 'accept-all')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    expect(plan.flows.map((f) => [f.flow_id, f.flow.classData, f.exists])).toEqual([
      [flowIdOf(list[0]!.id), REMOTE, false],
      [flowIdOf(list[1]!.id), REMOTE, false],
    ])
    expect(plan.flows[1]!.attributes).toMatchObject({ attributes: { hidden_edge_kind: 'remote-service', technique_ids: ['T1021'], source_exposure_ids: ['e1'], proposed_by: 'rule', tier: 'medium', required_privilege: 'user' } })
    expect(plan.decisions.map((d) => [d.verb, d.flow_id === null])).toEqual([['accepted', false], ['accepted', false], ['rejected', true]])
    // accept 2 was one by one: its pending e1 is affirmed; accept-all's candidate 1 cites only confirmed e2 and affirms nothing
    expect(plan.affirmations.map((o) => [o.exposure_id, o.kind, o.status])).toEqual([['e1', 'AFFIRMED', 'ready']])
    expect(plan.lines[1]).toBe('2 hidden edge(s) to add to the local files, 1 to reject, 1 exposure(s) to affirm on the platform')
  })

  it('writes the attribute files, then dataflows.json, then the decisions; refuses, writing nothing, when the files changed', async () => {
    const { local, exposures, list, dir } = await candidates()
    const r = review(local, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 1')
    applyHiddenEdgeReply(r, 'done')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    const s = signer()
    const bound = await filesBound(dir)
    fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }))
    await expect(writeApply(dir, plan, s, bound)).rejects.toMatchObject({ code: 'files_changed' })
    expect(fs.existsSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'))).toBe(false)
    const fresh = await filesBound(dir)
    expect(await writeApply(dir, plan, s, fresh)).toEqual({ flows: 1, decisions: 1 })
    const id = flowIdOf(list[0]!.id)
    const flows = JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).dataFlows
    expect(flows.map((f: { id: string }) => f.id)).toEqual([id])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'attributes', 'dataFlows', `${id}.json`), 'utf8'))).toMatchObject({ elementId: id, classData: { id: REMOTE.id } })
    const read = await readDecisions(dir, s)
    expect(read.status === 'ok' && read.decisions.map((d) => [d.verb, d.verified, d.flow_id])).toEqual([['accepted', true, id]])
  })

  it('takes back an accepted edge as a reject, listing the affirmed findings it cites for triage', () => {
    const s = signer()
    const d = { ...signDecision(s, { id: candidateId('remote-service', 'A', 'B'), kind: 'remote-service', source: 'A', target: 'B', verb: 'accepted', flow_id: 'p-1', technique_ids: ['T1021'], exposure_ids: ['e1', 'e2'], at: '' }), verified: true }
    const now = new Map([['e1', exposure('e1', 'B', 'pending')], ['e2', exposure('e2', 'SEG', 'confirmed')]])
    const plan = planRecord(d, now, { id: 'model-1', name: 'Shop' }, '2026-11-17T00:00:00.000Z')
    expect(plan.decision).toMatchObject({ verb: 'rejected', flow_id: null, id: d.id })
    expect(plan.lines.slice(2)).toEqual(['1 exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:', '  "exp e2" (SEG)'])
  })
})

describe('the analyst’s locators', () => {
  it('are places, never values, and never leave the project', () => {
    for (const ok of ['source:infra/main.tf:12', 'attributes:attributes/components/A.json#tls_only_transport', 'platform:abc-1', 'kg:rule:1']) expect(isLocator(ok), ok).toBe(true)
    for (const bad of ['source:/etc/passwd:1', 'source:../x:1', 'source:a/../../b:1', 'attributes:x#', 'secret=hunter2', 'source:a b:1', 'kg:a b']) expect(isLocator(bad), bad).toBe(false)
  })
})

describe('the review folds', () => {
  const s = (): Signer => ({ key: randomBytes(32), modelHash: 'm'.repeat(64) })
  const accept = (signer: Signer, at: string, verb: 'accepted' | 'rejected' = 'accepted') => ({
    ...signDecision(signer, { id: candidateId('remote-service', 'A', 'B'), kind: 'remote-service', source: 'A', target: 'B', verb, flow_id: verb === 'accepted' ? 'p-1' : null, technique_ids: ['T1021'], exposure_ids: ['e2'], at }),
    verified: verb === 'accepted',
  })

  it('reads an exposure fact that names an exposure of the read, and drops one that does not', async () => {
    const { local, exposures } = await context()
    const ctx = { local, components, exposures, excluded: new Set<string>(), classes: CLASSES }
    const ok = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e2'], { facts: ['exposure:e1', 'attributes:SEG#east_west_within_segment_restricted'] })]), ctx)
    expect(ok.status === 'ok' && ok.candidates.length).toBe(1)
    const bad = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e2'], { facts: ['exposure:other'] })]), ctx)
    expect(bad.status === 'ok' && bad.dropped).toBe(1)
  })

  it('keeps out what a decision of this machine stands for, whatever the module did, and counts it', async () => {
    const { local, exposures } = await context()
    const r = validateAnswer(answerOf([candidate('remote-service', 'A', 'B', ['e2'])]), { local, components, exposures, excluded: new Set([candidateId('remote-service', 'A', 'B')]), classes: CLASSES })
    expect(r.status === 'ok' && [r.candidates.length, r.excluded, r.dropped]).toEqual([0, 1, 0])
  })

  it('lets the latest decision stand by its signed time: an older accept appended again does not undo a take-back', () => {
    const signer = s()
    const old = accept(signer, '2026-11-16T00:00:00.000Z')
    const back = { ...accept(signer, '2026-11-17T00:00:00.000Z', 'rejected'), verified: false }
    expect(standing([old, back, old]).get(old.id)!.verb).toBe('rejected')
    expect(verifyDecision(signer, { ...old, at: '2026-11-18T00:00:00.000Z' })).toBe(false)
  })

  it('binds an accept to the edge’s flow already in the files, writing its attributes as shown and no second flow', async () => {
    const { local, exposures, list, dir } = await candidates()
    const flows = JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).dataFlows
    flows.push({ id: 'p-flow', name: 'pushed', source: { id: 'A' }, target: { id: 'B' }, classData: { id: REMOTE.id, name: REMOTE.name } })
    fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: flows }))
    local.flows.set('p-flow', { id: 'p-flow', source: 'A', target: 'B', classId: REMOTE.id })
    const r = review(local, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 1')
    applyHiddenEdgeReply(r, 'done')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    expect(plan.flows.map((f) => [f.flow_id, f.exists])).toEqual([['p-flow', true]])
    expect(plan.decisions[0]!.flow_id).toBe('p-flow')
    expect(await writeApply(dir, plan, s(), await filesBound(dir))).toEqual({ flows: 0, decisions: 1 })
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'dataflows.json'), 'utf8')).dataFlows.map((f: { id: string }) => f.id)).toEqual(['f1', 'p-flow'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'attributes', 'dataFlows', 'p-flow.json'), 'utf8')).attributes).toMatchObject({ hidden_edge_kind: 'remote-service' })
  })

  it('takes over an attribute file a failed commit left with no flow of its id', async () => {
    const { local, exposures, list, dir } = await candidates()
    const r = review(local, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 1')
    applyHiddenEdgeReply(r, 'done')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    fs.mkdirSync(path.join(dir, 'attributes', 'dataFlows'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'attributes', 'dataFlows', `${plan.flows[0]!.flow_id}.json`), '{"left":"behind"}')
    expect(await writeApply(dir, plan, s(), await filesBound(dir))).toEqual({ flows: 1, decisions: 1 })
  })

  it('shows on the plan’s lines what is written: base values, fields, rationale; and marks an affirmation as the operator’s accept', async () => {
    const { local, exposures, list } = await candidates()
    const r = review(local, exposures, [{ ...list[1]!, fields: { transport_state: 'cleartext' } }])
    applyHiddenEdgeReply(r, 'edit 1 transport_state: unstated')
    applyHiddenEdgeReply(r, 'edit 1 rationale: the VPN terminates on the web tier')
    applyHiddenEdgeReply(r, 'accept 1')
    applyHiddenEdgeReply(r, 'done')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    expect(plan.lines).toContain('    capability opportunistic, requires user, grants user; transport_state=unstated')
    expect(plan.lines).toContain('    rationale: the VPN terminates on the web tier')
    expect(plan.affirmations[0]!.reason).toMatch(/ — hidden edge accepted by the operator$/)
  })

  it('re-keys nothing, and warns of nothing, for a flow a push kept under its id', async () => {
    const dir = await syncedModel(repo, 'identity')
    const signer = s()
    fs.writeFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), JSON.stringify({ version: 1, decisions: [accept(signer, '2026-11-17T00:00:00.000Z')].map(({ verified: _v, ...d }) => d) }))
    expect(await remapDecisions(dir, new Map([['p-1', 'p-1']]))).toEqual([])
  })

  it('leaves a hidden-edge class out of the modules a push lists', async () => {
    const { deriveManifestModules } = await import('../../utils/manifest-modules.js')
    const derived = deriveManifestModules({
      manifestModules: undefined, scope: { scope: null }, classModules: new Map(), structure: { defaultBoundary: { id: 'root', name: 'r' } } as never,
      dataFlows: [{ id: 'he-1', classData: { id: REMOTE.id, name: REMOTE.name, module: REMOTE.module } }], dataItems: [],
      hiddenEdgeFlows: new Map([['he-1', new Set(['T1021'])]]),
    })
    expect(derived.gaps).toEqual([])
    expect(derived.modules).toEqual([])
    // A flow that names the module by hand, with no accept here, is an ordinary flow: its class's module is listed.
    const byHand = deriveManifestModules({
      manifestModules: undefined, scope: { scope: null }, classModules: new Map(), structure: { defaultBoundary: { id: 'root', name: 'r' } } as never,
      dataFlows: [{ id: 'he-1', classData: { id: REMOTE.id, name: REMOTE.name, module: REMOTE.module } }], dataItems: [],
    })
    expect(byHand.modules).toEqual([REMOTE.module])
  })
})

describe('which flows are hidden edges here', () => {
  it('a flow of a hidden-edge class with a verified accept for it and its ends; any other flow is ordinary', async () => {
    const { hiddenEdgeFlows, isHiddenEdgeFlow } = await import('../predicate.js')
    const dir = await syncedModel(repo, 'predicate')
    const signer = await signerFor(dir, true)
    if (!isSigner(signer)) throw new Error('no key')
    const accepted = signDecision(signer, { id: candidateId('remote-service', 'A', 'B'), kind: 'remote-service', source: 'A', target: 'B', verb: 'accepted', flow_id: 'p-1', technique_ids: ['T1021'], exposure_ids: ['e2'], at: '2026-11-17T00:00:00.000Z' })
    fs.writeFileSync(path.join(dir, '.dethereal', 'hidden-edges-decisions.json'), JSON.stringify({ version: 1, decisions: [accepted] }))
    const flow = { id: 'p-1', source: { id: 'A' }, target: { id: 'B' }, classData: { id: REMOTE.id, module: REMOTE.module } }
    const flows = await hiddenEdgeFlows(dir, [flow, { ...flow, id: 'p-2' }, { ...flow, classData: { id: 'other' } }, { ...flow, classData: { id: REMOTE.id, module: { name: 'another-module' } } }, { ...flow, target: { id: 'D' } }])
    expect([...flows]).toEqual([['p-1', new Set(['T1021'])]])
    expect(isHiddenEdgeFlow(flow, new Map())).toBe(false)
  })

  it('marks a triage group whose every member is on such a flow, for a technique it was accepted with', async () => {
    const { groupTriageSet } = await import('../../triage/model-views.js')
    const row = (id: string, element: string, attack: string) => ({ ...exposure(id, element, 'pending', { element_kind: 'dataFlow', name: `Inferred remote service path: ${attack}`, attack_ids: [attack], def_hash: attack }) })
    const parts = groupTriageSet([row('i1', 'p-1', 'T1021'), row('i2', 'p-2', 'T1021'), row('i3', 'p-1', 'T1210')], undefined, new Map([['p-1', new Set(['T1021'])], ['p-2', new Set(['T1021'])]]))
    expect(parts.map((p) => [p.name, p.inferred ?? false])).toEqual([['Inferred remote service path: T1021', true], ['Inferred remote service path: T1210', false]])
  })
})

describe('the inferred mark, at its edges', () => {
  it('is not set on a mixed group, and goes when the edge is taken back', async () => {
    const { groupTriageSet } = await import('../../triage/model-views.js')
    const row = (id: string, element: string) => ({ ...exposure(id, element, 'pending', { element_kind: 'dataFlow', name: 'Inferred remote service path: T1021', attack_ids: ['T1021'], def_hash: 'h1' }) })
    const parts = groupTriageSet([row('i1', 'p-1'), row('i2', 'p-unaccepted')], undefined, new Map([['p-1', new Set(['T1021'])]]))
    expect(parts.map((p) => p.inferred ?? false)).toEqual([false])
    const signer: Signer = { key: randomBytes(32), modelHash: 'm'.repeat(64) }
    const base = { id: candidateId('remote-service', 'A', 'B'), kind: 'remote-service', source: 'A', target: 'B', technique_ids: ['T1021'], exposure_ids: ['e2'] }
    const accepted = { ...signDecision(signer, { ...base, verb: 'accepted', flow_id: 'p-1', at: '2026-11-17T00:00:00.000Z' }), verified: true }
    const back = { ...signDecision(signer, { ...base, verb: 'rejected', flow_id: null, at: '2026-11-17T01:00:00.000Z' }), verified: false }
    const { isHiddenEdgeFlow } = await import('../predicate.js')
    const flow = { id: 'p-1', source: { id: 'A' }, target: { id: 'B' }, classData: { id: REMOTE.id, module: REMOTE.module } }
    expect(isHiddenEdgeFlow(flow, standing([accepted]))).toBe(true)
    expect(isHiddenEdgeFlow(flow, standing([accepted, back]))).toBe(false)
  })
})
