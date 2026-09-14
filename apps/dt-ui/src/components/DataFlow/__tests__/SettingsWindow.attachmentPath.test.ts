// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Attaching a control, from the real call site all the way to the writer.
 *
 * The panel's payload assertions live next door, in SettingsWindow.namedEdits.test.ts. This file
 * exists because those assertions can all hold while attachment is completely broken: they pin what
 * the component hands the store, and say nothing about what the store hands the writer. A test
 * written against a payload no call site emits would pass over a panel that persists nothing.
 *
 * So the panel is mounted over the REAL store here, and only `@dethernety/dt-core` is replaced. The
 * assertion is on the element the writer is given — the last point before the mutation is built.
 */

// `vi.mock` factories are hoisted above every declaration in this file, so anything they close over
// has to be hoisted with them.
const { updateComponentMock, updateDataFlowMock, deepMerge } = vi.hoisted(() => {
  // Mirrors dt-utils: nested objects merge, arrays replace wholesale. The dataflow writer deep-merges
  // `updates` into the edge ITSELF before reading the association off it, so the merge has to be here
  // for this file to be looking at what the real writer would look at.
  const deepMerge = (target: any, updates: any) => {
    for (const key in updates) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        target[key] = target[key] || {}
        deepMerge(target[key], updates[key])
      } else {
        target[key] = updates[key]
      }
    }
    return target
  }
  // The writers. Each captures what it was handed; the implementations in `beforeEach` echo a
  // plausible server response so the store re-pins rather than reverting the optimistic edit.
  return { updateComponentMock: vi.fn(), updateDataFlowMock: vi.fn(), deepMerge }
})

vi.mock('@dethernety/dt-core', () => ({
  DtBoundary: class { updateBoundaryNode = vi.fn() },
  DtClass: class {
    getComponentClass = vi.fn().mockResolvedValue(null)
    getBoundaryClass = vi.fn().mockResolvedValue(null)
    getDataFlowClass = vi.fn().mockResolvedValue(null)
    getAttributesFromClassRelationship = vi.fn().mockResolvedValue({})
  },
  DtComponent: class {
    updateComponent = updateComponentMock
    getComponentRepresentedModel = vi.fn().mockResolvedValue(null)
  },
  DtControl: class { getControls = vi.fn().mockResolvedValue([]) },
  DtDataflow: class { updateDataFlow = updateDataFlowMock },
  DtDataItem: class {},
  DtExposure: class { getExposures = vi.fn().mockResolvedValue([]) },
  DtMitreAttack: class {},
  DtModel: class {},
  DtModule: class {},
  DtUtils: class {
    handleError = vi.fn()
    deepMerge = deepMerge
    performQuery = vi.fn().mockResolvedValue(null)
    performMutation = vi.fn().mockResolvedValue(null)
  },
  executeSupersedeFlow: vi.fn(),
}))

vi.mock('@/plugins/apolloClient', () => ({ default: {} }))
vi.mock('@/stores/issueStore', () => ({
  useIssueStore: () => reactive({ issueClasses: [], setIssueDataClipboard: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/dataflow', query: {} } } }),
}))
vi.mock('@jsonforms/vue-vuetify', () => ({ extendedVuetifyRenderers: [] }))

import SettingsWindow from '../SettingsWindow.vue'
import { useFlowStore } from '@/stores/flowStore'

const serverComponent = (updatedNode: any) => ({
  id: updatedNode.id,
  name: updatedNode.data.label,
  type: updatedNode.type,
  description: updatedNode.data.description,
  positionX: updatedNode.position.x,
  positionY: updatedNode.position.y,
  parentBoundary: null,
  controls: (updatedNode.data.controls ?? []).map((id: string) => ({ id })),
  dataItems: (updatedNode.data.dataItems ?? []).map((id: string) => ({ id })),
})

let store: ReturnType<typeof useFlowStore>

const mountPanel = async () => {
  const w = mount(SettingsWindow, {
    props: { freshlyCreatedId: null },
    shallow: true,
    global: {
      stubs: {
        teleport: true,
        VHover: { name: 'VHover', template: '<div><slot :is-hovering="false" :props="{}" /></div>' },
      },
    },
  })
  await flushPromises()
  updateComponentMock.mockClear()
  updateDataFlowMock.mockClear()
  return w
}

/** The element the component writer was given, after the store's optimistic merge. */
const writtenNode = () => updateComponentMock.mock.calls.at(-1)![0].updatedNode

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  updateComponentMock.mockImplementation(async ({ updatedNode }: any) => serverComponent(updatedNode))
  // The dataflow writer merges `updates` into the edge in place, then reads the association off it.
  updateDataFlowMock.mockImplementation(async ({ edge, updates }: any) => {
    deepMerge(edge, updates)
    return {
      id: edge.id,
      name: edge.label,
      description: edge.data.description,
      source: { id: edge.source },
      target: { id: edge.target },
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      controls: (edge.data.controls ?? []).map((id: string) => ({ id })),
      dataItems: (edge.data.dataItems ?? []).map((id: string) => ({ id })),
    }
  })

  store = useFlowStore()
  store.$patch({
    defaultBoundaryId: 'b-default',
    modelId: 'model-1',
    controls: [{ id: 'ctl-1', name: 'C1' }, { id: 'ctl-2', name: 'C2' }] as any,
    dataItems: [{ id: 'di-1', name: 'D1' }, { id: 'di-2', name: 'D2' }] as any,
    nodes: [{
      id: 'n-1',
      type: 'PROCESS',
      position: { x: 1, y: 2 },
      parentNode: '',
      data: { label: 'N1', description: 'd', controls: ['ctl-1'], dataItems: ['di-1'] },
    }] as any,
    edges: [{
      id: 'e-1',
      source: 'n-1',
      target: 'n-2',
      label: 'E1',
      data: { description: 'd', controls: ['ctl-1'], dataItems: ['di-1'] },
    }] as any,
  })
})

describe('an attachment made in the panel reaches the writer', () => {
  it('carries a newly attached control', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect(updateComponentMock).toHaveBeenCalledTimes(1)
    expect(writtenNode().data.controls).toEqual(['ctl-1', 'ctl-2'])
  })

  it('carries a newly attached data item', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedDataItemIds(['di-1', 'di-2'])
    await flushPromises()

    expect(writtenNode().data.dataItems).toEqual(['di-1', 'di-2'])
  })

  it('carries a removal, shortened, once it is confirmed', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds([])
    await flushPromises()
    ;(w.vm as any).onRemoveControlConfirmed()
    await flushPromises()

    expect(writtenNode().data.controls).toEqual([])
  })

  it('carries an attachment made on a data flow', async () => {
    store.setSelectedItem({ item: store.edges[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect(updateComponentMock).not.toHaveBeenCalled()
    // Read off the edge the writer merged, which is what it builds the mutation from.
    expect(updateDataFlowMock.mock.calls.at(-1)![0].edge.data.controls).toEqual(['ctl-1', 'ctl-2'])
  })

  // The panel tells the user "Changes will be applied once the item finishes saving" when the element
  // is still being created. That promise only holds for what `updates` names: the optimistic node is
  // discarded when the server's node replaces it, and the queue replays `updates` alone. An unnamed
  // link edit is dropped there in silence.
  it('carries a control attached while the element is still being created', async () => {
    store.pendingNodes.add('n-1')
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()
    expect(updateComponentMock).not.toHaveBeenCalled() // deferred, not written

    // What the create does when it resolves: the optimistic node is REPLACED by the server's, so
    // every local mutation made while it was pending is gone. The queue is the only thing that
    // survives that swap, and it carries `updates` alone.
    store.nodes.splice(0, 1, {
      id: 'n-1',
      type: 'PROCESS',
      position: { x: 1, y: 2 },
      parentNode: '',
      data: { label: 'N1', description: 'd', controls: ['ctl-1'], dataItems: ['di-1'] },
    } as any)

    await store.applyDeferredUpdates('n-1', 'n-1')

    expect(updateComponentMock).toHaveBeenCalledTimes(1)
    expect(writtenNode().data.controls).toEqual(['ctl-1', 'ctl-2'])
  })
})

// The panel used to apply a link edit to the selection itself and let the whole-element send carry it.
// It cannot any more: the store reads the pre-edit list to work out what changed, and the selection IS
// the store's element, so an edit applied here first would make that read return the new value. The
// delta would come out empty and the attachment would never be written — with every assertion above
// still passing, because the element handed to the writer does carry the new list.
//
// So these assert the BASELINE, driven through the real panel and the real store. It is the only place
// in the interface layer where that trap is visible.
describe('the panel leaves the element to the store', () => {
  const sent = () => updateComponentMock.mock.calls.at(-1)![0]

  it('attaching a control reports the list as it was BEFORE the attach', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect(sent().updatedNode.data.controls).toEqual(['ctl-1', 'ctl-2'])
    expect(sent().baselineLinks.controls).toEqual(['ctl-1'])
  })

  it('attaching a data item does the same', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedDataItemIds(['di-1', 'di-2'])
    await flushPromises()

    expect(sent().baselineLinks.dataItems).toEqual(['di-1'])
  })

  it('a confirmed removal reports the list as it was before the removal', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()

    ;(w.vm as any).updateSelectedControlIds([])
    await flushPromises()
    ;(w.vm as any).onRemoveControlConfirmed()
    await flushPromises()

    expect(sent().updatedNode.data.controls).toEqual([])
    expect(sent().baselineLinks.controls).toEqual(['ctl-1'])
  })

  it('does not write the list onto the selection before the save', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()
    // Hold the save open so the only thing that could have changed the element is the panel.
    let release: (v: any) => void = () => {}
    updateComponentMock.mockReturnValue(new Promise(r => { release = r }))

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])

    // The store's merge has run by now — it happens synchronously on the way into the save — so the
    // element does hold the new list. What matters is that the baseline was taken first.
    expect(sent().baselineLinks.controls).toEqual(['ctl-1'])

    release(serverComponent({ ...store.nodes[0], controls: [{ id: 'ctl-1' }, { id: 'ctl-2' }] }))
    await flushPromises()
  })

  // The residual this closes: the revert snapshot used to be taken after the panel had already applied
  // the edit, so a save that failed left the attachment on screen until a reload.
  it('a failed save leaves no attachment behind', async () => {
    store.setSelectedItem({ item: store.nodes[0] })
    const w = await mountPanel()
    updateComponentMock.mockRejectedValue(new Error('network down'))

    ;(w.vm as any).updateSelectedControlIds(['ctl-1', 'ctl-2'])
    await flushPromises()

    expect((store.nodes[0] as any).data.controls).toEqual(['ctl-1'])
  })
})
