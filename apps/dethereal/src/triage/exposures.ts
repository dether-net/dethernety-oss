/**
 * Reading a model's exposures for triage: every exposure of a model in one query, as compact rows with their
 * disposition lifecycle and definition hash, and one exposure's full evidence.
 *
 * The model query walks the boundary tree from the model's anchor boundary, which `allDescendantBoundaries`
 * leaves out, so the anchor is selected itself. `description` is selected only to compute the definition hash.
 */
import { createHash } from 'node:crypto'
import { gql } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'

const EXPOSURE_ROW = gql`
  fragment TriageExposureRow on Exposure {
    id
    name
    description
    type
    category
    score
    attackVector
    createdBy
    authoredBy
    dispositionKind
    dispositionReason
    dispositionedBy
    dispositionedAt
    dispositionStale
    unresolvedReferences
    exploitedBy {
      attack_id
    }
    exploitedByAtlas {
      atlas_id
    }
  }
`

export const LIST_MODEL_EXPOSURES = gql`
  ${EXPOSURE_ROW}
  query TriageModelExposures($modelId: ID!) {
    models(where: { id: { eq: $modelId } }) {
      id
      name
      dataItems {
        id
        name
        dataClass { id name }
        exposures { ...TriageExposureRow }
      }
      defaultBoundary {
        id
        name
        securityBoundaryClass { id name }
        exposures { ...TriageExposureRow }
        allDescendantBoundaries {
          id
          name
          securityBoundaryClass { id name }
          exposures { ...TriageExposureRow }
        }
        allDescendantComponents {
          id
          name
          componentClass { id name }
          exposures { ...TriageExposureRow }
        }
        allDescendantDataFlows {
          id
          name
          dataFlowClass { id name }
          exposures { ...TriageExposureRow }
        }
      }
    }
  }
`

export const GET_EXPOSURE_EVIDENCE = gql`
  query TriageExposureEvidence($exposureId: ID!) {
    exposures(where: { id: { eq: $exposureId } }) {
      id
      name
      description
      type
      category
      score
      references
      mitigationSuggestions
      detectionMethods
      tags
      techniques
      attackVector
      createdBy
      authoredBy
      dispositionKind
      dispositionReason
      dispositionedBy
      dispositionedAt
      dispositionStale
      unresolvedReferences
      exploitedBy { id attack_id name description }
      exploitedByAtlas { id atlas_id name description }
    }
  }
`

export type ElementKind = 'component' | 'securityBoundary' | 'dataFlow' | 'dataItem'
export type Lifecycle = 'pending' | 'confirmed' | 'disposed'

interface RawRow {
  id: string
  name: string
  description: string | null
  type: string | null
  category: string | null
  score: number | null
  attackVector: string | null
  createdBy: string | null
  authoredBy: string | null
  dispositionKind: string | null
  dispositionReason: string | null
  dispositionedBy: string | null
  dispositionedAt: string | null
  dispositionStale: boolean | null
  unresolvedReferences: string[] | null
  exploitedBy: Array<{ attack_id: string | null }>
  exploitedByAtlas: Array<{ atlas_id: string | null }>
}

interface RawElement {
  id: string
  name: string
  componentClass?: Array<{ id: string; name: string }>
  securityBoundaryClass?: Array<{ id: string; name: string }>
  dataClass?: Array<{ id: string; name: string }>
  dataFlowClass?: Array<{ id: string; name: string }>
  exposures?: RawRow[]
}

interface RawModel {
  id: string
  name: string
  dataItems?: RawElement[]
  defaultBoundary?: Array<RawElement & { allDescendantBoundaries?: RawElement[]; allDescendantComponents?: RawElement[]; allDescendantDataFlows?: RawElement[] }>
}

/** One exposure of a model, as triage lists it. `disposition_reason` is cut to its first 200 characters. */
export interface ExposureRow {
  exposure_id: string
  name: string
  type: string | null
  category: string | null
  score: number | null
  attack_vector: string | null
  created_by: string | null
  authored_by: string | null
  disposition_kind: string | null
  disposition_reason: string | null
  dispositioned_by: string | null
  dispositioned_at: string | null
  disposition_stale: boolean | null
  lifecycle: Lifecycle
  element_id: string
  element_name: string
  element_kind: ElementKind
  element_class: { id: string; name: string } | null
  attack_ids: string[]
  atlas_ids: string[]
  unresolved_references: string[] | null
  def_hash: string
}

/** A row with the full disposition reason, as a disposition plan checks it. */
export interface ExposureState extends ExposureRow {
  full_reason: string | null
}

export interface ModelExposures {
  model_id: string
  model_name: string
  rows: ExposureState[]
  totals: { pending: number; confirmed: number; disposed: number; stale: number; user: number; system: number }
  elements_without_exposures: Array<{ id: string; name: string; kind: ElementKind }>
  /** Every element of the model, once each, in the order the model was read */
  elements: Array<{ id: string; name: string; kind: ElementKind }>
  element_count: number
}

/** The listed reason's length. */
export const ROW_REASON_MAX = 200

/**
 * The disposition lifecycle the platform's five disposition fields imply: AFFIRMED by someone is confirmed, by no
 * one pending; any other kind is disposed; no kind is confirmed for a user-authored exposure and pending otherwise.
 */
export function lifecycleOf(e: { dispositionKind: string | null; dispositionedBy: string | null; createdBy: string | null }): Lifecycle {
  if (e.dispositionKind === 'AFFIRMED') return e.dispositionedBy ? 'confirmed' : 'pending'
  if (e.dispositionKind != null) return 'disposed'
  return e.createdBy === 'USER' ? 'confirmed' : 'pending'
}

/**
 * The definition hash: sha256 of the description, the sorted technique ids (ATT&CK and ATLAS in one list), the
 * type and the category. Two exposures with one definition share it.
 */
export function defHashOf(description: string | null, techniqueIds: Array<string | null>, type: string | null, category: string | null): string {
  const ids = techniqueIds.filter((id): id is string => id != null).slice().sort()
  return createHash('sha256').update(`${description ?? ''} ${ids.join(',')} ${type ?? ''} ${category ?? ''}`, 'utf8').digest('hex')
}

function stateOf(raw: RawRow, element: RawElement, kind: ElementKind): ExposureState {
  const classes = element.componentClass ?? element.securityBoundaryClass ?? element.dataClass ?? element.dataFlowClass
  const attack = (raw.exploitedBy ?? []).map((t) => t.attack_id)
  const atlas = (raw.exploitedByAtlas ?? []).map((t) => t.atlas_id)
  return {
    exposure_id: raw.id,
    name: raw.name,
    type: raw.type,
    category: raw.category,
    score: raw.score,
    attack_vector: raw.attackVector,
    created_by: raw.createdBy,
    authored_by: raw.authoredBy,
    disposition_kind: raw.dispositionKind,
    disposition_reason: raw.dispositionReason == null ? null : raw.dispositionReason.slice(0, ROW_REASON_MAX),
    full_reason: raw.dispositionReason,
    dispositioned_by: raw.dispositionedBy,
    dispositioned_at: raw.dispositionedAt,
    disposition_stale: raw.dispositionStale,
    lifecycle: lifecycleOf(raw),
    element_id: element.id,
    element_name: element.name,
    element_kind: kind,
    element_class: classes?.length ? { id: classes[0]!.id, name: classes[0]!.name } : null,
    attack_ids: attack.filter((id): id is string => id != null),
    atlas_ids: atlas.filter((id): id is string => id != null),
    unresolved_references: raw.unresolvedReferences ?? null,
    def_hash: defHashOf(raw.description, [...attack, ...atlas], raw.type, raw.category),
  }
}

/**
 * Every exposure of a model, once each (an exposure reached through two elements keeps the first), with the totals
 * and the elements that have none.
 */
export function foldModel(model: RawModel): ModelExposures {
  const anchors = model.defaultBoundary ?? []
  const collections: Array<{ elements: RawElement[]; kind: ElementKind }> = [
    { elements: model.dataItems ?? [], kind: 'dataItem' },
    { elements: anchors, kind: 'securityBoundary' },
    { elements: anchors.flatMap((b) => b.allDescendantBoundaries ?? []), kind: 'securityBoundary' },
    { elements: anchors.flatMap((b) => b.allDescendantComponents ?? []), kind: 'component' },
    { elements: anchors.flatMap((b) => b.allDescendantDataFlows ?? []), kind: 'dataFlow' },
  ]
  const rows: ExposureState[] = []
  const seenExposures = new Set<string>()
  const seenElements = new Set<string>()
  const without: ModelExposures['elements_without_exposures'] = []
  const index: ModelExposures['elements'] = []
  for (const { elements, kind } of collections) {
    for (const element of elements) {
      if (seenElements.has(element.id)) continue
      seenElements.add(element.id)
      index.push({ id: element.id, name: element.name, kind })
      if (!element.exposures?.length) {
        without.push({ id: element.id, name: element.name, kind })
        continue
      }
      for (const raw of element.exposures) {
        if (seenExposures.has(raw.id)) continue
        seenExposures.add(raw.id)
        rows.push(stateOf(raw, element, kind))
      }
    }
  }
  const totals = { pending: 0, confirmed: 0, disposed: 0, stale: 0, user: 0, system: 0 }
  for (const r of rows) {
    totals[r.lifecycle]++
    if (r.disposition_stale === true) totals.stale++
    if (r.created_by === 'USER') totals.user++
    else totals.system++
  }
  return { model_id: model.id, model_name: model.name, rows, totals, elements_without_exposures: without, elements: index, element_count: seenElements.size }
}

/** How long the model read may take, and how large its result may be (characters of JSON). */
export const MODEL_READ_LIMITS = { timeoutMs: 60_000, resultChars: 4 * 1024 * 1024 } as const

/** Why a model read gave no result: the platform has no such model, it took too long, or the result is too large. */
export class ModelReadError extends Error {
  constructor(readonly code: 'model_not_found' | 'read_timed_out' | 'model_too_large', message: string) {
    super(message)
    this.name = 'ModelReadError'
  }
}

/** Read every exposure of the platform model `modelId`. */
export async function readModelExposures(client: ApolloClient, modelId: string, limits: { timeoutMs: number; resultChars: number } = MODEL_READ_LIMITS): Promise<ModelExposures> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelReadError('read_timed_out', 'the model read timed out: the model may be too large for one read')), limits.timeoutMs)
  })
  let data: { models?: RawModel[] } | undefined
  try {
    const result = (await Promise.race([client.query({ query: LIST_MODEL_EXPOSURES, variables: { modelId }, fetchPolicy: 'no-cache' }), timeout])) as { data?: { models?: RawModel[] } }
    data = result.data
  } finally {
    clearTimeout(timer)
  }
  const model = data?.models?.[0]
  if (!model) throw new ModelReadError('model_not_found', `the platform has no model ${modelId}`)
  const folded = foldModel(model)
  if (JSON.stringify(folded).length > limits.resultChars) {
    throw new ModelReadError('model_too_large', `the model is too large to read at once: ${folded.rows.length} exposures across ${folded.element_count} elements`)
  }
  return folded
}

/** One exposure's full evidence. */
export interface ExposureEvidence {
  exposure_id: string
  name: string
  description: string | null
  type: string | null
  category: string | null
  score: number | null
  attack_vector: string | null
  references: string | null
  mitigation_suggestions: string[] | null
  detection_methods: string[] | null
  tags: string[] | null
  techniques: string[] | null
  created_by: string | null
  authored_by: string | null
  disposition_kind: string | null
  disposition_reason: string | null
  dispositioned_by: string | null
  dispositioned_at: string | null
  disposition_stale: boolean | null
  unresolved_references: string[] | null
  lifecycle: Lifecycle
  def_hash: string
  exploited_by: Array<{ id: string; attack_id: string | null; name: string; description: string | null }>
  exploited_by_atlas: Array<{ id: string; atlas_id: string | null; name: string; description: string | null }>
}

/** One exposure's full evidence, or null when the platform has none with that id. */
export async function readExposureEvidence(client: ApolloClient, exposureId: string): Promise<ExposureEvidence | null> {
  const result = (await client.query({ query: GET_EXPOSURE_EVIDENCE, variables: { exposureId }, fetchPolicy: 'no-cache' })) as {
    data?: { exposures?: Array<Record<string, any>> }
  }
  const raw = result.data?.exposures?.[0]
  if (!raw) return null
  const exploitedBy = (raw.exploitedBy ?? []) as ExposureEvidence['exploited_by']
  const exploitedByAtlas = (raw.exploitedByAtlas ?? []) as ExposureEvidence['exploited_by_atlas']
  return {
    exposure_id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    type: raw.type ?? null,
    category: raw.category ?? null,
    score: raw.score ?? null,
    attack_vector: raw.attackVector ?? null,
    references: raw.references ?? null,
    mitigation_suggestions: raw.mitigationSuggestions ?? null,
    detection_methods: raw.detectionMethods ?? null,
    tags: raw.tags ?? null,
    techniques: raw.techniques ?? null,
    created_by: raw.createdBy ?? null,
    authored_by: raw.authoredBy ?? null,
    disposition_kind: raw.dispositionKind ?? null,
    disposition_reason: raw.dispositionReason ?? null,
    dispositioned_by: raw.dispositionedBy ?? null,
    dispositioned_at: raw.dispositionedAt ?? null,
    disposition_stale: raw.dispositionStale ?? null,
    unresolved_references: raw.unresolvedReferences ?? null,
    lifecycle: lifecycleOf({ dispositionKind: raw.dispositionKind ?? null, dispositionedBy: raw.dispositionedBy ?? null, createdBy: raw.createdBy ?? null }),
    def_hash: defHashOf(raw.description ?? null, [...exploitedBy.map((t) => t.attack_id), ...exploitedByAtlas.map((t) => t.atlas_id)], raw.type ?? null, raw.category ?? null),
    exploited_by: exploitedBy,
    exploited_by_atlas: exploitedByAtlas,
  }
}
