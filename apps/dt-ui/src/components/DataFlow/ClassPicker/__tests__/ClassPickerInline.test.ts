// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

interface MockCandidate {
  classId: string
  className: string
  classCategory?: string
  moduleName: string
  matchType: string
  confidence: string
  similarityScore?: number
}

const matchClassesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})
const storeState = {
  matchResults: new Map<string, MockCandidate[]>(),
  isLoading: {} as Record<string, boolean>,
  vectorAvailable: null as boolean | null,
  matchError: '',
  listError: '',
  matchClasses: matchClassesMock,
  listClasses: vi.fn(),
  listResults: new Map(),
}

vi.mock('@/stores/classSuggestionsStore', () => ({
  useClassSuggestionsStore: () => storeState,
}))

interface MockRecord {
  classId: string
  className: string
  classCategory?: string
  moduleName?: string
}
const recentRef = ref<MockRecord[]>([])
vi.mock('@/composables/useRecentClasses', () => ({
  useRecentClasses: () => ({ recent: recentRef, push: vi.fn(), clear: vi.fn() }),
}))

import ClassPickerInline from '../ClassPickerInline.vue'

const stubs = {
  'v-text-field': {
    template:
      '<div class="v-text-field-wrapper"><input class="v-text-field" :value="modelValue" :disabled="disabled" @focus="$emit(\'focus\')" @blur="$emit(\'blur\')" @keydown="$emit(\'keydown\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
    props: ['modelValue', 'disabled', 'label', 'density', 'hideDetails'],
    emits: ['focus', 'blur', 'keydown', 'update:modelValue'],
  },
  'v-menu': {
    template: '<div class="v-menu" v-if="modelValue"><slot /></div>',
    props: ['modelValue'],
  },
  'v-list': {
    template: '<div class="v-list" @mousedown="$emit(\'mousedown\')"><slot /></div>',
    emits: ['mousedown'],
  },
  'v-list-item': {
    template: '<div class="v-list-item" @click="$emit(\'click\')"><slot name="prepend" /><slot /><slot name="append" /></div>',
    emits: ['click'],
  },
  'v-icon': { template: '<i class="v-icon"><slot /></i>' },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot /></div>' },
  'v-list-item-subtitle': { template: '<div class="v-list-item-subtitle"><slot /></div>' },
  'v-divider': { template: '<hr class="v-divider" />' },
  'v-skeleton-loader': { template: '<div class="v-skeleton-loader"></div>' },
  'v-btn': {
    template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
    emits: ['click'],
  },
  'v-tooltip': {
    template: '<div class="v-tooltip"><slot name="activator" :props="{}" /></div>',
  },
  'v-chip': { template: '<div class="v-chip"><slot /></div>' },
}

const baseProps = {
  modelValue: null as string | null,
  classLabel: 'COMPONENT' as const,
  componentType: 'PROCESS' as const,
  elementName: 'auth service',
  elementDescription: 'Authenticates incoming requests.',
  modelId: 'model-1',
}

const candidate = (overrides: Partial<MockCandidate> = {}): MockCandidate => ({
  classId: overrides.classId ?? 'cls-1',
  className: overrides.className ?? 'AuthService',
  moduleName: overrides.moduleName ?? 'dethernety-module',
  matchType: overrides.matchType ?? 'exact_name',
  confidence: overrides.confidence ?? 'high',
  ...overrides,
})

beforeEach(() => {
  matchClassesMock.mockReset().mockImplementation(async () => {})
  storeState.matchResults = new Map()
  storeState.isLoading = {}
  storeState.vectorAvailable = null
  storeState.matchError = ''
  storeState.listError = ''
  recentRef.value = []
})

afterEach(() => {
  vi.useRealTimers()
})

const mountPicker = (overrides: Partial<typeof baseProps> = {}) =>
  mount(ClassPickerInline, { props: { ...baseProps, ...overrides }, global: { stubs } })

describe('ClassPickerInline — render', () => {
  it('mount disabled → text-field visible, menu closed', () => {
    const wrapper = mountPicker({ ...baseProps, ...{ disabled: true } } as typeof baseProps & { disabled: true })
    expect(wrapper.find('.v-text-field').exists()).toBe(true)
    expect(wrapper.find('.v-text-field').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.v-menu').exists()).toBe(false)
  })
})

describe('ClassPickerInline — first focus fetches suggestions', () => {
  it('on first focus, fires matchClasses with elementName + topN=6 + fields', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ matchType: 'exact_name' })])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const call = matchClassesMock.mock.calls[0][0] as Record<string, unknown>
    expect(call.classLabel).toBe('COMPONENT')
    expect(call.componentType).toBe('PROCESS')
    expect(call.topN).toBe(6)
    expect(call.fields).toEqual(['description', 'category', 'type'])
    const elements = call.elements as Array<{ name: string; description: string }>
    expect(elements[0].name).toBe('auth service')
    expect(elements[0].description).toBe('Authenticates incoming requests.')
  })
})

describe('ClassPickerInline — empty-state sections', () => {
  it('both sections empty → renders "Type to search" prompt', async () => {
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.empty-prompt').exists()).toBe(true)
    expect(wrapper.text()).toContain('Type to search, or browse all classes.')
    expect(wrapper.find('.recent-header').exists()).toBe(false)
    expect(wrapper.find('.suggested-header').exists()).toBe(false)
  })

  it('only recents → renders Recently-used header + rows, no Suggested header', async () => {
    recentRef.value = [
      { classId: 'r-1', className: 'Postgres', classCategory: 'Persistence', moduleName: 'mod-1' },
      { classId: 'r-2', className: 'AuthSvc', moduleName: 'mod-1' },
    ]
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.recent-header').exists()).toBe(true)
    expect(wrapper.find('.suggested-header').exists()).toBe(false)
    expect(wrapper.text()).toContain('Postgres')
    expect(wrapper.text()).toContain('AuthSvc')
  })

  it('only suggestions → renders Suggested header, no Recently-used header', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ className: 'SuggestedClass', matchType: 'exact_name' })])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.suggested-header').exists()).toBe(true)
    expect(wrapper.find('.recent-header').exists()).toBe(false)
    expect(wrapper.text()).toContain('SuggestedClass')
  })

  it('both sections populated → both headers render', async () => {
    recentRef.value = [{ classId: 'r-1', className: 'Postgres' }]
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ className: 'AuthSvc' })])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.recent-header').exists()).toBe(true)
    expect(wrapper.find('.suggested-header').exists()).toBe(true)
  })
})

describe('ClassPickerInline — debounced typing', () => {
  it('typing "auth" → call fires only after 300ms', async () => {
    vi.useFakeTimers()
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    matchClassesMock.mockClear()
    const input = wrapper.find('.v-text-field')
    await input.setValue('auth')
    expect(matchClassesMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(matchClassesMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const call = matchClassesMock.mock.calls[0][0] as Record<string, unknown>
    const elements = call.elements as Array<{ name: string }>
    expect(elements[0].name).toBe('auth')
    expect(call.topN).toBe(8)
  })

  it('rapid typing → only the latest query lands', async () => {
    vi.useFakeTimers()
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    matchClassesMock.mockClear()
    const input = wrapper.find('.v-text-field')
    await input.setValue('a')
    vi.advanceTimersByTime(100)
    await input.setValue('au')
    vi.advanceTimersByTime(100)
    await input.setValue('aut')
    vi.advanceTimersByTime(100)
    await input.setValue('auth')
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const call = matchClassesMock.mock.calls[0][0] as Record<string, unknown>
    const elements = call.elements as Array<{ name: string }>
    expect(elements[0].name).toBe('auth')
  })
})

describe('ClassPickerInline — commit + sheet emits', () => {
  it('clicking a candidate emits commit-request with classId, no update:modelValue', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ classId: 'cls-x' })])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    const rows = wrapper.findAll('.v-list-item')
    // First row is the suggested candidate (footer "Browse all" is the last row).
    await rows[0].trigger('click')
    expect(wrapper.emitted('commit-request')).toBeTruthy()
    expect(wrapper.emitted('commit-request')![0]).toEqual([{ classId: 'cls-x' }])
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('"Browse all classes →" footer click emits picker:sheet-open', async () => {
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    const footer = wrapper.find('.browse-all-footer')
    expect(footer.exists()).toBe(true)
    await footer.trigger('click')
    const sheetOpenEvents = wrapper.emitted('picker:sheet-open')
    expect(sheetOpenEvents).toBeTruthy()
    expect(sheetOpenEvents![0][0]).toEqual({ search: '' })
  })

  it('picker:sheet-open carries the typed search text', async () => {
    vi.useFakeTimers()
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    const input = wrapper.find<HTMLInputElement>('input.v-text-field')
    await input.setValue('foo')
    vi.advanceTimersByTime(350)
    await nextTick()
    const footer = wrapper.find('.browse-all-footer')
    await footer.trigger('click')
    const events = wrapper.emitted('picker:sheet-open')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ search: 'foo' })
  })
})

describe('ClassPickerInline — loading + error', () => {
  it('isLoading[key] true → renders 3 skeleton loaders, no candidate rows', async () => {
    storeState.isLoading['match:COMPONENT:PROCESS'] = true
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.findAll('.v-skeleton-loader')).toHaveLength(3)
    expect(wrapper.find('.suggested-header').exists()).toBe(false)
  })

  it('matchError set → renders Couldn\'t-load message + Retry button; clicking Retry re-fires matchClasses', async () => {
    storeState.matchError = 'Connection failed'
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(true)
    expect(wrapper.text()).toContain("Couldn't load suggestions.")
    matchClassesMock.mockClear()
    await wrapper.find('.retry-btn').trigger('click')
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
  })

  it('listError set → inline picker does NOT render error (cross-op isolation)', async () => {
    // Inline picker only consumes matchClasses; a stale listError must not
    // poison its error caption. Regression for the bug fixed in this round.
    storeState.listError = 'stale list error'
    storeState.matchError = ''
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(false)
  })
})

describe('ClassPickerInline — vectorAvailable captions', () => {
  it('vectorAvailable=false + description non-empty → vector-unavailable caption', async () => {
    storeState.vectorAvailable = false
    const wrapper = mountPicker({ elementDescription: 'has description' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.vector-unavailable-caption').exists()).toBe(true)
    expect(wrapper.find('.description-empty-caption').exists()).toBe(false)
  })

  it('vectorAvailable=true + description empty → description-empty caption', async () => {
    storeState.vectorAvailable = true
    const wrapper = mountPicker({ elementDescription: '' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.description-empty-caption').exists()).toBe(true)
    expect(wrapper.find('.vector-unavailable-caption').exists()).toBe(false)
  })

  it('vectorAvailable=false + description empty → no caption', async () => {
    storeState.vectorAvailable = false
    const wrapper = mountPicker({ elementDescription: '' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.vector-unavailable-caption').exists()).toBe(false)
    expect(wrapper.find('.description-empty-caption').exists()).toBe(false)
  })

  it('vectorAvailable=null → no captions', async () => {
    storeState.vectorAvailable = null
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.vector-unavailable-caption').exists()).toBe(false)
    expect(wrapper.find('.description-empty-caption').exists()).toBe(false)
  })
})

describe('ClassPickerInline — keyboard navigation', () => {
  it('exact_name tier → focusedIndex starts at 0, ArrowDown advances, Enter commits, Esc closes', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'a', className: 'A', matchType: 'exact_name' }),
      candidate({ classId: 'b', className: 'B', matchType: 'exact_name' }),
      candidate({ classId: 'c', className: 'C', matchType: 'exact_name' }),
    ])
    const wrapper = mountPicker()
    const input = wrapper.find('.v-text-field')
    await input.trigger('focus')
    await nextTick()

    // Initial auto-focus on index 0 (exact_name tier).
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    // Now at index 2 (was 0 → 1 → 2).
    await input.trigger('keydown', { key: 'Enter' })
    const events = wrapper.emitted('commit-request')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([{ classId: 'c' }])
  })

  it('vector_similarity tier → focusedIndex stays null, Enter does not commit', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'v-a', className: 'V-A', matchType: 'vector_similarity', similarityScore: 0.85 }),
      candidate({ classId: 'v-b', className: 'V-B', matchType: 'vector_similarity', similarityScore: 0.75 }),
    ])
    const wrapper = mountPicker()
    const input = wrapper.find('.v-text-field')
    await input.trigger('focus')
    await nextTick()
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit-request')).toBeFalsy()
  })

  it('Escape closes the menu', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate()])
    const wrapper = mountPicker()
    const input = wrapper.find('.v-text-field')
    await input.trigger('focus')
    await nextTick()
    expect(wrapper.find('.v-menu').exists()).toBe(true)
    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(wrapper.find('.v-menu').exists()).toBe(false)
  })

  it('ArrowDown reaches the Browse-all footer and Enter emits picker:sheet-open', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'a', className: 'A', matchType: 'exact_name' }),
    ])
    const wrapper = mountPicker()
    const input = wrapper.find('.v-text-field')
    await input.trigger('focus')
    await nextTick()
    // Auto-focus is on index 0 (exact_name); ArrowDown advances to index 1 = footer sentinel.
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    const events = wrapper.emitted('picker:sheet-open')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ search: '' })
    expect(wrapper.emitted('commit-request')).toBeFalsy()
  })
})

describe('ClassPickerInline — suggestion-fetch + signal-gating', () => {
  it('skips suggestion fetch when elementName < 3 chars and description empty', async () => {
    const wrapper = mountPicker({ elementName: 'ab', elementDescription: '' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(matchClassesMock).not.toHaveBeenCalled()
    expect(wrapper.find('.empty-prompt').exists()).toBe(true)
  })

  it('fetches when elementName >= 3 chars even with empty description', async () => {
    const wrapper = mountPicker({ elementName: 'auth', elementDescription: '' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
  })

  it('suppresses "Suggested for this element" header when tier is pure type_match', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'a', className: 'A', matchType: 'type_match' }),
      candidate({ classId: 'b', className: 'B', matchType: 'type_match' }),
    ])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.suggested-header').exists()).toBe(false)
  })

  it('clears currentResults on commit so re-focus triggers a fresh fetch', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ classId: 'cls-x' })])
    const wrapper = mountPicker()
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const rows = wrapper.findAll('.v-list-item')
    await rows[0].trigger('click')
    // After commit: re-focus should fire a fresh fetch (hasFocusedOnce was reset).
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(2)
  })

  it('hides vector captions during loading and error states', async () => {
    storeState.vectorAvailable = false
    storeState.isLoading['match:COMPONENT:PROCESS'] = true
    const wrapper = mountPicker({ elementDescription: 'has description' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper.find('.vector-unavailable-caption').exists()).toBe(false)

    storeState.isLoading = {}
    storeState.matchError = 'Connection failed'
    const wrapper2 = mountPicker({ elementDescription: 'has description' })
    await wrapper2.find('.v-text-field').trigger('focus')
    await nextTick()
    expect(wrapper2.find('.vector-unavailable-caption').exists()).toBe(false)
  })

  it('description-empty caption uses "get" instead of "unlock"', async () => {
    storeState.vectorAvailable = true
    const wrapper = mountPicker({ elementDescription: '' })
    await wrapper.find('.v-text-field').trigger('focus')
    await nextTick()
    const caption = wrapper.find('.description-empty-caption')
    expect(caption.exists()).toBe(true)
    expect(caption.text()).toContain('get semantic suggestions')
    expect(caption.text()).not.toContain('unlock')
  })
})
