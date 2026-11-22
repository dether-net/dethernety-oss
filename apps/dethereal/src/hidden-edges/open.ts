/**
 * A hidden-edge run's reads, in order: the model must be synced with no local changes (the module reads the
 * platform, which must be what the files say); then this machine's decisions, the exposure read, and the module's
 * candidates, validated. Nothing is held from an earlier answer.
 */
import { createHash } from 'node:crypto'
import type { ApolloClient } from '@apollo/client'
import { DtModule } from '@dethernety/dt-core'
import { canonicalJson } from '../utils/canonical-json.js'
import { computeContentHash, localChangeStatus, readSyncJson } from '../utils/sync-utils.js'
import { platformModelOf } from '../triage/model.js'
import { readModelExposures, type ExposureState } from '../triage/exposures.js'
import { validateAnswer, type AnswerHeader, type Candidate, type HiddenEdgeClass } from './answer.js'
import { HIDDEN_EDGE_CATEGORY, HIDDEN_EDGES_MODULE } from './contract.js'
import { readLocalModel, type LocalModel } from './local.js'
import { callModule } from './platform.js'
import { decisionsHash, isSigner, readDecisions, signerFor, standing, type ReadDecision } from './records.js'

export class OpenRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** The four counts the operator sees. */
export interface RunCounts {
  candidates: number
  dropped_by_caps: number
  excluded_by_decision: number
  dropped_by_validation: number
}

export interface OpenRun {
  model_id: string
  model_name: string
  local: LocalModel
  exposures: Map<string, ExposureState>
  decisions: ReadDecision[]
  invalid_decisions: number
  /** The module's state: answered, or why not */
  module: { status: string; detail?: string; version?: string }
  header: AnswerHeader | null
  candidates: Candidate[]
  counts: RunCounts
  seen: Seen
}

/** What a run read, which prepare and commit hold the files and the platform to. */
export interface Seen {
  fingerprint: string
  local_hash: string
  decisions_hash: string
  /** The cited exposures, as read */
  exposures: Map<string, ExposureState>
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** The part of an exposure a run is bound to. */
export const exposureBound = (e: ExposureState | undefined) => (e ? [e.lifecycle, e.disposition_kind, e.disposition_stale, e.def_hash, e.full_reason, e.element_id] : null)

/** The hidden-edges module's data flow classes on the platform, by id: the only classes an accepted edge is written with. */
export async function platformClasses(client: ApolloClient): Promise<Map<string, HiddenEdgeClass>> {
  const m = await new DtModule(client).getModuleByName(HIDDEN_EDGES_MODULE)
  const out = new Map<string, HiddenEdgeClass>()
  if (!m || typeof m.id !== 'string' || m.name !== HIDDEN_EDGES_MODULE) return out
  for (const c of m.dataFlowClasses ?? []) {
    if (typeof c?.id === 'string' && typeof c.name === 'string' && c.category === HIDDEN_EDGE_CATEGORY) out.set(c.id, { id: c.id, name: c.name, module: { id: m.id, name: m.name } })
  }
  return out
}

export async function openRun(dir: string, client: ApolloClient): Promise<OpenRun> {
  const modelId = await platformModelOf(dir)
  const status = await localChangeStatus(dir)
  if (status.status === 'local_changes') throw new OpenRefusal('push_first', 'the model has local changes the platform does not have: push first (/dethereal:sync push), then run hidden edges')
  if (status.status !== 'no_local_changes') throw new OpenRefusal('sync_first', 'the model is not in sync with the platform: sync first (/dethereal:sync)')
  const local = await readLocalModel(dir)
  const components = new Set<string>((await readSyncJson(dir))?.baseline_element_ids?.components ?? [])
  const signer = await signerFor(dir, false)
  const read = await readDecisions(dir, isSigner(signer) ? signer : null)
  if (read.status !== 'ok') throw new OpenRefusal('decisions_unreadable', `the hidden-edge decisions (.dethereal/hidden-edges-decisions.json) cannot be read (${read.code}): move the file aside, then run again`)
  const exposuresRead = await readModelExposures(client, modelId)
  const exposures = new Map(exposuresRead.rows.map((r) => [r.exposure_id, r]))

  // Every standing decision keeps its candidate out: a verified accept, or any reject.
  const excluded = [...standing(read.decisions).keys()]
  const call = await callModule(client, modelId, JSON.stringify({ excluded: excluded.slice(0, 2000), include_pending: true }))
  if (call.status === 'session_refused') throw new OpenRefusal('session_refused', call.detail)
  let module: OpenRun['module']
  let header: AnswerHeader | null = null
  let candidates: Candidate[] = []
  const counts: RunCounts = { candidates: 0, dropped_by_caps: 0, excluded_by_decision: 0, dropped_by_validation: 0 }
  let answerHash = ''
  if (call.status !== 'answer') module = { status: call.status, detail: call.detail }
  else {
    answerHash = sha(call.raw)
    // Without the module's classes no candidate can be checked: the module counts as failed, not its candidates as invalid.
    const classes = await platformClasses(client).catch(() => new Map<string, HiddenEdgeClass>())
    const v = classes.size > 0 ? validateAnswer(call.raw, { local, components, exposures, excluded: new Set(excluded), classes }) : null
    if (!v) module = { status: 'module_failed', detail: 'the hidden-edge classes could not be read from the platform' }
    else if (v.status === 'refused') module = { status: v.code, detail: v.detail }
    else {
      module = { status: 'answered', version: v.header.version }
      header = v.header
      candidates = v.candidates
      counts.candidates = candidates.length
      counts.dropped_by_caps = (v.counts.kind_budget_dropped ?? 0) + (v.counts.peers_capped ?? 0) + (v.counts.pairs_over_anchor_budget ?? 0)
      counts.excluded_by_decision = (v.counts.excluded_by_decision ?? 0) + v.excluded
      counts.dropped_by_validation = v.dropped
    }
  }

  const cited = new Set(candidates.flatMap((c) => c.exposure_ids))
  const seenExposures = new Map([...exposures].filter(([id]) => cited.has(id)))
  const localHash = await computeContentHash(dir)
  const decisions = await decisionsHash(dir)
  const fingerprint = sha(canonicalJson({
    local: localHash, decisions, answer: answerHash,
    exposures: [...seenExposures.keys()].sort().map((id) => [id, exposureBound(seenExposures.get(id))]),
  }))
  return {
    model_id: modelId, model_name: exposuresRead.model_name, local, exposures, decisions: read.decisions, invalid_decisions: read.invalid, module, header, candidates, counts,
    seen: { fingerprint, local_hash: localHash, decisions_hash: decisions, exposures: seenExposures },
  }
}
