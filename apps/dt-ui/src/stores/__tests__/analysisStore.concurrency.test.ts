/**
 * analysisStore concurrency guards.
 *
 * 1. fetchAnalyses request-generation token: on element/folder-switch an older response
 *    that resolves last must not clobber the newer list.
 * 2. getOrCreateAnalysis in-flight latch: two concurrent calls for one element must not
 *    both miss the find and both create — they collapse onto a single find→create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const findAnalysesMock = vi.fn()
const findAnalysisClassesMock = vi.fn()
const createAnalysisMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtAnalysis: class {
    findAnalyses = findAnalysesMock
    findAnalysisClasses = findAnalysisClassesMock
    createAnalysis = createAnalysisMock
  },
  DtMitreAttack: class {},
  DtMitreDefend: class {},
}))
vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useAnalysisStore: typeof import('../analysisStore').useAnalysisStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useAnalysisStore = (await import('../analysisStore')).useAnalysisStore
})

describe('analysisStore.fetchAnalyses — stale-response guard', () => {
  it('keeps the newest result when an older response resolves last', async () => {
    let resolveA: (v: unknown) => void = () => {}
    let resolveB: (v: unknown) => void = () => {}
    findAnalysesMock
      .mockReturnValueOnce(new Promise(r => { resolveA = r }))
      .mockReturnValueOnce(new Promise(r => { resolveB = r }))

    const store = useAnalysisStore()
    const pa = store.fetchAnalyses({ elementId: 'e1' })            // gen 1
    const pb = store.fetchAnalyses({ elementId: 'e1', classId: 'c2' }) // gen 2 (latest)

    resolveB([{ id: 'B' }])
    await pb
    resolveA([{ id: 'A' }])
    await pa

    expect(store.analyses).toHaveLength(1)
    expect(store.analyses[0].id).toBe('B')
  })
})

describe('analysisStore.getOrCreateAnalysis — in-flight latch', () => {
  it('collapses two concurrent calls for one element into a single create', async () => {
    findAnalysesMock.mockResolvedValue([])                          // no existing analysis
    findAnalysisClassesMock.mockResolvedValue([{ id: 'cls-1', type: 't', category: 'c' }])
    let resolveCreate: (v: unknown) => void = () => {}
    createAnalysisMock.mockReturnValueOnce(new Promise(r => { resolveCreate = r }))

    const store = useAnalysisStore()
    const p1 = store.getOrCreateAnalysis({ elementId: 'e1' })
    const p2 = store.getOrCreateAnalysis({ elementId: 'e1' })

    resolveCreate({ id: 'created-1', elementId: 'e1' })
    const [a1, a2] = await Promise.all([p1, p2])

    // Exactly one find + one create despite two callers.
    expect(findAnalysesMock).toHaveBeenCalledTimes(1)
    expect(createAnalysisMock).toHaveBeenCalledTimes(1)
    expect(a1).toBe(a2)
    expect(a1.id).toBe('created-1')
  })

  it('reuses the resolved analysis for both callers when the element already exists', async () => {
    findAnalysesMock.mockResolvedValue([{ id: 'existing-1', elementId: 'e2' }])

    const store = useAnalysisStore()
    const [a1, a2] = await Promise.all([
      store.getOrCreateAnalysis({ elementId: 'e2' }),
      store.getOrCreateAnalysis({ elementId: 'e2' }),
    ])

    expect(findAnalysesMock).toHaveBeenCalledTimes(1)
    expect(createAnalysisMock).not.toHaveBeenCalled()
    expect(a1.id).toBe('existing-1')
    expect(a2).toBe(a1)
  })
})
