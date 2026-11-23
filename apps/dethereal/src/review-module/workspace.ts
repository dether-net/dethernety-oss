/**
 * The review module as a review sees it at open: present or not, the model's Triage analysis if one exists (never
 * created here: open asks nothing), and the findings' fingerprints and waiting proposals read from it. Nothing here
 * fails an open: a failure is recorded and a publish reads again.
 */
import type { ApolloClient } from '@apollo/client'
import type { ReviewWorkspace } from '../triage/review.js'
import { WAITING_STATUSES } from './contract.js'
import { findTriageAnalysis, probe, readProposals, readStates } from './platform.js'

export async function workspaceAt(client: ApolloClient, modelId: string, ids: string[], now: number = Date.now()): Promise<ReviewWorkspace> {
  const p = await probe(client)
  if (p.status !== 'present') return { status: p.status, detail: p.detail, fingerprints: 'none', opened_at_ms: now }
  const base = { status: 'present' as const, module_version: p.moduleVersion, triage_class_id: p.triageClassId, opened_at_ms: now }
  const a = await findTriageAnalysis(client, modelId, p.triageClassId)
  if (a.status === 'none') return { ...base, fingerprints: 'none' }
  if (a.status !== 'found') return { ...base, fingerprints: 'failed', detail: a.detail }
  const s = await readStates(client, a.id, ids)
  if (s.status !== 'answer') return { ...base, analysis_id: a.id, fingerprints: 'failed', detail: s.status === 'refused' ? `the states read was refused (${s.reason})` : s.detail }
  const states = new Map<string, { fingerprint: string; fpVersion: number }>()
  for (const [id, st] of s.states) if (!('gone' in st)) states.set(id, { fingerprint: st.fingerprint, fpVersion: st.fpVersion })
  const pr = await readProposals(client, a.id, ids)
  const pending = pr.status === 'answer' ? [...pr.proposals.values()].filter((x) => 'status' in x && WAITING_STATUSES.has(x.status)).length : undefined
  return { ...base, analysis_id: a.id, fingerprints: 'read', states, ...(pending !== undefined ? { pending } : {}) }
}

/** The workspace as open answers it: what the skill shows, without the fingerprints themselves. */
export function workspaceView(ws: ReviewWorkspace | undefined): Record<string, unknown> | undefined {
  if (!ws) return undefined
  return {
    status: ws.status,
    ...(ws.module_version ? { module_version: ws.module_version } : {}),
    ...(ws.analysis_id ? { analysis_id: ws.analysis_id } : {}),
    fingerprints: ws.fingerprints,
    ...(ws.pending !== undefined ? { pending: ws.pending } : {}),
    ...(ws.detail ? { detail: ws.detail } : {}),
  }
}
