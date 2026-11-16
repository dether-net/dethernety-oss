/**
 * Rows, evidence and model views for the triage tests: an exposure as the model read returns it, and as its
 * evidence read does.
 */
import type { ExposureEvidence, ExposureState } from '../exposures.js'
import type { ModelView } from '../review.js'

export function row(id: string, over: Partial<ExposureState> = {}): ExposureState {
  return {
    exposure_id: id,
    name: `Exposure ${id}`,
    type: 'weakness',
    category: 'network',
    score: 5,
    attack_vector: 'NETWORK',
    created_by: 'system',
    authored_by: null,
    disposition_kind: null,
    disposition_reason: null,
    dispositioned_by: null,
    dispositioned_at: null,
    disposition_stale: null,
    lifecycle: 'pending',
    element_id: 'c1',
    element_name: 'API',
    element_kind: 'component',
    element_class: { id: 'k1', name: 'Web API' },
    attack_ids: ['T1190'],
    atlas_ids: [],
    unresolved_references: null,
    def_hash: 'h1',
    full_reason: null,
    ...over,
  }
}

export function evidence(id: string, over: Partial<ExposureEvidence> = {}): ExposureEvidence {
  return {
    exposure_id: id,
    name: `Exposure ${id}`,
    description: 'An open port',
    type: 'weakness',
    category: 'network',
    score: 5,
    attack_vector: 'NETWORK',
    references: 'https://example.test/advisory',
    mitigation_suggestions: ['close it'],
    detection_methods: ['scan'],
    tags: ['net'],
    techniques: ['T1190'],
    created_by: 'system',
    authored_by: null,
    disposition_kind: null,
    disposition_reason: null,
    dispositioned_by: null,
    dispositioned_at: null,
    disposition_stale: null,
    unresolved_references: null,
    lifecycle: 'pending',
    def_hash: 'h1',
    exploited_by: [{ id: 'n-t1190', attack_id: 'T1190', name: 'Exploit Public-Facing Application', description: null }],
    exploited_by_atlas: [{ id: 'n-aml0049', atlas_id: 'AML.T0049', name: 'Exploit Public-Facing Application', description: null }],
    ...over,
  }
}

/** A model view holding `rows`, with evidence for each and two known techniques to add. */
export function viewOf(rows: ExposureState[], over: Partial<ModelView> = {}): ModelView {
  return {
    model_id: 'model-1',
    model_name: 'Shop',
    seen: new Map(rows.map((r) => [r.exposure_id, r])),
    evidence: new Map(rows.map((r) => [r.exposure_id, evidence(r.exposure_id, { name: r.name })])),
    techniques: { attack: new Map([['n-t1059', 'T1059']]), atlas: new Map([['n-aml0051', 'AML.T0051']]) },
    ...over,
  }
}

/** A view of every exposure the groups name, as `rowOf` makes it. */
export function viewFor(groups: Array<{ exposure_ids: string[] }>, rowOf: (id: string) => ExposureState = (id) => row(id)): ModelView {
  return viewOf(groups.flatMap((g) => g.exposure_ids).map(rowOf))
}
