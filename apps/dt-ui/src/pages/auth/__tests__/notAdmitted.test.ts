// @vitest-environment happy-dom

/**
 * The page a person reaches when their sign-in worked and the deployment refused the account. It has
 * to say what happened, which account, who can change it, and that the change needs a restart — and
 * it must never route back to the login page, which would loop through the identity provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
const logout = vi.fn()
const user = { email: 'anna@example.test', name: 'Anna' }
let authDisabled = false

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user, logout, authDisabled }),
}))

const stubs = {
  'v-icon': { template: '<i class="v-icon"><slot /></i>' },
  'v-btn': { template: '<button class="v-btn" v-bind="$attrs"><slot /></button>' },
}

let NotAdmitted: any

beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  authDisabled = false
  NotAdmitted = (await import('../not-admitted.vue')).default
})

describe('the not-admitted page', () => {
  it('says the sign-in worked, names the account, and says who can change it and when it takes effect', () => {
    const w = mount(NotAdmitted, { global: { stubs } })
    const text = w.text()
    expect(text).toContain('does not admit your account')
    expect(text).toContain('Your sign-in worked')
    expect(w.find('[data-not-admitted-account]').text()).toBe('anna@example.test')
    expect(text).toMatch(/administrator of the team/)
    expect(text).toMatch(/deployment.s console/)
    expect(text).toMatch(/when the platform is restarted/)
    // It must not read as something the person can fix by retrying the load.
    expect(text).not.toMatch(/try again/i)
    // And it never claims the account is wrong — the sign-in was fine.
    expect(text).not.toMatch(/log in again|sign in again|invalid/i)
  })

  it('offers a sign-out and a check-again, and neither is the login page', async () => {
    const w = mount(NotAdmitted, { global: { stubs } })
    await w.find('[data-not-admitted-sign-out]').trigger('click')
    expect(logout).toHaveBeenCalledTimes(1)
    await w.find('[data-not-admitted-check]').trigger('click')
    expect(push).toHaveBeenCalledWith('/')
    expect(push).not.toHaveBeenCalledWith('/login')
  })
})
