// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { EffectiveZone } from '@/utils/effectiveZone'

// The tab reads two store getters for the ghost: effectiveZone(id) + boundaryById(id). Mock both.
let effectiveZoneResult: EffectiveZone = { zone: 'INTERNAL', source: 'inherited', from: 'p1' }

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({
    effectiveZone: () => effectiveZoneResult,
    boundaryById: () => ({ data: { label: 'Datacenter' } }),
  }),
}))

import SettingsZoningTab from '../SettingsZoningTab.vue'

// Controllable stubs for the inputs; passthrough stubs for containers.
const VSelect = {
  name: 'VSelect',
  props: ['modelValue', 'items', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<div class="v-select-stub"><slot /></div>',
}
const VCombobox = {
  name: 'VCombobox',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="v-combobox-stub" />',
}
const VBtn = {
  name: 'VBtn',
  props: ['disabled'],
  template: '<button class="v-btn-stub" :disabled="disabled"><slot /></button>',
}
const passthrough = (cls: string) => ({ template: `<div class="${cls}"><slot /></div>` })
const VTooltip = { template: '<div class="v-tooltip-stub"><slot name="activator" :props="{}" /></div>' }
// Stub the picker drawer — its own behaviour is covered by BoundaryPickerSheet.test.ts; here we only
// assert it's wired (opens on "+ Add", and its commit-request appends to the buffer).
const BoundaryPickerSheet = {
  name: 'BoundaryPickerSheet',
  props: ['modelValue', 'currentBoundaryId', 'existingConduits'],
  emits: ['update:modelValue', 'commit-request'],
  template: '<div class="bps-stub" />',
}

const stubs = {
  VCard: passthrough('v-card-stub'),
  VContainer: passthrough('v-container-stub'),
  VRow: passthrough('v-row-stub'),
  VCol: passthrough('v-col-stub'),
  VSelect,
  VCombobox,
  VBtn,
  VTooltip,
  BoundaryPickerSheet,
  VIcon: { template: '<i />' },
  VSpacer: { template: '<span />' },
  VListSubheader: passthrough('v-list-subheader-stub'),
  VListItem: { template: '<div class="v-list-item-stub" />' },
  VExpansionPanels: passthrough('v-expansion-panels-stub'),
  VExpansionPanel: passthrough('v-expansion-panel-stub'),
  VExpansionPanelTitle: passthrough('v-expansion-panel-title-stub'),
  VExpansionPanelText: passthrough('v-expansion-panel-text-stub'),
}

const baseZoning = () => ({ zone: null as any, domains: [] as string[], planes: [] as any[], conduits: [] as any[] })

const mountTab = (zoning: any) =>
  mount(SettingsZoningTab, {
    props: { zoning, boundaryId: 'b-1' },
    global: { stubs },
  })

beforeEach(() => {
  effectiveZoneResult = { zone: 'INTERNAL', source: 'inherited', from: 'p1' }
})

describe('SettingsZoningTab — zone', () => {
  it('emits update:zoning with the chosen enum when a zone is selected', async () => {
    const wrapper = mountTab(baseZoning())
    const zoneSelect = wrapper.findAllComponents(VSelect)[0]
    zoneSelect.vm.$emit('update:modelValue', 'RESTRICTED')
    const evt = wrapper.emitted('update:zoning')
    expect(evt).toBeTruthy()
    expect((evt![0][0] as any).zone).toBe('RESTRICTED')
  })

  it('emits zone:null when cleared (back to the inherited ghost)', () => {
    const wrapper = mountTab({ ...baseZoning(), zone: 'PUBLIC' })
    const zoneSelect = wrapper.findAllComponents(VSelect)[0]
    zoneSelect.vm.$emit('update:modelValue', null)
    expect((wrapper.emitted('update:zoning')![0][0] as any).zone).toBeNull()
  })

  it('shows the ghost placeholder (inherited value) only while the zone is unset', () => {
    const unset = mountTab(baseZoning())
    expect(unset.findAllComponents(VSelect)[0].props('placeholder')).toBe('Internal (inherited from Datacenter)')

    const set = mountTab({ ...baseZoning(), zone: 'PUBLIC' })
    expect(set.findAllComponents(VSelect)[0].props('placeholder')).toBeUndefined()
  })

  it('shows the first-use teaching line only while the zone is unset', () => {
    expect(mountTab(baseZoning()).find('.zoning-firstuse').exists()).toBe(true)
    expect(mountTab({ ...baseZoning(), zone: 'INTERNAL' }).find('.zoning-firstuse').exists()).toBe(false)
  })
})

describe('SettingsZoningTab — tags (domain + role)', () => {
  it('hides the tag inputs behind "+ Add tags" until opened or populated', async () => {
    const wrapper = mountTab(baseZoning())
    expect(wrapper.findComponent(VCombobox).exists()).toBe(false)
    // The "Add tags" button is the first v-btn.
    await wrapper.findComponent(VBtn).trigger('click')
    expect(wrapper.findComponent(VCombobox).exists()).toBe(true)
  })

  it('renders tag inputs immediately when domains/planes are already set', () => {
    const wrapper = mountTab({ ...baseZoning(), planes: ['WORKLOAD'] })
    expect(wrapper.findComponent(VCombobox).exists()).toBe(true)
  })

  it('emits the chosen planes for each of the four Role states', () => {
    const cases: Array<[string, string[]]> = [
      ['UNDECIDED', []],
      ['WORKLOAD', ['WORKLOAD']],
      ['MANAGEMENT', ['MANAGEMENT']],
      ['BOTH', ['WORKLOAD', 'MANAGEMENT']],
    ]
    for (const [role, planes] of cases) {
      const wrapper = mountTab({ ...baseZoning(), planes: ['WORKLOAD'] }) // forces tags open
      const roleSelect = wrapper.findAllComponents(VSelect)[1]
      roleSelect.vm.$emit('update:modelValue', role)
      expect((wrapper.emitted('update:zoning')!.at(-1)![0] as any).planes).toEqual(planes)
    }
  })

  it('reflects a {workload, management} buffer as the combined Role (order-insensitive)', () => {
    const wrapper = mountTab({ ...baseZoning(), planes: ['MANAGEMENT', 'WORKLOAD'] })
    expect(wrapper.findAllComponents(VSelect)[1].props('modelValue')).toBe('BOTH')
  })

  it('emits the domain chips array on combobox change', () => {
    const wrapper = mountTab({ ...baseZoning(), domains: ['erp'] })
    wrapper.findComponent(VCombobox).vm.$emit('update:modelValue', ['erp', 'payments'])
    expect((wrapper.emitted('update:zoning')!.at(-1)![0] as any).domains).toEqual(['erp', 'payments'])
  })
})

describe('SettingsZoningTab — approved channels (read-only this session)', () => {
  it('lists buffer conduits read-only with the peer, direction and justification', () => {
    const wrapper = mountTab({
      ...baseZoning(),
      conduits: [
        { peerId: 'p1', peerName: 'Payments-DB', direction: 'OUTBOUND', justification: 'card flow' },
        { peerId: 'p2', direction: 'INBOUND' },
      ],
    })
    const rows = wrapper.findAll('.channel-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Payments-DB')
    expect(rows[0].text()).toContain('card flow')
    expect(rows[0].text()).toContain('→')
    // Missing peerName falls back to boundaryById's label.
    expect(rows[1].text()).toContain('Datacenter')
    expect(rows[1].text()).toContain('←')
  })

  it('opens the peer picker drawer from the enabled "+ Add" button', async () => {
    const wrapper = mountTab(baseZoning())
    const addBtn = wrapper.find('.add-channel-btn')
    expect(addBtn.exists()).toBe(true)
    expect((addBtn.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.findComponent(BoundaryPickerSheet).props('modelValue')).toBe(false)
    await addBtn.trigger('click')
    expect(wrapper.findComponent(BoundaryPickerSheet).props('modelValue')).toBe(true)
  })

  it('appends the conduit(s) to the buffer on the drawer commit-request (batched array)', () => {
    const wrapper = mountTab(baseZoning())
    // The picker emits an ARRAY of specs (1–2) in one event — a bidirectional add appends both atomically.
    wrapper.findComponent(BoundaryPickerSheet).vm.$emit('commit-request', [
      { peerId: 'p9', peerName: 'Vendor API', direction: 'OUTBOUND', justification: 'egress' },
      { peerId: 'p9', peerName: 'Vendor API', direction: 'INBOUND', justification: 'egress' },
    ])
    expect((wrapper.emitted('update:zoning')!.at(-1)![0] as any).conduits).toEqual([
      { peerId: 'p9', peerName: 'Vendor API', direction: 'OUTBOUND', justification: 'egress' },
      { peerId: 'p9', peerName: 'Vendor API', direction: 'INBOUND', justification: 'egress' },
    ])
  })

  it('removes a conduit from the buffer via the row ✕', async () => {
    const wrapper = mountTab({
      ...baseZoning(),
      conduits: [
        { peerId: 'p1', peerName: 'A', direction: 'OUTBOUND' },
        { peerId: 'p2', peerName: 'B', direction: 'INBOUND' },
      ],
    })
    await wrapper.find('.remove-channel-btn').trigger('click')
    expect((wrapper.emitted('update:zoning')!.at(-1)![0] as any).conduits).toEqual([
      { peerId: 'p2', peerName: 'B', direction: 'INBOUND' },
    ])
  })
})
