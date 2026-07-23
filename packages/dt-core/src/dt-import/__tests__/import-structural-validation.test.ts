/**
 * The repaired validateMonolithicModel is wired into importModel — structural
 * errors (dangling flow refs, duplicate ids) abort BEFORE any mutation; validator
 * warnings surface on the result without blocking.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

const stubPipeline = (dtImport: any) => {
  dtImport.createModel = vi.fn().mockResolvedValue({ id: 'M1' })
  for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'createDataFlows',
    'associateDataItemsWithElements', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
    dtImport[m] = vi.fn().mockResolvedValue(undefined)
  }
  return dtImport.createModel
}

describe('DtImport — structural validation wired', () => {
  it('a dangling flow source aborts before createModel', async () => {
    const dtImport = new DtImport({} as any) as any
    const createSpy = stubPipeline(dtImport)

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0', components: [{ id: 'c1', name: 'C', type: 'PROCESS', positionX: 0, positionY: 0 }] },
      dataFlows: [{ id: 'f1', name: 'bad', source: { id: 'nope' }, target: { id: 'c1' } }],
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /source/.test(e.error))).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('duplicate element ids abort before createModel', async () => {
    const dtImport = new DtImport({} as any) as any
    const createSpy = stubPipeline(dtImport)

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: {
        id: 'b0',
        components: [
          { id: 'c1', name: 'A', type: 'PROCESS', positionX: 0, positionY: 0 },
          { id: 'c1', name: 'B', type: 'STORE', positionX: 1, positionY: 1 },
        ],
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /Duplicate element id/.test(e.error))).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('a boundary-attached flow imports fine (endpoint drift fixed)', async () => {
    const dtImport = new DtImport({} as any) as any
    stubPipeline(dtImport)

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: {
        id: 'b0',
        components: [{ id: 'c1', name: 'C', type: 'PROCESS', positionX: 0, positionY: 0 }],
        boundaries: [{ id: 'b1', name: 'DMZ' }],
      },
      dataFlows: [{ id: 'f1', name: 'to-dmz', source: { id: 'c1' }, target: { id: 'b1' } }],
    })

    expect(result.success).toBe(true)
  })

  it('validator warnings (orphaned data-item ref) surface without blocking', async () => {
    const dtImport = new DtImport({} as any) as any
    stubPipeline(dtImport)

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: {
        id: 'b0',
        components: [{ id: 'c1', name: 'C', type: 'PROCESS', positionX: 0, positionY: 0, dataItemIds: ['ghost'] }],
      },
      dataItems: [{ id: 'd1', name: 'PII' }],
    })

    expect(result.success).toBe(true)
    expect(result.warnings.some((w: string) => /ghost/.test(w))).toBe(true)
  })
})
