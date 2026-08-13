import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CloudNotice from '@/components/CloudNotice.vue'

describe('CloudNotice', () => {
  it('renders the title and message as an alert', () => {
    const w = mount(CloudNotice, {
      props: { notice: { title: 'Something failed', message: 'the reason' } },
    })
    expect(w.find('[data-notice]').exists()).toBe(true)
    expect(w.text()).toContain('Something failed')
    expect(w.text()).toContain('the reason')
    w.unmount()
  })

  it('shows a register value and recovery steps when given', () => {
    const w = mount(CloudNotice, {
      props: {
        notice: {
          title: 'Callback not registered',
          message: 'rejected',
          registerUri: 'http://127.0.0.1:3000/console/auth/callback',
          recovery: ['Register the callback.', 'Sign in again.'],
        },
      },
    })
    expect(w.text()).toContain('Register this exact value')
    expect(w.get('code').text()).toBe('http://127.0.0.1:3000/console/auth/callback')
    const steps = w.findAll('ol li').map((li) => li.text())
    expect(steps).toEqual(['Register the callback.', 'Sign in again.'])
    w.unmount()
  })

  it('omits the register block and recovery list when not provided', () => {
    const w = mount(CloudNotice, {
      props: { notice: { title: 'T', message: 'M' } },
    })
    expect(w.find('code').exists()).toBe(false)
    expect(w.find('ol').exists()).toBe(false)
    w.unmount()
  })
})
