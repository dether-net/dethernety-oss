/**
 * Store finder error contract: the list/fetch finders on the core pages catch a
 * dt-core failure, set their error ref, and RESOLVE to an empty sentinel — they
 * do NOT re-throw. Callers distinguish "fetch failed" from "empty" via the error
 * ref (the controlsStore pattern) instead of an unhandled rejection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const getFoldersMock = vi.fn()
const findIssueClassesMock = vi.fn()
const findAnalysesMock = vi.fn()
const findAnalysisClassesMock = vi.fn()
const getModelsMock = vi.fn()
const getModulesMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtFolder: class { getFolders = getFoldersMock },
  DtClass: class {},
  DtIssue: class { findIssueClasses = findIssueClassesMock },
  DtAnalysis: class { findAnalyses = findAnalysesMock; findAnalysisClasses = findAnalysisClassesMock },
  DtMitreAttack: class {},
  DtMitreDefend: class {},
  DtModel: class { getModels = getModelsMock },
  DtModule: class { getModules = getModulesMock },
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFolderStore: typeof import('../folderStore').useFolderStore
let useIssueStore: typeof import('../issueStore').useIssueStore
let useAnalysisStore: typeof import('../analysisStore').useAnalysisStore
let useModelsStore: typeof import('../modelsStore').useModelsStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useFolderStore = (await import('../folderStore')).useFolderStore
  useIssueStore = (await import('../issueStore')).useIssueStore
  useAnalysisStore = (await import('../analysisStore')).useAnalysisStore
  useModelsStore = (await import('../modelsStore')).useModelsStore
})

const boom = () => new Error('network unreachable')

describe('folderStore.fetchFolders', () => {
  it('resolves and sets error (no throw) on failure', async () => {
    getFoldersMock.mockRejectedValue(boom())
    const store = useFolderStore()
    await expect(store.fetchFolders()).resolves.toBeUndefined()
    expect(store.error).toBeTruthy()
  })
  it('loads folders and leaves error clear on success', async () => {
    getFoldersMock.mockResolvedValue([{ id: 'f1' }])
    const store = useFolderStore()
    await store.fetchFolders()
    expect(store.error).toBe('')
    expect(store.folders.length).toBe(1)
  })
})

describe('issueStore.fetchIssueClasses', () => {
  it('returns [] and sets error (no throw) on failure', async () => {
    findIssueClassesMock.mockRejectedValue(boom())
    const store = useIssueStore()
    await expect(store.fetchIssueClasses({})).resolves.toEqual([])
    expect(store.error).toBeTruthy()
  })
  it('returns the classes and leaves error clear on success', async () => {
    findIssueClassesMock.mockResolvedValue([{ id: 'c1' }])
    const store = useIssueStore()
    await expect(store.fetchIssueClasses({})).resolves.toEqual([{ id: 'c1' }])
    expect(store.error).toBe('')
  })
})

describe('analysisStore.fetchAnalyses', () => {
  it('returns [] and sets error (no throw) on failure', async () => {
    findAnalysesMock.mockRejectedValue(boom())
    const store = useAnalysisStore()
    await expect(store.fetchAnalyses({ analysisId: 'a1' })).resolves.toEqual([])
    expect(store.error).toBeTruthy()
  })
  it('returns analyses and leaves error clear on success', async () => {
    findAnalysesMock.mockResolvedValue([{ id: 'a1' }])
    const store = useAnalysisStore()
    const res = await store.fetchAnalyses({ analysisId: 'a1' })
    expect(res.length).toBe(1)
    expect(store.error).toBe('')
  })
})

describe('analysisStore.fetchAnalysisClasses', () => {
  it('returns [] and sets error (no throw) on failure', async () => {
    findAnalysisClassesMock.mockRejectedValue(boom())
    const store = useAnalysisStore()
    await expect(store.fetchAnalysisClasses({})).resolves.toEqual([])
    expect(store.error).toBeTruthy()
  })
  it('returns the classes and leaves error clear on success', async () => {
    findAnalysisClassesMock.mockResolvedValue([{ id: 'ac1' }])
    const store = useAnalysisStore()
    await expect(store.fetchAnalysisClasses({})).resolves.toEqual([{ id: 'ac1' }])
    expect(store.error).toBe('')
  })
})

describe('modelsStore.fetchModels', () => {
  it('returns [] and sets both error refs (no throw) on failure', async () => {
    getModelsMock.mockRejectedValue(boom())
    const store = useModelsStore()
    await expect(store.fetchModels({})).resolves.toEqual([])
    expect(store.error).toBeTruthy()
    expect(store.fetchModelsError).toBeTruthy()
  })
  it('returns models and leaves both error refs clear on success', async () => {
    getModelsMock.mockResolvedValue([{ id: 'm1' }])
    const store = useModelsStore()
    await expect(store.fetchModels({})).resolves.toEqual([{ id: 'm1' }])
    expect(store.error).toBe('')
    expect(store.fetchModelsError).toBe('')
  })
})

describe('modelsStore.fetchModules', () => {
  it('resolves and sets error (no throw) on failure', async () => {
    getModulesMock.mockRejectedValue(boom())
    const store = useModelsStore()
    await expect(store.fetchModules()).resolves.toBeUndefined()
    expect(store.error).toBeTruthy()
  })
  it('loads modules and leaves error clear on success', async () => {
    getModulesMock.mockResolvedValue([{ id: 'mod1' }])
    const store = useModelsStore()
    await store.fetchModules()
    expect(store.error).toBe('')
    expect(store.modules.length).toBe(1)
  })
})
