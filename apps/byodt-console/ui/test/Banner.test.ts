import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Banner from '@/components/Banner.vue'

describe('Banner', () => {
  it('renders the title, the slot body, and role=alert', () => {
    const w = mount(Banner, { props: { tone: 'info', title: 'Heads up' }, slots: { default: 'the body' } })
    expect(w.attributes('role')).toBe('alert')
    expect(w.text()).toContain('Heads up')
    expect(w.text()).toContain('the body')
    w.unmount()
  })

  it('maps tone to the brand accent (fault→quinary, warn→tertiary)', () => {
    const fault = mount(Banner, { props: { tone: 'fault', title: 't' } })
    expect(fault.classes().join(' ')).toContain('border-dt-quinary')
    fault.unmount()
    const warn = mount(Banner, { props: { tone: 'warn', title: 't' } })
    expect(warn.classes().join(' ')).toContain('border-dt-tertiary')
    warn.unmount()
  })
})
