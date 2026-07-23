/**
 * A node's parent in the later update passes must come from the create-time
 * structure (elementParent: the boundary it was actually created under), NOT the file's
 * per-element `parentBoundary.id` — otherwise a crafted/omitted parent re-parents a
 * nested node to another boundary or the default.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

describe('DtImport — parent is authoritative from create-time mapping', () => {
  it('component: ignores a crafted file parentBoundary.id, uses the create-time parent', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.defaultBoundaryId = 'b0'
    dtImport.idMapping = new Map([
      ['c1', 'C1'], ['d1', 'D1'],
      ['B_evil', 'B_EVIL_SERVER'],  // where the file *claims* the node belongs
      ['B_real', 'B_REAL_SERVER'],  // where it was actually created
    ])
    dtImport.elementParent = new Map([['c1', 'B_REAL_SERVER']])
    const componentSpy = vi.fn().mockResolvedValue({ id: 'C1' })
    dtImport.dtComponent.updateComponent = componentSpy

    await dtImport.processElementForDataItemAssociation({
      id: 'c1', type: 'STORE', name: 'C', dataItemIds: ['d1'],
      parentBoundary: { id: 'B_evil' },
    })

    expect(componentSpy).toHaveBeenCalledTimes(1)
    // Create-time parent wins — NOT idMapping.get('B_evil') = 'B_EVIL_SERVER'.
    expect(componentSpy.mock.calls[0][0].updatedNode.parentNode).toBe('B_REAL_SERVER')
  })

  it('component: falls back to default boundary when no create-time parent recorded', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.defaultBoundaryId = 'b0'
    dtImport.idMapping = new Map([['c1', 'C1'], ['d1', 'D1'], ['B_evil', 'B_EVIL_SERVER']])
    dtImport.elementParent = new Map() // nothing recorded for c1
    const componentSpy = vi.fn().mockResolvedValue({ id: 'C1' })
    dtImport.dtComponent.updateComponent = componentSpy

    await dtImport.processElementForDataItemAssociation({
      id: 'c1', type: 'STORE', name: 'C', dataItemIds: ['d1'],
      parentBoundary: { id: 'B_evil' },
    })

    expect(componentSpy.mock.calls[0][0].updatedNode.parentNode).toBe('b0')
  })

  it('boundary: ignores a crafted file parentBoundary.id, uses the create-time parent', async () => {
    const dtImport = new DtImport({} as any) as any
    dtImport.defaultBoundaryId = 'b0'
    dtImport.idMapping = new Map([['b1', 'B1'], ['d1', 'D1'], ['B_evil', 'B_EVIL_SERVER'], ['B_real', 'B_REAL_SERVER']])
    dtImport.elementParent = new Map([['b1', 'B_REAL_SERVER']])
    const boundarySpy = vi.fn().mockResolvedValue({ id: 'B1' })
    dtImport.dtBoundary.updateBoundaryNode = boundarySpy

    await dtImport.processElementForDataItemAssociation({
      id: 'b1', type: 'BOUNDARY', name: 'B', dataItemIds: ['d1'],
      parentBoundary: { id: 'B_evil' },
    })

    expect(boundarySpy).toHaveBeenCalledTimes(1)
    expect(boundarySpy.mock.calls[0][0].updatedNode.parentNode).toBe('B_REAL_SERVER')
  })
})
