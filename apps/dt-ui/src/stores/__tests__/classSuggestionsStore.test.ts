/**
 * Unit tests for classSuggestionsStore — the picker's data layer.
 * Mocks @dethernety/dt-core so the test exercises only the store's wrapper:
 * keyed state writes, isLoading lifecycle, CancelledError swallowing, and
 * handleApiError mapping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const matchClassesMock = vi.fn()
const listClassesMock = vi.fn()

class MockCancelledError extends Error {
  readonly name = 'CancelledError' as const
  constructor(public readonly key: string) {
    super(`Cancelled by a newer call with key "${key}"`)
  }
}

vi.mock('@dethernety/dt-core', () => ({
  DtClass: class {
    matchClasses = matchClassesMock
    listClasses = listClassesMock
  },
  CancelledError: MockCancelledError,
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useClassSuggestionsStore: typeof import('../classSuggestionsStore').useClassSuggestionsStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../classSuggestionsStore')
  useClassSuggestionsStore = mod.useClassSuggestionsStore
})

const sampleCandidate = {
  classId: 'cls-1',
  className: 'AuthService',
  moduleName: 'dethernety-module',
  matchType: 'exact_name',
  confidence: 'high',
}

const sampleListResult = {
  items: [{ ...sampleCandidate, classCategory: 'security', classType: 'PROCESS' }],
  totalCount: 42,
  facetCounts: {
    categories: [{ value: 'security', count: 10 }],
    modules: [{ moduleId: 'mod-1', moduleName: 'dethernety-module', count: 42 }],
    types: [{ value: 'PROCESS', count: 30 }],
  },
}

describe('classSuggestionsStore — initial state', () => {
  it('starts with empty Maps, null vectorAvailable, empty isLoading and per-op errors', () => {
    const store = useClassSuggestionsStore()
    expect(store.matchResults).toEqual(new Map())
    expect(store.listResults).toEqual(new Map())
    expect(store.isLoading).toEqual({})
    expect(store.vectorAvailable).toBeNull()
    expect(store.matchError).toBe('')
    expect(store.listError).toBe('')
  })
})

describe('classSuggestionsStore.matchClasses', () => {
  it('populates matchResults keyed by classLabel:componentType and updates vectorAvailable', async () => {
    matchClassesMock.mockResolvedValueOnce({
      matches: [{ elementName: 'svc', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: true,
    })

    const store = useClassSuggestionsStore()
    await store.matchClasses({
      elements: [{ name: 'svc' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })

    expect(store.matchResults.get('COMPONENT:PROCESS')).toEqual([sampleCandidate])
    expect(store.vectorAvailable).toBe(true)
    expect(store.matchError).toBe('')
  })

  it('keys with _ when componentType is omitted', async () => {
    matchClassesMock.mockResolvedValueOnce({
      matches: [{ elementName: 'svc', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: false,
    })

    const store = useClassSuggestionsStore()
    await store.matchClasses({
      elements: [{ name: 'svc' }],
      classLabel: 'CONTROL',
    })

    expect(store.matchResults.get('CONTROL:_')).toEqual([sampleCandidate])
    expect(store.vectorAvailable).toBe(false)
  })

  it('stores [] when matches is empty', async () => {
    matchClassesMock.mockResolvedValueOnce({
      matches: [],
      unmatched: ['unknown-thing'],
      vectorAvailable: true,
    })

    const store = useClassSuggestionsStore()
    await store.matchClasses({
      elements: [{ name: 'unknown-thing' }],
      classLabel: 'COMPONENT',
    })

    expect(store.matchResults.get('COMPONENT:_')).toEqual([])
  })

  it('toggles isLoading true → false around the call', async () => {
    let resolveCall: (value: unknown) => void = () => {}
    matchClassesMock.mockReturnValueOnce(new Promise(resolve => { resolveCall = resolve }))

    const store = useClassSuggestionsStore()
    const promise = store.matchClasses({
      elements: [{ name: 'svc' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })

    expect(store.isLoading['match:COMPONENT:PROCESS']).toBe(true)
    resolveCall({ matches: [], unmatched: [], vectorAvailable: true })
    await promise
    expect(store.isLoading['match:COMPONENT:PROCESS']).toBe(false)
  })

  it('swallows CancelledError without populating matchError.value', async () => {
    matchClassesMock.mockRejectedValueOnce(new MockCancelledError('matchClasses:COMPONENT:_'))

    const store = useClassSuggestionsStore()
    await store.matchClasses({
      elements: [{ name: 'svc' }],
      classLabel: 'COMPONENT',
    })

    expect(store.matchError).toBe('')
    expect(store.isLoading['match:COMPONENT:_']).toBe(false)
  })

  it('classifies generic errors via handleApiError', async () => {
    matchClassesMock.mockRejectedValueOnce(new Error('Request failed with 401 unauthorized'))

    const store = useClassSuggestionsStore()
    await store.matchClasses({
      elements: [{ name: 'svc' }],
      classLabel: 'COMPONENT',
    })

    expect(store.matchError).toBe('Please log in again')
    expect(store.isLoading['match:COMPONENT:_']).toBe(false)
  })

  it('updates vectorAvailable to the latest response across multiple calls', async () => {
    matchClassesMock
      .mockResolvedValueOnce({ matches: [], unmatched: [], vectorAvailable: true })
      .mockResolvedValueOnce({ matches: [], unmatched: [], vectorAvailable: false })

    const store = useClassSuggestionsStore()
    await store.matchClasses({ elements: [{ name: 'a' }], classLabel: 'COMPONENT' })
    expect(store.vectorAvailable).toBe(true)
    await store.matchClasses({ elements: [{ name: 'b' }], classLabel: 'COMPONENT' })
    expect(store.vectorAvailable).toBe(false)
  })
})

describe('classSuggestionsStore.listClasses', () => {
  it('populates listResults with the full envelope', async () => {
    listClassesMock.mockResolvedValueOnce(sampleListResult)

    const store = useClassSuggestionsStore()
    await store.listClasses({
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    })

    expect(store.listResults.get('COMPONENT:PROCESS')).toEqual(sampleListResult)
    expect(store.listError).toBe('')
  })

  it('swallows CancelledError', async () => {
    listClassesMock.mockRejectedValueOnce(new MockCancelledError('listClasses:COMPONENT:_'))

    const store = useClassSuggestionsStore()
    await store.listClasses({ classLabel: 'COMPONENT' })

    expect(store.listError).toBe('')
    expect(store.isLoading['list:COMPONENT:_']).toBe(false)
  })
})

describe('classSuggestionsStore — cross-op error isolation', () => {
  // Regression for the bug fixed in this round: a failure in one op must
  // not surface in the other op's error slot. Inline picker only consumes
  // matchClasses results; a background listClasses failure used to render
  // its caption.
  it('a failed listClasses does not poison matchError', async () => {
    listClassesMock.mockRejectedValueOnce(new Error('500 internal'))
    matchClassesMock.mockResolvedValueOnce({
      matches: [{ elementName: 'svc', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: true,
    })

    const store = useClassSuggestionsStore()
    await store.listClasses({ classLabel: 'COMPONENT' })
    expect(store.listError).not.toBe('')
    expect(store.matchError).toBe('')

    // Run matchClasses afterwards — matchError must remain unaffected
    // by the prior listClasses failure.
    await store.matchClasses({ elements: [{ name: 'svc' }], classLabel: 'COMPONENT' })
    expect(store.matchError).toBe('')
    // listError persists — it's the consumer's job to retry or dismiss.
    expect(store.listError).not.toBe('')
  })

  it('a failed matchClasses does not poison listError', async () => {
    matchClassesMock.mockRejectedValueOnce(new Error('500 internal'))
    listClassesMock.mockResolvedValueOnce(sampleListResult)

    const store = useClassSuggestionsStore()
    await store.matchClasses({ elements: [{ name: 'svc' }], classLabel: 'COMPONENT' })
    expect(store.matchError).not.toBe('')
    expect(store.listError).toBe('')

    await store.listClasses({ classLabel: 'COMPONENT' })
    expect(store.listError).toBe('')
    expect(store.matchError).not.toBe('')
  })
})
