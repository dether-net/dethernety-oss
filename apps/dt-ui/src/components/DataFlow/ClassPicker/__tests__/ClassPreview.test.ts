// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClassPreview, { type ClassPreviewable } from '../ClassPreview.vue'

const stubs = {
  'v-card': { template: '<div class="v-card"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
}

const fullClass: ClassPreviewable = {
  classId: 'cls-1',
  className: 'AuthService',
  classCategory: 'security',
  classDescription: 'Handles user authentication and session management.',
  moduleName: 'dethernety-module',
}

describe('ClassPreview', () => {
  it('renders the empty-state when classItem is null', () => {
    const wrapper = mount(ClassPreview, { props: { classItem: null }, global: { stubs } })
    expect(wrapper.text()).toContain('No class selected')
  })

  it('renders all four fields when classItem is fully populated', () => {
    const wrapper = mount(ClassPreview, { props: { classItem: fullClass }, global: { stubs } })
    const text = wrapper.text()
    expect(text).toContain('AuthService')
    expect(text).toContain('security')
    expect(text).toContain('dethernety-module')
    expect(text).toContain('Handles user authentication and session management.')
  })

  it('renders em-dash placeholders for missing optional fields', () => {
    const partial: ClassPreviewable = {
      classId: 'cls-2',
      className: 'PartialClass',
    }
    const wrapper = mount(ClassPreview, { props: { classItem: partial }, global: { stubs } })
    const text = wrapper.text()
    expect(text).toContain('PartialClass')
    // Category, Module, Description all absent → three em-dashes
    const dashMatches = text.match(/—/g) ?? []
    expect(dashMatches.length).toBe(3)
  })
})
