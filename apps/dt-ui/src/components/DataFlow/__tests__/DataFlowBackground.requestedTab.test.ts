// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'

// DataFlowBackground relays an editor link's settings tab: requestedTab goes down to the settings window, and the
// window's requested-tab-applied comes back up to DataFlow, which then clears the request. A lost emit would leave the
// request set and force that tab on every later selection.

const { SettingsWindowStub } = vi.hoisted(() => ({
  SettingsWindowStub: {
    name: 'SettingsWindow',
    props: ['freshlyCreatedId', 'requestedTab'],
    emits: ['requested-tab-applied'],
    template: '<div class="settings-window-stub" />',
  },
}))

vi.mock('@/stores/flowStore', () => ({ useFlowStore: () => reactive({ selectedItem: null, defaultBoundaryId: 'root' }) }))
vi.mock('@/stores/analysisStore', () => ({ useAnalysisStore: () => reactive({ analyses: [], fetchAnalyses: vi.fn() }) }))
vi.mock('@vue-flow/background', () => ({ Background: { name: 'Background', template: '<div />' } }))
vi.mock('@/components/DataFlow/SettingsWindow.vue', () => ({ default: SettingsWindowStub }))
vi.mock('@/components/DataFlow/PaletteWindow.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/DataFlow/BoundaryZoning/BoundaryZoningOverview.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/Dialogs/Analysis/ModelAnalysisDialog.vue', () => ({ default: { template: '<div />' } }))

import DataFlowBackground from '../DataFlowBackground.vue'

const mountBackground = (requestedTab: string | null) =>
  mount(DataFlowBackground, {
    props: { openSettings: true, modelName: 'Model', modelId: 'm1', freshlyCreatedId: null, requestedTab: requestedTab as any },
    shallow: true,
    global: {
      stubs: {
        // the settings window sits inside the expansion panel's content: render the panel's slots
        VExpansionPanels: { template: '<div><slot /></div>' },
        VExpansionPanel: { template: '<div><slot /></div>' },
        VExpansionPanelTitle: { template: '<div><slot /></div>' },
        VExpansionPanelText: { template: '<div><slot /></div>' },
        VExpandTransition: { template: '<div><slot /></div>' },
        VContainer: { template: '<div><slot /></div>' },
        SettingsWindow: SettingsWindowStub,
      },
    },
  })

describe('DataFlowBackground — the requested settings tab', () => {
  it('passes requestedTab down to the settings window', () => {
    const w = mountBackground('exposures')
    expect(w.findComponent(SettingsWindowStub).props('requestedTab')).toBe('exposures')
  })

  it('passes no request down when there is none', () => {
    const w = mountBackground(null)
    expect(w.findComponent(SettingsWindowStub).props('requestedTab')).toBeNull()
  })

  it('relays requested-tab-applied from the settings window back up', async () => {
    const w = mountBackground('attributes')
    await w.findComponent(SettingsWindowStub).vm.$emit('requested-tab-applied')
    expect(w.emitted('requested-tab-applied')).toHaveLength(1)
  })
})
