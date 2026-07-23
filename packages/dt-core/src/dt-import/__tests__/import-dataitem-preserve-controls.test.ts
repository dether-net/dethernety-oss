/**
 * DtImport data-item association pass must PRESERVE controls set at create time.
 * Controls are associated at create (setElementControlsDirect); the later
 * data-item pass previously sent `controls: []` — which, under the builder's
 * disconnect-all-on-`[]`, wiped them. It must now OMIT the controls key so the
 * builder leaves the create-time controls untouched.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

const seeded = () => {
  const dtImport = new DtImport({} as any) as any
  dtImport.defaultBoundaryId = 'b0'
  dtImport.idMapping = new Map([['c1', 'C1'], ['b1', 'B1'], ['d1', 'D1'], ['d2', 'D2']])
  const componentSpy = vi.fn().mockResolvedValue({ id: 'C1' })
  const boundarySpy = vi.fn().mockResolvedValue({ id: 'B1' })
  dtImport.dtComponent.updateComponent = componentSpy
  dtImport.dtBoundary.updateBoundaryNode = boundarySpy
  return { dtImport, componentSpy, boundarySpy }
}

describe('DtImport — data-item pass preserves create-time controls', () => {
  it('component: sends dataItems but OMITS controls (preserve)', async () => {
    const { dtImport, componentSpy } = seeded()
    await dtImport.processElementForDataItemAssociation({ id: 'c1', type: 'STORE', name: 'C', dataItemIds: ['d1', 'd2'] })
    expect(componentSpy).toHaveBeenCalledTimes(1)
    const data = componentSpy.mock.calls[0][0].updatedNode.data
    expect(data).not.toHaveProperty('controls')
    expect(data.dataItems).toEqual(['D1', 'D2'])
  })

  it('boundary: sends dataItems but OMITS controls (preserve)', async () => {
    const { dtImport, boundarySpy } = seeded()
    await dtImport.processElementForDataItemAssociation({ id: 'b1', type: 'BOUNDARY', name: 'B', dataItemIds: ['d1'] })
    expect(boundarySpy).toHaveBeenCalledTimes(1)
    const data = boundarySpy.mock.calls[0][0].updatedNode.data
    expect(data).not.toHaveProperty('controls')
    expect(data.dataItems).toEqual(['D1'])
  })
})
