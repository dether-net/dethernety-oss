/**
 * Unit tests for the classIdentityStore. The store wraps DtClassIdentity and
 * adds a small client-side filter layer (the 'errors' and 'orphan-revive'
 * composite kinds). Tests verify the store's translation between UI-facing
 * filter shape and the server-facing query args.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const getEventsMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtClassIdentity: class {
    getClassIdentityEvents = getEventsMock
  }
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useClassIdentityStore: typeof import('../classIdentityStore').useClassIdentityStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../classIdentityStore')
  useClassIdentityStore = mod.useClassIdentityStore
})

describe('classIdentityStore initial state', () => {
  it('starts with empty events and the default "all" filter', () => {
    const store = useClassIdentityStore()
    expect(store.events).toEqual([])
    expect(store.filter.kind).toBe('all')
    expect(store.filter.moduleName).toBeUndefined()
    expect(store.isLoading).toBe(false)
  })
})

describe('classIdentityStore.fetchEvents', () => {
  it('passes through kind/module/since to the server when filter is concrete', async () => {
    getEventsMock.mockResolvedValue([])
    const store = useClassIdentityStore()
    store.setKindFilter('rebind')
    store.setModuleFilter('mod-1')
    store.setSinceFilter('2026-05-10T00:00:00.000Z')
    await store.fetchEvents()
    expect(getEventsMock).toHaveBeenLastCalledWith({
      kind: 'rebind',
      moduleName: 'mod-1',
      since: '2026-05-10T00:00:00.000Z'
    })
  })

  it('omits server kind for the "all" composite (server returns everything)', async () => {
    getEventsMock.mockResolvedValue([])
    const store = useClassIdentityStore()
    await store.fetchEvents()
    expect(getEventsMock).toHaveBeenLastCalledWith({
      kind: undefined,
      moduleName: undefined,
      since: undefined
    })
  })

  it('omits server kind for the "errors" composite (filtered client-side)', async () => {
    getEventsMock.mockResolvedValue([
      { kind: 'rebind', timestamp: 't1' },
      { kind: 'rebind-conflict', timestamp: 't2' },
      { kind: 'collision', timestamp: 't3' },
      { kind: 'orphan', timestamp: 't4' }
    ])
    const store = useClassIdentityStore()
    store.setKindFilter('errors')
    await store.fetchEvents()
    expect(getEventsMock).toHaveBeenLastCalledWith({
      kind: undefined,
      moduleName: undefined,
      since: undefined
    })
    // events stores the raw response; filteredEvents applies the composite.
    expect(store.filteredEvents.map((e) => e.kind)).toEqual([
      'rebind-conflict',
      'collision'
    ])
  })

  it('omits server kind for "orphan-revive" composite and filters client-side', async () => {
    getEventsMock.mockResolvedValue([
      { kind: 'rebind', timestamp: 't1' },
      { kind: 'orphan', timestamp: 't2' },
      { kind: 'revive', timestamp: 't3' }
    ])
    const store = useClassIdentityStore()
    store.setKindFilter('orphan-revive')
    await store.fetchEvents()
    expect(getEventsMock).toHaveBeenLastCalledWith({
      kind: undefined,
      moduleName: undefined,
      since: undefined
    })
    expect(store.events.map((e) => e.kind)).toEqual(['orphan', 'revive'])
  })

  it('populates events on success and stamps lastFetch', async () => {
    const events = [{ kind: 'rebind', timestamp: '2026-05-10T12:00:00.000Z' }]
    getEventsMock.mockResolvedValue(events)
    const store = useClassIdentityStore()
    await store.fetchEvents()
    expect(store.events).toEqual(events)
    expect(store.lastFetch).toBeGreaterThan(0)
  })

  it('sets error and preserves prior events on rejection', async () => {
    getEventsMock.mockResolvedValueOnce([
      { kind: 'rebind', timestamp: 't1' }
    ])
    const store = useClassIdentityStore()
    await store.fetchEvents()
    expect(store.events).toHaveLength(1)

    getEventsMock.mockRejectedValueOnce(new Error('boom'))
    await store.fetchEvents()
    expect(store.error).toContain('Failed to fetch class-identity events')
    expect(store.events).toHaveLength(1) // prior data preserved
  })
})

describe('classIdentityStore filter setters', () => {
  it('clearFilter resets to defaults', () => {
    const store = useClassIdentityStore()
    store.setKindFilter('rebind')
    store.setModuleFilter('mod-1')
    store.setSinceFilter('t1')
    store.clearFilter()
    expect(store.filter).toEqual({ kind: 'all' })
  })

  it('setModuleFilter normalises empty string to undefined', () => {
    const store = useClassIdentityStore()
    store.setModuleFilter('')
    expect(store.filter.moduleName).toBeUndefined()
  })

  it('resetStore zeroes everything', async () => {
    getEventsMock.mockResolvedValue([{ kind: 'rebind', timestamp: 't1' }])
    const store = useClassIdentityStore()
    await store.fetchEvents()
    store.setKindFilter('rebind')
    store.resetStore()
    expect(store.events).toEqual([])
    expect(store.filter).toEqual({ kind: 'all' })
    expect(store.lastFetch).toBe(0)
  })
})
