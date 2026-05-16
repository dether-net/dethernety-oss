// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClassPickerFacets from '../ClassPickerFacets.vue'

const stubs = {
  'v-chip-group': { template: '<div class="v-chip-group"><slot /></div>' },
  'v-chip': {
    template: '<div class="v-chip" @click="$emit(\'click\')"><slot /></div>',
    emits: ['click'],
  },
}

const sampleFacetCounts = {
  categories: [
    { value: 'Persistence', count: 47 },
    { value: 'Networking', count: 12 },
    { value: 'Identity', count: 8 },
  ],
  modules: [
    { moduleId: 'mod-1', moduleName: 'dethernety-module', count: 50 },
    { moduleId: 'mod-2', moduleName: 'extras-module', count: 10 },
  ],
  types: [
    { value: 'STORE', count: 30 },
    { value: 'PROCESS', count: 25 },
    { value: 'EXTERNAL_ENTITY', count: 5 },
  ],
}

const baseProps = {
  classLabel: 'COMPONENT' as const,
  facetCounts: sampleFacetCounts,
  selectedCategories: [] as string[],
  selectedModuleIds: [] as string[],
}

describe('ClassPickerFacets — rendering', () => {
  it('renders Category + Module groups (Type group is never rendered)', () => {
    const wrapper = mount(ClassPickerFacets, { props: baseProps, global: { stubs } })
    // Type is not user-selectable: locked to the node context for COMPONENT,
    // and not meaningful for DATA_FLOW / SECURITY_BOUNDARY.
    expect(wrapper.find('.facet-group--type').exists()).toBe(false)
    expect(wrapper.find('.facet-group--category').exists()).toBe(true)
    expect(wrapper.find('.facet-group--module').exists()).toBe(true)
  })

  it('Type group stays hidden regardless of classLabel', () => {
    for (const classLabel of ['COMPONENT', 'DATA_FLOW', 'SECURITY_BOUNDARY'] as const) {
      const wrapper = mount(ClassPickerFacets, {
        props: { ...baseProps, classLabel },
        global: { stubs },
      })
      expect(wrapper.find('.facet-group--type').exists()).toBe(false)
    }
  })
})

describe('ClassPickerFacets — chip labels + ordering', () => {
  it('includes value + count in each chip label', () => {
    const wrapper = mount(ClassPickerFacets, { props: baseProps, global: { stubs } })
    expect(wrapper.text()).toContain('Persistence (47)')
    expect(wrapper.text()).toContain('dethernety-module (50)')
  })

  it('orders chips within each group by count descending', () => {
    const wrapper = mount(ClassPickerFacets, { props: baseProps, global: { stubs } })
    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    expect(categoryChips[0].text()).toContain('Persistence')
    expect(categoryChips[1].text()).toContain('Networking')
    expect(categoryChips[2].text()).toContain('Identity')
  })
})

describe('ClassPickerFacets — category multi-select toggle', () => {
  it('emits update:selectedCategories with value added when clicked', async () => {
    const wrapper = mount(ClassPickerFacets, { props: baseProps, global: { stubs } })
    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    await categoryChips[0].trigger('click')
    const events = wrapper.emitted('update:selectedCategories')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual(['Persistence'])
  })

  it('emits update:selectedCategories with value removed when clicked while selected', async () => {
    const wrapper = mount(ClassPickerFacets, {
      props: { ...baseProps, selectedCategories: ['Persistence', 'Networking'] },
      global: { stubs },
    })
    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    await categoryChips[0].trigger('click')
    const events = wrapper.emitted('update:selectedCategories')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual(['Networking'])
  })
})

