// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelPreview from '../ModelPreview.vue'

const stubs = {
  'v-card': { template: '<div class="v-card"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
}

describe('ModelPreview', () => {
  it('shows the empty-state card when modelItem is null', () => {
    const wrapper = mount(ModelPreview, { props: { modelItem: null }, global: { stubs } })
    expect(wrapper.text()).toContain('No model selected')
  })

  it('renders the model name as header and the description in the body', () => {
    const wrapper = mount(ModelPreview, {
      props: { modelItem: { id: 'm-1', name: 'Auth Sub-model', description: 'Handles OIDC.' } },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Auth Sub-model')
    expect(wrapper.text()).toContain('Handles OIDC.')
  })

  it('falls back to em-dash when description is empty', () => {
    const wrapper = mount(ModelPreview, {
      props: { modelItem: { id: 'm-1', name: 'Auth Sub-model', description: '' } },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Auth Sub-model')
    expect(wrapper.text()).toContain('—')
  })

  it('falls back to em-dash for missing name', () => {
    const wrapper = mount(ModelPreview, {
      props: { modelItem: { id: 'm-1', name: '', description: 'Some text.' } },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('—')
    expect(wrapper.text()).toContain('Some text.')
  })
})
