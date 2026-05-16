// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

interface MockCandidate {
  classId: string
  className: string
  classCategory?: string
  moduleName: string
  matchType: string
  confidence: string
}

const matchClassesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})
const listClassesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})

const storeState = {
  matchResults: new Map<string, MockCandidate[]>(),
  listResults: new Map<string, { items: MockCandidate[]; totalCount: number; facetCounts: { categories: []; modules: []; types: [] } }>(),
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

const pushMock = vi.fn()
const recentRef = ref<unknown[]>([])
vi.mock('@/composables/useRecentClasses', () => ({
  useRecentClasses: () => ({ recent: recentRef, push: pushMock, clear: vi.fn() }),
}))

import ClassPicker from '../ClassPicker.vue'

const stubs = {
  ClassPickerInline: {
    name: 'ClassPickerInline',
    template:
      '<div class="ClassPickerInline-stub">'
      + '<button class="stub-inline-commit" @click="$emit(\'commit-request\', { classId: \'cls-inline\' })">commit</button>'
      + '<button class="stub-inline-focus" @click="$emit(\'picker:focus\')">focus</button>'
      + '<button class="stub-inline-blur" @click="$emit(\'picker:blur\')">blur</button>'
      + '<button class="stub-inline-sheet-empty" @click="$emit(\'picker:sheet-open\', { search: \'\' })">open-empty</button>'
      + '<button class="stub-inline-sheet-typed" @click="$emit(\'picker:sheet-open\', { search: \'auth\' })">open-typed</button>'
      + '</div>',
    props: ['modelValue', 'classLabel', 'componentType', 'elementName', 'elementDescription', 'modelId', 'disabled', 'label'],
    emits: ['commit-request', 'picker:focus', 'picker:blur', 'picker:sheet-open'],
  },
  ClassPickerSheet: {
    name: 'ClassPickerSheet',
    template:
      '<div v-if="modelValue" class="ClassPickerSheet-stub" :data-initial-search="initialSearch">'
      + '<button class="stub-sheet-commit" @click="$emit(\'commit-request\', { classId: \'cls-sheet\' })">commit</button>'
      + '<button class="stub-sheet-close" @click="$emit(\'update:modelValue\', false)">close</button>'
      + '</div>',
    props: ['modelValue', 'classLabel', 'componentType', 'currentClassId', 'initialSearch'],
    emits: ['commit-request', 'update:modelValue'],
  },
  'v-tooltip': {
    template: '<div class="v-tooltip"><span class="v-tooltip-text">{{ text }}</span><slot name="activator" :props="{}" /></div>',
    props: ['location', 'text'],
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
  currentClassName: null as string | null,
}

const candidate = (overrides: Partial<MockCandidate> = {}): MockCandidate => ({
  classId: overrides.classId ?? 'cls-1',
  className: overrides.className ?? 'AuthService',
  moduleName: overrides.moduleName ?? 'dethernety-module',
  matchType: overrides.matchType ?? 'exact_name',
  confidence: overrides.confidence ?? 'high',
  classCategory: overrides.classCategory ?? 'Security',
  ...overrides,
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
  pushMock.mockReset()
  recentRef.value = []
})

describe('ClassPicker — initial render', () => {
  it('renders inline; sheet hidden', () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    expect(wrapper.find('.ClassPickerInline-stub').exists()).toBe(true)
    expect(wrapper.find('.ClassPickerSheet-stub').exists()).toBe(false)
  })

  it('does not render current-class-row when modelValue is null', () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    expect(wrapper.find('.current-class-row').exists()).toBe(false)
  })
})

describe('ClassPicker — sheet open / close', () => {
  it('opens sheet with empty initialSearch when inline emits picker:sheet-open with empty search', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-sheet-empty').trigger('click')
    await nextTick()
    expect(wrapper.find('.ClassPickerSheet-stub').exists()).toBe(true)
    expect(wrapper.find('.ClassPickerSheet-stub').attributes('data-initial-search')).toBe('')
    expect(wrapper.emitted('picker:sheet-open')).toBeTruthy()
  })

  it('opens sheet with typed initialSearch payload forwarded', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-sheet-typed').trigger('click')
    await nextTick()
    expect(wrapper.find('.ClassPickerSheet-stub').attributes('data-initial-search')).toBe('auth')
  })

  it('closes sheet when sheet emits update:modelValue=false; emits picker:sheet-close', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-sheet-empty').trigger('click')
    await nextTick()
    await wrapper.find('.stub-sheet-close').trigger('click')
    await nextTick()
    expect(wrapper.find('.ClassPickerSheet-stub').exists()).toBe(false)
    expect(wrapper.emitted('picker:sheet-close')).toBeTruthy()
  })
})

describe('ClassPicker — commit-request forwarding', () => {
  it('forwards inline commit-request to parent', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-commit').trigger('click')
    expect(wrapper.emitted('commit-request')).toBeTruthy()
    expect(wrapper.emitted('commit-request')![0][0]).toEqual({ classId: 'cls-inline' })
  })

  it('forwards sheet commit-request to parent', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-sheet-empty').trigger('click')
    await nextTick()
    await wrapper.find('.stub-sheet-commit').trigger('click')
    expect(wrapper.emitted('commit-request')).toBeTruthy()
    expect(wrapper.emitted('commit-request')![0][0]).toEqual({ classId: 'cls-sheet' })
  })

  it('auto-closes the sheet on sheet commit-request (single-bind close-on-commit)', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-sheet-empty').trigger('click')
    await nextTick()
    expect(wrapper.find('.ClassPickerSheet-stub').exists()).toBe(true)
    await wrapper.find('.stub-sheet-commit').trigger('click')
    await nextTick()
    expect(wrapper.find('.ClassPickerSheet-stub').exists()).toBe(false)
    expect(wrapper.emitted('picker:sheet-close')).toBeTruthy()
  })

  it('forwards inline picker:focus and picker:blur to parent', async () => {
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.find('.stub-inline-focus').trigger('click')
    await wrapper.find('.stub-inline-blur').trigger('click')
    expect(wrapper.emitted('picker:focus')).toBeTruthy()
    expect(wrapper.emitted('picker:blur')).toBeTruthy()
  })
})

describe('ClassPicker — recents push on commit (modelValue transition)', () => {
  it('pushes full candidate when transitioning null → "cls-1" with candidate in matchResults', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ classId: 'cls-1', className: 'AuthService', classCategory: 'Identity' })])
    const wrapper = mount(ClassPicker, { props: baseProps, global: { stubs } })
    await wrapper.setProps({ modelValue: 'cls-1' })
    await nextTick()
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith({
      classId: 'cls-1',
      className: 'AuthService',
      classCategory: 'Identity',
      moduleName: 'dethernety-module',
    })
  })

  it('does not push when modelValue transitions to null', async () => {
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, modelValue: 'cls-1' },
      global: { stubs },
    })
    await wrapper.setProps({ modelValue: null })
    await nextTick()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('pushes a new candidate when transitioning between two non-null ids', async () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [
      candidate({ classId: 'cls-1', className: 'A' }),
      candidate({ classId: 'cls-2', className: 'B', classCategory: 'Networking' }),
    ])
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, modelValue: 'cls-1' },
      global: { stubs },
    })
    await wrapper.setProps({ modelValue: 'cls-2' })
    await nextTick()
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({ classId: 'cls-2', className: 'B', classCategory: 'Networking' }))
  })

  it('fallback push uses currentClassName when candidate not found in store but name resolved', async () => {
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, currentClassName: 'KnownName' },
      global: { stubs },
    })
    await wrapper.setProps({ modelValue: 'cls-unknown' })
    await nextTick()
    expect(pushMock).toHaveBeenCalledWith({ classId: 'cls-unknown', className: 'KnownName' })
  })

  it('skips push when candidate not found and currentClassName is null (avoids polluting recents)', async () => {
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, currentClassName: null },
      global: { stubs },
    })
    await wrapper.setProps({ modelValue: 'cls-unknown' })
    await nextTick()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('does not push on initial mount', () => {
    storeState.matchResults.set('COMPONENT:PROCESS', [candidate({ classId: 'cls-1' })])
    mount(ClassPicker, {
      props: { ...baseProps, modelValue: 'cls-1' },
      global: { stubs },
    })
    expect(pushMock).not.toHaveBeenCalled()
  })
})

describe('ClassPicker — current class display + orphan signalling', () => {
  it('renders the ClassPreview card (not the orphan row) when modelValue + currentClassName both set', () => {
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, modelValue: 'cls-1', currentClassName: 'AuthService' },
      global: { stubs },
    })
    // The orphan-only row is hidden when the class resolves; the class name
    // lives in the ClassPreview card's header instead.
    expect(wrapper.find('.current-class-row').exists()).toBe(false)
    expect(wrapper.find('.current-class-preview').exists()).toBe(true)
    expect(wrapper.html()).toContain('AuthService')
    expect(wrapper.find('.retired-chip').exists()).toBe(false)
  })

  it('renders retired chip when modelValue set but currentClassName missing', () => {
    const wrapper = mount(ClassPicker, {
      props: { ...baseProps, modelValue: 'cls-orphan', currentClassName: null },
      global: { stubs },
    })
    expect(wrapper.find('.retired-chip').exists()).toBe(true)
    expect(wrapper.html()).toContain('Unknown class')
    expect(wrapper.html()).toContain('This class is no longer provided by any installed module')
    // ClassPreview only renders for resolved classes.
    expect(wrapper.find('.current-class-preview').exists()).toBe(false)
  })
})
