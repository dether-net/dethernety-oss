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
import { AFFIRM_MARKER, affirmReason, applyHiddenEdgeReply, bulkAcceptable, NOTE_MAX, ReplyRefusal, type HiddenEdgeReview, type ReviewCandidate } from '../review.js'
import { affirmedByEdge, filesBound, flowIdOf, planApply, planRecord, writeApply } from '../apply.js'
import { limitsLines, PATH_CHARS, rowOf, showOf } from '../views.js'
import { REASON_MAX } from '../../triage/dispositions.js'
import { registerSecret } from '../../auth/redact.js'
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

  it('reads a release as a reject is read, and lets none stand for an edge whose latest decision is one', () => {
    const at = (t: string) => `2026-11-1${t}T00:00:00.000Z`
    const accept = { ...signDecision(signer, accepted({ at: at('7') })), verified: true }
    const release = { ...accept, verb: 'released' as const, flow_id: null, mac: null, at: at('8'), verified: false }
    const { verified: _v, ...entry } = release
    expect(decisionOf(entry)).toEqual(entry)
    expect(decisionOf({ ...entry, flow_id: 'f' })).toBeNull()
    expect(decisionOf({ ...entry, mac: 'x' })).toBeNull()
    expect(standing([accept, release]).size).toBe(0)
    // accepted again after the release: it stands
    const again = { ...signDecision(signer, accepted({ at: at('9') })), verified: true }
    expect(standing([accept, release, again]).get(accept.id)!.verb).toBe('accepted')
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
    candidates: candidates.map((c, i): ReviewCandidate => ({ ...c, n: i + 1, choice: 'open', rationale: null, base: { ...c.defaults }, evidence: [], argument: null, edited: false, bulk: false, affirm: [], note: null })),
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

  it('affirms nothing on an accept, unless it names the findings: pending ones, numbered as show numbers them, one accept each', async () => {
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
    expect(applyHiddenEdgeReply(r, 'accept 2')).toEqual({ verb: 'accept', ns: [2] })
    expect(r.candidates[1]).toMatchObject({ choice: 'accept', affirm: [], note: null })
    // candidate 2 cites e1, pending: its finding 1
    expect(applyHiddenEdgeReply(r, 'accept 2 affirm 1')).toEqual({ verb: 'accept', ns: [2], affirm: [1], note: false })
    expect(r.candidates[1]).toMatchObject({ choice: 'accept', affirm: ['e1'], note: null })
    // candidate 3 cites e2 (confirmed) and e1 (named by candidate 2's accept already)
    expect(code('accept 3 affirm 1')).toBe('argument_invalid')
    expect(code('accept 3 affirm 2')).toBe('argument_invalid')
    expect(code('accept 3 affirm 9')).toBe('argument_invalid')
    expect(code('accept 2,3 affirm 1')).toBe('reply_unparsed')
    expect(code('accept 2 affirm')).toBe('reply_unparsed')
    expect(code('accept 2 note: seen')).toBe('argument_invalid')
    // a skip drops what the accept named: the finding is free for another accept
    applyHiddenEdgeReply(r, 'skip 2')
    expect(r.candidates[1]).toMatchObject({ choice: 'skip', affirm: [] })
    expect(applyHiddenEdgeReply(r, 'accept 3 affirm 2 note: seen in the lab')).toEqual({ verb: 'accept', ns: [3], affirm: [2], note: true })
    expect(r.candidates[2]).toMatchObject({ affirm: ['e1'], note: 'seen in the lab' })
    // a note may itself say affirm or note: the first note: starts it
    applyHiddenEdgeReply(r, 'accept 3 affirm 2 note: I affirm it; note: twice')
    expect(r.candidates[2]).toMatchObject({ affirm: ['e1'], note: 'I affirm it; note: twice' })
    // a plain accept after it drops what it named
    applyHiddenEdgeReply(r, 'accept 3')
    expect(r.candidates[2]).toMatchObject({ affirm: [], note: null })
    // accept-all affirms nothing, and takes only what is still open (2 was skipped)
    expect(applyHiddenEdgeReply(r, 'accept-all')).toEqual({ verb: 'accept-all', accepted: [1], held: [] })
    expect(r.candidates[0]).toMatchObject({ bulk: true, affirm: [] })
  })

  it('caps the note so that its reason, marker included, fits the platform; refuses one holding this session’s credentials', async () => {
    const { local, exposures, list } = await candidates()
    const r = review(local, exposures, list)
    const id = list[1]!.id
    expect(`${affirmReason('x'.repeat(NOTE_MAX), id)}${AFFIRM_MARKER}`.length).toBe(REASON_MAX)
    expect(applyHiddenEdgeReply(r, `accept 2 affirm 1 note: ${'x'.repeat(NOTE_MAX)}`)).toMatchObject({ note: true })
    expect(() => applyHiddenEdgeReply(r, `accept 2 affirm 1 note: ${'x'.repeat(NOTE_MAX + 1)}`)).toThrow(/at most/)
    expect(() => applyHiddenEdgeReply(r, 'accept 2 affirm 1 note:   ')).toThrow(/empty/)
    expect(() => applyHiddenEdgeReply(r, 'accept 2 affirm 1 note: a\nb')).toThrow(/one line/)
    const secret = `tok-${randomBytes(12).toString('hex')}`
    registerSecret(secret)
    let message = ''
    try {
      applyHiddenEdgeReply(r, `accept 2 affirm 1 note: see ${secret}`)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/credentials/)
    expect(message).not.toContain(secret)
  })
})

describe('the views', () => {
  // a pending finding caps the evidence at Medium, yet High stays reachable on the pair: the module's basis
  const basis = { confirmed: false, gates: 1, gates_stated: 0, raises: 0, lowers: 0, high_reachable: true, caps: ['pending'] }
  const part = (over: Record<string, unknown> = {}) => ({
    row: 'remote-service/rs-3', role: 'target', relation: 'same-segment', exposure: 'e1', anchor: 'A', matched: ['T1021'], path: 'T1021', foothold: 'B', reached: 'A',
    anchored_end: null, shared: 'SEG', flow: null, item: null, low: null, tier: 'medium', basis, facts: [{ at: ['attributes:A#tls_enabled'], value: false, effect: 'meets_gate', gate: 0 }], facts_total: 3, ...over,
  })

  it('reads the names, classes and nesting the stories use from the files', async () => {
    const { local } = await candidates()
    expect(local.components.get('B')).toMatchObject({ name: 'web', className: 'Web Server', parent: 'SEG' })
    expect(local.boundaries.get('SEG')).toMatchObject({ className: 'Network Segment', parent: 'root' })
    expect(local.flows.get('f1')).toMatchObject({ name: 'query' })
  })

  it('gives a row its path and evidence line only when the module explained it', async () => {
    const { local, exposures, list } = await candidates()
    const plain = review(local, exposures, list)
    expect(Object.keys(rowOf(plain, plain.candidates[1]!))).not.toContain('path')
    const explained = review(local, exposures, [{ ...list[1]!, explain: { parts: [part()], parts_total: 1, crown_jewel: { source: false, target: false }, remedies: [], remedies_total: 0 } } as Candidate])
    const row = rowOf(explained, explained.candidates[0]!)
    expect(row.path).toBe('From web (Web Server), in the same "Segment" as api, an attacker uses T1021 against api, where "exp e1" was found, with user rights on web (rule assumption).')
    expect(row.evidence_why).toBe('Evidence: Medium. The finding is pending (Medium at most); 0 of the 1 condition High needs is met.')
    // a long name: the path is cut
    const long = review({ ...local, components: new Map([...local.components, ['B', { ...local.components.get('B')!, name: 'w'.repeat(400) }]]) }, exposures, explained.candidates)
    expect((rowOf(long, long.candidates[0]!).path as string).length).toBeLessThanOrEqual(PATH_CHARS)
  })

  it('shows a candidate’s findings numbered, the other ways in, the facts, the remedies, the rule and its defaults', async () => {
    const { local, exposures, list } = await candidates()
    const x = { parts: [part(), part({ row: 'remote-service/rs-2', shared: null })], parts_total: 4, crown_jewel: { source: false, target: false }, remedies: null, remedies_total: 0 }
    const r = review(local, exposures, [{ ...list[2]!, explain: x } as Candidate])
    r.explained = { rationale: { 'remote-service/rs-3': 'a flat tier lets any peer reach a service' }, limits: null }
    const shown = showOf(r, r.candidates[0]!)
    // candidate 3 cites e2 (confirmed) then e1 (pending): the numbers accept <n> affirm <k> takes
    expect(shown.findings).toEqual([
      { k: 1, finding: 'exp e2', on: 'SEG', state: 'confirmed, affirmed' },
      { k: 2, finding: 'exp e1', on: 'B', state: 'pending', affirmable: true },
    ])
    expect(shown.other_ways).toEqual(['From web (Web Server), an attacker uses T1021 against api, where "exp e1" was found, with user rights on web (rule assumption).'])
    expect(shown.other_ways_more).toBe(2)
    expect(shown.facts_weighed).toEqual([{ fact: 'tls_enabled on "api"', value: false, effect: 'meets 1 of the 1 condition High needs' }])
    expect(shown.facts_more).toBe(2)
    expect(shown.remedies).toEqual(['The module left out what removes this edge, for time.'])
    expect(shown.rationale).toBe('a flat tier lets any peer reach a service')
    expect(shown.rule_defaults).toBe('capability opportunistic, requires user, grants user: rule defaults, not checked for this edge')
    // left out for size: said, with the findings still numbered
    const omitted = review(local, exposures, [{ ...list[2]!, explain: { omitted: 'size' } } as Candidate])
    expect(showOf(omitted, omitted.candidates[0]!)).toMatchObject({ explanation: "the module left out this edge's explanation, for size", findings: [{ k: 1 }, { k: 2 }] })
  })

  it('says where the module’s caps left the list short, and nothing when they did not', () => {
    const limits = { per_kind_budget: 50, max_peers: 20, by_kind: { 'remote-service': { listed: 50, not_listed: 7, pairs_capped: 3, anchors_over_budget: 0 } }, explain_trimmed: 2, remedies_skipped: 1 }
    expect(limitsLines(limits)).toEqual([
      'The list is incomplete: Remote service 50 listed, 7 not. The module lists at most 50 edges of a kind; decide some, then run hidden edges again, to see the rest.',
      'The module walked a limited number of starting points (at most 20 peers each): Remote service 3 pair(s) past the cap, 0 finding(s) past their budget. A change that removes the paths it walked may leave others.',
      'The module left out 2 edge explanation(s), for size.',
      'The module left out what removes 1 edge(s), for time.',
    ])
    expect(limitsLines({ ...limits, by_kind: {}, explain_trimmed: 0, remedies_skipped: 0 })).toEqual([])
    expect(limitsLines(undefined)).toEqual([])
  })
})

describe('what removes it, and this session’s credentials in the views', () => {
  const basis = { confirmed: true, gates: 0, gates_stated: 0, raises: 0, lowers: 0, high_reachable: false, caps: ['no_gate'] }
  const part = { row: 'remote-service/rs-3', role: 'target', relation: 'same-segment', exposure: 'e1', anchor: 'A', matched: ['T1021'], path: 'T1021', foothold: 'B', reached: 'A',
    anchored_end: null, shared: 'SEG', flow: null, item: null, low: null, tier: 'medium', basis, facts: [], facts_total: 0 }
  const with_ = (list: Candidate[], remedies: unknown) => list.map((c) => ({ ...c, explain: { parts: [part], parts_total: 1, crown_jewel: { source: false, target: false }, remedies, remedies_total: Array.isArray(remedies) ? remedies.length : 0 } }) as Candidate)

  it('gives a row its first remedy in words, cut to 120, and nothing when there is none or it was left out', async () => {
    const { local, exposures, list } = await candidates()
    const one = [list[1]!]
    const r = review(local, exposures, with_(one, [{ set: [{ at: 'attributes:A#hardened' }], outcome: 'removes' }]))
    expect(rowOf(r, r.candidates[0]!).removes_if).toBe('The edge goes if the model states hardened = true on "api".')
    const long = review(local, exposures, with_(one, [{ control_classes: ['A'.repeat(64), 'B'.repeat(64)], attributes_true: [], item_classes: [], on: 'A', outcome: 'removes' }]))
    expect((rowOf(long, long.candidates[0]!).removes_if as string).length).toBe(120)
    for (const none of [[], null]) {
      const r2 = review(local, exposures, with_(one, none))
      expect(Object.keys(rowOf(r2, r2.candidates[0]!))).not.toContain('removes_if')
    }
  })

  it('takes this session’s credentials out before a cut, so a cut never leaves part of one', async () => {
    const { local, list } = await candidates()
    const secret = `bearer-${'5c'.repeat(12)}`
    registerSecret(secret)
    // the credential straddles the 80-character cut of a finding's name
    const name = `${'n'.repeat(70)}${secret}`
    const exposures = new Map([['e1', exposure('e1', 'B', 'pending', { name })], ['e2', exposure('e2', 'SEG', 'confirmed')]])
    const r = review(local, exposures, with_([list[1]!], []))
    const text = JSON.stringify([rowOf(r, r.candidates[0]!), showOf(r, r.candidates[0]!)])
    expect(text).not.toContain(secret.slice(0, 12))
    expect(rowOf(r, r.candidates[0]!).exposures).toEqual([`${'n'.repeat(70)}[redacted]`])
    expect(rowOf(r, r.candidates[0]!).path).toContain('[redacted]')
  })

  it('takes them out before the cuts of the apply and take-back lines too', async () => {
    const { local, exposures, list, dir } = await candidates()
    const secret = `bearer-${'6d'.repeat(12)}`
    registerSecret(secret)
    // the credential straddles the 60-character cut of a component's name, and of a finding's element
    const named = { ...local, components: new Map([...local.components].map(([id, c]) => [id, id === 'A' ? { ...c, name: `${'a'.repeat(50)}${secret}` } : c])) }
    const r = review(named, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 1')
    applyHiddenEdgeReply(r, 'done')
    const lines = planApply(r, exposures, 'x').lines.join('\n')
    expect(lines).not.toContain(secret.slice(0, 8))
    expect(lines).toContain(`${'a'.repeat(50)}[redacted]`)
    const id = candidateId('remote-service', 'A', 'B')
    const d = { ...signDecision({ key: randomBytes(32), modelHash: 'm'.repeat(64) }, { id, kind: 'remote-service', source: 'A', target: 'B', verb: 'accepted', flow_id: 'p-1', technique_ids: ['T1021'], exposure_ids: ['e2'], at: '' }), verified: true }
    const now = new Map([['e2', exposure('e2', 'SEG', 'confirmed', { element_name: `${'s'.repeat(55)}${secret}`, full_reason: `${affirmReason(null, id)}${AFFIRM_MARKER}` })]])
    const back = planRecord(d, now, { id: 'model-1', name: 'Shop' }, 'x').lines.join('\n')
    expect(back).not.toContain(secret.slice(0, 4))
    expect(back).toContain(`${'s'.repeat(55)}[re`)
  })
})

describe('the apply', () => {
  const signer = (): Signer => ({ key: randomBytes(32), modelHash: 'm'.repeat(64) })

  it('plans a flow of the class the module named, with its module, and a signed accept per accept, an unsigned reject, and affirms only the findings an accept names', async () => {
    const { local, exposures, list, dir } = await candidates()
    const r = review(local, exposures, list, dir)
    applyHiddenEdgeReply(r, 'accept 2 affirm 1')
    applyHiddenEdgeReply(r, 'reject 3')
    applyHiddenEdgeReply(r, 'accept-all')
    const plan = planApply(r, exposures, '2026-11-17T00:00:00.000Z')
    expect(plan.flows.map((f) => [f.flow_id, f.flow.classData, f.exists])).toEqual([
      [flowIdOf(list[0]!.id), REMOTE, false],
      [flowIdOf(list[1]!.id), REMOTE, false],
    ])
    expect(plan.flows[1]!.attributes).toMatchObject({ attributes: { hidden_edge_kind: 'remote-service', technique_ids: ['T1021'], source_exposure_ids: ['e1'], proposed_by: 'rule', tier: 'medium', required_privilege: 'user' } })
    expect(plan.decisions.map((d) => [d.verb, d.flow_id === null])).toEqual([['accepted', false], ['accepted', false], ['rejected', true]])
    // accept 2 named its pending e1: affirmed, with the reason that says so; accept-all affirms nothing
    expect(plan.affirmations.map((o) => [o.exposure_id, o.kind, o.status])).toEqual([['e1', 'AFFIRMED', 'ready']])
    expect(plan.affirmations[0]).toMatchObject({
      reason: `Affirmed by the operator, who named it in "accept … affirm" for hidden edge ${list[1]!.id}; no note given${AFFIRM_MARKER}`,
    })
    expect(plan.lines[1]).toBe('2 hidden edge(s) to add to the local files, 1 to reject, 1 exposure(s) to affirm on the platform')
  })

  it('affirms nothing for a plain accept; a note is the reason; a finding no longer pending is left, and said', async () => {
    const { local, exposures, list, dir } = await candidates()
    const plain = review(local, exposures, list, dir)
    applyHiddenEdgeReply(plain, 'accept 2')
    applyHiddenEdgeReply(plain, 'done')
    expect(planApply(plain, exposures, '2026-11-17T00:00:00.000Z').affirmations).toEqual([])
    const noted = review(local, exposures, list, dir)
    applyHiddenEdgeReply(noted, 'accept 2 affirm 1 note: seen in the lab')
    applyHiddenEdgeReply(noted, 'done')
    const notedPlan = planApply(noted, exposures, 'x')
    expect(notedPlan.affirmations[0]).toMatchObject({ reason: `seen in the lab (affirmed with the accepted hidden edge ${list[1]!.id})${AFFIRM_MARKER}` })
    // the operator sees the reason in full, once per accept, before answering yes
    expect(notedPlan.lines).toContain(`  Affirmed with [2], reason: seen in the lab (affirmed with the accepted hidden edge ${list[1]!.id})${AFFIRM_MARKER}`)
    // decided on the platform since the reply
    const now = new Map([...exposures, ['e1', exposure('e1', 'B', 'confirmed', { disposition_kind: 'AFFIRMED', dispositioned_by: 'someone' })]])
    const plan = planApply(noted, now, 'x')
    expect(plan.affirmations).toEqual([])
    expect(plan.lines).toContain('  Not affirmed (no longer pending with no disposition): "exp e1"')
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

  it('counts as this edge’s affirmation only the reason it generated, 0.7.0’s included, never an id in the operator’s note', () => {
    const id = candidateId('remote-service', 'A', 'B')
    const other = candidateId('remote-service', 'B', 'A')
    const ok = (body: string) => affirmedByEdge(`${body}${AFFIRM_MARKER}`, id)
    expect(ok(affirmReason(null, id))).toBe(true)
    expect(ok(affirmReason('seen in the lab', id))).toBe(true)
    expect(ok(`Affirmed by the accepted hidden edge ${id}`)).toBe(true)
    expect(ok(`Affirmed by the accepted hidden edges ${other}, ${id}`)).toBe(true)
    // another edge's accept, its note naming this one
    expect(ok(affirmReason(`as for ${id}`, other))).toBe(false)
    expect(ok(affirmReason(`${affirmReason(null, id)}`, other))).toBe(false)
    expect(ok(`Affirmed by the accepted hidden edges ${other}`)).toBe(false)
    expect(affirmedByEdge(affirmReason(null, id), id)).toBe(false)
  })

  it('takes back an accepted edge, listing for triage only the findings this edge’s accept affirmed', () => {
    const s = signer()
    const id = candidateId('remote-service', 'A', 'B')
    const d = { ...signDecision(s, { id, kind: 'remote-service', source: 'A', target: 'B', verb: 'accepted', flow_id: 'p-1', technique_ids: ['T1021'], exposure_ids: ['e1', 'e2', 'e3'], at: '' }), verified: true }
    const now = new Map([
      ['e1', exposure('e1', 'B', 'pending')],
      ['e2', exposure('e2', 'SEG', 'confirmed', { full_reason: `${affirmReason(null, id)}${AFFIRM_MARKER}` })],
      // affirmed in triage on its own grounds: not this edge's to mention
      ['e3', exposure('e3', 'B', 'confirmed', { full_reason: 'Reachable from the internet — AI-assisted triage, operator-approved' })],
    ])
    const plan = planRecord(d, now, { id: 'model-1', name: 'Shop' }, '2026-11-17T00:00:00.000Z')
    expect(plan.decision).toMatchObject({ flow_id: null, id: d.id })
    expect(plan.decision).not.toHaveProperty('verb')
    expect(plan.lines.slice(5)).toEqual(['1 exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:', '  "exp e2" (SEG)'])
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
    applyHiddenEdgeReply(r, 'accept 1 affirm 1')
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

describe("a publish's lines", () => {
  it('say each reason for leaving edges out once, with their numbers in ranges; a reason of one edge names it', async () => {
    const { edgePublishLines, ranges } = await import('../publish.js')
    expect(ranges([9, 3, 4, 5, 1, 4])).toBe('1, 3–5, 9')
    const review = { model_name: 'Shop', local: { components: new Map() }, candidates: [] } as unknown as HiddenEdgeReview
    const none = 'the analyst returned no argument for it: decide it here'
    const left = [...[4, 5, 6, 7, 9].map((n) => ({ n, candidate_id: `c${n}`, why: none })), { n: 8, candidate_id: 'c8', why: 'it is in the model already as a flow' }]
    const lines = edgePublishLines(review, { edges: [], left, dropped_locators: 0 }, { analysisId: 'a1' })
    expect(lines.slice(lines.indexOf('Not sent (6 edges):'), lines.indexOf('Not sent (6 edges):') + 3)).toEqual([
      'Not sent (6 edges):',
      `  Edges 4–7, 9 (5), each: ${none}`,
      '  Edge 8: it is in the model already as a flow',
    ])
  })
})
