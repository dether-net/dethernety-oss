/**
 * A synced model directory for the hidden-edge tests: a segment with two services, an external user and a store,
 * one declared flow, and the platform's exposures and the module's answer for it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { computeContentHash } from '../../utils/sync-utils.js'
import { candidateId } from '../contract.js'

export const PLATFORM = 'http://127.0.0.1:9'
export const MODEL_ID = 'model-1'

export const structure = () => ({
  defaultBoundary: {
    id: 'root', name: 'Root',
    boundaries: [{
      id: 'SEG', name: 'Segment', parentBoundary: { id: 'root' }, classData: { id: 'c-seg', name: 'Network Segment' },
      components: [
        { id: 'A', name: 'api', type: 'PROCESS', positionX: 0, positionY: 0, classData: { id: 'c-app', name: 'Application Service' } },
        { id: 'B', name: 'web', type: 'PROCESS', positionX: 0, positionY: 0, classData: { id: 'c-web', name: 'Web Server' } },
        { id: 'D', name: 'db', type: 'STORE', positionX: 0, positionY: 0 },
      ],
    }],
    components: [{ id: 'X', name: 'user', type: 'EXTERNAL_ENTITY', positionX: 0, positionY: 0 }],
  },
})

/** Write a synced model with no local changes; returns its directory. */
export async function syncedModel(repo: string, name: string): Promise<string> {
  const dir = path.join(repo, name)
  fs.mkdirSync(path.join(dir, '.dethereal'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: '2.0.0', format: 'split', model: { id: MODEL_ID, name: 'Shop' }, files: { structure: 'structure.json', dataFlows: 'dataflows.json', dataItems: 'data-items.json' } }))
  fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify(structure()))
  fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: [{ id: 'f1', name: 'query', source: { id: 'A' }, target: { id: 'D' } }] }))
  fs.writeFileSync(path.join(dir, 'data-items.json'), JSON.stringify({ dataItems: [] }))
  await markSynced(dir)
  return dir
}

/** Record the files as pushed: sync.json with the baseline and the content hash. */
export async function markSynced(dir: string): Promise<void> {
  const hash = await computeContentHash(dir)
  fs.writeFileSync(path.join(dir, '.dethereal', 'sync.json'), JSON.stringify({
    platform_model_id: MODEL_ID, platform_url: `${PLATFORM}/`, last_push_at: '2026-11-16T10:00:00.000Z', push_content_hash: hash,
    baseline_element_ids: { boundaries: ['root', 'SEG'], components: ['A', 'B', 'D', 'X'], flows: ['f1'], dataItems: [] },
  }))
}

export const rawExposure = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `exp ${id}`, description: 'desc', type: '1', category: 'cat', score: 5, attackVector: 'NETWORK',
  createdBy: 'SYSTEM', authoredBy: null, dispositionKind: null, dispositionReason: null, dispositionedBy: null,
  dispositionedAt: null, dispositionStale: null, unresolvedReferences: null, exploitedBy: [{ attack_id: 'T1021' }], exploitedByAtlas: [], ...over,
})

/** The platform's model read: e2 (confirmed) on the segment, e1 (pending) on the web server. */
export function platformModel(exposures: { seg: unknown[]; web: unknown[] }) {
  const comp = (id: string, name: string, ex: unknown[] = []) => ({ id, name, componentClass: [], exposures: ex })
  return {
    id: MODEL_ID, name: 'Shop', dataItems: [],
    defaultBoundary: [{
      id: 'root', name: 'Root', securityBoundaryClass: [], exposures: [], allDescendantDataFlows: [{ id: 'f1', name: 'query', dataFlowClass: [], exposures: [] }],
      allDescendantBoundaries: [{ id: 'SEG', name: 'Segment', securityBoundaryClass: [], exposures: exposures.seg }],
      allDescendantComponents: [comp('A', 'api'), comp('B', 'web', exposures.web), comp('D', 'db'), comp('X', 'user')],
    }],
  }
}

/** The hidden-edges module on the test platform, and its remote-service class (test ids). */
export const HE_MODULE = { id: 'mod-hidden-edges', name: 'dethernety-hidden-edges' }
export const REMOTE = { id: 'cls-he-remote-service', name: 'Hidden Edge: Remote Service', module: HE_MODULE }
/** The module's classes on the test platform, as the answer check reads them. */
export const CLASSES: ReadonlyMap<string, typeof REMOTE> = new Map([[REMOTE.id, REMOTE]])
/** The platform's answer to the module lookup. */
export const moduleByName = () => ({ modules: [{ ...HE_MODULE, dataFlowClasses: [{ id: REMOTE.id, name: REMOTE.name, category: 'Hidden Edge' }] }] })

export const candidate = (kind: string, source: string, target: string, exposureIds: string[], over: Record<string, unknown> = {}) => ({
  id: candidateId(kind, source, target), kind, class: { id: REMOTE.id, name: REMOTE.name }, source, target, technique_ids: ['T1021'], cited_techniques: ['T1021'], exposure_ids: exposureIds,
  rows: ['remote-service/rs-1'], tier: 'medium', defaults: { required_capability: 'opportunistic', required_privilege: 'user', granted_privilege: 'user' },
  fields: {}, facts: [], totals: { exposure_ids: exposureIds.length, facts: 0, cited_techniques: 1 }, ...over,
})

export const answerOf = (candidates: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({
  contract: 1, module: 'dethernety-hidden-edges', version: '0.1.0', table_hash: 'a'.repeat(64), regime: { kg: 'kg_absent', reason: 'unavailable' },
  candidates, counts: { excluded_by_decision: 2, kind_budget_dropped: 1, peers_capped: 0 }, ...over,
})

