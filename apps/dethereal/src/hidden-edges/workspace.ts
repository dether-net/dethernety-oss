/**
 * The review module's Hidden edges workspace as a review sees it at open: present or not, the model's Hidden edges
 * analysis if one exists (never created here: open asks nothing), and the candidates' fingerprints and states read
 * from it. Nothing here fails an open: a failure is recorded, and a publish reads again.
 */
import type { ApolloClient } from '@apollo/client'
import { findAnalysis, HIDDEN_EDGES_ANALYSIS, probe, readEdgeStates, type EdgeRef } from '../review-module/platform.js'
import type { Candidate } from './answer.js'

export interface EdgeWorkspace {
  status: 'present' | 'no_hidden_edges' | 'module_not_loaded' | 'session_refused' | 'failed'
  module_version?: string
  hidden_edges_class_id?: string
  analysis_id?: string
  fingerprints: 'read' | 'none' | 'failed'
  /** Per candidate id: its fingerprint, and whether the model holds it or the workspace rejected it */
  states?: Map<string, { fingerprint: string; fpVersion: number; inModel: boolean; rejected: boolean }>
  detail?: string
  opened_at_ms: number
}

export const edgeRefOf = (c: Pick<Candidate, 'id' | 'kind' | 'source' | 'target' | 'exposure_ids'>): EdgeRef => ({ candidateId: c.id, kind: c.kind, source: c.source, target: c.target, exposureIds: c.exposure_ids })

export async function edgeWorkspaceAt(client: ApolloClient, modelId: string, candidates: Candidate[], now: number = Date.now()): Promise<EdgeWorkspace> {
  const p = await probe(client)
  if (p.status !== 'present') return { status: p.status, detail: p.detail, fingerprints: 'none', opened_at_ms: now }
  if (!p.hiddenEdgesClassId) return { status: 'no_hidden_edges', module_version: p.moduleVersion, detail: 'this version of the review module has no Hidden edges workspace', fingerprints: 'none', opened_at_ms: now }
  const base = { status: 'present' as const, module_version: p.moduleVersion, hidden_edges_class_id: p.hiddenEdgesClassId, opened_at_ms: now }
  const a = await findAnalysis(client, modelId, p.hiddenEdgesClassId, HIDDEN_EDGES_ANALYSIS)
  if (a.status === 'none') return { ...base, fingerprints: 'none' }
  if (a.status !== 'found') return { ...base, fingerprints: 'failed', detail: a.detail }
  if (!candidates.length) return { ...base, analysis_id: a.id, fingerprints: 'none' }
  const s = await readEdgeStates(client, a.id, candidates.map(edgeRefOf))
  if (s.status !== 'answer') return { ...base, analysis_id: a.id, fingerprints: 'failed', detail: s.status === 'refused' ? `the edge states read was refused (${s.reason})` : s.detail }
  const states: NonNullable<EdgeWorkspace['states']> = new Map()
  for (const [id, st] of s.states) if (!('gone' in st)) states.set(id, st)
  return { ...base, analysis_id: a.id, fingerprints: 'read', states }
}

/** The workspace as open answers it: what the skill shows and asks on, without the fingerprints themselves. */
export function edgeWorkspaceView(ws: EdgeWorkspace | undefined): Record<string, unknown> | undefined {
  if (!ws) return undefined
  const held = ws.states ? [...ws.states.values()] : []
  return {
    status: ws.status,
    ...(ws.module_version ? { module_version: ws.module_version } : {}),
    ...(ws.analysis_id ? { analysis_id: ws.analysis_id } : {}),
    fingerprints: ws.fingerprints,
    ...(ws.states ? { in_model: held.filter((s) => s.inModel).length, rejected_there: held.filter((s) => s.rejected).length } : {}),
    ...(ws.detail ? { detail: ws.detail } : {}),
  }
}
