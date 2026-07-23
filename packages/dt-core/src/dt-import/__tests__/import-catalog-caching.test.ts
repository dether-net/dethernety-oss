/**
 * The module and control catalogs are fetched ONCE per import and
 * reused. Pre-fix, resolveClass called getModules() up to 3x per class-bearing element
 * and resolveControls called getControls() 2x per control-bearing element — all
 * `network-only` — so an N-element import issued ~5N heavyweight catalog round-trips.
 * These guards assert the underlying fetch count is O(1) (constant), not O(N).
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

describe('DtImport — module catalog is fetched once per import', () => {
  it('resolveClass across many elements triggers exactly one getModules()', async () => {
    const dtImport = new DtImport({} as any) as any
    // Empty catalog → every priority strategy falls through (worst case: pre-fix this hit
    // getModules 3x per element). classData carries id + module.id + module.name so all
    // three priority branches run.
    const getModulesSpy = vi.fn().mockResolvedValue([])
    dtImport.dtModule.getModules = getModulesSpy

    for (let i = 0; i < 5; i++) {
      await dtImport.resolveClass({ id: `cls${i}`, module: { id: 'm', name: 'M' }, name: `C${i}` }, 'COMPONENT')
    }

    // One fetch total for all 5 elements × 3 priority strategies (pre-fix: 15).
    expect(getModulesSpy).toHaveBeenCalledTimes(1)
  })

  it('is O(1): same fetch count for 1 element as for many', async () => {
    const oneGetModules = async () => {
      const dt = new DtImport({} as any) as any
      const spy = vi.fn().mockResolvedValue([])
      dt.dtModule.getModules = spy
      await dt.resolveClass({ id: 'x', module: { id: 'm', name: 'M' }, name: 'C' }, 'COMPONENT')
      return spy.mock.calls.length
    }
    const manyGetModules = async () => {
      const dt = new DtImport({} as any) as any
      const spy = vi.fn().mockResolvedValue([])
      dt.dtModule.getModules = spy
      for (let i = 0; i < 8; i++) {
        await dt.resolveClass({ id: `x${i}`, module: { id: 'm', name: 'M' }, name: `C${i}` }, 'COMPONENT')
      }
      return spy.mock.calls.length
    }
    expect(await oneGetModules()).toBe(await manyGetModules())
  })
})

describe('DtImport — control catalog is fetched once per import', () => {
  it('resolveControls across many elements triggers getControls() twice total (the undefined+all pair, once)', async () => {
    const dtImport = new DtImport({} as any) as any
    const getControlsSpy = vi.fn().mockResolvedValue([])
    dtImport.dtControl.getControls = getControlsSpy

    for (let i = 0; i < 5; i++) {
      await dtImport.resolveControls([{ id: `ctrl${i}`, name: `X${i}` }])
    }

    // The no-folder + all-folders pair, loaded once and cached (pre-fix: 10 = 2 × 5).
    expect(getControlsSpy).toHaveBeenCalledTimes(2)
  })
})
