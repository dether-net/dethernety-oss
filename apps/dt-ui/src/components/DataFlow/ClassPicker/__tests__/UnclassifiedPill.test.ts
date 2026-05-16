// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UnclassifiedPill from '../UnclassifiedPill.vue'

const stubs = {
  'v-tooltip': { template: '<div class="v-tooltip"><slot name="activator" :props="{}" /></div>' },
  'v-icon': {
    template: '<i class="v-icon" v-bind="$attrs" :class="$attrs.class"><slot /></i>',
    inheritAttrs: false,
  },
}

describe('UnclassifiedPill', () => {
  it('renders nothing when visible=false', () => {
    const wrapper = mount(UnclassifiedPill, { props: { visible: false }, global: { stubs } })
    expect(wrapper.find('.v-icon').exists()).toBe(false)
    expect(wrapper.find('.v-tooltip').exists()).toBe(false)
  })

  it('renders the icon when visible=true (default corner placement)', () => {
    const wrapper = mount(UnclassifiedPill, { props: { visible: true }, global: { stubs } })
    const icon = wrapper.find('.v-icon')
    expect(icon.exists()).toBe(true)
    // Default placement is 'corner' — used by rectangular nodes.
    expect(icon.classes()).toContain('unclassified-pill--corner')
    expect(icon.classes()).not.toContain('unclassified-pill--circle')
  })

  it('switches placement class when placement="circle" is passed (for round nodes like Process)', () => {
    const wrapper = mount(UnclassifiedPill, {
      props: { visible: true, placement: 'circle' },
      global: { stubs },
    })
    const icon = wrapper.find('.v-icon')
    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('unclassified-pill--circle')
    expect(icon.classes()).not.toContain('unclassified-pill--corner')
  })
})
