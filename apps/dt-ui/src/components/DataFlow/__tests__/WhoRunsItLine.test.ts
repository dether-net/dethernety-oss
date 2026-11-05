// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { WHO_RUNS_COPY as COPY } from '@/utils/whoRunsIt'

/**
 * Which boundary hosts an element, and what it declares, as the Settings window shows them: a parent read per
 * (element, parent, parent's class), late answers dropped, and a failed read never shown as "not declared".
 */

const OP = 'dethernety_operated_by'

const boundary = (id: string, data: Record<string, unknown>, parentNode = '') => ({ id, type: 'BOUNDARY', parentNode, data })

const mockFlowStore = reactive<Record<string, any>>({
  defaultBoundaryId: 'root',
  nodes: [],
  boundaryById: vi.fn(),
  effectiveZone: vi.fn(),
  getAttributesFromClassRelationship: vi.fn(),
})

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => mockFlowStore }))

import WhoRunsItLine from '../WhoRunsItLine.vue'

const pendingRead = () => {
  let answer!: (value: unknown) => void
  let fail!: (e: unknown) => void
  const promise = new Promise((resolve, reject) => { answer = resolve; fail = reject })
  return { promise, answer, fail }
}

const component = (parentNode: string) => ({ id: 'c', type: 'PROCESS', parentNode, data: {} })

let mounted: Array<ReturnType<typeof mount>> = []

const mountLine = (item: Record<string, unknown>, over: Record<string, unknown> = {}) => {
  const w = mount(WhoRunsItLine, {
    props: { item, ownState: 'read', ownBag: {}, ...over } as never,
    global: { stubs: { VSheet: { template: '<div><slot /></div>' } } },
  })
  mounted.push(w)
  return w
}

const text = (w: ReturnType<typeof mount>) => w.text()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockFlowStore.nodes = []
  const parents: Record<string, unknown> = {
    cloud: boundary('cloud', { label: 'Cloud', classId: 'cls-cloud' }),
    other: boundary('other', { label: 'Other', classId: 'cls-other' }),
    bare: boundary('bare', { label: 'Bare', classId: '' }),
    root: boundary('root', { label: 'Root' }),
  }
  mockFlowStore.boundaryById = vi.fn((id: string) => parents[id])
  mockFlowStore.effectiveZone = vi.fn(() => ({ zone: 'INTERNAL', source: 'default' }))
  mockFlowStore.getAttributesFromClassRelationship = vi.fn().mockResolvedValue({ [OP]: 'VENDOR' })
})

afterEach(() => {
  for (const w of mounted) w.unmount()
  mounted = []
  vi.restoreAllMocks()
})

describe('WhoRunsItLine', () => {
  it('reads the parent\'s stored declaration and names it', async () => {
    const w = mountLine(component('cloud'))
    await flushPromises()
    expect(mockFlowStore.getAttributesFromClassRelationship).toHaveBeenCalledWith({ componentId: 'cloud', classId: 'cls-cloud' })
    expect(text(w)).toContain(COPY.environmentVendor('Cloud'))
  })

  it('reads no parent for the model root, written either way, or for an unclassed parent', async () => {
    for (const parent of ['', 'root', 'bare']) {
      const w = mountLine(component(parent))
      await flushPromises()
      expect(text(w)).toContain(COPY.notDeclared)
      expect(text(w)).not.toContain('Its environment')
    }
    expect(mockFlowStore.getAttributesFromClassRelationship).not.toHaveBeenCalled()
  })

  it('a failed parent read says so, and is not "undeclared"', async () => {
    mockFlowStore.getAttributesFromClassRelationship = vi.fn().mockRejectedValue(new Error('boom'))
    const w = mountLine(component('cloud'), { ownBag: { [OP]: 'VENDOR' } })
    await flushPromises()
    expect(text(w)).toContain(COPY.vendorDeclared)
    expect(text(w)).toContain(COPY.environmentNotRead('Cloud'))
  })

  it('a late answer for an earlier parent is dropped', async () => {
    const first = pendingRead()
    const second = pendingRead()
    mockFlowStore.getAttributesFromClassRelationship = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const w = mountLine(component('cloud'))
    await w.setProps({ item: component('other') } as never)
    second.answer({ [OP]: 'CUSTOMER' })
    await flushPromises()
    first.answer({ [OP]: 'VENDOR' })
    await flushPromises()
    expect(text(w)).toContain(COPY.environmentYou('Other'))
    expect(text(w)).not.toContain('Cloud')
  })

  it('a late failure of an earlier read does not replace the current answer', async () => {
    const first = pendingRead()
    mockFlowStore.getAttributesFromClassRelationship = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ [OP]: 'CUSTOMER' })
    const w = mountLine(component('cloud'))
    await w.setProps({ item: component('other') } as never)
    await flushPromises()
    first.fail(new Error('late'))
    await flushPromises()
    expect(text(w)).toContain(COPY.environmentYou('Other'))
  })

  it('reads again when the element moves to another parent, with the same id', async () => {
    const w = mountLine(component('cloud'))
    await flushPromises()
    await w.setProps({ item: component('other') } as never)
    await flushPromises()
    expect(mockFlowStore.getAttributesFromClassRelationship).toHaveBeenCalledTimes(2)
    expect(mockFlowStore.getAttributesFromClassRelationship).toHaveBeenLastCalledWith({ componentId: 'other', classId: 'cls-other' })
    expect(text(w)).toContain(COPY.environmentVendor('Other'))
  })

  it('a component reads its parent\'s zone, the root\'s when drawn directly in the model', async () => {
    mockFlowStore.effectiveZone = vi.fn(() => ({ zone: 'VENDOR', source: 'declared' }))
    const w = mountLine(component(''))
    await flushPromises()
    expect(mockFlowStore.effectiveZone).toHaveBeenCalledWith('root')
    expect(text(w)).toContain(COPY.vendorFromZone)
    mountLine(component('cloud'))
    await flushPromises()
    expect(mockFlowStore.effectiveZone).toHaveBeenLastCalledWith('cloud')
  })

  it('a boundary reads its own zone and counts the components drawn directly in it', async () => {
    mockFlowStore.nodes = [
      { id: 'a', type: 'PROCESS', parentNode: 'cloud' },
      { id: 'b', type: 'STORE', parentNode: 'cloud' },
      { id: 'nested', type: 'BOUNDARY', parentNode: 'cloud' },
      { id: 'd', type: 'PROCESS', parentNode: 'nested' },
    ]
    const w = mountLine(boundary('cloud', { label: 'Cloud' }), { ownBag: { [OP]: 'VENDOR' } })
    await flushPromises()
    expect(mockFlowStore.effectiveZone).toHaveBeenCalledWith('cloud')
    expect(text(w)).toContain(COPY.runsEnvironment(2))
    expect(mockFlowStore.getAttributesFromClassRelationship).not.toHaveBeenCalled()
  })

  it('the model\'s root is never counted as hosting, even declared', async () => {
    mockFlowStore.nodes = [{ id: 'a', type: 'PROCESS', parentNode: 'root' }]
    const w = mountLine(boundary('root', { label: 'Root' }), { ownBag: { [OP]: 'VENDOR' } })
    await flushPromises()
    expect(text(w)).toContain(COPY.vendorDeclared)
    expect(text(w)).not.toContain('Declared as running')
  })

  it('shows the not-available notice beside the stored declaration', async () => {
    const template = { schema: { properties: {} }, uischema: { type: 'VerticalLayout', elements: [{ type: 'Label' }] } }
    const w = mountLine(component(''), { template, ownBag: { [OP]: 'VENDOR' } })
    await flushPromises()
    expect(text(w)).toContain(COPY.vendorDeclared)
    expect(text(w)).toContain(COPY.unavailable)
  })

  it('renders a product as text, not as markup', async () => {
    const w = mountLine(component(''), { ownBag: { [OP]: 'VENDOR', dethernety_product: '<img src=x onerror=alert(1)>' } })
    await flushPromises()
    expect(w.find('img').exists()).toBe(false)
    expect(text(w)).toContain('<img src=x onerror=alert(1)>')
  })
})
