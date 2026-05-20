// @vitest-environment happy-dom

/**
 * Coverage focus: the `seedSearch(text)` imperative entry point exposed via
 * `defineExpose`. Used by the host dialogs' "Suggest matches" link to seed
 * the picker's search box from the exposure / countermeasure name +
 * description. The rest of the inline picker (typed-input cascade) is
 * exercised indirectly via the same code paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

interface MockCandidate {
  mitreId: string
  name: string
  description?: string | null
  tactic?: string | null
  kind: string
  matchType: string
  similarityScore: number | null
}

const matchTechniquesMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})
const hydrateCatalogMock = vi.fn<(kind: string) => Promise<void>>(async () => {})

const storeState = {
  matchResults: new Map<string, MockCandidate[]>(),
  catalog: new Map<string, unknown[]>(),
  isCatalogReady: { ATTACK_TECHNIQUE: false, DEFEND_TECHNIQUE: false, ATTACK_MITIGATION: false } as Record<string, boolean>,
  isLoading: {} as Record<string, boolean>,
  vectorAvailable: true as boolean | null,
  vectorDisabledReason: null as string | null,
  matchError: '',
  matchTechniques: matchTechniquesMock,
  hydrateCatalog: hydrateCatalogMock,
}

vi.mock('@/stores/techniqueSuggestionsStore', () => ({
  useTechniqueSuggestionsStore: () => storeState,
}))

const recentRef = ref<unknown[]>([])
vi.mock('@/composables/useRecentTechniques', () => ({
  useRecentTechniques: () => ({ recent: recentRef, push: vi.fn(), clear: vi.fn() }),
}))

import TechniquePickerInline from '../TechniquePickerInline.vue'

const stubs = {
  'v-text-field': {
    template:
      '<div class="v-text-field-wrapper"><input class="v-text-field" :value="modelValue" :disabled="disabled" @focus="$emit(\'focus\')" @blur="$emit(\'blur\')" @keydown="$emit(\'keydown\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
    props: ['modelValue', 'disabled', 'label', 'density', 'hideDetails', 'placeholder', 'prependInnerIcon', 'clearable'],
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
    template: '<div class="v-list-item"><slot name="prepend" /><slot /><slot name="append" /></div>',
  },
  'v-icon': { template: '<i class="v-icon"><slot /></i>' },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot /></div>' },
  'v-list-item-subtitle': { template: '<div class="v-list-item-subtitle"><slot /></div>' },
  'v-divider': { template: '<hr class="v-divider" />' },
  'v-skeleton-loader': { template: '<div class="v-skeleton-loader"></div>' },
  'v-btn': { template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>', emits: ['click'] },
  'v-chip': { template: '<div class="v-chip"><slot /></div>' },
  TechniquePickerResults: { template: '<div class="picker-results"></div>', props: ['candidates', 'kind', 'boundMitreIds', 'emptyHint'] },
}

const baseProps = {
  kind: 'ATTACK_TECHNIQUE' as const,
  selectedMitreIds: [] as string[],
  modelId: 'model-1',
}

beforeEach(() => {
  matchTechniquesMock.mockReset().mockImplementation(async () => {})
  hydrateCatalogMock.mockReset().mockImplementation(async () => {})
  storeState.matchResults = new Map()
  storeState.catalog = new Map()
  storeState.isCatalogReady = { ATTACK_TECHNIQUE: false, DEFEND_TECHNIQUE: false, ATTACK_MITIGATION: false }
  storeState.isLoading = {}
  storeState.vectorAvailable = true
  storeState.vectorDisabledReason = null
  storeState.matchError = ''
  recentRef.value = []
})

afterEach(() => {
  vi.useRealTimers()
})

const mountPicker = (overrides: Partial<typeof baseProps> = {}) =>
  mount(TechniquePickerInline, { props: { ...baseProps, ...overrides }, global: { stubs } })

describe('TechniquePickerInline — seedSearch', () => {
  it('exposes seedSearch via defineExpose', () => {
    const wrapper = mountPicker()
    const exposed = wrapper.vm as unknown as { seedSearch?: (text: string) => Promise<void> }
    expect(typeof exposed.seedSearch).toBe('function')
  })

  it('sets the search query, opens the menu, hydrates the catalog, and fires the vector tier', async () => {
    const seededQuery = 'MTA-STS or DANE not configured for outbound delivery TLS downgrade'
    storeState.matchResults.set(`ATTACK_TECHNIQUE:${seededQuery}`, [
      {
        mitreId: 'T1557.001',
        name: 'LLMNR/NBT-NS Poisoning and SMB Relay',
        kind: 'ATTACK_TECHNIQUE',
        matchType: 'VECTOR_SIMILARITY',
        similarityScore: 0.76,
      },
    ])

    const wrapper = mountPicker()
    const exposed = wrapper.vm as unknown as { seedSearch: (text: string) => Promise<void> }
    await exposed.seedSearch(seededQuery)
    await nextTick()

    // The text field reflects the seeded query.
    const input = wrapper.find('.v-text-field').element as HTMLInputElement
    expect(input.value).toBe(seededQuery)
    // The dropdown is open.
    expect(wrapper.find('.v-menu').exists()).toBe(true)
    // The catalog was hydrated for the picker's kind.
    expect(hydrateCatalogMock).toHaveBeenCalledWith('ATTACK_TECHNIQUE')
    // The vector tier was invoked exactly once with the seeded query +
    // the wider topN budget (description-seeded queries need breadth
    // since the genuinely-relevant technique can rank below 3).
    expect(matchTechniquesMock).toHaveBeenCalledTimes(1)
    expect(matchTechniquesMock).toHaveBeenCalledWith({ kind: 'ATTACK_TECHNIQUE', query: seededQuery, topN: 10 })
  })

  it('idempotent re-click — re-firing with the same text fetches again', async () => {
    const seededQuery = 'phishing email malicious attachment with link to remote payload'
    const wrapper = mountPicker()
    const exposed = wrapper.vm as unknown as { seedSearch: (text: string) => Promise<void> }
    await exposed.seedSearch(seededQuery)
    await nextTick()
    await exposed.seedSearch(seededQuery)
    await nextTick()
    // Two invocations even though searchQuery didn't change between calls —
    // bypassing the watcher is the whole point of the direct fetch.
    expect(matchTechniquesMock).toHaveBeenCalledTimes(2)
  })

  it('no-op when text is empty or whitespace-only', async () => {
    const wrapper = mountPicker()
    const exposed = wrapper.vm as unknown as { seedSearch: (text: string) => Promise<void> }
    await exposed.seedSearch('')
    await exposed.seedSearch('   \n\t  ')
    await nextTick()
    expect(matchTechniquesMock).not.toHaveBeenCalled()
    expect(hydrateCatalogMock).not.toHaveBeenCalled()
  })

  it('no-op when the picker is disabled', async () => {
    const wrapper = mountPicker({ ...baseProps, ...{ disabled: true } } as typeof baseProps & { disabled: true })
    const exposed = wrapper.vm as unknown as { seedSearch: (text: string) => Promise<void> }
    await exposed.seedSearch('some valid query text exceeding the dialog threshold')
    await nextTick()
    expect(matchTechniquesMock).not.toHaveBeenCalled()
  })
})
