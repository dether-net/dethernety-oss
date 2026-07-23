/**
 * DtUpdateSplit — (1) validateSplitModel now validates flow references (a
 * typo'd endpoint fails the update BEFORE the skip-then-delete-orphan sequence
 * could fire under deleteOrphaned), and (2) updateAttributesOnly scopes writes
 * to the target model (record key must match entry.elementId AND belong to the
 * model — closes the cross-model attributes write).
 */
import { describe, it, expect, vi } from 'vitest'
import { DtUpdateSplit } from '../dt-update-split.js'

const splitFixture = (over: any = {}) => ({
  manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M', defaultBoundaryId: 'b0' }, modules: [], exportedAt: 'x' },
  structure: {
    defaultBoundary: {
      id: 'b0', name: 'root',
      components: [{ id: 'c1', name: 'C1', type: 'PROCESS', positionX: 0, positionY: 0 }],
      boundaries: [{ id: 'b1', name: 'DMZ' }],
    },
  },
  dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1' }, target: { id: 'b1' } }],
  dataItems: [],
  attributes: {},
  ...over,
})

describe('DtUpdateSplit.validateSplitModel — flow references', () => {
  it('accepts a valid model incl. a boundary-attached flow', () => {
    const dt = new DtUpdateSplit({} as any) as any
    expect(dt.validateSplitModel(splitFixture())).toEqual([])
  })

  it('rejects a typo\'d flow source (the deleteOrphaned data-loss guard)', () => {
    const dt = new DtUpdateSplit({} as any) as any
    const errors = dt.validateSplitModel(splitFixture({
      dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1-typo' }, target: { id: 'b1' } }],
    }))
    expect(errors.some((e: any) => /non-existent source: c1-typo/.test(e.error))).toBe(true)
  })

  it('rejects a flow with a missing target reference', () => {
    const dt = new DtUpdateSplit({} as any) as any
    const errors = dt.validateSplitModel(splitFixture({
      dataFlows: [{ id: 'f1', name: 'flow', source: { id: 'c1' } }],
    }))
    expect(errors.some((e: any) => /missing target reference/.test(e.error))).toBe(true)
  })
})

describe('DtUpdateSplit.updateAttributesOnly — model-scoped writes', () => {
  const seeded = () => {
    const dt = new DtUpdateSplit({} as any) as any
    dt.dtModel.getModelData = vi.fn().mockResolvedValue({
      id: 'M1',
      defaultBoundary: {
        id: 'b0',
        allDescendantComponents: [{ id: 'c1' }],
        allDescendantBoundaries: [{ id: 'b1' }],
        allDescendantDataFlows: [{ id: 'f1' }],
      },
      dataItems: [{ id: 'd1' }],
    })
    const setSpy = vi.fn().mockResolvedValue(true)
    dt.dtClass.setInstantiationAttributes = setSpy
    return { dt, setSpy }
  }

  it('writes a legitimate same-model entry', async () => {
    const { dt, setSpy } = seeded()
    const result = await dt.updateAttributesOnly('M1', {
      components: { c1: { elementId: 'c1', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } } },
    })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.stats.components.updated).toBe(1)
  })

  it('rejects an entry whose element belongs to a DIFFERENT model (no write)', async () => {
    const { dt, setSpy } = seeded()
    const result = await dt.updateAttributesOnly('M1', {
      components: { foreign: { elementId: 'foreign', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } } },
    })
    expect(setSpy).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /does not belong to model M1/.test(e.error))).toBe(true)
    expect(result.stats.components.failed).toBe(1)
  })

  it('rejects a key/elementId mismatch (no redirected write)', async () => {
    const { dt, setSpy } = seeded()
    const result = await dt.updateAttributesOnly('M1', {
      components: { c1: { elementId: 'b1', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } } },
    })
    expect(setSpy).not.toHaveBeenCalled()
    expect(result.errors.some((e: any) => /does not match its elementId/.test(e.error))).toBe(true)
  })

  it('rejections are per-entry: a bad entry fails, a good one still writes', async () => {
    const { dt, setSpy } = seeded()
    const result = await dt.updateAttributesOnly('M1', {
      components: {
        c1: { elementId: 'c1', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } },
        foreign: { elementId: 'foreign', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } },
      },
    })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(result.stats.components.updated).toBe(1)
    expect(result.stats.components.failed).toBe(1)
  })

  it('a null entry value fails per-entry, not by throwing out of the loop', async () => {
    const { dt, setSpy } = seeded()
    const result = await dt.updateAttributesOnly('M1', {
      components: {
        broken: null as any,
        c1: { elementId: 'c1', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } },
      },
    })
    expect(setSpy).toHaveBeenCalledTimes(1) // the good entry still writes
    expect(result.stats.components.failed).toBe(1)
    expect(result.errors.some((e: any) => /is not an object/.test(e.error))).toBe(true)
  })

  it('fails closed when the membership set cannot be established', async () => {
    const dt = new DtUpdateSplit({} as any) as any
    dt.dtModel.getModelData = vi.fn().mockRejectedValue(new Error('network down'))
    const setSpy = vi.fn()
    dt.dtClass.setInstantiationAttributes = setSpy

    const result = await dt.updateAttributesOnly('M1', {
      components: { c1: { elementId: 'c1', elementType: 'component', classData: { id: 'k1', name: 'K' }, attributes: { a: 1 } } },
    })
    expect(result.success).toBe(false)
    expect(setSpy).not.toHaveBeenCalled()
    expect(result.errors.some((e: any) => /Could not verify element ownership/.test(e.error))).toBe(true)
  })
})
