/**
 * The model exposure read: the fold over the five element collections, the definition hash, the disposition
 * lifecycle, the read's bounds and its messages, and one exposure's evidence.
 */
import { describe, it, expect } from 'vitest'
import type { ApolloClient } from '@apollo/client'
import { print } from 'graphql'
import {
  defHashOf,
  foldModel,
  lifecycleOf,
  ModelReadError,
  readExposureEvidence,
  readModelExposures,
  ROW_REASON_MAX,
} from '../exposures.js'

type RawModel = Parameters<typeof foldModel>[0]

function exp(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `exp ${id}`,
    description: 'desc',
    type: '1',
    category: 'cat',
    score: 5,
    attackVector: 'NETWORK',
    createdBy: 'SYSTEM',
    authoredBy: null,
    dispositionKind: null,
    dispositionReason: null,
    dispositionedBy: null,
    dispositionedAt: null,
    dispositionStale: null,
    unresolvedReferences: null,
    exploitedBy: [{ attack_id: 'T1040' }],
    exploitedByAtlas: [] as Array<{ atlas_id: string | null }>,
    ...over,
  } as any
}

/**
 * Two anchors (one with an exposure of its own), a nested boundary, two components (one reaching an exposure the
 * anchor already has, one with none), a data flow with a class, and a data item; user-authored, disposed, stale
 * and affirmed exposures.
 */
const fixture: RawModel = {
  id: 'model-1',
  name: 'Fixture',
  dataItems: [
    { id: 'di-1', name: 'PII store', dataClass: [{ id: 'dc-1', name: 'Sensitive Data' }], exposures: [exp('e-data', { createdBy: 'USER' })] },
  ],
  defaultBoundary: [
    {
      id: 'b-anchor-1',
      name: 'Edge',
      securityBoundaryClass: [{ id: 'sbc-1', name: 'DMZ' }],
      exposures: [exp('e-anchor')],
      allDescendantBoundaries: [
        {
          id: 'b-nested',
          name: 'App Tier',
          securityBoundaryClass: [],
          exposures: [
            exp('e-nested-disposed', {
              dispositionKind: 'FALSE_POSITIVE',
              dispositionReason: 'r'.repeat(500),
              dispositionedBy: 'op@example.com',
              dispositionedAt: '2026-07-17T00:00:00Z',
              dispositionStale: true,
            }),
          ],
        },
      ],
      allDescendantComponents: [
        { id: 'c-1', name: 'api', componentClass: [{ id: 'cc-1', name: 'Web Application' }], exposures: [exp('e-comp'), exp('e-anchor')] },
        { id: 'c-2', name: 'cache', componentClass: [], exposures: [] },
      ],
      allDescendantDataFlows: [
        {
          id: 'df-1',
          name: 'api to db',
          dataFlowClass: [{ id: 'dfc-1', name: 'HTTPS' }],
          exposures: [exp('e-flow-affirmed', { dispositionKind: 'AFFIRMED', dispositionReason: 'confirmed real', dispositionedBy: 'op@example.com' })],
        },
      ],
    },
    {
      id: 'b-anchor-2',
      name: 'Mgmt',
      securityBoundaryClass: [],
      exposures: [],
      allDescendantBoundaries: [],
      allDescendantComponents: [],
      allDescendantDataFlows: [],
    },
  ],
}

const clientOf = (query: (o: any) => Promise<unknown>) => ({ query }) as unknown as ApolloClient

describe('foldModel', () => {
  const res = foldModel(fixture)

  it('emits one row per exposure across all five collections, once each', () => {
    expect(res.rows.map((r) => r.exposure_id).sort()).toEqual(['e-anchor', 'e-comp', 'e-data', 'e-flow-affirmed', 'e-nested-disposed'])
  })

  it('an exposure reached through two elements keeps the first', () => {
    expect(res.rows.filter((r) => r.exposure_id === 'e-anchor')).toHaveLength(1)
    expect(res.rows.find((r) => r.exposure_id === 'e-anchor')!.element_id).toBe('b-anchor-1')
  })

  it('reads the anchor boundary itself, which the descendant collections leave out', () => {
    expect(res.rows.find((r) => r.exposure_id === 'e-anchor')).toMatchObject({ element_id: 'b-anchor-1', element_kind: 'securityBoundary', element_class: { id: 'sbc-1', name: 'DMZ' } })
  })

  it('derives kinds, the first class or null, and the lifecycle', () => {
    const byId = new Map(res.rows.map((r) => [r.exposure_id, r]))
    expect(byId.get('e-data')).toMatchObject({ element_kind: 'dataItem', element_class: { name: 'Sensitive Data' }, lifecycle: 'confirmed' })
    expect(byId.get('e-comp')).toMatchObject({ element_kind: 'component', element_class: { name: 'Web Application' }, lifecycle: 'pending' })
    expect(byId.get('e-nested-disposed')).toMatchObject({ element_kind: 'securityBoundary', element_class: null, lifecycle: 'disposed' })
    expect(byId.get('e-flow-affirmed')).toMatchObject({ element_kind: 'dataFlow', lifecycle: 'confirmed' })
  })

  it("binds a data flow's class", () => {
    expect(res.rows.find((r) => r.exposure_id === 'e-flow-affirmed')!.element_class).toEqual({ id: 'dfc-1', name: 'HTTPS' })
  })

  it('a row has no description and cuts the reason to 200 characters, keeping the full one aside', () => {
    const disposed = res.rows.find((r) => r.exposure_id === 'e-nested-disposed')!
    expect(disposed).not.toHaveProperty('description')
    expect(disposed.disposition_reason).toHaveLength(ROW_REASON_MAX)
    expect(disposed.full_reason).toHaveLength(500)
  })

  it('totals reconcile with the rows', () => {
    const { totals, rows } = res
    expect(totals.pending + totals.confirmed + totals.disposed).toBe(rows.length)
    expect(totals).toEqual({ pending: 2, confirmed: 2, disposed: 1, stale: 1, user: 1, system: 4 })
  })

  it('lists the elements without exposures with their kind, and counts every element once', () => {
    expect(res.elements_without_exposures).toEqual(
      expect.arrayContaining([
        { id: 'c-2', name: 'cache', kind: 'component' },
        { id: 'b-anchor-2', name: 'Mgmt', kind: 'securityBoundary' },
      ]),
    )
    expect(res.elements_without_exposures).toHaveLength(2)
    expect(res.element_count).toBe(7)
    expect(res.elements).toHaveLength(7)
    expect(new Set(res.elements.map((e) => e.id)).size).toBe(7)
    expect(res.elements).toEqual(expect.arrayContaining([{ id: 'c-2', name: 'cache', kind: 'component' }]))
  })

  it('walks an element reached through two anchors once', () => {
    const shared = { id: 'c-shared', name: 'shared', componentClass: [], exposures: [exp('e-shared')] }
    const anchor = (id: string) => ({ id, name: id, securityBoundaryClass: [], exposures: [], allDescendantBoundaries: [], allDescendantComponents: [shared], allDescendantDataFlows: [] })
    const folded = foldModel({ id: 'm', name: 'M', dataItems: [], defaultBoundary: [anchor('a1'), anchor('a2')] })
    expect(folded.rows.map((r) => r.exposure_id)).toEqual(['e-shared'])
    expect(folded.element_count).toBe(3)
  })

  it("carries the platform's unresolved-references marker; absent reads as null", () => {
    const folded = foldModel({
      id: 'm',
      name: 'M',
      dataItems: [{ id: 'di', name: 'store', dataClass: [], exposures: [exp('e-plain', { unresolvedReferences: undefined }), exp('e-marked', { unresolvedReferences: ['MitreAtlasTechnique.atlas_id=AML.T9999'] })] }],
      defaultBoundary: [],
    })
    expect(folded.rows.find((r) => r.exposure_id === 'e-marked')!.unresolved_references).toEqual(['MitreAtlasTechnique.atlas_id=AML.T9999'])
    expect(folded.rows.find((r) => r.exposure_id === 'e-plain')!.unresolved_references).toBeNull()
  })

  it('a model with no collections folds to nothing', () => {
    expect(foldModel({ id: 'm', name: 'M' })).toEqual({
      model_id: 'm',
      model_name: 'M',
      rows: [],
      totals: { pending: 0, confirmed: 0, disposed: 0, stale: 0, user: 0, system: 0 },
      elements_without_exposures: [],
      elements: [],
      element_count: 0,
    })
  })
})

describe('defHashOf', () => {
  it('another description hashes differently; the same definition on another element hashes the same', () => {
    const a = defHashOf('TLS is off on the listener', ['T1040'], '1', 'transport')
    expect(a).not.toBe(defHashOf('A different definition entirely', ['T1040'], '1', 'transport'))
    expect(a).toBe(defHashOf('TLS is off on the listener', ['T1040'], '1', 'transport'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sorts the ids before hashing, and drops null ids', () => {
    expect(defHashOf('d', ['T1557', 'T1040'], null, null)).toBe(defHashOf('d', ['T1040', 'T1557'], null, null))
    expect(defHashOf('d', ['T1040', null], null, null)).toBe(defHashOf('d', ['T1040'], null, null))
  })

  it('an exposure with no ATLAS link hashes as with its ATT&CK ids only', () => {
    // sha256('TLS is off on the listener T1040,T1557 1 transport')
    expect(defHashOf('TLS is off on the listener', ['T1557', 'T1040'], '1', 'transport')).toBe('6f5e488a1019781f2f57e593b44a4fce7dccdbaf48a5c9fd1ac0a429f887b504')
    const plain = foldModel({ id: 'm', name: 'M', dataItems: [{ id: 'di', name: 's', exposures: [exp('e', { exploitedBy: [{ attack_id: 'T1557' }, { attack_id: 'T1040' }], description: 'TLS is off on the listener', category: 'transport' })] }] })
    expect(plain.rows[0]!.def_hash).toBe('6f5e488a1019781f2f57e593b44a4fce7dccdbaf48a5c9fd1ac0a429f887b504')
  })

  it('joins the ATLAS ids: definitions differing only in an ATLAS link hash differently', () => {
    const folded = foldModel({
      id: 'm',
      name: 'M',
      dataItems: [{ id: 'di', name: 'store', dataClass: [], exposures: [exp('e-plain'), exp('e-atlas', { exploitedByAtlas: [{ atlas_id: 'AML.T0051' }] })] }],
      defaultBoundary: [],
    })
    const plain = folded.rows.find((r) => r.exposure_id === 'e-plain')!
    const atlas = folded.rows.find((r) => r.exposure_id === 'e-atlas')!
    expect(atlas.def_hash).not.toBe(plain.def_hash)
    expect(atlas.def_hash).toBe(defHashOf('desc', ['T1040', 'AML.T0051'], '1', 'cat'))
    expect(atlas.atlas_ids).toEqual(['AML.T0051'])
    expect(plain.atlas_ids).toEqual([])
    expect(atlas.attack_ids).toEqual(['T1040'])
  })

  it('null description, type and category hash as empty strings', () => {
    expect(defHashOf(null, [], null, null)).toBe(defHashOf('', [], '', ''))
  })

  it('tolerates absent technique lists on a row', () => {
    const folded = foldModel({ id: 'm', name: 'M', dataItems: [{ id: 'di', name: 's', exposures: [exp('e', { exploitedBy: undefined, exploitedByAtlas: undefined })] }] })
    expect(folded.rows[0]).toMatchObject({ attack_ids: [], atlas_ids: [], def_hash: defHashOf('desc', [], '1', 'cat') })
  })
})

describe('lifecycleOf', () => {
  it('AFFIRMED by someone is confirmed', () => {
    expect(lifecycleOf({ dispositionKind: 'AFFIRMED', dispositionedBy: 'op@example.com', createdBy: 'SYSTEM' })).toBe('confirmed')
  })

  it('AFFIRMED by no one is pending', () => {
    expect(lifecycleOf({ dispositionKind: 'AFFIRMED', dispositionedBy: null, createdBy: 'SYSTEM' })).toBe('pending')
  })

  it.each(['NOT_APPLICABLE', 'FALSE_POSITIVE', 'COMPENSATING_CONTROL', 'RISK_ACCEPTED', 'WAIVED', 'SUPERSEDED'])('%s is disposed, whoever set it', (kind) => {
    expect(lifecycleOf({ dispositionKind: kind, dispositionedBy: 'op@example.com', createdBy: 'SYSTEM' })).toBe('disposed')
    expect(lifecycleOf({ dispositionKind: kind, dispositionedBy: null, createdBy: 'USER' })).toBe('disposed')
  })

  it('no disposition on a user-authored exposure is confirmed', () => {
    expect(lifecycleOf({ dispositionKind: null, dispositionedBy: null, createdBy: 'USER' })).toBe('confirmed')
  })

  it('no disposition on a system exposure is pending', () => {
    expect(lifecycleOf({ dispositionKind: null, dispositionedBy: null, createdBy: 'SYSTEM' })).toBe('pending')
  })

  it('no disposition and no author is pending', () => {
    expect(lifecycleOf({ dispositionKind: null, dispositionedBy: null, createdBy: null })).toBe('pending')
  })

  it('no disposition and an unknown author is pending', () => {
    expect(lifecycleOf({ dispositionKind: null, dispositionedBy: null, createdBy: 'IMPORT' })).toBe('pending')
  })
})

describe('readModelExposures', () => {
  it('reads the model by id with no cache, and folds it', async () => {
    const calls: any[] = []
    const res = await readModelExposures(clientOf(async (o) => { calls.push(o); return { data: { models: [fixture] } } }), 'model-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ variables: { modelId: 'model-1' }, fetchPolicy: 'no-cache' })
    expect(res.model_id).toBe('model-1')
    expect(res.rows).toHaveLength(5)
  })

  it('no model: model_not_found', async () => {
    const err = await readModelExposures(clientOf(async () => ({ data: { models: [] } })), 'nope').catch((e) => e)
    expect(err).toBeInstanceOf(ModelReadError)
    expect(err).toMatchObject({ code: 'model_not_found', message: 'the platform has no model nope' })
  })

  it('a read past its time: read_timed_out', async () => {
    const err = await readModelExposures(clientOf(() => new Promise(() => {})), 'm', { timeoutMs: 20, resultChars: 4 * 1024 * 1024 }).catch((e) => e)
    expect(err).toBeInstanceOf(ModelReadError)
    expect(err).toMatchObject({ code: 'read_timed_out', message: 'the model read timed out: the model may be too large for one read' })
  })

  it('a result past its size: model_too_large, with the counts', async () => {
    const err = await readModelExposures(clientOf(async () => ({ data: { models: [fixture] } })), 'model-1', { timeoutMs: 60_000, resultChars: 500 }).catch((e) => e)
    expect(err).toBeInstanceOf(ModelReadError)
    expect(err).toMatchObject({ code: 'model_too_large', message: 'the model is too large to read at once: 5 exposures across 7 elements' })
  })

  it('a transport failure is passed on as it is', async () => {
    const err = await readModelExposures(clientOf(async () => { throw new Error('socket hang up') }), 'm').catch((e) => e)
    expect(err).not.toBeInstanceOf(ModelReadError)
    expect(err.message).toBe('socket hang up')
  })
})

describe('readExposureEvidence', () => {
  it('maps the full evidence, with lifecycle and definition hash', async () => {
    const raw = {
      ...exp('e-1', { dispositionKind: 'AFFIRMED', dispositionedBy: 'op@example.com' }),
      references: 'https://example.com/advisory',
      mitigationSuggestions: ['enable TLS'],
      detectionMethods: ['flow logs'],
      tags: ['transport'],
      techniques: ['T1040'],
      exploitedBy: [{ id: 'n-t1040', attack_id: 'T1040', name: 'Network Sniffing', description: null }],
      exploitedByAtlas: [{ id: 'n-aml', atlas_id: 'AML.T0051', name: 'LLM Prompt Injection', description: null }],
      element: [{ id: 'c-1', name: 'api' }],
    }
    let sent: any
    const ev = await readExposureEvidence(clientOf(async (o) => { sent = o; return { data: { exposures: [raw] } } }), 'e-1')
    expect(sent).toMatchObject({ variables: { exposureId: 'e-1' }, fetchPolicy: 'no-cache' })
    expect(ev).toMatchObject({
      exposure_id: 'e-1',
      description: 'desc',
      references: 'https://example.com/advisory',
      mitigation_suggestions: ['enable TLS'],
      detection_methods: ['flow logs'],
      tags: ['transport'],
      techniques: ['T1040'],
      lifecycle: 'confirmed',
      def_hash: defHashOf('desc', ['T1040', 'AML.T0051'], '1', 'cat'),
      exploited_by: raw.exploitedBy,
      exploited_by_atlas: raw.exploitedByAtlas,
    })
    // A list a platform returns over the element interface is not the exposure's own: it is neither asked for nor kept.
    expect(ev).not.toHaveProperty('elements')
    expect(print(sent.query)).not.toMatch(/\belement\b/)
  })

  it('no such exposure: null', async () => {
    expect(await readExposureEvidence(clientOf(async () => ({ data: { exposures: [] } })), 'nope')).toBeNull()
  })
})
