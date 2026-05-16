// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

interface MockCandidate {
  classId: string
  className: string
  classCategory?: string
  classDescription?: string
  classType?: string
  moduleId: string
  moduleName: string
  matchType: string
  confidence: string
  similarityScore?: number
}

interface MockListResult {
  items: MockCandidate[]
  totalCount: number
  facetCounts: {
    categories: Array<{ value: string; count: number }>
    modules: Array<{ moduleId: string; moduleName: string; count: number }>
    types: Array<{ value: string; count: number }>
  }
}

const matchClassesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})
const listClassesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})

const storeState = {
  matchResults: new Map<string, MockCandidate[]>(),
  listResults: new Map<string, MockListResult>(),
  isLoading: {} as Record<string, boolean>,
  vectorAvailable: null as boolean | null,
  matchError: '',
  listError: '',
  matchClasses: matchClassesMock,
  listClasses: listClassesMock,
}

vi.mock('@/stores/classSuggestionsStore', () => ({
  useClassSuggestionsStore: () => storeState,
}))

import ClassPickerSheet from '../ClassPickerSheet.vue'

const stubs = {
  // Render Teleport's slot inline so wrapper.find/findAll can see the drawer's
  // content. Production behaviour hoists to document.body (so the drawer
  // overlays the viewport regardless of ancestor overflow contexts).
  teleport: true,
  'v-navigation-drawer': {
    template:
      '<div v-if="modelValue" class="v-navigation-drawer" :data-width="width"><slot /></div>',
    props: ['modelValue', 'location', 'temporary', 'width'],
    emits: ['update:modelValue'],
  },
  'v-text-field': {
    template:
      '<div class="v-text-field-wrapper"><input class="v-text-field" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
    props: ['modelValue', 'label', 'density', 'hideDetails', 'clearable', 'prependInnerIcon'],
    emits: ['update:modelValue'],
  },
  'v-divider': { template: '<hr class="v-divider" />' },
  'v-skeleton-loader': { template: '<div class="v-skeleton-loader"></div>' },
  'v-btn': {
    template:
      '<button class="v-btn" :class="$attrs.class" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ['disabled', 'color', 'variant', 'size', 'icon'],
    emits: ['click'],
  },
  'v-chip-group': { template: '<div class="v-chip-group"><slot /></div>' },
  'v-chip': {
    template: '<div class="v-chip" @click="$emit(\'click\')"><slot /></div>',
    emits: ['click'],
  },
  'v-list-item': {
    template:
      '<div class="v-list-item" :class="$attrs.class" @click="$emit(\'click\')"><slot name="prepend" /><slot /><slot name="append" /></div>',
    emits: ['click'],
  },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot /></div>' },
  'v-list-item-subtitle': { template: '<div class="v-list-item-subtitle"><slot /></div>' },
  'v-list': { template: '<div class="v-list"><slot /></div>' },
  'v-virtual-scroll': {
    name: 'VVirtualScroll',
    template:
      '<div class="v-virtual-scroll"><template v-for="(item, index) in items" :key="index"><slot :item="item" :index="index" /></template></div>',
    props: ['items', 'height', 'itemHeight'],
    emits: ['update:end'],
  },
  'v-card': { template: '<div class="v-card"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
  'v-icon': { template: '<i class="v-icon"><slot /></i>' },
  'v-tooltip': {
    template:
      '<div class="v-tooltip"><span class="v-tooltip-text" v-if="!disabled">{{ text }}</span><slot name="activator" :props="{}" /></div>',
    props: ['disabled', 'location', 'text'],
  },
}

const baseProps = {
  modelValue: true,
  classLabel: 'COMPONENT' as const,
  componentType: 'PROCESS' as const,
  currentClassId: null as string | null,
  initialSearch: '',
}

const candidate = (overrides: Partial<MockCandidate> = {}): MockCandidate => ({
  classId: overrides.classId ?? 'cls-1',
  className: overrides.className ?? 'PostgreSQL Persistence Store',
  moduleId: overrides.moduleId ?? 'mod-1',
  moduleName: overrides.moduleName ?? 'dethernety-module',
  matchType: overrides.matchType ?? 'exact_name',
  confidence: overrides.confidence ?? 'high',
  classCategory: overrides.classCategory ?? 'Persistence',
  ...overrides,
})

const sampleFacetCounts = {
  categories: [
    { value: 'Persistence', count: 47 },
    { value: 'Networking', count: 12 },
  ],
  modules: [
    { moduleId: 'mod-1', moduleName: 'dethernety-module', count: 50 },
    { moduleId: 'mod-2', moduleName: 'extras-module', count: 10 },
  ],
  types: [
    { value: 'STORE', count: 30 },
    { value: 'PROCESS', count: 25 },
  ],
}

const sampleListResult = (items: MockCandidate[], total = items.length): MockListResult => ({
  items,
  totalCount: total,
  facetCounts: sampleFacetCounts,
})

beforeEach(() => {
  matchClassesMock.mockReset().mockImplementation(async () => {})
  listClassesMock.mockReset().mockImplementation(async () => {})
  storeState.matchResults = new Map()
  storeState.listResults = new Map()
  storeState.isLoading = {}
  storeState.vectorAvailable = null
  storeState.matchError = ''
  storeState.listError = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ClassPickerSheet — drawer visibility', () => {
  it('does not render content when modelValue = false', () => {
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, modelValue: false },
      global: { stubs },
    })
    expect(wrapper.find('.v-navigation-drawer').exists()).toBe(false)
  })
})

describe('ClassPickerSheet — open: initial fetch', () => {
  it('fires listClasses on open with empty initialSearch', async () => {
    mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    expect(listClassesMock).toHaveBeenCalledTimes(1)
    const call = listClassesMock.mock.calls[0][0]
    expect(call.classLabel).toBe('COMPONENT')
    expect(call.componentType).toBe('PROCESS')
    expect(call.offset).toBe(0)
    expect(call.limit).toBe(50)
    expect(matchClassesMock).not.toHaveBeenCalled()
  })

  it('switches to search mode on open when initialSearch is set', async () => {
    mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()
    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const call = matchClassesMock.mock.calls[0][0]
    expect(call.topN).toBe(25)
    expect((call.elements as Array<{ name: string }>)[0].name).toBe('auth')
    // listClasses still fires to keep facet counts current.
    expect(listClassesMock).toHaveBeenCalledTimes(1)
  })
})

describe('ClassPickerSheet — search threshold', () => {
  it('stays in browse mode for 1-character query', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    listClassesMock.mockClear()
    matchClassesMock.mockClear()

    const input = wrapper.find('input.v-text-field')
    await input.setValue('a')
    vi.advanceTimersByTime(250)
    await nextTick()

    expect(matchClassesMock).not.toHaveBeenCalled()
    expect(listClassesMock).toHaveBeenCalled()
  })

  it('switches to search mode at 2 characters', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    listClassesMock.mockClear()
    matchClassesMock.mockClear()

    const input = wrapper.find('input.v-text-field')
    await input.setValue('au')
    vi.advanceTimersByTime(250)
    await nextTick()

    expect(matchClassesMock).toHaveBeenCalledTimes(1)
    const call = matchClassesMock.mock.calls[0][0]
    expect(call.topN).toBe(25)
    expect((call.elements as Array<{ name: string }>)[0].name).toBe('au')
  })
})

describe('ClassPickerSheet — facet interactions', () => {
  it('debounces listClasses on category facet click', async () => {
    vi.useFakeTimers()
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    listClassesMock.mockClear()

    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    await categoryChips[0].trigger('click')
    vi.advanceTimersByTime(150)
    expect(listClassesMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    await nextTick()
    expect(listClassesMock).toHaveBeenCalledTimes(1)
    const call = listClassesMock.mock.calls[0][0]
    expect(call.categories).toEqual(['Persistence'])
  })

  it('passes multiple categories when more chips are clicked', async () => {
    vi.useFakeTimers()
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()

    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    await categoryChips[0].trigger('click')
    await categoryChips[1].trigger('click')
    vi.advanceTimersByTime(250)
    await nextTick()

    const lastCall = listClassesMock.mock.calls[listClassesMock.mock.calls.length - 1][0]
    expect(lastCall.categories).toEqual(['Persistence', 'Networking'])
  })

  it('passes moduleIds when module chips are clicked', async () => {
    vi.useFakeTimers()
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    listClassesMock.mockClear()

    const moduleChips = wrapper.find('.facet-group--module').findAll('.v-chip')
    await moduleChips[0].trigger('click')
    vi.advanceTimersByTime(250)
    await nextTick()

    const call = listClassesMock.mock.calls[0][0]
    expect(call.moduleIds).toEqual(['mod-1'])
  })

  it('locks componentType to the node context — no Type facet rendered, fetch carries the prop value', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    // Type facet is never exposed — the type is fixed by the node (componentType prop).
    expect(wrapper.find('.facet-group--type').exists()).toBe(false)
    // The very first listClasses call carries the locked componentType.
    const firstCall = listClassesMock.mock.calls[0][0]
    expect(firstCall.componentType).toBe('PROCESS')
  })

  it('Type facet stays hidden for DATA_FLOW classLabel (and componentType is not forwarded)', async () => {
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, classLabel: 'DATA_FLOW', componentType: null },
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.facet-group--type').exists()).toBe(false)
    const firstCall = listClassesMock.mock.calls[0][0]
    expect(firstCall.componentType).toBeUndefined()
  })
})

describe('ClassPickerSheet — pagination', () => {
  it('fires next-page listClasses when near-bottom scroll fires', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => candidate({ classId: `c-${i}`, className: `Item ${i}` }))
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult(page1, 120))
    listClassesMock.mockImplementation(async () => {
      // Subsequent calls should NOT overwrite for this test; just observe args.
    })

    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    listClassesMock.mockClear()

    const vScroll = wrapper.findComponent({ name: 'VVirtualScroll' })
    vScroll.vm.$emit('update:end', 49)
    await nextTick()

    expect(listClassesMock).toHaveBeenCalledTimes(1)
    const call = listClassesMock.mock.calls[0][0]
    expect(call.offset).toBe(50)
    expect(call.limit).toBe(50)
  })
})

describe('ClassPickerSheet — select / commit', () => {
  it('clicking a browse row focuses it; Select emits commit-request', async () => {
    const items = [candidate({ classId: 'a' }), candidate({ classId: 'b', className: 'Beta' })]
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult(items))

    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()

    const rows = wrapper.findAll('.browse-row')
    expect(rows.length).toBeGreaterThan(0)
    await rows[1].trigger('click')
    const selectBtn = wrapper.find('button.select-btn')
    await selectBtn.trigger('click')

    expect(wrapper.emitted('commit-request')).toBeTruthy()
    expect(wrapper.emitted('commit-request')![0][0]).toEqual({ classId: 'b' })
  })

  it('Select disabled when no row focused', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([]))

    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    const selectBtn = wrapper.find('button.select-btn')
    expect(selectBtn.attributes('disabled')).toBeDefined()
  })

  it('Select disabled when focused row equals currentClassId', async () => {
    const items = [candidate({ classId: 'a' })]
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult(items))

    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, currentClassId: 'a' },
      global: { stubs },
    })
    await nextTick()
    const selectBtn = wrapper.find('button.select-btn')
    expect(selectBtn.attributes('disabled')).toBeDefined()
  })
})

describe('ClassPickerSheet — keyboard nav', () => {
  it('Esc emits update:modelValue=false', async () => {
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    await wrapper.find('.sheet-root').trigger('keydown', { key: 'Escape' })
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0][0]).toBe(false)
  })

  it('document-level Esc closes the sheet (covers focus-not-in-sheet case)', async () => {
    // Production trigger: Escape from anywhere on the page (e.g., user opened
    // the sheet but didn't click inside it, so focus is on the launcher button).
    // The .sheet-root @keydown can't see this; the document listener does.
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![events!.length - 1][0]).toBe(false)
    wrapper.unmount()
  })

  it('document-level Esc stops propagation so outer dialog Esc handlers do not also fire', async () => {
    // Production case: sheet rendered inside a v-dialog (DataDialog,
    // ControlDialog). Without stopPropagation, one Esc keypress would close
    // both the sheet AND the host dialog.
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    const outerHandler = vi.fn()
    document.addEventListener('keydown', outerHandler)  // bubble-phase listener (like v-dialog's)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(outerHandler).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outerHandler)
    wrapper.unmount()
  })

  it('document-level Esc listener is removed when sheet closes', async () => {
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    await wrapper.setProps({ modelValue: false })
    await nextTick()
    // After close, an Escape on the document should NOT cause another
    // update:modelValue emission. Capture the count beforehand.
    const before = wrapper.emitted('update:modelValue')?.length ?? 0
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    const after = wrapper.emitted('update:modelValue')?.length ?? 0
    expect(after).toBe(before)
    wrapper.unmount()
  })

  it('ArrowDown wraps from last to first', async () => {
    const items = [candidate({ classId: 'a' }), candidate({ classId: 'b' })]
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult(items))

    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    // initial focusedIndex = 0
    const root = wrapper.find('.sheet-root')
    await root.trigger('keydown', { key: 'ArrowDown' })
    await root.trigger('keydown', { key: 'ArrowDown' })
    // 0 -> 1 -> 0 (wrap)
    await root.trigger('keydown', { key: 'Enter' })

    const events = wrapper.emitted('commit-request')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({ classId: 'a' })
  })

  it('Cancel button emits update:modelValue=false', async () => {
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    await wrapper.find('button.cancel-btn').trigger('click')
    const events = wrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0][0]).toBe(false)
  })
})

describe('ClassPickerSheet — UX review fixes', () => {
  it('renders mode pill "Browsing catalogue" in browse mode', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    expect(wrapper.find('.mode-pill').text()).toBe('Browsing catalogue')
  })

  it('renders mode pill "Ranked by relevance" in search mode', async () => {
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.mode-pill').text()).toBe('Ranked by relevance')
  })

  it('Select tooltip surfaces "Choose a row first" reason when nothing focused', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([]))
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    expect(wrapper.html()).toContain('Choose a row first')
  })

  it('search mode: filters candidates by moduleId; two modules with the same moduleName remain independently filterable', async () => {
    // Defensive case: module names are expected to be unique in production,
    // but the filter is by id so a same-name fixture shouldn't collide.
    const items = [
      candidate({ classId: 'a', className: 'AlphaClass', moduleId: 'mod-a', moduleName: 'shared-name' }),
      candidate({ classId: 'b', className: 'BetaClass', moduleId: 'mod-b', moduleName: 'shared-name' }),
    ]
    storeState.matchResults.set('COMPONENT:PROCESS', items)
    // facetCounts drives chip rendering; expose both modules with distinct ids
    // but a shared moduleName.
    storeState.listResults.set('COMPONENT:PROCESS', {
      items: [],
      totalCount: 0,
      facetCounts: {
        categories: [],
        modules: [
          { moduleId: 'mod-a', moduleName: 'shared-name', count: 1 },
          { moduleId: 'mod-b', moduleName: 'shared-name', count: 1 },
        ],
        types: [],
      },
    })

    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()

    // Search-mode rows render via ClassPickerResults (not the browse virtual-scroll).
    const searchRowsBefore = wrapper.findAll('.class-picker-results .v-list-item')
    expect(searchRowsBefore.length).toBe(2)
    expect(searchRowsBefore[0].text()).toContain('AlphaClass')
    expect(searchRowsBefore[1].text()).toContain('BetaClass')

    // Click the first module chip (mod-a).
    const moduleChips = wrapper.find('.facet-group--module').findAll('.v-chip')
    await moduleChips[0].trigger('click')
    await nextTick()

    // Only candidate 'a' (moduleId 'mod-a') remains — the same-named 'mod-b' is filtered out.
    const rowsAfter = wrapper.findAll('.class-picker-results .v-list-item')
    expect(rowsAfter.length).toBe(1)
    expect(rowsAfter[0].text()).toContain('AlphaClass')
    expect(rowsAfter[0].text()).not.toContain('BetaClass')
  })

  it('clamps focusedIndex when currentRows shrinks below it', async () => {
    const items = [
      candidate({ classId: 'a', classCategory: 'Persistence' }),
      candidate({ classId: 'b', classCategory: 'Networking' }),
      candidate({ classId: 'c', classCategory: 'Persistence' }),
    ]
    storeState.matchResults.set('COMPONENT:PROCESS', items)
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult(items))

    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()
    // Click last row (index 2: 'c')
    const rows = wrapper.findAll('.v-list-item')
    await rows[rows.length - 1].trigger('click')
    await nextTick()

    // Apply a category filter that narrows visible rows to 1 (only 'b' is Networking).
    const categoryChips = wrapper.find('.facet-group--category').findAll('.v-chip')
    await categoryChips[1].trigger('click') // 'Networking'
    await nextTick()

    // Select button should remain enabled (focusedIndex clamped to last valid index = 0).
    const selectBtn = wrapper.find('button.select-btn')
    expect(selectBtn.attributes('disabled')).toBeUndefined()
  })
})

describe('ClassPickerSheet — error state', () => {
  it('shows retry block in browse mode when store.listError is set', async () => {
    // baseProps has initialSearch === '' → browse mode → listError drives.
    storeState.listError = 'Connection failed'
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(true)
    expect(wrapper.text()).toContain("Couldn't load classes.")
  })

  it('shows retry block in search mode when store.matchError is set', async () => {
    storeState.matchError = 'Connection failed'
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(true)
    expect(wrapper.text()).toContain("Couldn't load classes.")
  })

  it('browse mode ignores matchError (cross-op isolation)', async () => {
    // Regression for the bug fixed by per-op error slots: a stale matchError
    // must NOT render in browse mode, even if it's set.
    storeState.matchError = 'stale match error'
    storeState.listError = ''
    const wrapper = mount(ClassPickerSheet, { props: baseProps, global: { stubs } })
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(false)
  })

  it('search mode ignores listError (cross-op isolation)', async () => {
    storeState.listError = 'stale list error'
    storeState.matchError = ''
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth' },
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.error-row').exists()).toBe(false)
  })
})

describe('ClassPickerSheet — boundClassIds "Added" chip', () => {
  it('renders "Added" chip in browse mode for rows whose classId ∈ boundClassIds', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([
      candidate({ classId: 'cls-1', className: 'A' }),
      candidate({ classId: 'cls-2', className: 'B' }),
    ]))
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, boundClassIds: ['cls-1'] },
      global: { stubs },
    })
    await nextTick()
    const rows = wrapper.findAll('.browse-row')
    expect(rows.length).toBe(2)
    expect(rows[0].find('.added-chip').exists()).toBe(true)
    expect(rows[0].text()).toContain('Added')
    expect(rows[1].find('.added-chip').exists()).toBe(false)
  })

  it('forwards boundClassIds to ClassPickerResults in search mode', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'cls-1', className: 'A' }),
    ])
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, initialSearch: 'auth', boundClassIds: ['cls-1'] },
      global: {
        stubs: {
          ...stubs,
          ClassPickerResults: {
            template: '<div class="ClassPickerResults-stub" :data-bound="JSON.stringify(boundClassIds)" />',
            props: ['candidates', 'boundClassIds'],
          },
        },
      },
    })
    await nextTick()
    const stub = wrapper.find('.ClassPickerResults-stub')
    expect(stub.exists()).toBe(true)
    expect(JSON.parse(stub.attributes('data-bound') ?? '[]')).toEqual(['cls-1'])
  })

  it('defaults boundClassIds to [] when prop is not provided — no chips rendered', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([
      candidate({ classId: 'cls-1' }),
    ]))
    const wrapper = mount(ClassPickerSheet, {
      props: baseProps,
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.added-chip').exists()).toBe(false)
  })

  it('shows multi-bind caption in action footer when boundClassIds.length > 0', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, boundClassIds: ['cls-1'] },
      global: { stubs },
    })
    await nextTick()
    const hint = wrapper.find('.multi-bind-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('Adding multiple')
  })

  it('hides multi-bind caption when boundClassIds is empty (single-bind sheet)', async () => {
    storeState.listResults.set('COMPONENT:PROCESS', sampleListResult([candidate()]))
    const wrapper = mount(ClassPickerSheet, {
      props: { ...baseProps, boundClassIds: [] },
      global: { stubs },
    })
    await nextTick()
    expect(wrapper.find('.multi-bind-hint').exists()).toBe(false)
  })
})
