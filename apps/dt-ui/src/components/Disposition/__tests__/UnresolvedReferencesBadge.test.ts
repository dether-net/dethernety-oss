// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UnresolvedReferencesBadge from '../UnresolvedReferencesBadge.vue'

const stubs = {
  'v-tooltip': {
    template: '<div class="v-tooltip"><slot name="activator" :props="{}" /><div class="tip"><slot /></div></div>',
  },
  'v-chip': { template: '<span class="v-chip" v-bind="$attrs"><slot /></span>', inheritAttrs: false },
}

const mountBadge = (references?: string[] | null) =>
  mount(UnresolvedReferencesBadge, { props: { references }, global: { stubs } })

describe('UnresolvedReferencesBadge', () => {
  it('counts the unlinked references and lists them', () => {
    const w = mountBadge(['T1562.010', 'MitreAttackTechnique.attack_iexposured=T1078'])
    const chip = w.find('.v-chip')
    expect(chip.text()).toBe('2 unlinked')
    expect(chip.attributes('color')).toBe('warning')
    expect(chip.attributes('aria-label')).toContain('T1562.010, MitreAttackTechnique.attack_iexposured=T1078')
    expect(w.find('.tip').text()).toContain('T1562.010, MitreAttackTechnique.attack_iexposured=T1078')
  })

  it.each([[undefined], [null], [[]]])('renders nothing for %p', references => {
    expect(mountBadge(references as string[] | null | undefined).find('.v-chip').exists()).toBe(false)
  })
})
