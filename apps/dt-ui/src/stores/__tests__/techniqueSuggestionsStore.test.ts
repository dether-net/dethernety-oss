/**
 * techniqueSuggestionsStore unit tests.
 *
 * Mirrors classSuggestionsStore.test.ts harness. Mocks @dethernety/dt-core so
 * we exercise only the store's wrapper: keyed state writes, isLoading lifecycle,
 * CancelledError swallowing, vectorAvailable + vectorDisabledReason propagation,
 * and per-op error isolation (matchError vs catalogError).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const matchTechniquesMock = vi.fn()
const findAttackTechniquesMock = vi.fn()
const fetchDefendTacticsMock = vi.fn()
const getDefendTechniquesByTacticMock = vi.fn()
const getMitigationsMock = vi.fn()

class MockCancelledError extends Error {
  readonly name = 'CancelledError' as const
  constructor(public readonly key: string) {
    super(`Cancelled by a newer call with key "${key}"`)
  }
}

vi.mock('@dethernety/dt-core', () => ({
  DtMitre: class {
    matchTechniques = matchTechniquesMock
  },
  DtMitreAttack: class {
    findMitreAttackTechniques = findAttackTechniquesMock
    getMitreAttackMitigations = getMitigationsMock
  },
  DtMitreDefend: class {
    fetchMitreDefendTactics = fetchDefendTacticsMock
    getMitreDefendTechniquesByTactic = getDefendTechniquesByTacticMock
  },
  CancelledError: MockCancelledError,
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useTechniqueSuggestionsStore: typeof import('../techniqueSuggestionsStore').useTechniqueSuggestionsStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../techniqueSuggestionsStore')
  useTechniqueSuggestionsStore = mod.useTechniqueSuggestionsStore
})

const sampleCandidate = {
  mitreId: 'T1003',
  name: 'OS Credential Dumping',
  description: 'Adversaries dump credentials.',
  tactic: 'Credential Access',
  kind: 'ATTACK_TECHNIQUE',
  matchType: 'VECTOR_SIMILARITY',
  similarityScore: 0.81,
}

describe('techniqueSuggestionsStore — initial state', () => {
  it('starts with empty maps, null vectorAvailable + reason, empty errors', () => {
    const store = useTechniqueSuggestionsStore()
    expect(store.matchResults).toEqual(new Map())
    expect(store.catalog).toEqual(new Map())
    expect(store.isLoading).toEqual({})
    expect(store.vectorAvailable).toBeNull()
    expect(store.vectorDisabledReason).toBeNull()
    expect(store.matchError).toBe('')
    expect(store.catalogError).toBe('')
    expect(store.isCatalogReady).toEqual({
      ATTACK_TECHNIQUE: false,
      DEFEND_TECHNIQUE: false,
      ATTACK_MITIGATION: false,
    })
  })
})

describe('techniqueSuggestionsStore.matchTechniques', () => {
  it('populates matchResults keyed by kind:query and propagates vector state', async () => {
    matchTechniquesMock.mockResolvedValueOnce({
      matches: [{ query: 'creds', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: true,
      vectorDisabledReason: null,
    })

    const store = useTechniqueSuggestionsStore()
    await store.matchTechniques({ kind: 'ATTACK_TECHNIQUE', query: 'creds' })

    expect(store.matchResults.get('ATTACK_TECHNIQUE:creds')).toEqual([sampleCandidate])
    expect(store.vectorAvailable).toBe(true)
    expect(store.vectorDisabledReason).toBeNull()
    expect(store.matchError).toBe('')
  })

  it('propagates vectorAvailable=false with a specific reason', async () => {
    matchTechniquesMock.mockResolvedValueOnce({
      matches: [{ query: 'x', candidates: [] }],
      unmatched: ['x'],
      vectorAvailable: false,
      vectorDisabledReason: 'NO_VECTORS',
    })

    const store = useTechniqueSuggestionsStore()
    await store.matchTechniques({ kind: 'ATTACK_TECHNIQUE', query: 'x' })

    expect(store.vectorAvailable).toBe(false)
    expect(store.vectorDisabledReason).toBe('NO_VECTORS')
  })

  it('toggles isLoading true → false around the call', async () => {
    let resolveCall: (value: unknown) => void = () => {}
    matchTechniquesMock.mockReturnValueOnce(new Promise(resolve => { resolveCall = resolve }))

    const store = useTechniqueSuggestionsStore()
    const promise = store.matchTechniques({ kind: 'DEFEND_TECHNIQUE', query: 'iso' })

    expect(store.isLoading['match:DEFEND_TECHNIQUE:iso']).toBe(true)
    resolveCall({ matches: [], unmatched: [], vectorAvailable: true, vectorDisabledReason: null })
    await promise
    expect(store.isLoading['match:DEFEND_TECHNIQUE:iso']).toBe(false)
  })

  it('swallows CancelledError without setting matchError', async () => {
    matchTechniquesMock.mockRejectedValueOnce(new MockCancelledError('matchTechniques:ATTACK_TECHNIQUE'))

    const store = useTechniqueSuggestionsStore()
    await store.matchTechniques({ kind: 'ATTACK_TECHNIQUE', query: 'foo' })

    expect(store.matchError).toBe('')
  })

  it('classifies generic errors via handleApiError', async () => {
    matchTechniquesMock.mockRejectedValueOnce(new Error('Request failed with 401 unauthorized'))

    const store = useTechniqueSuggestionsStore()
    await store.matchTechniques({ kind: 'ATTACK_TECHNIQUE', query: 'foo' })

    expect(store.matchError).toBe('Please log in again')
  })
})

describe('techniqueSuggestionsStore.hydrateCatalog', () => {
  it('hydrates ATTACK_TECHNIQUE catalog with empty filter and maps fields', async () => {
    findAttackTechniquesMock.mockResolvedValueOnce([
      {
        id: 't-1',
        name: 'OS Credential Dumping',
        description: 'desc',
        attack_id: 'T1003',
        tactics: [{ name: 'Credential Access' }],
      },
      {
        id: 't-2',
        name: 'LSASS Memory',
        description: '',
        attack_id: 'T1003.001',
        tactics: [{ name: 'Credential Access' }],
      },
    ])

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('ATTACK_TECHNIQUE')

    expect(findAttackTechniquesMock).toHaveBeenCalledWith({ query: {} })
    expect(store.catalog.get('ATTACK_TECHNIQUE')).toHaveLength(2)
    expect(store.catalog.get('ATTACK_TECHNIQUE')?.[0]).toEqual({
      mitreId: 'T1003',
      internalId: 't-1',
      name: 'OS Credential Dumping',
      description: 'desc',
      tactic: 'Credential Access',
      kind: 'ATTACK_TECHNIQUE',
    })
    expect(store.isCatalogReady.ATTACK_TECHNIQUE).toBe(true)
  })

  it('ATTACK_TECHNIQUE catalog: falls back to null tactic when tactics array is empty', async () => {
    findAttackTechniquesMock.mockResolvedValueOnce([
      { id: 't-3', name: 'Orphan', description: '', attack_id: 'T9999', tactics: [] },
    ])
    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('ATTACK_TECHNIQUE')
    expect(store.catalog.get('ATTACK_TECHNIQUE')?.[0]?.tactic).toBeNull()
  })

  it('hydrates DEFEND_TECHNIQUE by walking tactics + deduplicating + recursing subTechniques', async () => {
    fetchDefendTacticsMock.mockResolvedValueOnce([
      { id: 'tac-1', name: 'Harden' },
      { id: 'tac-2', name: 'Detect' },
    ])
    getDefendTechniquesByTacticMock
      .mockResolvedValueOnce([
        {
          id: 'd-1', name: 'PMAD', description: 'desc', d3fendId: 'D3-PMAD',
          subTechniques: [
            // nested sub — must flow through to the catalog with the parent tactic
            { id: 'd-1a', name: 'PMAD child', description: 'sub', d3fendId: 'D3-PMAD-001' },
          ],
        },
      ])
      .mockResolvedValueOnce([
        { id: 'd-1', name: 'PMAD', description: 'desc', d3fendId: 'D3-PMAD' }, // dup top-level
        {
          id: 'd-2', name: 'PSA', description: 'other', d3fendId: 'D3-PSA',
          subTechniques: [
            { id: 'd-2a', name: 'PSA child', description: 'sub',  d3fendId: 'D3-PSA-001',
              subTechniques: [
                // deeper sub — must also flow through
                { id: 'd-2aa', name: 'PSA grandchild', description: '', d3fendId: 'D3-PSA-001-001' },
              ],
            },
          ],
        },
      ])

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('DEFEND_TECHNIQUE')

    const got = store.catalog.get('DEFEND_TECHNIQUE')!
    // 5 distinct d3fendIds: D3-PMAD, D3-PMAD-001, D3-PSA, D3-PSA-001, D3-PSA-001-001
    expect(got).toHaveLength(5)
    const byId = new Map(got.map(e => [e.mitreId, e.tactic]))
    expect(byId.get('D3-PMAD')).toBe('Harden')
    expect(byId.get('D3-PMAD-001')).toBe('Harden')
    expect(byId.get('D3-PSA')).toBe('Detect')
    expect(byId.get('D3-PSA-001')).toBe('Detect')
    expect(byId.get('D3-PSA-001-001')).toBe('Detect')
    expect(store.isCatalogReady.DEFEND_TECHNIQUE).toBe(true)
  })

  it('hydrates ATTACK_MITIGATION via getMitreAttackMitigations', async () => {
    getMitigationsMock.mockResolvedValueOnce([
      { id: 'm-1', name: 'Privileged Account Management', description: 'desc', attack_id: 'M1026' },
    ])

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('ATTACK_MITIGATION')

    expect(store.catalog.get('ATTACK_MITIGATION')).toHaveLength(1)
    expect(store.catalog.get('ATTACK_MITIGATION')?.[0]?.tactic).toBeNull()
    expect(store.isCatalogReady.ATTACK_MITIGATION).toBe(true)
  })

  it('is a no-op when the catalog is already ready', async () => {
    findAttackTechniquesMock.mockResolvedValueOnce([])
    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('ATTACK_TECHNIQUE')
    // second call should not re-invoke dt-core
    await store.hydrateCatalog('ATTACK_TECHNIQUE')
    expect(findAttackTechniquesMock).toHaveBeenCalledOnce()
  })

  it('total DEFEND failure sets catalogError, leaves the catalog unready, and permits retry', async () => {
    fetchDefendTacticsMock.mockResolvedValue([
      { id: 'tac-1', name: 'Harden' },
      { id: 'tac-2', name: 'Detect' },
    ])
    // Every tactic query rejects — allSettled would otherwise swallow this and mark ready.
    getDefendTechniquesByTacticMock
      .mockRejectedValueOnce(new Error('500 internal'))
      .mockRejectedValueOnce(new Error('500 internal'))

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('DEFEND_TECHNIQUE')

    expect(store.isCatalogReady.DEFEND_TECHNIQUE).toBe(false)
    expect(store.catalogError).not.toBe('')

    // Retry is NOT blocked by the isCatalogReady guard — a second attempt re-runs and succeeds.
    getDefendTechniquesByTacticMock
      .mockResolvedValueOnce([{ id: 'd-1', name: 'PMAD', description: 'd', d3fendId: 'D3-PMAD' }])
      .mockResolvedValueOnce([{ id: 'd-2', name: 'PSA', description: 'd', d3fendId: 'D3-PSA' }])

    await store.hydrateCatalog('DEFEND_TECHNIQUE')
    expect(store.isCatalogReady.DEFEND_TECHNIQUE).toBe(true)
    expect(store.catalog.get('DEFEND_TECHNIQUE')).toHaveLength(2)
  })

  it('partial DEFEND failure still marks the catalog ready with the entries that loaded', async () => {
    fetchDefendTacticsMock.mockResolvedValueOnce([
      { id: 'tac-1', name: 'Harden' },
      { id: 'tac-2', name: 'Detect' },
    ])
    getDefendTechniquesByTacticMock
      .mockResolvedValueOnce([{ id: 'd-1', name: 'PMAD', description: 'd', d3fendId: 'D3-PMAD' }])
      .mockRejectedValueOnce(new Error('500 internal'))

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('DEFEND_TECHNIQUE')

    expect(store.isCatalogReady.DEFEND_TECHNIQUE).toBe(true)
    expect(store.catalog.get('DEFEND_TECHNIQUE')).toHaveLength(1)
  })

  it('catalog error does NOT poison matchError', async () => {
    findAttackTechniquesMock.mockRejectedValueOnce(new Error('500 internal'))
    matchTechniquesMock.mockResolvedValueOnce({
      matches: [{ query: 'creds', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: true,
      vectorDisabledReason: null,
    })

    const store = useTechniqueSuggestionsStore()
    await store.hydrateCatalog('ATTACK_TECHNIQUE')
    expect(store.catalogError).not.toBe('')
    expect(store.matchError).toBe('')

    await store.matchTechniques({ kind: 'ATTACK_TECHNIQUE', query: 'creds' })
    expect(store.matchError).toBe('')
    // catalogError persists — consumer's job to retry or dismiss
    expect(store.catalogError).not.toBe('')
  })
})
