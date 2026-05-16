// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClassPickerResults from '../ClassPickerResults.vue'
import type { ClassCandidate } from '@/stores/classSuggestionsStore'

const stubs = {
  'v-list': { template: '<div class="v-list"><slot /></div>' },
  'v-list-item': {
    template: '<div class="v-list-item" @click="$emit(\'click\')"><slot /></div>',
    emits: ['click'],
  },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot /></div>' },
  'v-list-item-subtitle': { template: '<div class="v-list-item-subtitle"><slot /></div>' },
  // $attrs.class forwards "ml-2 added-chip" from the production markup so the
  // .added-chip selector finds only the chips actually rendered.
  'v-chip': {
    template: '<div class="v-chip" :class="$attrs.class"><slot /></div>',
  },
}

const make = (overrides: Partial<ClassCandidate> = {}): ClassCandidate => ({
  classId: overrides.classId ?? 'cls-1',
  className: overrides.className ?? 'AuthService',
  moduleId: overrides.moduleId ?? 'mod-1',
  moduleName: overrides.moduleName ?? 'dethernety-module',
  matchType: overrides.matchType ?? 'exact_name',
  confidence: overrides.confidence ?? 'high',
  ...overrides,
})

describe('ClassPickerResults — empty + base rendering', () => {
  it('renders the empty-state when candidates is []', () => {
    const wrapper = mount(ClassPickerResults, { props: { candidates: [] }, global: { stubs } })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('No candidates available.')
    expect(wrapper.find('.v-list').exists()).toBe(false)
  })

  it('exact_name tier renders no badges or group header', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make({ matchType: 'exact_name' })] },
      global: { stubs },
    })
    const text = wrapper.text()
    expect(text).not.toContain('Likely match')
    expect(text).not.toContain('Suggested')
    expect(text).not.toContain('All classes of this type')
    expect(text).toContain('AuthService')
  })
})

describe('ClassPickerResults — fuzzy_name tier', () => {
  it('renders "· Likely match" caption per row', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make({ matchType: 'fuzzy_name', className: 'AuthSvc' })] },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('· Likely match')
    expect(wrapper.text()).toContain('AuthSvc')
  })
})

describe('ClassPickerResults — vector_similarity tier 3-dot meter', () => {
  const filledDotsIn = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.similarity-dot.filled').length

  it('similarityScore=0.95 → "· Suggested" + 3 filled dots', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make({ matchType: 'vector_similarity', similarityScore: 0.95 })] },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('· Suggested')
    expect(filledDotsIn(wrapper)).toBe(3)
  })

  it('similarityScore=0.82 → 2 filled dots', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make({ matchType: 'vector_similarity', similarityScore: 0.82 })] },
      global: { stubs },
    })
    expect(filledDotsIn(wrapper)).toBe(2)
  })

  it('similarityScore=0.71 → 1 filled dot', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make({ matchType: 'vector_similarity', similarityScore: 0.71 })] },
      global: { stubs },
    })
    expect(filledDotsIn(wrapper)).toBe(1)
  })
})

describe('ClassPickerResults — type_match tier', () => {
  const typeMatches: ClassCandidate[] = [
    make({ classId: 'c-z', className: 'Zebra', matchType: 'type_match' }),
    make({ classId: 'c-a', className: 'Alpha', matchType: 'type_match' }),
    make({ classId: 'c-m', className: 'Mike', matchType: 'type_match' }),
  ]

  it('with plain=false → renders group header + alphabetical order', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: typeMatches },
      global: { stubs },
    })
    expect(wrapper.find('.group-header').exists()).toBe(true)
    expect(wrapper.text()).toContain('All classes of this type')
    const titles = wrapper.findAll('.v-list-item-title').map(w => w.text())
    expect(titles[0]).toContain('Alpha')
    expect(titles[1]).toContain('Mike')
    expect(titles[2]).toContain('Zebra')
  })

  it('with plain=true → no group header, rows in input order', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: typeMatches, plain: true },
      global: { stubs },
    })
    expect(wrapper.find('.group-header').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('All classes of this type')
    const titles = wrapper.findAll('.v-list-item-title').map(w => w.text())
    expect(titles[0]).toContain('Zebra')
    expect(titles[1]).toContain('Alpha')
    expect(titles[2]).toContain('Mike')
  })
})

describe('ClassPickerResults — select emit', () => {
  it('emits "select" with the clicked candidate', async () => {
    const candidate = make({ matchType: 'exact_name', className: 'AuthService' })
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [candidate] },
      global: { stubs },
    })
    await wrapper.find('.v-list-item').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual([candidate])
  })
})

describe('ClassPickerResults — boundClassIds "Added" chip', () => {
  it('renders "Added" chip for rows whose classId ∈ boundClassIds', () => {
    const wrapper = mount(ClassPickerResults, {
      props: {
        candidates: [
          make({ classId: 'cls-1', className: 'A' }),
          make({ classId: 'cls-2', className: 'B' }),
        ],
        boundClassIds: ['cls-1'],
      },
      global: { stubs },
    })
    const titles = wrapper.findAll('.v-list-item-title')
    expect(titles[0].find('.added-chip').exists()).toBe(true)
    expect(titles[0].text()).toContain('Added')
    expect(titles[1].find('.added-chip').exists()).toBe(false)
  })

  it('renders no chips when boundClassIds is empty (default)', () => {
    const wrapper = mount(ClassPickerResults, {
      props: { candidates: [make()] },
      global: { stubs },
    })
    expect(wrapper.find('.added-chip').exists()).toBe(false)
  })
})
