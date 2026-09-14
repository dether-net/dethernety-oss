/**
 * What the store actually hands a writer.
 *
 * Every interactive save used to send the element as this client last loaded it, so editing one field
 * rewrote all of them — including fields another user had changed in the meantime, which were reverted
 * with no error to either party. The store now narrows the element to the fields the edit names.
 *
 * These assert per surface, because each one names a different set: a drag names a parent and a
 * position, a rename names neither. The controls at the bottom are what keep this from degenerating
 * into "never send anything".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const updateBoundaryNodeMock = vi.fn()
const updateComponentMock = vi.fn()
const updateDataFlowMock = vi.fn()

class DtUtilsStub {
  handleError = vi.fn()
  deepMerge(target: any, updates: any) {
    for (const key in updates) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        target[key] = target[key] || {}
        this.deepMerge(target[key], updates[key])
      } else {
        target[key] = updates[key]
      }
    }
    return target
  }
}

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class { updateBoundaryNode = updateBoundaryNodeMock },
  DtClass: class {},
  DtComponent: class { updateComponent = updateComponentMock },
  DtControl: class {},
  DtDataflow: class { updateDataFlow = updateDataFlowMock },
  DtDataItem: class {},
  DtExposure: class {},
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: DtUtilsStub,
  executeSupersedeFlow: vi.fn(),
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))

let useFlowStore: typeof import('../flowStore').useFlowStore

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useFlowStore = (await import('../flowStore')).useFlowStore
})

const componentNode = () => ({
  id: 'c1',
  type: 'PROCESS',
  position: { x: 1, y: 2 },
  parentNode: 'b1',
  data: { label: 'C', description: 'd', crownJewel: false, controls: ['ctl-1'], dataItems: [] },
})

const boundaryNode = () => ({
  id: 'b1',
  type: 'BOUNDARY',
  position: { x: 0, y: 0 },
  width: 300,
  height: 200,
  parentNode: '',
  data: { label: 'B', description: 'd', minWidth: 200, minHeight: 150, zone: 'PUBLIC', conduits: [] },
})

const flowEdge = () => ({
  id: 'f1',
  source: 'A',
  target: 'B',
  sourceHandle: 'sh',
  targetHandle: 'th',
  label: 'F',
  data: { description: 'd', controls: [], dataItems: [] },
})

const serverComponent = (over: any = {}) => ({
  id: 'c1', name: 'C', type: 'PROCESS', description: 'd',
  positionX: 1, positionY: 2, parentBoundary: [{ id: 'b1' }],
  controls: [], dataItems: [], ...over,
})
const serverBoundary = (over: any = {}) => ({
  id: 'b1', name: 'B', description: 'd', controls: [], dataItems: [], parentBoundary: [],
  zone: 'PUBLIC', domains: [], planes: [], conduits: [],
  positionX: 0, positionY: 0, dimensionsWidth: 300, dimensionsHeight: 200, ...over,
})
const serverDataFlow = (over: any = {}) => ({
  id: 'f1', name: 'F', description: 'd', source: { id: 'A' }, target: { id: 'B' },
  sourceHandle: 'sh', targetHandle: 'th', controls: [], dataItems: [], ...over,
})

/** The element the component writer was handed. */
const sentComponent = () => updateComponentMock.mock.calls.at(-1)![0].updatedNode
const sentBoundary = () => updateBoundaryNodeMock.mock.calls.at(-1)![0].updatedNode
const sentEdge = () => updateDataFlowMock.mock.calls.at(-1)![0].edge

const seedComponent = (store: any) => {
  store.$patch({ nodes: [componentNode()], defaultBoundaryId: 'root' })
  updateComponentMock.mockResolvedValue(serverComponent())
}
const seedBoundary = (store: any) => {
  store.$patch({ nodes: [boundaryNode()], defaultBoundaryId: 'root' })
  updateBoundaryNodeMock.mockResolvedValue(serverBoundary())
}
const seedEdge = (store: any) => {
  store.$patch({ edges: [flowEdge()], defaultBoundaryId: 'root' })
  updateDataFlowMock.mockResolvedValue(serverDataFlow())
}

describe('a save carries the edit and not the element', () => {
  it('a rename and description edit names no position and no parent', async () => {
    const store = useFlowStore()
    seedComponent(store)

    await store.updateNode({
      nodeId: 'c1',
      updates: { data: { label: 'renamed', description: 'edited', crownJewel: false } },
    })

    const sent = sentComponent()
    expect(sent.data).toEqual({ label: 'renamed', description: 'edited', crownJewel: false })
    expect(sent).not.toHaveProperty('position')
    expect(sent).not.toHaveProperty('parentNode')
    expect(sent).not.toHaveProperty('type')
    expect(sent.id).toBe('c1')
  })

  it('a drag names a parent and a position, and no label', async () => {
    const store = useFlowStore()
    seedComponent(store)

    await store.updateNode({ nodeId: 'c1', updates: { parentNode: 'b2', position: { x: 7, y: 8 } } })

    const sent = sentComponent()
    expect(sent).toMatchObject({ id: 'c1', parentNode: 'b2', position: { x: 7, y: 8 } })
    expect(sent).not.toHaveProperty('data')
  })

  it('a drag to the root carries the empty string, which is the relocation and not an absence', async () => {
    const store = useFlowStore()
    seedComponent(store)

    await store.updateNode({ nodeId: 'c1', updates: { parentNode: '', position: { x: 7, y: 8 } } })

    expect(sentComponent().parentNode).toBe('')
  })

  it('a boundary resize names dimensions and a position, and no zoning', async () => {
    const store = useFlowStore()
    seedBoundary(store)

    await store.updateNode({
      nodeId: 'b1',
      updates: { width: 400, height: 300, position: { x: 5, y: 5 } },
    })

    const sent = sentBoundary()
    expect(sent).toMatchObject({ id: 'b1', width: 400, height: 300, position: { x: 5, y: 5 } })
    expect(sent).not.toHaveProperty('data')
  })

  it('a zone change names the zone alone', async () => {
    const store = useFlowStore()
    seedBoundary(store)

    await store.updateNode({ nodeId: 'b1', updates: { data: { zone: 'RESTRICTED' } } })

    const sent = sentBoundary()
    expect(sent.data).toEqual({ zone: 'RESTRICTED' })
    expect(sent).not.toHaveProperty('position')
    expect(sent).not.toHaveProperty('width')
  })

  it('a cleared zone still travels', async () => {
    const store = useFlowStore()
    seedBoundary(store)

    await store.updateNode({ nodeId: 'b1', updates: { data: { zone: null } } })

    expect(sentBoundary().data).toEqual({ zone: null })
  })

  it('an edge rename names neither endpoint', async () => {
    const store = useFlowStore()
    seedEdge(store)

    await store.updateDataFlow({ edgeId: 'f1', updates: { label: 'renamed', data: { description: 'x' } } })

    const sent = sentEdge()
    expect(sent).toEqual({ id: 'f1', label: 'renamed', data: { description: 'x' } })
    expect(sent).not.toHaveProperty('source')
    expect(sent).not.toHaveProperty('target')
  })

  it('a reroute names both endpoints and both handles, and no label', async () => {
    const store = useFlowStore()
    seedEdge(store)

    await store.updateDataFlow({
      edgeId: 'f1',
      updates: { source: 'X', target: 'Y', sourceHandle: 'a', targetHandle: 'b' },
    })

    const sent = sentEdge()
    expect(sent).toEqual({ id: 'f1', source: 'X', target: 'Y', sourceHandle: 'a', targetHandle: 'b' })
  })

  it('hands the writer a detached element, never the live node', async () => {
    const store = useFlowStore()
    seedComponent(store)

    await store.updateNode({ nodeId: 'c1', updates: { data: { description: 'edited' } } })

    expect(sentComponent()).not.toBe(store.nodes[0])
  })
})

// The case this whole change exists for.
describe('a stale client does not revert another user\'s edit', () => {
  it('sends no name at all when the user edited only the description', async () => {
    const store = useFlowStore()
    seedComponent(store)
    // Someone else renamed it to "theirs" since this client loaded; this client still holds "C".
    updateComponentMock.mockResolvedValue(serverComponent({ name: 'theirs' }))

    await store.updateNode({ nodeId: 'c1', updates: { data: { description: 'mine' } } })

    // Nothing in the payload can overwrite their rename, because the name is not in it.
    expect(sentComponent().data).not.toHaveProperty('label')
  })

  it('converges on their edit afterwards, because the response carries the whole element back', async () => {
    const store = useFlowStore()
    seedComponent(store)
    updateComponentMock.mockResolvedValue(serverComponent({ name: 'theirs' }))

    await store.updateNode({ nodeId: 'c1', updates: { data: { description: 'mine' } } })

    const after: any = store.nodes.find((n: any) => n.id === 'c1')
    expect(after.data.label).toBe('theirs')
    expect(after.data.description).toBe('d')
  })
})

// Without these the suite above is satisfied by a store that sends nothing but an id.
describe('a genuine edit of each field still reaches the writer', () => {
  it.each([
    ['a name', { data: { label: 'renamed' } }, (s: any) => s.data.label, 'renamed'],
    ['a description', { data: { description: 'edited' } }, (s: any) => s.data.description, 'edited'],
    ['a crown jewel flag', { data: { crownJewel: true } }, (s: any) => s.data.crownJewel, true],
    ['a control list', { data: { controls: ['ctl-2'] } }, (s: any) => s.data.controls, ['ctl-2']],
    ['a parent', { parentNode: 'b9' }, (s: any) => s.parentNode, 'b9'],
    ['a position', { position: { x: 4, y: 5 } }, (s: any) => s.position, { x: 4, y: 5 }],
  ])('writes %s', async (_name, updates, read, expected) => {
    const store = useFlowStore()
    seedComponent(store)

    await store.updateNode({ nodeId: 'c1', updates })

    expect(read(sentComponent())).toEqual(expected)
  })
})
