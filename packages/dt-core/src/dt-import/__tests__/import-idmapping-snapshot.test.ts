/**
 * The id-mapping consumed after an import must be the
 * snapshot captured INSIDE the import mutex, not a post-await read of DtImport's
 * live private Map. A queued second import's body starts with idMapping.clear(),
 * and the caller's continuation runs only after the mutex releases — so the old
 * `(dtImport as any).idMapping` reach-in in DtImportSplit.buildIdMapping could
 * observe an empty (or the NEXT import's) map and silently break source-file
 * id sync.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'
import { DtImportSplit } from '../dt-import-split.js'

const noopPipeline = (dtImport: any) => {
  for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'createDataFlows',
    'associateDataItemsWithElements', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
    dtImport[m] = vi.fn().mockResolvedValue(undefined)
  }
}

describe('DtImport — idMapping snapshot is taken inside the mutex', () => {
  it('a queued second import cannot clear the first import\'s returned mapping', async () => {
    const dtImport = new DtImport({} as any) as any
    noopPipeline(dtImport)

    // A populates the mapping mid-pipeline, then parks until released — with B
    // already queued on the mutex, so B's state reset races A's caller
    // continuation the moment A's body resolves.
    let releaseA!: () => void
    const aGate = new Promise<void>((res) => { releaseA = res })
    dtImport.createModel = vi
      .fn()
      .mockImplementationOnce(async () => {
        dtImport.idMapping.set('ref-c1', 'srv-c1')
        await aGate
        return { id: 'MA' }
      })
      .mockImplementationOnce(async () => ({ id: 'MB' }))

    const payload = { name: 'M', defaultBoundary: { id: 'b0' } }
    const pA = dtImport.importModel(payload)
    const pB = dtImport.importModel(payload)
    releaseA()
    const [rA, rB] = await Promise.all([pA, pB])

    // A's result carries A's mapping — snapshotted before B's clear() could run.
    expect(rA.idMapping).toBeInstanceOf(Map)
    expect(rA.idMapping!.get('ref-c1')).toBe('srv-c1')
    // B's snapshot is its own (reset state), not A's leftovers.
    expect(rB.idMapping).toBeInstanceOf(Map)
    expect(rB.idMapping!.has('ref-c1')).toBe(false)
  })
})

describe('DtImportSplit.buildIdMapping — consumes the result snapshot, not the live map', () => {
  it('uses importResult.idMapping even when the live private map has been cleared', async () => {
    const split = new DtImportSplit({} as any) as any
    // Simulate the post-mutex world: the import returned a snapshot, and the
    // live private map has ALREADY been cleared by a queued next import.
    split.dtImport.importModel = vi.fn().mockResolvedValue({
      success: true,
      model: { id: 'M-server' },
      errors: [],
      warnings: [],
      progress: { currentStep: 8, totalSteps: 8, stepName: 'done', percentage: 100 },
      idMapping: new Map([['ref-c1', 'srv-c1']]),
    })
    split.dtImport.idMapping.clear() // the live map is already the next import's

    const result = await split.importSplitModel({
      manifest: { schemaVersion: '1.0', format: 'split', model: { id: 'ref-model', name: 'M', defaultBoundaryId: 'b0' }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'b0', name: 'root' } },
      attributes: { components: {}, boundaries: {}, dataFlows: {} },
      dataFlows: [],
      dataItems: [],
    } as any)

    expect(result.idMapping.get('ref-c1')).toBe('srv-c1') // from the snapshot
    expect(result.idMapping.get('ref-model')).toBe('M-server') // model id still appended
  })
})
