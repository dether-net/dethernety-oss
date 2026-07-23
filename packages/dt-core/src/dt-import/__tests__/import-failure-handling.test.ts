/**
 * Up-front type validation rejects bad payloads BEFORE any mutation (no
 * partial model), and a terminal failure AFTER the model is created rolls it back
 * (best-effort deleteModel), while a failure BEFORE creation does not.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

describe('DtImport — up-front type validation gate', () => {
  it('rejects a non-numeric positionX before creating anything', async () => {
    const dtImport = new DtImport({} as any) as any
    const createSpy = vi.fn()
    dtImport.createModel = createSpy

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0', components: [{ id: 'c1', name: 'C', type: 'STORE', positionX: '12' }] },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /positionX/.test(e.error))).toBe(true)
    expect(createSpy).not.toHaveBeenCalled() // no partial model
  })

  it('rejects a non-string type before creating anything', async () => {
    const dtImport = new DtImport({} as any) as any
    const createSpy = vi.fn()
    dtImport.createModel = createSpy

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0', components: [{ id: 'c1', name: 'C', type: 123 }] },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /type must be a string/.test(e.error))).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-finite position (Infinity survives the || fallback and reaches GraphQL)', async () => {
    const dtImport = new DtImport({} as any) as any
    const createSpy = vi.fn()
    dtImport.createModel = createSpy

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0', components: [{ id: 'c1', name: 'C', type: 'STORE', positionX: Infinity }] },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((e: any) => /positionX/.test(e.error))).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('accepts position 0 and absent fields (no false positive)', async () => {
    const dtImport = new DtImport({} as any) as any
    // Stub the whole pipeline to no-op so a valid payload sails through to success.
    dtImport.createModel = vi.fn().mockResolvedValue({ id: 'M1' })
    for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'createDataFlows',
      'associateDataItemsWithElements', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
      dtImport[m] = vi.fn().mockResolvedValue(undefined)
    }

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0', components: [{ id: 'c1', name: 'C', type: 'STORE', positionX: 0, positionY: 0 }] },
    })

    expect(result.success).toBe(true)
  })
})

describe('DtImport — rollback on terminal failure', () => {
  it('deletes the created model when an exception aborts mid-import', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.createModel = vi.fn().mockResolvedValue({ id: 'M1' })
    dtImport.setupDefaultBoundary = vi.fn().mockRejectedValue(new Error('boom'))
    const deleteSpy = vi.fn().mockResolvedValue({ nodesDeleted: 1, relationshipsDeleted: 0 })
    dtImport.dtModel.deleteModel = deleteSpy

    const result = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' } })

    expect(result.success).toBe(false)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith({ modelId: 'M1' })
  })

  it('does NOT delete when the failure happens before the model is created', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.createModel = vi.fn().mockRejectedValue(new Error('early boom'))
    const deleteSpy = vi.fn()
    dtImport.dtModel.deleteModel = deleteSpy

    const result = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' } })

    expect(result.success).toBe(false)
    expect(deleteSpy).not.toHaveBeenCalled() // nothing to roll back
  })

  it('a rollback delete failure becomes a warning, not a throw', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.createModel = vi.fn().mockResolvedValue({ id: 'M1' })
    dtImport.setupDefaultBoundary = vi.fn().mockRejectedValue(new Error('boom'))
    dtImport.dtModel.deleteModel = vi.fn().mockRejectedValue(new Error('delete failed'))

    const result = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' } })

    expect(result.success).toBe(false)
    expect(result.warnings.some((w: string) => /Rollback failed/.test(w))).toBe(true)
  })
})
