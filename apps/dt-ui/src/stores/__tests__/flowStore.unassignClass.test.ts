/**
 * Class unassign through the store: `updateNodeClass` / `updateDataFlowClass`
 * with `classId: null` must send a `kind: NONE` binding target (the backend
 * unassign + SYSTEM-exposure sweep) and clear the node's local `data.classId`
 * on success — restoring the canvas "unclassified" state. A failed rebind must
 * leave local state untouched. Non-null ids keep the CLASS target (regression).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const changeElementBindingMock = vi.fn()

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class {},
  DtClass: class {
    changeElementBinding = changeElementBindingMock
  },
  DtComponent: class {},
  DtControl: class {},
  DtDataflow: class {},
  DtDataItem: class {},
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: class {
    handleError = vi.fn()
  },
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const mod = await import('../flowStore')
  useFlowStore = mod.useFlowStore
})

const node = (id: string, classId: string | null): any => ({
  id,
  type: 'PROCESS',
  position: { x: 0, y: 0 },
  data: { label: id, classId },
})

describe('flowStore — class unassign (kind: NONE)', () => {
  it('updateNodeClass with null sends a NONE target and clears local data.classId', async () => {
    changeElementBindingMock.mockResolvedValue({ success: true })
    const store = useFlowStore()
    store.$patch({ nodes: [node('c1', 'k1')] as any })

    const res = await store.updateNodeClass({ nodeId: 'c1', classId: null })

    expect(changeElementBindingMock).toHaveBeenCalledTimes(1)
    expect(changeElementBindingMock).toHaveBeenCalledWith({
      elementId: 'c1',
      target: { kind: 'NONE' },
    })
    expect(res).toEqual({ success: true })
    expect(store.nodes[0].data.classId).toBeNull()
  })

  it('updateNodeClass with null leaves local state untouched when the rebind fails', async () => {
    changeElementBindingMock.mockResolvedValue({ success: false, errorCode: 'DATABASE_ERROR' })
    const store = useFlowStore()
    store.$patch({ nodes: [node('c1', 'k1')] as any })

    const res = await store.updateNodeClass({ nodeId: 'c1', classId: null })

    expect(res).toEqual({ success: false, errorCode: 'DATABASE_ERROR' })
    expect(store.nodes[0].data.classId).toBe('k1')
  })

  it('updateNodeClass with a real id still sends a CLASS target (regression)', async () => {
    changeElementBindingMock.mockResolvedValue({ success: true })
    const store = useFlowStore()
    store.$patch({ nodes: [node('c1', null)] as any })

    await store.updateNodeClass({ nodeId: 'c1', classId: 'k2' })

    expect(changeElementBindingMock).toHaveBeenCalledWith({
      elementId: 'c1',
      target: { kind: 'CLASS', classIds: ['k2'] },
    })
    expect(store.nodes[0].data.classId).toBe('k2')
  })

  it('updateDataFlowClass with null sends a NONE target', async () => {
    changeElementBindingMock.mockResolvedValue({ success: true })
    const store = useFlowStore()

    const res = await store.updateDataFlowClass({ dataFlowId: 'f1', classId: null })

    expect(changeElementBindingMock).toHaveBeenCalledWith({
      elementId: 'f1',
      target: { kind: 'NONE' },
    })
    expect(res).toEqual({ success: true })
  })

  it('updateDataFlowClass with a real id still sends a CLASS target (regression)', async () => {
    changeElementBindingMock.mockResolvedValue({ success: true })
    const store = useFlowStore()

    await store.updateDataFlowClass({ dataFlowId: 'f1', classId: 'k2' })

    expect(changeElementBindingMock).toHaveBeenCalledWith({
      elementId: 'f1',
      target: { kind: 'CLASS', classIds: ['k2'] },
    })
  })
})
