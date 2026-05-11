/**
 * Unit tests for DtClassIdentity. Mirrors the create-analysis test pattern:
 * stub dtUtils.performQuery to capture call shape and return prepared results.
 * Real GraphQL execution is exercised via the dt-ws integration tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtClassIdentity } from '../dt-class-identity.js'

interface PerformQueryCall {
  query: unknown
  variables?: Record<string, unknown>
  action: string
  fetchPolicy?: string
}

function buildHarness(queryResult: unknown) {
  const calls: PerformQueryCall[] = []
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtClassIdentity(apolloClient)
  const performQuery = vi.fn(async (input: PerformQueryCall) => {
    calls.push(input)
    return queryResult
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performQuery = performQuery
  return { dt, calls, performQuery }
}

describe('DtClassIdentity.getModulesWithIdentity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the modules array when the response is populated', async () => {
    const { dt } = buildHarness({
      modules: [
        { id: 'm1', name: 'mod-1', constraintsHealthy: true },
        { id: 'm2', name: 'mod-2', constraintsHealthy: true }
      ]
    })
    const result = await dt.getModulesWithIdentity()
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('mod-1')
  })

  it('returns an empty array when the response has no modules field', async () => {
    const { dt } = buildHarness({})
    const result = await dt.getModulesWithIdentity()
    expect(result).toEqual([])
  })

  it('uses network-only fetchPolicy and a stable action name', async () => {
    const { dt, calls } = buildHarness({ modules: [] })
    await dt.getModulesWithIdentity()
    expect(calls).toHaveLength(1)
    expect(calls[0].fetchPolicy).toBe('network-only')
    expect(calls[0].action).toBe('getModulesWithIdentity')
  })

  it('propagates errors from the underlying performQuery', async () => {
    const { dt } = buildHarness({})
    const apolloClient = {} as Apollo.ApolloClient
    const failing = new DtClassIdentity(apolloClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(failing as any).dtUtils.performQuery = vi.fn().mockRejectedValue(
      new Error('network down')
    )
    await expect(failing.getModulesWithIdentity()).rejects.toThrow('network down')
    void dt
  })
})

describe('DtClassIdentity.getClassIdentityEvents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes filter args through unchanged', async () => {
    const { dt, calls } = buildHarness({ classIdentityEvents: [] })
    await dt.getClassIdentityEvents({
      kind: 'rebind-conflict',
      moduleName: 'mod-x',
      since: '2026-05-10T12:00:00.000Z'
    })
    expect(calls[0].variables).toEqual({
      kind: 'rebind-conflict',
      moduleName: 'mod-x',
      since: '2026-05-10T12:00:00.000Z'
    })
  })

  it('passes undefined for omitted filter args (server treats as no filter)', async () => {
    const { dt, calls } = buildHarness({ classIdentityEvents: [] })
    await dt.getClassIdentityEvents({})
    expect(calls[0].variables).toEqual({
      kind: undefined,
      moduleName: undefined,
      since: undefined
    })
  })

  it('returns events array from the response', async () => {
    const events = [
      { kind: 'rebind', timestamp: '2026-05-10T12:00:00.000Z', moduleName: 'mod-1' },
      { kind: 'orphan', timestamp: '2026-05-10T12:01:00.000Z', moduleName: 'mod-1' }
    ]
    const { dt } = buildHarness({ classIdentityEvents: events })
    const result = await dt.getClassIdentityEvents({})
    expect(result).toEqual(events)
  })

  it('returns empty array when classIdentityEvents is missing from response', async () => {
    const { dt } = buildHarness({})
    const result = await dt.getClassIdentityEvents({})
    expect(result).toEqual([])
  })

  it('defaults filter to empty object when no arg provided', async () => {
    const { dt, calls } = buildHarness({ classIdentityEvents: [] })
    await dt.getClassIdentityEvents()
    expect(calls[0].variables).toEqual({
      kind: undefined,
      moduleName: undefined,
      since: undefined
    })
  })
})

// -----------------------------------------------------------------------
// Admin mutations. Mirror the read-side harness shape; the call shape of
// performMutation is `{ mutation, variables, dataPath, action }`. Each
// test asserts (a) call shape, (b) return value, (c) error propagation.
// -----------------------------------------------------------------------

interface PerformMutationCall {
  mutation: unknown
  variables: Record<string, unknown>
  dataPath: string
  action: string
}

function buildMutationHarness(returnValue: unknown) {
  const calls: PerformMutationCall[] = []
  const apolloClient = {} as Apollo.ApolloClient
  const dt = new DtClassIdentity(apolloClient)
  const performMutation = vi.fn(async (input: PerformMutationCall) => {
    calls.push(input)
    return returnValue
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(dt as any).dtUtils.performMutation = performMutation
  return { dt, calls, performMutation }
}

describe('DtClassIdentity.migrateClassId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes variables + dataPath + action through to performMutation', async () => {
    const { dt, calls } = buildMutationHarness(true)
    await dt.migrateClassId({
      moduleName: 'mod-1',
      className: 'WebServer',
      classKind: 'ComponentClass',
      newId: 'mod-1:WebServer:v2'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].variables).toEqual({
      moduleName: 'mod-1',
      className: 'WebServer',
      classKind: 'ComponentClass',
      newId: 'mod-1:WebServer:v2'
    })
    expect(calls[0].dataPath).toBe('migrateClassId')
    expect(calls[0].action).toBe('migrateClassId')
  })

  it('returns the boolean from the server', async () => {
    const { dt } = buildMutationHarness(true)
    const ok = await dt.migrateClassId({
      moduleName: 'm',
      className: 'c',
      classKind: 'ComponentClass',
      newId: 'x'
    })
    expect(ok).toBe(true)
  })

  it('propagates errors from performMutation', async () => {
    const apolloClient = {} as Apollo.ApolloClient
    const dt = new DtClassIdentity(apolloClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dt as any).dtUtils.performMutation = vi
      .fn()
      .mockRejectedValue(new Error('Admin role required'))
    await expect(
      dt.migrateClassId({ moduleName: 'm', className: 'c', classKind: 'ComponentClass', newId: 'x' })
    ).rejects.toThrow('Admin role required')
  })
})

describe('DtClassIdentity.reviveOrphanedClass', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes args + dataPath + action through to performMutation', async () => {
    const { dt, calls } = buildMutationHarness(true)
    await dt.reviveOrphanedClass({ classId: 'cid-1', classKind: 'AnalysisClass' })
    expect(calls[0].variables).toEqual({ classId: 'cid-1', classKind: 'AnalysisClass' })
    expect(calls[0].dataPath).toBe('reviveOrphanedClass')
    expect(calls[0].action).toBe('reviveOrphanedClass')
  })

  it('returns the boolean from the server', async () => {
    const { dt } = buildMutationHarness(true)
    const ok = await dt.reviveOrphanedClass({ classId: 'cid', classKind: 'IssueClass' })
    expect(ok).toBe(true)
  })

  it('propagates errors from performMutation', async () => {
    const apolloClient = {} as Apollo.ApolloClient
    const dt = new DtClassIdentity(apolloClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dt as any).dtUtils.performMutation = vi.fn().mockRejectedValue(new Error('not orphaned'))
    await expect(
      dt.reviveOrphanedClass({ classId: 'cid', classKind: 'AnalysisClass' })
    ).rejects.toThrow('not orphaned')
  })
})

describe('DtClassIdentity.deleteOrphanedClass', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes cascade flag verbatim and uses correct dataPath', async () => {
    const { dt, calls } = buildMutationHarness(true)
    await dt.deleteOrphanedClass({
      classId: 'cid',
      classKind: 'ComponentClass',
      cascade: true
    })
    expect(calls[0].variables).toEqual({
      classId: 'cid',
      classKind: 'ComponentClass',
      cascade: true
    })
    expect(calls[0].dataPath).toBe('deleteOrphanedClass')
    expect(calls[0].action).toBe('deleteOrphanedClass')
  })

  it('also handles cascade=false (the safe default)', async () => {
    const { dt, calls } = buildMutationHarness(true)
    await dt.deleteOrphanedClass({
      classId: 'cid',
      classKind: 'IssueClass',
      cascade: false
    })
    expect(calls[0].variables.cascade).toBe(false)
  })

  it('propagates errors from performMutation', async () => {
    const apolloClient = {} as Apollo.ApolloClient
    const dt = new DtClassIdentity(apolloClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dt as any).dtUtils.performMutation = vi
      .fn()
      .mockRejectedValue(new Error('cascade limit exceeded'))
    await expect(
      dt.deleteOrphanedClass({ classId: 'cid', classKind: 'ComponentClass', cascade: true })
    ).rejects.toThrow('cascade limit exceeded')
  })
})

describe('DtClassIdentity.runIdentityMigration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes dryRun arg through to performMutation', async () => {
    const { dt, calls } = buildMutationHarness({
      dryRun: true,
      totalActions: 0,
      details: []
    })
    await dt.runIdentityMigration({ dryRun: true })
    expect(calls[0].variables).toEqual({ dryRun: true })
    expect(calls[0].dataPath).toBe('runIdentityMigration')
    expect(calls[0].action).toBe('runIdentityMigration')
  })

  it('returns the IdentityMigrationReport from the server', async () => {
    const report = {
      dryRun: false,
      totalActions: 7,
      details: ['Normalized AnalysisClass:legacy', 'Rescued 2 orphaned attachments']
    }
    const { dt } = buildMutationHarness(report)
    const result = await dt.runIdentityMigration({ dryRun: false })
    expect(result).toEqual(report)
  })

  it('propagates errors from performMutation', async () => {
    const apolloClient = {} as Apollo.ApolloClient
    const dt = new DtClassIdentity(apolloClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dt as any).dtUtils.performMutation = vi
      .fn()
      .mockRejectedValue(new Error('migration timed out'))
    await expect(dt.runIdentityMigration({ dryRun: false })).rejects.toThrow(
      'migration timed out'
    )
  })
})
