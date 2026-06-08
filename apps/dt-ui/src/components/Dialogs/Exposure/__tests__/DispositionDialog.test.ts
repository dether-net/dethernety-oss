// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => ({ disposeExposure: vi.fn(), clearDisposition: vi.fn() }),
}))
vi.mock('@/stores/controlsStore', () => ({
  useControlsStore: () => ({ disposeCountermeasure: vi.fn(), clearCountermeasureDisposition: vi.fn() }),
}))

import DispositionDialog from '../DispositionDialog.vue'

// Stub only v-dialog so its slotted content renders inline (no Vuetify overlay/teleport).
const stubs = {
  'v-dialog': { template: '<div class="v-dialog"><slot /></div>' },
}

const mountDialog = (props: Record<string, unknown>) =>
  mount(DispositionDialog, {
    props: {
      showDialog: true,
      findingId: 'e1',
      findingName: 'Open bucket',
      findingType: 'EXPOSURE',
      ...props,
    },
    global: { stubs },
  })

describe('DispositionDialog — affirm-edit variant (locked AFFIRMED)', () => {
  it('titles "Re-affirm Exposure", shows the locked "Affirmed" line, never "Dispose"', () => {
    const text = mountDialog({ lockKind: true, initialKind: 'AFFIRMED', isStale: false }).text()
    expect(text).toContain('Re-affirm Exposure')
    expect(text).toContain('Affirmed')
    expect(text).not.toContain('Dispose')
  })

  it('stale → titles "Review Exposure"', () => {
    expect(mountDialog({ lockKind: true, initialKind: 'AFFIRMED', isStale: true }).text())
      .toContain('Review Exposure')
  })

  it('normal dispose mode still titles "Dispose Exposure"', () => {
    expect(mountDialog({ lockKind: false, initialKind: null }).text())
      .toContain('Dispose Exposure')
  })
})
