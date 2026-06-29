// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { EffectiveZone } from '@/utils/effectiveZone'

// Forest: Datacenter (declared) ─ App tier (inherits) ; Lonely (default) ; Edge (default) ─ Edge pod (default).
// Edge has an unclassified descendant → smart-expand should open it; Datacenter's only child is classified →
// smart-expand should fold it.
const NODES: any[] = [
  { id: 'b1', type: 'BOUNDARY', parentNode: '', data: { label: 'Datacenter', zone: 'INTERNAL', planes: [], conduits: [{ peerId: 'x', direction: 'OUTBOUND' }] } },
  { id: 'b2', type: 'BOUNDARY', parentNode: 'b1', data: { label: 'App tier', zone: null, planes: ['WORKLOAD'] } },
  { id: 'b3', type: 'BOUNDARY', parentNode: '', data: { label: 'Lonely', zone: null } },
  { id: 'b4', type: 'BOUNDARY', parentNode: '', data: { label: 'Edge', zone: null } },
  { id: 'b5', type: 'BOUNDARY', parentNode: 'b4', data: { label: 'Edge pod', zone: null } },
]
const EZ: Record<string, EffectiveZone> = {
  b1: { zone: 'INTERNAL', source: 'declared' },
  b2: { zone: 'INTERNAL', source: 'inherited', from: 'b1' },
  b3: { zone: 'INTERNAL', source: 'default' },
  b4: { zone: 'INTERNAL', source: 'default' },
  b5: { zone: 'INTERNAL', source: 'default' },
}

const updateNode = vi.fn().mockResolvedValue(true)

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({
    allBoundaries: () => NODES,
    defaultBoundaryId: '',
    effectiveZone: (id: string) => EZ[id],
    boundaryById: (id: string) => NODES.find(n => n.id === id) ?? null,
    isOperationLoading: () => false,
    updateNode,
  }),
}))

import BoundaryZoningOverview from '../BoundaryZoningOverview.vue'

// VDataTable stub: render the #top slot + each row's #item.name/#item.zone/#item.role slots so the inline
// editor, the twisty, the roll-up badge and the resolution caption are reachable. Selection is driven via
// $emit('update:modelValue', ids).
const VDataTable = {
  name: 'VDataTable',
  props: ['items', 'modelValue', 'headers'],
  emits: ['update:modelValue'],
  template: `
    <div class="vdt">
      <div class="vdt-top"><slot name="top" /></div>
      <div v-for="item in items" :key="item.id" class="vdt-row" :data-id="item.id">
        <slot name="item.name" :item="item" />
        <slot name="item.zone" :item="item" />
        <slot name="item.role" :item="item" />
      </div>
    </div>`,
}
const VSelect = {
  name: 'VSelect',
  props: ['modelValue', 'items', 'placeholder', 'loading'],
  emits: ['update:modelValue'],
  template: '<div class="vsel" />',
}
const VSwitch = {
  name: 'VSwitch',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="vsw" />',
}
const VMenu = { template: '<div class="vmenu"><slot name="activator" :props="{}" /><slot /></div>' }
const VListItem = {
  name: 'VListItem',
  props: ['title', 'subtitle'],
  emits: ['click'],
  template: '<div class="vli" :data-title="title" @click="$emit(\'click\')">{{ title }}</div>',
}
const passthrough = (cls: string) => ({ template: `<div class="${cls}"><slot /></div>` })

const stubs = {
  VDialog: passthrough('vdialog'),
  VCard: passthrough('vcard'),
  VCardTitle: passthrough('vct'),
  VCardText: passthrough('vcx'),
  VSheet: passthrough('vsheet'),
  VDataTable,
  VSelect,
  VSwitch,
  VMenu,
  VList: passthrough('vlist'),
  VListItem,
  VListSubheader: passthrough('vlsh'),
  VChip: passthrough('vchip'),
  VBtn: { props: ['loading'], emits: ['click'], template: '<button class="vbtn" @click="$emit(\'click\')"><slot /></button>' },
  VDivider: { template: '<hr />' },
  VIcon: { template: '<i />' },
  VSpacer: { template: '<span />' },
  VSnackbar: { template: '<div class="vsnack"><slot /><slot name="actions" /></div>' },
}

const mountOverview = () =>
  mount(BoundaryZoningOverview, { props: { modelValue: true }, global: { stubs } })

const rowFor = (wrapper: any, id: string) => wrapper.find(`.vdt-row[data-id="${id}"]`)
const rowIds = (wrapper: any) => wrapper.findAll('.vdt-row').map((r: any) => r.attributes('data-id'))
const btnByText = (wrapper: any, text: string) => wrapper.findAll('.vbtn').find((b: any) => b.text().includes(text))!
const clickBtn = async (wrapper: any, text: string) => {
  await btnByText(wrapper, text).trigger('click')
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  updateNode.mockClear()
})

describe('BoundaryZoningOverview — tree + smart expansion', () => {
  it('smart-expands branches with an unclassified descendant and folds fully-classified branches', () => {
    const wrapper = mountOverview()
    // Edge (b4) has an unclassified child (b5) → expanded → b5 visible. Datacenter (b1) only has a classified
    // child (b2) → folded → b2 hidden.
    expect(rowIds(wrapper)).toEqual(['b1', 'b3', 'b4', 'b5'])
    expect(rowFor(wrapper, 'b2').exists()).toBe(false)
    // twisty aria-expanded reflects state
    expect(rowFor(wrapper, 'b4').find('.twisty-btn').attributes('aria-expanded')).toBe('true')
    expect(rowFor(wrapper, 'b1').find('.twisty-btn').attributes('aria-expanded')).toBe('false')
  })

  it('indents child name-cell content by depth (parents on a straight edge)', () => {
    const wrapper = mountOverview()
    expect(rowFor(wrapper, 'b4').find('.name-cell').attributes('style')).toContain('padding-left: 0px')
    expect(rowFor(wrapper, 'b5').find('.name-cell').attributes('style')).toContain('padding-left: 20px')
  })

  it('renders every boundary with the right resolution caption once expanded', async () => {
    const wrapper = mountOverview()
    await clickBtn(wrapper, 'Expand all')
    expect(wrapper.findAll('.vdt-row')).toHaveLength(5)
    expect(rowFor(wrapper, 'b1').text()).toContain('Declared')
    expect(rowFor(wrapper, 'b2').text()).toContain('Inherited from Datacenter')
    expect(rowFor(wrapper, 'b3').text()).toContain('Unset → default Internal')
  })

  it('counts unclassified (source === default) boundaries', () => {
    const wrapper = mountOverview()
    expect(wrapper.find('.unclassified-chip').text()).toContain('3 unclassified')
  })

  it('highlights the unclassified row name', () => {
    const wrapper = mountOverview()
    expect(rowFor(wrapper, 'b3').find('.unclassified-name').exists()).toBe(true)
    expect(rowFor(wrapper, 'b1').find('.unclassified-name').exists()).toBe(false)
  })
})

describe('BoundaryZoningOverview — roll-up badge & expand/collapse all (constraint A/C)', () => {
  it('a collapsed parent surfaces a ⚠ N unclassified roll-up badge (none while expanded)', async () => {
    const wrapper = mountOverview()
    // b4 starts expanded (smart) → no badge, child visible.
    expect(rowFor(wrapper, 'b4').find('.rollup-unclassified').exists()).toBe(false)
    expect(rowFor(wrapper, 'b5').exists()).toBe(true)
    // collapse b4 → its hidden unclassified descendant rolls up as a text badge.
    await rowFor(wrapper, 'b4').find('.twisty-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(rowFor(wrapper, 'b5').exists()).toBe(false)
    expect(rowFor(wrapper, 'b4').find('.rollup-unclassified').text()).toContain('1 unclassified')
  })

  it('collapse all shows only roots; expand all shows the whole tree', async () => {
    const wrapper = mountOverview()
    await clickBtn(wrapper, 'Collapse all')
    expect(rowIds(wrapper)).toEqual(['b1', 'b3', 'b4'])
    await clickBtn(wrapper, 'Expand all')
    expect(rowIds(wrapper)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
  })

  it('toggles a parent when its whole name cell is clicked (bigger target than the twisty)', async () => {
    const wrapper = mountOverview()
    // b4 starts expanded (smart) → child b5 visible. Click the name cell (not the twisty) → collapse.
    expect(rowFor(wrapper, 'b5').exists()).toBe(true)
    expect(rowFor(wrapper, 'b4').find('.name-cell').classes()).toContain('name-cell--expandable')
    await rowFor(wrapper, 'b4').find('.name-cell').trigger('click')
    await wrapper.vm.$nextTick()
    expect(rowFor(wrapper, 'b5').exists()).toBe(false)
    // and back open
    await rowFor(wrapper, 'b4').find('.name-cell').trigger('click')
    await wrapper.vm.$nextTick()
    expect(rowFor(wrapper, 'b5').exists()).toBe(true)
  })
})

describe('BoundaryZoningOverview — inline edit', () => {
  it('persists a single zone change via updateNode({ data: { zone } })', async () => {
    const wrapper = mountOverview()
    await clickBtn(wrapper, 'Expand all') // make the inherited child b2 visible
    const sel = rowFor(wrapper, 'b2').findComponent(VSelect)
    sel.vm.$emit('update:modelValue', 'RESTRICTED')
    await wrapper.vm.$nextTick()
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b2', updates: { data: { zone: 'RESTRICTED' } } })
  })

  it('shows the ghost placeholder only when no zone is declared on the row', () => {
    const wrapper = mountOverview()
    expect(rowFor(wrapper, 'b1').findComponent(VSelect).props('placeholder')).toBeUndefined() // declared
    expect(rowFor(wrapper, 'b3').findComponent(VSelect).props('placeholder')).toBe('Internal') // default ghost
  })
})

describe('BoundaryZoningOverview — bulk set, filter & per-row selection (constraint B)', () => {
  it('sets the chosen zone on every selected boundary (one updateNode per id)', async () => {
    const wrapper = mountOverview()
    wrapper.findComponent(VDataTable).vm.$emit('update:modelValue', ['b3', 'b4'])
    await wrapper.vm.$nextTick()
    const restricted = wrapper.findAll('.vli').find(li => li.attributes('data-title') === 'Restricted')!
    await restricted.trigger('click')
    await wrapper.vm.$nextTick()
    expect(updateNode).toHaveBeenCalledTimes(2)
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b3', updates: { data: { zone: 'RESTRICTED' } } })
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b4', updates: { data: { zone: 'RESTRICTED' } } })
  })

  it('selecting a parent does NOT pull in its children (per-row selection only)', async () => {
    const wrapper = mountOverview()
    // b4 has a child b5; selecting just b4 must keep the count at 1.
    wrapper.findComponent(VDataTable).vm.$emit('update:modelValue', ['b4'])
    await wrapper.vm.$nextTick()
    expect(btnByText(wrapper, 'Set zone for').text()).toContain('1 selected')
  })

  it('surfaces selected rows hidden by a collapse in the bulk button (no opaque off-screen writes)', async () => {
    const wrapper = mountOverview()
    // Select the child b5 (visible — b4 starts expanded), then collapse its parent b4.
    wrapper.findComponent(VDataTable).vm.$emit('update:modelValue', ['b5'])
    await wrapper.vm.$nextTick()
    expect(btnByText(wrapper, 'Set zone for').text()).not.toContain('hidden')
    await rowFor(wrapper, 'b4').find('.twisty-btn').trigger('click') // collapse b4 → b5 hidden but still selected
    await wrapper.vm.$nextTick()
    expect(btnByText(wrapper, 'Set zone for').text()).toContain('1 hidden by collapse')
  })

  it('"Clear (inherit)" bulk-sets zone to null', async () => {
    const wrapper = mountOverview()
    wrapper.findComponent(VDataTable).vm.$emit('update:modelValue', ['b1'])
    await wrapper.vm.$nextTick()
    const clear = wrapper.findAll('.vli').find(li => li.attributes('data-title') === 'Clear (inherit)')!
    await clear.trigger('click')
    await wrapper.vm.$nextTick()
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b1', updates: { data: { zone: null } } })
  })

  it('offers Undo after a successful bulk set, replaying the prior declared zones', async () => {
    const wrapper = mountOverview()
    wrapper.findComponent(VDataTable).vm.$emit('update:modelValue', ['b3', 'b4'])
    await wrapper.vm.$nextTick()
    const restricted = wrapper.findAll('.vli').find(li => li.attributes('data-title') === 'Restricted')!
    await restricted.trigger('click')
    await flushPromises()
    updateNode.mockClear()
    const undo = wrapper.findAll('.vbtn').find(b => b.text() === 'Undo')!
    expect(undo).toBeTruthy()
    await undo.trigger('click')
    await flushPromises()
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b3', updates: { data: { zone: null } } })
    expect(updateNode).toHaveBeenCalledWith({ nodeId: 'b4', updates: { data: { zone: null } } })
  })

  it('"show only unclassified" flattens to the flat default-source list (no twisties)', async () => {
    const wrapper = mountOverview()
    wrapper.findComponent(VSwitch).vm.$emit('update:modelValue', true)
    await wrapper.vm.$nextTick()
    expect(rowIds(wrapper)).toEqual(['b3', 'b4', 'b5'])
    // flattened → even a parent (b4) renders with no twisty (depth 0, hasChildren false)
    expect(rowFor(wrapper, 'b4').find('.twisty-btn').exists()).toBe(false)
  })
})
