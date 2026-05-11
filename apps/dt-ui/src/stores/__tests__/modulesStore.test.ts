/**
 * Unit tests for the modulesStore admin-mutation surface. We mock
 * @dethernety/dt-core to capture the (DtClassIdentity, DtModule) calls so
 * the test exercises only the store's wrapper logic: try/catch, isLoading
 * lifecycle, post-success refresh, and handleApiError mapping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const migrateClassIdMock = vi.fn()
const reviveOrphanedClassMock = vi.fn()
const deleteOrphanedClassMock = vi.fn()
const runIdentityMigrationMock = vi.fn()
const getModulesWithIdentityMock = vi.fn()
const getModulesMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtModule: class {
    getModules = getModulesMock
  },
  DtClassIdentity: class {
    getModulesWithIdentity = getModulesWithIdentityMock
    migrateClassId = migrateClassIdMock
    reviveOrphanedClass = reviveOrphanedClassMock
    deleteOrphanedClass = deleteOrphanedClassMock
    runIdentityMigration = runIdentityMigrationMock
  }
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useModulesStore: typeof import('../modulesStore').useModulesStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../modulesStore')
  useModulesStore = mod.useModulesStore
})

describe('modulesStore.migrateClassId', () => {
  it('forwards args, returns true, and refreshes module state on success', async () => {
    migrateClassIdMock.mockResolvedValueOnce(true)
    getModulesWithIdentityMock.mockResolvedValueOnce([{ id: 'm1', name: 'mod-1' }])
    const store = useModulesStore()
    const ok = await store.migrateClassId({
      moduleName: 'mod-1',
      className: 'WebServer',
      classKind: 'ComponentClass',
      newId: 'mod-1:WebServer:v2'
    })
    expect(ok).toBe(true)
    expect(migrateClassIdMock).toHaveBeenCalledWith({
      moduleName: 'mod-1',
      className: 'WebServer',
      classKind: 'ComponentClass',
      newId: 'mod-1:WebServer:v2'
    })
    expect(getModulesWithIdentityMock).toHaveBeenCalledTimes(1)
  })

  it('toggles isLoading.migrateClassId across the call', async () => {
    migrateClassIdMock.mockResolvedValueOnce(true)
    getModulesWithIdentityMock.mockResolvedValueOnce([])
    const store = useModulesStore()
    expect(store.isLoading.migrateClassId).toBe(false)
    const promise = store.migrateClassId({
      moduleName: 'm', className: 'c', classKind: 'ComponentClass', newId: 'x'
    })
    expect(store.isLoading.migrateClassId).toBe(true)
    await promise
    expect(store.isLoading.migrateClassId).toBe(false)
  })

  it('maps a 403 error via handleApiError and rethrows', async () => {
    migrateClassIdMock.mockRejectedValueOnce(new Error('Forbidden 403'))
    const store = useModulesStore()
    await expect(
      store.migrateClassId({ moduleName: 'm', className: 'c', classKind: 'ComponentClass', newId: 'x' })
    ).rejects.toThrow('Forbidden 403')
    expect(store.error).toBe('Admin role required to perform this action')
    expect(getModulesWithIdentityMock).not.toHaveBeenCalled()
  })

  it('does not refresh when the mutation returns false', async () => {
    migrateClassIdMock.mockResolvedValueOnce(false)
    const store = useModulesStore()
    const ok = await store.migrateClassId({
      moduleName: 'm', className: 'c', classKind: 'ComponentClass', newId: 'x'
    })
    expect(ok).toBe(false)
    expect(getModulesWithIdentityMock).not.toHaveBeenCalled()
  })
})

describe('modulesStore.reviveOrphanedClass', () => {
  it('forwards args, refreshes, and surfaces a success message', async () => {
    reviveOrphanedClassMock.mockResolvedValueOnce(true)
    getModulesWithIdentityMock.mockResolvedValueOnce([])
    const store = useModulesStore()
    const ok = await store.reviveOrphanedClass({ classId: 'cid', classKind: 'AnalysisClass' })
    expect(ok).toBe(true)
    expect(reviveOrphanedClassMock).toHaveBeenCalledWith({
      classId: 'cid', classKind: 'AnalysisClass'
    })
    expect(getModulesWithIdentityMock).toHaveBeenCalledTimes(1)
    expect(store.successMessage).toBe('Class revived')
  })

  it('preserves error and skips refresh on rejection', async () => {
    reviveOrphanedClassMock.mockRejectedValueOnce(new Error('not orphaned'))
    const store = useModulesStore()
    await expect(
      store.reviveOrphanedClass({ classId: 'cid', classKind: 'IssueClass' })
    ).rejects.toThrow('not orphaned')
    expect(store.error).toContain('Failed to revive orphaned class')
    expect(getModulesWithIdentityMock).not.toHaveBeenCalled()
  })
})

describe('modulesStore.deleteOrphanedClass', () => {
  it('passes cascade=true and uses the cascade success copy', async () => {
    deleteOrphanedClassMock.mockResolvedValueOnce(true)
    getModulesWithIdentityMock.mockResolvedValueOnce([])
    const store = useModulesStore()
    const ok = await store.deleteOrphanedClass({
      classId: 'cid', classKind: 'ComponentClass', cascade: true
    })
    expect(ok).toBe(true)
    expect(deleteOrphanedClassMock).toHaveBeenCalledWith({
      classId: 'cid', classKind: 'ComponentClass', cascade: true
    })
    expect(store.successMessage).toBe('Class and dependents deleted')
  })

  it('uses the non-cascade success copy when cascade=false', async () => {
    deleteOrphanedClassMock.mockResolvedValueOnce(true)
    getModulesWithIdentityMock.mockResolvedValueOnce([])
    const store = useModulesStore()
    await store.deleteOrphanedClass({
      classId: 'cid', classKind: 'ComponentClass', cascade: false
    })
    expect(store.successMessage).toBe('Class deleted')
  })

  it('maps cascade-rejection error and rethrows', async () => {
    deleteOrphanedClassMock.mockRejectedValueOnce(new Error('Refusing to delete — has 5 incoming edges'))
    const store = useModulesStore()
    await expect(
      store.deleteOrphanedClass({ classId: 'cid', classKind: 'ComponentClass', cascade: false })
    ).rejects.toThrow('Refusing to delete')
    expect(store.error).toContain('Failed to delete orphaned class')
  })
})

describe('modulesStore.runIdentityMigration', () => {
  it('returns the report and skips refresh on dry-run', async () => {
    const report = { dryRun: true, totalActions: 3, details: ['a', 'b', 'c'] }
    runIdentityMigrationMock.mockResolvedValueOnce(report)
    const store = useModulesStore()
    const result = await store.runIdentityMigration({ dryRun: true })
    expect(result).toEqual(report)
    expect(getModulesWithIdentityMock).not.toHaveBeenCalled()
  })

  it('refreshes module state when applying (dryRun: false)', async () => {
    const report = { dryRun: false, totalActions: 0, details: [] }
    runIdentityMigrationMock.mockResolvedValueOnce(report)
    getModulesWithIdentityMock.mockResolvedValueOnce([])
    const store = useModulesStore()
    await store.runIdentityMigration({ dryRun: false })
    expect(getModulesWithIdentityMock).toHaveBeenCalledTimes(1)
  })

  it('toggles isLoading.runIdentityMigration across the call', async () => {
    runIdentityMigrationMock.mockResolvedValueOnce({ dryRun: true, totalActions: 0, details: [] })
    const store = useModulesStore()
    expect(store.isLoading.runIdentityMigration).toBe(false)
    const promise = store.runIdentityMigration({ dryRun: true })
    expect(store.isLoading.runIdentityMigration).toBe(true)
    await promise
    expect(store.isLoading.runIdentityMigration).toBe(false)
  })

  it('maps errors via handleApiError and rethrows', async () => {
    runIdentityMigrationMock.mockRejectedValueOnce(new Error('timed out'))
    const store = useModulesStore()
    await expect(store.runIdentityMigration({ dryRun: false })).rejects.toThrow('timed out')
    expect(store.error).toContain('Failed to run identity migration')
  })
})
