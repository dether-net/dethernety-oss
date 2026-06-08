// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LifecycleBadge from '../LifecycleBadge.vue'
import type { DispositionableFinding } from '@/composables/useFindingDisposition'

const stubs = {
  'v-chip': { template: '<span class="v-chip" v-bind="$attrs"><slot /></span>', inheritAttrs: false },
}

const mountBadge = (item: DispositionableFinding, findingType: 'EXPOSURE' | 'COUNTERMEASURE') =>
  mount(LifecycleBadge, { props: { item, findingType }, global: { stubs } })

describe('LifecycleBadge', () => {
  it('confirmed exposure → "Confirmed risk", filled, risk-toned (never green)', () => {
    const w = mountBadge({ id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: 'auth0|x' }, 'EXPOSURE')
    const chip = w.find('.v-chip')
    expect(chip.exists()).toBe(true)
    expect(w.text()).toContain('Confirmed risk')
    expect(chip.attributes('variant')).toBe('flat')
    expect(chip.attributes('color')).not.toBe('success')
  })

  it('confirmed countermeasure → "In place", filled, green', () => {
    const w = mountBadge({ id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: 'auth0|x' }, 'COUNTERMEASURE')
    expect(w.text()).toContain('In place')
    expect(w.find('.v-chip').attributes('color')).toBe('success')
  })

  it('disposed → outlined kind-label chip', () => {
    const w = mountBadge({ id: 'x', dispositionKind: 'WAIVED' }, 'COUNTERMEASURE')
    expect(w.text()).toContain('Waived')
    expect(w.find('.v-chip').attributes('variant')).toBe('outlined')
  })

  it('pending → renders no chip', () => {
    const w = mountBadge({ id: 'x', createdBy: 'SYSTEM', dispositionKind: null }, 'EXPOSURE')
    expect(w.find('.v-chip').exists()).toBe(false)
  })

  it('unattributed AFFIRMED → renders no chip (forensic guard)', () => {
    const w = mountBadge({ id: 'x', dispositionKind: 'AFFIRMED', dispositionedBy: null }, 'EXPOSURE')
    expect(w.find('.v-chip').exists()).toBe(false)
  })
})
