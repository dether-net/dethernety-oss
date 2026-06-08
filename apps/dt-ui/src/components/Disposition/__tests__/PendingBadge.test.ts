// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PendingBadge from '../PendingBadge.vue'

describe('PendingBadge', () => {
  it('renders a terse "(N)" with an awaiting-review tooltip when count > 0', () => {
    const w = mount(PendingBadge, { props: { count: 3 } })
    expect(w.text()).toBe('(3)')
    expect(w.find('span').attributes('title')).toBe('3 awaiting review')
  })

  it('renders nothing when count is 0', () => {
    const w = mount(PendingBadge, { props: { count: 0 } })
    expect(w.text()).toBe('')
  })
})
