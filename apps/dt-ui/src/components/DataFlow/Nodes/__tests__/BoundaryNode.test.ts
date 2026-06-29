// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { EffectiveZone } from '@/utils/effectiveZone'

// The component now reads flowStore.effectiveZone(id) (+ boundaryById for the tooltip name);
// the mock supplies both. Default per-test: a 'default' source → zonePill() returns null → no pill.
let effectiveZoneResult: EffectiveZone = { zone: 'INTERNAL', source: 'default' }

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({
    editMode: false,
    effectiveZone: () => effectiveZoneResult,
    boundaryById: () => ({ data: { label: 'Datacenter' } }),
  }),
}))

import BoundaryNode from '../BoundaryNode.vue'

const stubs = {
  NodeResizer: { template: '<div class="node-resizer-stub" />' },
  UnclassifiedPill: {
    template: '<span v-if="visible" class="unclassified-pill-stub" />',
    props: ['visible'],
  },
  // Render the tooltip's activator slot and surface the chip content for assertions.
  'v-tooltip': { template: '<div class="zone-tooltip-stub"><slot name="activator" :props="{}" /></div>' },
  'v-chip': { template: '<span class="zone-pill-stub" :class="$attrs.class"><slot /></span>', inheritAttrs: false },
}

const baseData = { label: 'Network Boundary', minWidth: 100, minHeight: 100 }

beforeEach(() => {
  effectiveZoneResult = { zone: 'INTERNAL', source: 'default' }
})

describe('BoundaryNode — unclassified pill visibility', () => {
  it('shows pill when classId and representedModelId are both null', () => {
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData, classId: null, representedModelId: null } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(true)
  })

  it('hides pill when classId is set', () => {
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData, classId: 'cls-1', representedModelId: null } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })

  it('hides pill when representedModelId is set (boundary represents a model)', () => {
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData, classId: null, representedModelId: 'mdl-1' } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })

  it('hides pill when both classId and representedModelId are set', () => {
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData, classId: 'cls-1', representedModelId: 'mdl-1' } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })
})

describe('BoundaryNode — zone pill', () => {
  it('renders no zone pill or stripe for a default (undeclared) zone', () => {
    effectiveZoneResult = { zone: 'INTERNAL', source: 'default' }
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData } },
      global: { stubs },
    })
    expect(wrapper.find('.zone-pill-stub').exists()).toBe(false)
    expect(wrapper.find('.zone-stripe').exists()).toBe(false)
  })

  it('renders a solid word pill + stripe for a declared zone', () => {
    effectiveZoneResult = { zone: 'PUBLIC', source: 'declared' }
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData } },
      global: { stubs },
    })
    expect(wrapper.find('.zone-pill-stub').text()).toBe('Public')
    const stripe = wrapper.find('.zone-stripe')
    expect(stripe.exists()).toBe(true)
    expect(stripe.classes()).toContain('bg-deep-purple-lighten-1')
    expect(stripe.classes()).not.toContain('zone-inherited')
  })

  it('dims the pill + stripe for an inherited zone', () => {
    effectiveZoneResult = { zone: 'EXPOSED', source: 'inherited', from: 'p1' }
    const wrapper = mount(BoundaryNode, {
      props: { id: 'b-1', data: { ...baseData } },
      global: { stubs },
    })
    expect(wrapper.find('.zone-pill-stub').text()).toBe('DMZ')
    expect(wrapper.find('.zone-pill-stub').classes()).toContain('zone-inherited')
    expect(wrapper.find('.zone-stripe').classes()).toContain('zone-inherited')
  })
})
