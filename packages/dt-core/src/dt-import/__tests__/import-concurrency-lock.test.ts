/**
 * Two concurrent imports on one DtImport must serialize. The import mutex key
 * was `importModel_${Date.now()}` — a fresh key per call, so it never actually locked and
 * the two runs interleaved, corrupting shared instance state (idMapping/caches/errors).
 * A constant key ('importModel') serializes them on the shared DtUtils FIFO mutex.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

describe('DtImport — concurrent imports serialize (constant-key mutex)', () => {
  it('does not start import B until import A completes', async () => {
    const dtImport = new DtImport({} as any) as any
    const order: string[] = []

    // Park A inside its createModel until we release it; B must not have run yet.
    let releaseA!: () => void
    const aGate = new Promise<void>((res) => { releaseA = res })

    dtImport.createModel = vi
      .fn()
      .mockImplementationOnce(async () => { order.push('A:createModel'); await aGate; return { id: 'MA' } })
      .mockImplementationOnce(async () => { order.push('B:createModel'); return { id: 'MB' } })

    // No-op the rest of the pipeline so importModel resolves right after createModel.
    for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'createDataFlows',
      'associateDataItemsWithElements', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
      dtImport[m] = vi.fn().mockResolvedValue(undefined)
    }

    const payload = { name: 'M', defaultBoundary: { id: 'b0' } }
    const pA = dtImport.importModel(payload)
    const pB = dtImport.importModel(payload)

    // Let microtasks + a real tick settle: A is parked on aGate, B must be queued on the mutex.
    await new Promise((r) => setTimeout(r, 15))
    expect(order).toEqual(['A:createModel']) // B has NOT begun — the lock held

    releaseA()
    const [rA, rB] = await Promise.all([pA, pB])

    expect(order).toEqual(['A:createModel', 'B:createModel']) // strictly serialized
    expect(rA.model).toEqual({ id: 'MA' })
    expect(rB.model).toEqual({ id: 'MB' }) // no cross-corruption of the returned model
  })
})
