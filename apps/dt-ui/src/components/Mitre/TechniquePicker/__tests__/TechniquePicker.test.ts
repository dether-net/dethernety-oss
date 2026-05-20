// @vitest-environment happy-dom

/**
 * Coverage focus: the TechniquePicker wrapper forwards the imperative
 * `seedSearch(text)` call to its inner TechniquePickerInline ref.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/stores/techniqueSuggestionsStore', () => ({
  useTechniqueSuggestionsStore: () => ({
    catalog: new Map(),
    isCatalogReady: { ATTACK_TECHNIQUE: false, DEFEND_TECHNIQUE: false, ATTACK_MITIGATION: false },
    matchResults: new Map(),
    isLoading: {},
    vectorAvailable: null,
    vectorDisabledReason: null,
    matchError: '',
    matchTechniques: vi.fn(),
    hydrateCatalog: vi.fn(),
  }),
}))

vi.mock('@/composables/useRecentTechniques', () => ({
  useRecentTechniques: () => ({ recent: ref([]), push: vi.fn(), clear: vi.fn() }),
}))

const inlineSeedSpy = vi.fn<(text: string) => Promise<void>>(async () => {})

vi.mock('../TechniquePickerInline.vue', () => ({
  default: {
    name: 'TechniquePickerInline',
    template: '<div class="picker-inline-stub" />',
    props: ['kind', 'selectedMitreIds', 'modelId', 'disabled', 'label'],
    emits: ['commit-request', 'picker:focus', 'picker:blur', 'picker:sheet-open'],
    setup(_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
      expose({ seedSearch: inlineSeedSpy })
      return {}
    },
  },
}))

vi.mock('../TechniquePickerChips.vue', () => ({
  default: { name: 'TechniquePickerChips', template: '<div />', props: ['mitreIds', 'kind', 'nameById', 'disabled'] },
}))

vi.mock('../TechniquePickerSheet.vue', () => ({
  default: {
    name: 'TechniquePickerSheet',
    template: '<div />',
    props: ['modelValue', 'kind', 'initialSearch', 'selectedMitreIds'],
    emits: ['update:modelValue', 'commit-request'],
  },
}))

import TechniquePicker from '../TechniquePicker.vue'

const baseProps = {
  modelValue: [] as string[],
  kind: 'ATTACK_TECHNIQUE' as const,
  modelId: 'model-1',
}

beforeEach(() => {
  inlineSeedSpy.mockReset().mockImplementation(async () => {})
})

describe('TechniquePicker — seedSearch wrapper', () => {
  it('exposes seedSearch via defineExpose', () => {
    const wrapper = mount(TechniquePicker, { props: baseProps })
    const exposed = wrapper.vm as unknown as { seedSearch?: (text: string) => Promise<void> }
    expect(typeof exposed.seedSearch).toBe('function')
  })

  it('forwards seedSearch(text) to the inner TechniquePickerInline ref', async () => {
    const wrapper = mount(TechniquePicker, { props: baseProps })
    const exposed = wrapper.vm as unknown as { seedSearch: (text: string) => Promise<void> }
    await exposed.seedSearch('phishing email with malicious attachment')
    expect(inlineSeedSpy).toHaveBeenCalledTimes(1)
    expect(inlineSeedSpy).toHaveBeenCalledWith('phishing email with malicious attachment')
  })
})
