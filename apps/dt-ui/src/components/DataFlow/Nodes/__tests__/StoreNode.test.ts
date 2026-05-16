// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StoreNode from '../StoreNode.vue'

const stubs = {
  Handle: { template: '<div class="handle-stub" />' },
  UnclassifiedPill: {
    template: '<span v-if="visible" class="unclassified-pill-stub" />',
    props: ['visible'],
  },
}

describe('StoreNode — unclassified pill visibility', () => {
  it('shows pill when classId and representedModelId are both null', () => {
    const wrapper = mount(StoreNode, {
      props: { id: 'n-1', data: { label: 'DB', classId: null, representedModelId: null } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(true)
  })

  it('hides pill when classId is set', () => {
    const wrapper = mount(StoreNode, {
      props: { id: 'n-1', data: { label: 'DB', classId: 'cls-1', representedModelId: null } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })

  it('hides pill when representedModelId is set', () => {
    const wrapper = mount(StoreNode, {
      props: { id: 'n-1', data: { label: 'DB', classId: null, representedModelId: 'mdl-1' } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })

  it('hides pill when both classId and representedModelId are set', () => {
    const wrapper = mount(StoreNode, {
      props: { id: 'n-1', data: { label: 'DB', classId: 'cls-1', representedModelId: 'mdl-1' } },
      global: { stubs },
    })
    expect(wrapper.find('.unclassified-pill-stub').exists()).toBe(false)
  })
})
