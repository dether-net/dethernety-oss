/**
 * issueStore.fetchIssues stale-response guard.
 *
 * Search-as-you-type / folder-switch fires overlapping fetches. A request-generation
 * token ensures only the latest call publishes to the store, so an older response that
 * resolves last can't clobber the newer list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const findIssuesMock = vi.fn()
const findIssueClassesMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtIssue: class { findIssues = findIssuesMock; findIssueClasses = findIssueClassesMock },
  DtClass: class {},
}))
vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useIssueStore: typeof import('../issueStore').useIssueStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useIssueStore = (await import('../issueStore')).useIssueStore
})

describe('issueStore.fetchIssues — stale-response guard', () => {
  it('keeps the newest result when an older response resolves last', async () => {
    let resolveA: (v: unknown) => void = () => {}
    let resolveB: (v: unknown) => void = () => {}
    findIssuesMock
      .mockReturnValueOnce(new Promise(r => { resolveA = r }))
      .mockReturnValueOnce(new Promise(r => { resolveB = r }))

    const store = useIssueStore()
    const pa = store.fetchIssues({ name: 'a' })   // gen 1
    const pb = store.fetchIssues({ name: 'ab' })  // gen 2 (latest)

    // B (newer) resolves first, then A (older) resolves last.
    resolveB([{ id: 'B' }])
    await pb
    resolveA([{ id: 'A' }])
    await pa

    // The stale A write is dropped; the store holds B.
    expect(store.issues).toEqual([{ id: 'B' }])
  })

  it('publishes normally when the latest call resolves', async () => {
    findIssuesMock.mockResolvedValueOnce([{ id: 'X' }])
    const store = useIssueStore()
    await store.fetchIssues({ name: 'x' })
    expect(store.issues).toEqual([{ id: 'X' }])
  })
})
