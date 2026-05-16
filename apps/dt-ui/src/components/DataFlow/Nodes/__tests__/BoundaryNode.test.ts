// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'

const mockFlowStore = reactive<{ editMode: boolean }>({ editMode: false })

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => mockFlowStore,
}))

import BoundaryNode from '../BoundaryNode.vue'

const stubs = {
  NodeResizer: { template: '<div class="node-resizer-stub" />' },
  UnclassifiedPill: {
    template: '<span v-if="visible" class="unclassified-pill-stub" />',
    props: ['visible'],
  },
}

const baseData = { label: 'Network Boundary', minWidth: 100, minHeight: 100 }

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
