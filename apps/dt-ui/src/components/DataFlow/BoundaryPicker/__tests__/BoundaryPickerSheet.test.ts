// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Node } from '@vue-flow/core'
import type { EffectiveZone } from '@/utils/effectiveZone'

// ── Store mock: a small boundary model — Datacenter ─ App tier ─ Payments svc ; plus Payments-DB. ──
const NODES: Node[] = [
  { id: 'dc', type: 'BOUNDARY', parentNode: '', position: { x: 0, y: 0 }, data: { label: 'Datacenter' } },
  { id: 'app', type: 'BOUNDARY', parentNode: 'dc', position: { x: 0, y: 0 }, data: { label: 'App tier' } },
  { id: 'pay', type: 'BOUNDARY', parentNode: 'app', position: { x: 0, y: 0 }, data: { label: 'Payments svc' } },
  { id: 'db', type: 'BOUNDARY', parentNode: 'dc', position: { x: 0, y: 0 }, data: { label: 'Payments-DB', planes: ['WORKLOAD'] } },
] as any

const ZONES: Record<string, EffectiveZone> = {
  dc: { zone: 'INTERNAL', source: 'declared' },
  app: { zone: 'EXPOSED', source: 'declared' },
  pay: { zone: 'INTERNAL', source: 'inherited', from: 'dc' },
  db: { zone: 'RESTRICTED', source: 'declared' },
}

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({
    allBoundaries: () => NODES,
    defaultBoundaryId: '',
    boundaryById: (id: string) => NODES.find(n => n.id === id) ?? null,
    effectiveZone: (id: string) => ZONES[id] ?? { zone: 'INTERNAL', source: 'default' },
  }),
}))

import BoundaryPickerSheet from '../BoundaryPickerSheet.vue'

// Stub BoundaryPeerPreview (its own store reads aren't under test here).
const BoundaryPeerPreview = { props: ['boundaryId'], template: '<div class="peer-preview-stub" :data-bid="boundaryId" />' }

const passthrough = (cls: string) => ({ template: `<div class="${cls}"><slot /></div>` })
const VListItem = {
  props: ['active', 'disabled'],
  emits: ['click'],
  template: '<div class="vli" :class="{ active, disabled }" @click="$emit(\'click\')"><slot /></div>',
}
const VTextField = { props: ['modelValue', 'label'], emits: ['update:modelValue'], template: '<input class="vtf" :data-label="label" />' }
// Add-only direction checkboxes (template order: [0] Outbound, [1] Inbound). Renders the #label slot so the
// "Added" chip is reachable; surfaces modelValue/disabled as classes for assertions.
const VCheckbox = {
  props: ['modelValue', 'disabled', 'readonly'],
  emits: ['update:modelValue'],
  template: '<div class="vcheckbox" :class="{ checked: modelValue, disabled, readonly }"><slot name="label" /></div>',
}
// nesting warning — surfaces severity via data-type so the merged `.nesting-warning` class can be queried.
const VAlert = { props: ['type'], template: '<div class="valert" :data-type="type"><slot /></div>' }
const VBtn = {
  props: ['disabled'],
  emits: ['click'],
  template: '<button class="vbtn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}
const VTooltip = { template: '<div class="vtt"><slot name="activator" :props="{}" /></div>' }

const stubs = {
  BoundaryPeerPreview,
  Teleport: passthrough('teleport-stub'),
  VNavigationDrawer: passthrough('vnd'),
  VSheet: passthrough('vsheet'),
  VDivider: { template: '<hr />' },
  VList: passthrough('vlist'),
  VListItem,
  VChip: passthrough('vchip'),
  VTextField,
  VCheckbox,
  VAlert,
  VBtn,
  VTooltip,
  VIcon: { template: '<i />' },
}

const mountSheet = (overrides: Record<string, any> = {}) =>
  mount(BoundaryPickerSheet, {
    props: { modelValue: true, currentBoundaryId: 'pay', existingConduits: [], ...overrides },
    global: { stubs },
  })

const addBtn = (wrapper: any) =>
  wrapper.findAll('.vbtn').find((b: any) => b.text().includes('Add channel'))!
const rowFor = (wrapper: any, id: string) => wrapper.find(`[data-id="${id}"]`)
// [0] Outbound, [1] Inbound
const dirBoxes = (wrapper: any) => wrapper.findAllComponents(VCheckbox)
const tickOut = (wrapper: any, on: boolean) => dirBoxes(wrapper)[0].vm.$emit('update:modelValue', on)
const tickIn = (wrapper: any, on: boolean) => dirBoxes(wrapper)[1].vm.$emit('update:modelValue', on)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BoundaryPickerSheet — tree', () => {
  it('renders the boundary forest pre-ordered, current boundary disabled', () => {
    const wrapper = mountSheet()
    const ids = wrapper.findAll('.vli').map((r: any) => r.attributes('data-id'))
    // dc ─ app ─ pay, then db (sibling of app under dc)
    expect(ids).toEqual(['dc', 'app', 'pay', 'db'])
    expect(rowFor(wrapper, 'pay').classes()).toContain('disabled')
    expect(rowFor(wrapper, 'pay').text()).toContain('this boundary')
  })
})

describe('BoundaryPickerSheet — selection & confirm', () => {
  it('disables "Add channel" until a peer is highlighted', async () => {
    const wrapper = mountSheet()
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true)
    await rowFor(wrapper, 'db').trigger('click')
    // Outbound is ticked by default on highlight → one new direction → enabled.
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not highlight the current boundary (no self-conduit)', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'pay').trigger('click')
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })

  it('emits one commit-request carrying a single OUTBOUND spec (default) with the shared justification', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    // set a justification (index 1 — index 0 is the search box)
    wrapper.findAllComponents(VTextField)[1].vm.$emit('update:modelValue', '  card flow  ')
    await wrapper.vm.$nextTick()
    await addBtn(wrapper).trigger('click')
    const evt = wrapper.emitted('commit-request')
    expect(evt).toBeTruthy()
    // Payload is an ARRAY of specs (batched), not a single object.
    expect(evt![0][0]).toEqual([{ peerId: 'db', peerName: 'Payments-DB', direction: 'OUTBOUND', justification: 'card flow' }])
    // and the drawer closes
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toBe(false)
  })

  it('omits justification when blank', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    await addBtn(wrapper).trigger('click')
    expect(wrapper.emitted('commit-request')![0][0]).toEqual([{ peerId: 'db', peerName: 'Payments-DB', direction: 'OUTBOUND' }])
  })

  it('authors a single INBOUND spec when outbound is unticked and inbound ticked', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    tickOut(wrapper, false)
    tickIn(wrapper, true)
    await wrapper.vm.$nextTick()
    await addBtn(wrapper).trigger('click')
    expect(wrapper.emitted('commit-request')![0][0]).toEqual([{ peerId: 'db', peerName: 'Payments-DB', direction: 'INBOUND' }])
  })

  it('authors a bidirectional channel in one pass — one event, two specs', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    // outbound already ticked by default; add inbound too
    tickIn(wrapper, true)
    await wrapper.vm.$nextTick()
    await addBtn(wrapper).trigger('click')
    const specs = wrapper.emitted('commit-request')![0][0] as any[]
    expect(specs).toHaveLength(1 + 1)
    expect(specs.map(s => s.direction).sort()).toEqual(['INBOUND', 'OUTBOUND'])
    expect(specs.every(s => s.peerId === 'db')).toBe(true)
    // exactly one event for the whole bidirectional add
    expect(wrapper.emitted('commit-request')!).toHaveLength(1)
  })

  it('discloses the shared justification in the Why label when both directions are authored', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    const whyField = () => wrapper.findAllComponents(VTextField)[1]
    // single direction (outbound default) → plain label
    expect(whyField().props('label')).toBe('Why (optional)')
    tickIn(wrapper, true)
    await wrapper.vm.$nextTick()
    // both directions → label discloses the single Why applies to both edges
    expect(whyField().props('label')).toContain('applies to both directions')
  })

  it('disables Add when no direction is ticked', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    tickOut(wrapper, false)
    await wrapper.vm.$nextTick()
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('BoundaryPickerSheet — add-only existing directions (no delete-by-untick)', () => {
  it('renders an already-approved direction checked + disabled + "Added", frees the other', async () => {
    const wrapper = mountSheet({ existingConduits: [{ peerId: 'db', direction: 'OUTBOUND' }] })
    await rowFor(wrapper, 'db').trigger('click')
    // Outbound exists → checked + read-only (kept in tab order for AT) + "Added"; nothing new → Add disabled.
    expect(dirBoxes(wrapper)[0].props('readonly')).toBe(true)
    expect(dirBoxes(wrapper)[0].props('modelValue')).toBe(true)
    expect(dirBoxes(wrapper)[0].text()).toContain('Added')
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true)
    // the row chip also marks it
    expect(rowFor(wrapper, 'db').text()).toContain('Added')
    // tick the missing inbound → Add enables, and emits ONLY the new inbound spec
    tickIn(wrapper, true)
    await wrapper.vm.$nextTick()
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(false)
    await addBtn(wrapper).trigger('click')
    expect(wrapper.emitted('commit-request')![0][0]).toEqual([{ peerId: 'db', peerName: 'Payments-DB', direction: 'INBOUND' }])
  })

  it('keeps Add disabled when both directions already exist', async () => {
    const wrapper = mountSheet({
      existingConduits: [
        { peerId: 'db', direction: 'OUTBOUND' },
        { peerId: 'db', direction: 'INBOUND' },
      ],
    })
    await rowFor(wrapper, 'db').trigger('click')
    expect(dirBoxes(wrapper)[0].props('readonly')).toBe(true)
    expect(dirBoxes(wrapper)[1].props('readonly')).toBe(true)
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('BoundaryPickerSheet — nested-conduit warning (warn, never block)', () => {
  const warning = (wrapper: any) => wrapper.find('.nesting-warning')

  it('shows the stronger warning when the peer is a containment ancestor (child→parent)', async () => {
    // current = pay (under app under dc); peer = dc is an ancestor of pay.
    const wrapper = mountSheet({ currentBoundaryId: 'pay' })
    await rowFor(wrapper, 'dc').trigger('click')
    expect(warning(wrapper).exists()).toBe(true)
    expect(warning(wrapper).attributes('data-type')).toBe('warning')
    // warn-not-block: Add stays enabled (outbound ticked by default)
    expect((addBtn(wrapper).element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the stronger warning for a same-resolved-zone nesting pair', async () => {
    // current = dc (INTERNAL); peer = pay inherits INTERNAL from dc → same effective zone.
    const wrapper = mountSheet({ currentBoundaryId: 'dc' })
    await rowFor(wrapper, 'pay').trigger('click')
    expect(warning(wrapper).exists()).toBe(true)
    expect(warning(wrapper).attributes('data-type')).toBe('warning')
  })

  it('shows the softer info note for a parent→child channel into a different tier', async () => {
    // current = dc (INTERNAL); peer = app (EXPOSED) is a child of dc, different zone.
    const wrapper = mountSheet({ currentBoundaryId: 'dc' })
    await rowFor(wrapper, 'app').trigger('click')
    expect(warning(wrapper).exists()).toBe(true)
    expect(warning(wrapper).attributes('data-type')).toBe('info')
  })

  it('shows no warning for a non-nested peer', async () => {
    // current = pay; peer = db is a sibling-branch (under dc, not on pay's chain).
    const wrapper = mountSheet({ currentBoundaryId: 'pay' })
    await rowFor(wrapper, 'db').trigger('click')
    expect(warning(wrapper).exists()).toBe(false)
  })
})

describe('BoundaryPickerSheet — keyboard a11y (lean)', () => {
  const searchField = (wrapper: any) => wrapper.findAllComponents(VTextField)[0]

  it('search-box Enter adds the highlighted peer when enabled', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click') // highlight → outbound ticked by default → enabled
    await searchField(wrapper).trigger('keydown.enter')
    const evt = wrapper.emitted('commit-request')
    expect(evt).toBeTruthy()
    expect(evt![0][0]).toEqual([{ peerId: 'db', peerName: 'Payments-DB', direction: 'OUTBOUND' }])
  })

  it('search-box Enter is a no-op while Add is disabled (no peer highlighted)', async () => {
    const wrapper = mountSheet()
    await searchField(wrapper).trigger('keydown.enter')
    expect(wrapper.emitted('commit-request')).toBeFalsy()
  })

  it('exposes the disabled reason to AT while Add is disabled and clears it when enabled', async () => {
    const wrapper = mountSheet()
    const reason = () => wrapper.find('.add-reason')
    // Disabled on open (no peer) → reason rendered, announced, and referenced by the button.
    expect(reason().exists()).toBe(true)
    expect(reason().text()).toBe('Pick a peer boundary first')
    expect(reason().attributes('role')).toBe('status')
    expect(reason().attributes('aria-live')).toBe('polite')
    expect(addBtn(wrapper).attributes('aria-describedby')).toBe('boundary-picker-add-reason')
    // Highlight a peer → Add enables → reason and its reference disappear.
    await rowFor(wrapper, 'db').trigger('click')
    expect(reason().exists()).toBe(false)
    expect(addBtn(wrapper).attributes('aria-describedby')).toBeUndefined()
  })

  it('reason text tracks why Add is disabled (no direction ticked)', async () => {
    const wrapper = mountSheet()
    await rowFor(wrapper, 'db').trigger('click')
    tickOut(wrapper, false) // untick the default → no direction left → disabled again
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.add-reason').text()).toBe('Tick a direction to add')
  })
})
