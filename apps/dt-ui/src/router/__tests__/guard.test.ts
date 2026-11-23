// @vitest-environment happy-dom
//
// The sign-in guard: a signed-out tab goes to /login with the address it asked for kept; the sign-in routes, the
// no-auth mode and a signed-in tab keep nothing.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/layouts/default.vue', () => ({ default: {} }))
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({}) }))

import '@/router'
import { createAuthGuard, type GuardAuth } from '../guard'
import { RETURN_PATH_KEY } from '../returnPath'

const auth = (over: Partial<GuardAuth> = {}): GuardAuth => ({ authDisabled: false, isAuthenticated: false, initializeAuthMode: vi.fn(async () => {}), ...over })
const kept = () => {
  const raw = sessionStorage.getItem(RETURN_PATH_KEY)
  return raw ? JSON.parse(raw).path : null
}

describe('the sign-in guard', () => {
  beforeEach(() => sessionStorage.clear())

  it('sends a signed-out tab to /login and keeps the address it asked for; the auth mode is read once', async () => {
    const guard = createAuthGuard()
    const store = auth()
    expect(await guard({ path: '/dataflow', fullPath: '/dataflow?id=m&element=e&tab=attributes' }, store)).toBe('/login')
    expect(kept()).toBe('/dataflow?id=m&element=e&tab=attributes')
    await guard({ path: '/issues', fullPath: '/issues' }, store)
    expect(kept()).toBe('/issues')
    expect(store.initializeAuthMode).toHaveBeenCalledTimes(1)
  })

  it("the sign-in's own legs keep the address: the redirect to /login and the callback pass through", async () => {
    const guard = createAuthGuard()
    const store = auth()
    await guard({ path: '/dataflow', fullPath: '/dataflow?id=m&element=e' }, store)
    expect(await guard({ path: '/login', fullPath: '/login' }, store)).toBe(true)
    expect(await guard({ path: '/auth/callback', fullPath: '/auth/callback?code=c&state=s' }, store)).toBe(true)
    expect(kept()).toBe('/dataflow?id=m&element=e')
  })

  it('keeps nothing for the sign-in routes, in the no-auth mode, or for a signed-in tab', async () => {
    expect(await createAuthGuard()({ path: '/login', fullPath: '/login' }, auth())).toBe(true)
    expect(await createAuthGuard()({ path: '/auth/callback', fullPath: '/auth/callback?code=c' }, auth())).toBe(true)
    expect(await createAuthGuard()({ path: '/dataflow', fullPath: '/dataflow?id=m' }, auth({ authDisabled: true }))).toBe(true)
    expect(await createAuthGuard()({ path: '/dataflow', fullPath: '/dataflow?id=m' }, auth({ isAuthenticated: true }))).toBe(true)
    expect(kept()).toBeNull()
  })
})
