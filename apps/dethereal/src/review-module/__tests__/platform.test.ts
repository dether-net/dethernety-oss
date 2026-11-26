/**
 * The review module's calls against a fake client: detection, the Triage analysis lookup and create, and the
 * reads, each answer checked before it is used.
 */
import { describe, it, expect } from 'vitest'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'
import { createTriageAnalysis, deterministicAnalysisId, findTriageAnalysis, probe, publishProposals, readProposals, readStates } from '../platform.js'
import { workspaceAt, workspaceView } from '../workspace.js'

const CLASS = 'class-triage'
const MODEL = 'model-1'
const FP = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`

type Answers = Record<string, (variables: Record<string, unknown>) => unknown>
function client(answers: Answers, sent: Array<{ name: string; variables: Record<string, unknown> }> = []): ApolloClient {
  const run = async (doc: { definitions: Array<{ kind: string; name?: { value: string } }> }, variables: Record<string, unknown>) => {
    const name = doc.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value ?? '?'
    sent.push({ name, variables })
    const answer = answers[name]
    if (!answer) throw new Error(`unexpected ${name}`)
    return { data: answer(variables) }
  }
  return {
    query: (o: { query: never; variables?: Record<string, unknown> }) => run(o.query, o.variables ?? {}),
    mutate: (o: { mutation: never; variables?: Record<string, unknown> }) => run(o.mutation, o.variables ?? {}),
  } as unknown as ApolloClient
}
const missing = () => {
  throw new CombinedGraphQLErrors({ errors: [{ message: 'Cannot query field', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] } as never)
}
const unauthenticated = () => {
  throw new CombinedGraphQLErrors({ errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] } as never)
}
const capability = () => ({ reviewCapability: JSON.stringify({ ok: true, moduleVersion: '0.1.0', triageClassId: CLASS }) })

describe('detection', () => {
  it('present, with the Triage class; absent by validation; a refused session; any other failure by name', async () => {
    expect(await probe(client({ ReviewCapability: capability }))).toEqual({ status: 'present', moduleVersion: '0.1.0', triageClassId: CLASS, hiddenEdgesClassId: null })
    // a version with the Hidden edges workspace names its class; an id out of form is none
    const withEdges = (id: unknown) => () => ({ reviewCapability: JSON.stringify({ ok: true, moduleVersion: '0.2.0', triageClassId: CLASS, hiddenEdgesClassId: id }) })
    expect(await probe(client({ ReviewCapability: withEdges('he-class') }))).toMatchObject({ status: 'present', hiddenEdgesClassId: 'he-class' })
    expect(await probe(client({ ReviewCapability: withEdges('bad id!') }))).toMatchObject({ status: 'present', hiddenEdgesClassId: null })
    expect((await probe(client({ ReviewCapability: missing }))).status).toBe('module_not_loaded')
    expect((await probe(client({ ReviewCapability: unauthenticated }))).status).toBe('session_refused')
    expect(await probe(client({ ReviewCapability: () => ({ reviewCapability: 'not json' }) }))).toEqual({ status: 'failed', detail: 'the review module answer is not JSON' })
    expect((await probe(client({ ReviewCapability: () => ({ reviewCapability: JSON.stringify({ ok: true }) }) }))).status).toBe('failed')
  })
})

describe("the model's Triage analysis", () => {
  const det = deterministicAnalysisId(MODEL, CLASS)
  const lookup = (rows: unknown[]) => client({ TriageReviewAnalyses: () => ({ analyses: rows }) })
  const one = (id: string, createdAt: string | null, models = [MODEL]) => ({ id, createdAt, model: models.map((m) => ({ id: m })) })

  it('the deterministic id is stable, per model and class, and shaped as a UUID', () => {
    expect(det).toBe(deterministicAnalysisId(MODEL, CLASS))
    expect(det).not.toBe(deterministicAnalysisId('model-2', CLASS))
    expect(det).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Triage's id is the one it always was; another kind of analysis derives its own
    expect(deterministicAnalysisId(MODEL, CLASS, 'dethereal-triage')).toBe(det)
    expect(deterministicAnalysisId(MODEL, CLASS, 'dethereal-hidden-edges')).not.toBe(det)
  })

  it('the deterministic one first; else the oldest, an empty time last, ties by id; one bound to two models passed over', async () => {
    expect(await findTriageAnalysis(lookup([one('a-old', '2026-01-01T00:00:00Z'), one(det, '2026-06-01T00:00:00Z')]), MODEL, CLASS)).toEqual({ status: 'found', id: det })
    expect(await findTriageAnalysis(lookup([one('b', null), one('c', '2026-03-01T00:00:00Z'), one('a', '2026-03-01T00:00:00Z')]), MODEL, CLASS)).toEqual({ status: 'found', id: 'a' })
    expect(await findTriageAnalysis(lookup([one('two', '2026-01-01T00:00:00Z', [MODEL, 'model-2']), one('mine', null)]), MODEL, CLASS)).toEqual({ status: 'found', id: 'mine' })
    expect(await findTriageAnalysis(lookup([]), MODEL, CLASS)).toEqual({ status: 'none' })
  })

  it('created with the deterministic id, through the idempotent create', async () => {
    const sent: Array<{ name: string; variables: Record<string, unknown> }> = []
    const c = client({ CreateTriageAnalysis: (v) => ({ createAnalysisIdempotent: { id: v.id } }) }, sent)
    expect(await createTriageAnalysis(c, MODEL, CLASS)).toEqual({ status: 'created', id: det })
    expect(sent[0]!.variables).toMatchObject({ id: det, name: 'Triage', elementId: MODEL, analysisClassId: CLASS })
    expect((await createTriageAnalysis(client({ CreateTriageAnalysis: () => ({ createAnalysisIdempotent: { id: 'other' } }) }), MODEL, CLASS)).status).toBe('failed')
  })
})

describe('the reads and the publish', () => {
  it("the states, the proposals and the publish's results, unexpected entries dropped; a refusal by its code", async () => {
    const c = client({
      ReviewFindingStates: () => ({ reviewFindingStates: JSON.stringify({ ok: true, states: [{ exposureId: 'e1', kind: null, at: null, stale: false, fingerprint: FP(1), fpVersion: 3 }, { exposureId: 'e2', gone: true }, { exposureId: 'e3', fingerprint: 'nope' }] }) }),
      ReviewProposals: () => ({ reviewProposals: JSON.stringify({ ok: true, proposals: [{ exposureId: 'e1', status: 'rejected', rejectedBy: 'bob', rejectedNote: 'n', reviewId: 'r' }, { exposureId: 'e2', none: true }] }) }),
      ReviewPublishProposals: () => ({ reviewPublishProposals: JSON.stringify({ ok: true, results: [{ exposureId: 'e1', result: 'stored' }, { exposureId: 'e2', result: 'bogus' }] }) }),
    })
    const s = await readStates(c, 'a1', ['e1', 'e2', 'e3'])
    expect(s.status === 'answer' && [...s.states]).toEqual([['e1', { kind: null, at: null, fingerprint: FP(1), fpVersion: 3 }], ['e2', { gone: true }]])
    const p = await readProposals(c, 'a1', ['e1', 'e2'])
    expect(p.status === 'answer' && p.proposals.get('e1')).toMatchObject({ status: 'rejected', rejectedBy: 'bob' })
    expect(await publishProposals(c, 'a1', '{}')).toEqual({ status: 'answer', results: [{ exposureId: 'e1', result: 'stored' }] })
    const refused = client({ ReviewPublishProposals: () => ({ reviewPublishProposals: JSON.stringify({ ok: false, reason: 'too_large', field: 'proposals' }) }) })
    expect(await publishProposals(refused, 'a1', '{}')).toEqual({ status: 'refused', reason: 'too_large', field: 'proposals' })
  })

  it('reads at most 2000 ids per call', async () => {
    const sent: Array<{ name: string; variables: Record<string, unknown> }> = []
    const c = client({ ReviewFindingStates: () => ({ reviewFindingStates: JSON.stringify({ ok: true, states: [] }) }) }, sent)
    await readStates(c, 'a1', Array.from({ length: 2001 }, (_, i) => `e${i}`))
    expect(sent.map((x) => (x.variables.exposureIds as string[]).length)).toEqual([2000, 1])
  })
})

describe('the workspace at open', () => {
  const det = deterministicAnalysisId(MODEL, CLASS)
  const present = (extra: Answers = {}) => client({
    ReviewCapability: capability,
    TriageReviewAnalyses: () => ({ analyses: [{ id: det, createdAt: null, model: [{ id: MODEL }] }] }),
    ReviewFindingStates: () => ({ reviewFindingStates: JSON.stringify({ ok: true, states: [{ exposureId: 'e1', kind: null, at: null, fingerprint: FP(1), fpVersion: 3 }] }) }),
    ReviewProposals: () => ({ reviewProposals: JSON.stringify({ ok: true, proposals: [{ exposureId: 'e1', status: 'open' }, { exposureId: 'e2', status: 'rejected' }] }) }),
    ...extra,
  })

  it('present with an analysis: its fingerprints and the proposals still waiting', async () => {
    const ws = await workspaceAt(present(), MODEL, ['e1', 'e2'], 1000)
    expect(workspaceView(ws)).toEqual({ status: 'present', module_version: '0.1.0', analysis_id: det, fingerprints: 'read', pending: 1 })
    expect([...ws.states!]).toEqual([['e1', { fingerprint: FP(1), fpVersion: 3 }]])
  })

  it('no analysis yet: none created, no fingerprints', async () => {
    const sent: Array<{ name: string; variables: Record<string, unknown> }> = []
    const c = client({ ReviewCapability: capability, TriageReviewAnalyses: () => ({ analyses: [] }) }, sent)
    expect(workspaceView(await workspaceAt(c, MODEL, ['e1']))).toEqual({ status: 'present', module_version: '0.1.0', fingerprints: 'none' })
    expect(sent.map((x) => x.name)).toEqual(['ReviewCapability', 'TriageReviewAnalyses'])
  })

  it('a failed states read is recorded, never thrown; the module absent says so', async () => {
    const ws = await workspaceAt(present({ ReviewFindingStates: () => ({ reviewFindingStates: JSON.stringify({ ok: false, reason: 'busy' }) }) }), MODEL, ['e1'])
    expect(workspaceView(ws)).toMatchObject({ status: 'present', analysis_id: det, fingerprints: 'failed', detail: 'the states read was refused (busy)' })
    expect(workspaceView(await workspaceAt(client({ ReviewCapability: missing }), MODEL, ['e1']))).toMatchObject({ status: 'module_not_loaded', fingerprints: 'none' })
  })
})
