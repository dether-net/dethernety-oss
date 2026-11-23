/**
 * The review module's calls, each bounded in time and size. What comes back is untrusted: every answer is parsed and
 * checked here, and only the fields Dethereal uses are kept.
 */
import { createHash } from 'node:crypto'
import type { ApolloClient, DocumentNode } from '@apollo/client'
import { graphQLErrorCode, isValidationFailure, LOGIN_SENTENCE } from '../triage/kg.js'
import {
  CREATE_TRIAGE_ANALYSIS,
  REVIEW_CAPABILITY,
  REVIEW_FINDING_STATES,
  REVIEW_LIMITS,
  REVIEW_MODULE,
  REVIEW_PROPOSALS,
  REVIEW_PUBLISH,
  TRIAGE_REVIEW_ANALYSES,
} from './contract.js'

/** A call that did not answer: the module is absent, the session was refused, or it failed (by name, never by value). */
export type CallFailure = { status: 'module_not_loaded' | 'session_refused' | 'failed'; detail: string }
/** The module's own refusal envelope: a fixed reason code and, for a payload, the field's path. */
export type ModuleRefusal = { status: 'refused'; reason: string; field?: string }

export type Probe = { status: 'present'; moduleVersion: string; triageClassId: string } | CallFailure

const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN.test(v)
const isReason = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]{1,40}$/.test(v)

/** Send one document and return its field's JSON answer, parsed, or why there is none. */
async function call(client: ApolloClient, kind: 'query' | 'mutation', document: DocumentNode, variables: Record<string, unknown>, field: string): Promise<{ status: 'answer'; value: unknown } | CallFailure> {
  let timer: NodeJS.Timeout | undefined
  try {
    const pending = (kind === 'query'
      ? client.query({ query: document, variables, fetchPolicy: 'no-cache' })
      : client.mutate({ mutation: document, variables })) as Promise<{ data?: unknown }>
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), REVIEW_LIMITS.timeoutMs)
    })
    const r = await Promise.race([pending, expired])
    if (r === 'expired') return { status: 'failed', detail: 'the review module did not answer in time' }
    const raw = (r.data as Record<string, unknown> | undefined)?.[field]
    if (typeof raw !== 'string') return { status: 'failed', detail: 'the review module returned no answer' }
    if (raw.length > REVIEW_LIMITS.answerChars) return { status: 'failed', detail: 'the review module answer is too large' }
    try {
      return { status: 'answer', value: JSON.parse(raw) }
    } catch {
      return { status: 'failed', detail: 'the review module answer is not JSON' }
    }
  } catch (err) {
    if (isValidationFailure(err)) return { status: 'module_not_loaded', detail: `the platform has no ${REVIEW_MODULE} module` }
    if (graphQLErrorCode(err) === 'UNAUTHENTICATED') return { status: 'session_refused', detail: LOGIN_SENTENCE }
    const code = graphQLErrorCode(err)
    return { status: 'failed', detail: `the review module call failed${code ? ` (${code})` : ''}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** A `{ok: false, reason}` answer, or null. */
function refusalOf(value: unknown): ModuleRefusal | null {
  const v = value as { ok?: unknown; reason?: unknown; field?: unknown } | null
  if (!v || typeof v !== 'object' || v.ok !== false) return null
  // a field is named by its path's form only; anything else goes out unnamed
  const field = typeof v.field === 'string' ? (/^[A-Za-z0-9_.[\]]{1,200}$/.test(v.field) ? v.field : '(unnamed field)') : undefined
  return { status: 'refused', reason: isReason(v.reason) ? v.reason : 'unknown', ...(field ? { field } : {}) }
}

/** Is the module there, and which class is its Triage class. */
export async function probe(client: ApolloClient): Promise<Probe> {
  const r = await call(client, 'query', REVIEW_CAPABILITY, {}, 'reviewCapability')
  if (r.status !== 'answer') return r
  const v = r.value as { ok?: unknown; moduleVersion?: unknown; triageClassId?: unknown } | null
  if (v?.ok !== true || !isToken(v.triageClassId)) return { status: 'failed', detail: 'the review module answered no Triage class' }
  const version = typeof v.moduleVersion === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(v.moduleVersion) ? v.moduleVersion : 'unknown'
  return { status: 'present', moduleVersion: version, triageClassId: v.triageClassId }
}

/** The id two harnesses, or two runs, agree on for a model's Triage analysis: public, derived, never secret. */
export function deterministicAnalysisId(modelId: string, triageClassId: string): string {
  const h = createHash('sha256').update(`dethereal-triage\0${modelId}\0${triageClassId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export type AnalysisLookup = { status: 'found'; id: string } | { status: 'none' } | CallFailure

/** The model's Triage analyses bound to it alone, with their creation times: what the module's gate takes. */
export async function triageAnalysesOf(client: ApolloClient, modelId: string, triageClassId: string): Promise<{ status: 'answer'; analyses: Array<{ id: string; createdAt: unknown }> } | CallFailure> {
  let data: unknown
  let timer: NodeJS.Timeout | undefined
  try {
    const pending = client.query({ query: TRIAGE_REVIEW_ANALYSES, variables: { classId: triageClassId, modelId }, fetchPolicy: 'no-cache' }) as Promise<{ data?: unknown }>
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), REVIEW_LIMITS.timeoutMs)
    })
    const r = await Promise.race([pending, expired])
    if (r === 'expired') return { status: 'failed', detail: 'the analysis lookup did not answer in time' }
    data = r.data
  } catch (err) {
    if (graphQLErrorCode(err) === 'UNAUTHENTICATED') return { status: 'session_refused', detail: LOGIN_SENTENCE }
    const code = graphQLErrorCode(err)
    return { status: 'failed', detail: `the analysis lookup failed${code ? ` (${code})` : ''}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
  const rows = (data as { analyses?: unknown } | undefined)?.analyses
  if (!Array.isArray(rows)) return { status: 'failed', detail: 'the analysis lookup returned no list' }
  const analyses = rows
    .filter((a): a is { id: string; createdAt?: unknown; model?: unknown } => !!a && typeof a === 'object' && isToken((a as { id?: unknown }).id))
    .filter((a) => Array.isArray(a.model) && a.model.length === 1 && (a.model[0] as { id?: unknown })?.id === modelId)
    .map((a) => ({ id: a.id, createdAt: a.createdAt }))
  return { status: 'answer', analyses }
}

/**
 * The model's Triage analysis, never created here: the deterministic id first, else the oldest by its own creation
 * time (an empty time last, ties by id). An analysis bound to more than one model is passed over: the module's gate
 * refuses it.
 */
export async function findTriageAnalysis(client: ApolloClient, modelId: string, triageClassId: string): Promise<AnalysisLookup> {
  const listed = await triageAnalysesOf(client, modelId, triageClassId)
  if (listed.status !== 'answer') return listed
  const candidates = listed.analyses
  const preferred = deterministicAnalysisId(modelId, triageClassId)
  if (candidates.some((a) => a.id === preferred)) return { status: 'found', id: preferred }
  if (!candidates.length) return { status: 'none' }
  const at = (a: { createdAt?: unknown }) => (typeof a.createdAt === 'string' && !Number.isNaN(Date.parse(a.createdAt)) ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY)
  const oldest = [...candidates].sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!
  return { status: 'found', id: oldest.id }
}

/** Create the model's Triage analysis with the deterministic id: a MERGE, so a second create meets the first. */
export async function createTriageAnalysis(client: ApolloClient, modelId: string, triageClassId: string): Promise<{ status: 'created'; id: string } | CallFailure> {
  const id = deterministicAnalysisId(modelId, triageClassId)
  try {
    const r = (await client.mutate({
      mutation: CREATE_TRIAGE_ANALYSIS,
      variables: { id, name: 'Triage', description: "Dethereal's triage proposals, for a person to decide", elementId: modelId, analysisClassId: triageClassId },
    })) as { data?: { createAnalysisIdempotent?: { id?: unknown } } }
    if (r.data?.createAnalysisIdempotent?.id !== id) return { status: 'failed', detail: 'the platform did not confirm the Triage analysis' }
    return { status: 'created', id }
  } catch (err) {
    if (graphQLErrorCode(err) === 'UNAUTHENTICATED') return { status: 'session_refused', detail: LOGIN_SENTENCE }
    const code = graphQLErrorCode(err)
    return { status: 'failed', detail: `creating the Triage analysis failed${code ? ` (${code})` : ''}` }
  }
}

export type FindingState = { kind: string | null; at: string | null; fingerprint: string; fpVersion: number } | { gone: true }

/** The findings' dispositions and fingerprints, as the module computes them for this analysis's model. */
export async function readStates(client: ApolloClient, analysisId: string, ids: string[]): Promise<{ status: 'answer'; states: Map<string, FindingState> } | ModuleRefusal | CallFailure> {
  const states = new Map<string, FindingState>()
  for (let i = 0; i < ids.length; i += REVIEW_LIMITS.idsPerCall) {
    const r = await call(client, 'query', REVIEW_FINDING_STATES, { analysisId, exposureIds: ids.slice(i, i + REVIEW_LIMITS.idsPerCall) }, 'reviewFindingStates')
    if (r.status !== 'answer') return r
    const refused = refusalOf(r.value)
    if (refused) return refused
    const rows = (r.value as { states?: unknown })?.states
    if (!Array.isArray(rows)) return { status: 'failed', detail: 'the states read returned no list' }
    for (const s of rows as Array<Record<string, unknown>>) {
      if (!s || !isToken(s.exposureId)) continue
      if (s.gone === true) states.set(s.exposureId, { gone: true })
      else if (typeof s.fingerprint === 'string' && /^sha256:[0-9a-f]{64}$/.test(s.fingerprint) && typeof s.fpVersion === 'number') {
        // a kind is a platform kind's form, a time an instant; anything else is not passed on
        const kind = typeof s.kind === 'string' && /^[A-Z_]{1,40}$/.test(s.kind) ? s.kind : null
        const at = typeof s.at === 'string' && s.at.length <= 40 && !Number.isNaN(Date.parse(s.at)) ? s.at : null
        states.set(s.exposureId, { kind, at, fingerprint: s.fingerprint, fpVersion: s.fpVersion })
      }
    }
  }
  return { status: 'answer', states }
}

/** A stored proposal as the read-back uses it: its status and who did what, nothing else. */
export type StoredProposal =
  | { status: string; drift: 'stale' | 'stale_module' | null; reviewId: string | null; proposedBy: string | null; rejectedBy: string | null; rejectedAt: string | null; rejectedNote: string | null }
  | { none: true }
  | { gone: true }

export async function readProposals(client: ApolloClient, analysisId: string, ids: string[]): Promise<{ status: 'answer'; proposals: Map<string, StoredProposal> } | ModuleRefusal | CallFailure> {
  const proposals = new Map<string, StoredProposal>()
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)
  for (let i = 0; i < ids.length; i += REVIEW_LIMITS.idsPerCall) {
    const r = await call(client, 'query', REVIEW_PROPOSALS, { analysisId, exposureIds: ids.slice(i, i + REVIEW_LIMITS.idsPerCall) }, 'reviewProposals')
    if (r.status !== 'answer') return r
    const refused = refusalOf(r.value)
    if (refused) return refused
    const rows = (r.value as { proposals?: unknown })?.proposals
    if (!Array.isArray(rows)) return { status: 'failed', detail: 'the proposals read returned no list' }
    for (const p of rows as Array<Record<string, unknown>>) {
      if (!p || !isToken(p.exposureId)) continue
      if (p.gone === true) proposals.set(p.exposureId, { gone: true })
      else if (p.none === true) proposals.set(p.exposureId, { none: true })
      else if (isReason(p.status)) {
        proposals.set(p.exposureId, {
          status: p.status,
          drift: p.drift === 'stale' || p.drift === 'stale_module' ? p.drift : null,
          reviewId: str(p.reviewId, 128),
          proposedBy: str(p.proposedBy, 200),
          rejectedBy: str(p.rejectedBy, 200),
          rejectedAt: str(p.rejectedAt, 40),
          rejectedNote: str(p.rejectedNote, 2000),
        })
      }
    }
  }
  return { status: 'answer', proposals }
}

export const PUBLISH_RESULTS = ['stored', 'stored_stale', 'already_decided', 'rejected', 'changed_since_review', 'finding_not_found'] as const
export type PublishResult = (typeof PUBLISH_RESULTS)[number]

/** One publish: the module's answer per finding, or its refusal. */
export async function publishProposals(client: ApolloClient, analysisId: string, payload: string): Promise<{ status: 'answer'; results: Array<{ exposureId: string; result: PublishResult }> } | ModuleRefusal | CallFailure> {
  const r = await call(client, 'mutation', REVIEW_PUBLISH, { analysisId, payload }, 'reviewPublishProposals')
  if (r.status !== 'answer') return r
  const refused = refusalOf(r.value)
  if (refused) return refused
  const rows = (r.value as { results?: unknown })?.results
  if (!Array.isArray(rows)) return { status: 'failed', detail: 'the publish returned no results' }
  const results = (rows as Array<Record<string, unknown>>)
    .filter((x) => x && isToken(x.exposureId) && (PUBLISH_RESULTS as readonly unknown[]).includes(x.result))
    .map((x) => ({ exposureId: x.exposureId as string, result: x.result as PublishResult }))
  return { status: 'answer', results }
}
