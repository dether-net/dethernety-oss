// @vitest-environment happy-dom
//
// The address a signed-out tab returns to after sign-in, decided by the app's own router: kept only when it
// resolves to one of the app's pages, never a sign-in route or an unmatched one, and taken once, at most ten
// minutes old, as the parsed address on this origin under the app's base.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/layouts/default.vue', () => ({ default: {} }))
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({}) }))

import '@/router'
import { RETURN_PATH_KEY, RETURN_PATH_TTL_MS, isReturnPath, rememberReturnPath, setRouteResolver, takeReturnPath } from '../returnPath'
import router from '@/router'

const ORIGIN = 'https://app.test'
const plant = (path: unknown, at: unknown = Date.now()) => sessionStorage.setItem(RETURN_PATH_KEY, JSON.stringify({ path, at }))

describe('the return path, by the router', () => {
  beforeEach(() => sessionStorage.clear())

  it("keeps an address the router resolves to one of the app's pages, a module's included", () => {
    for (const p of ['/dataflow?id=m&element=e&tab=attributes', '/analysisresults?id=a1', '/Browser/', '/issues#top']) expect(isReturnPath(p), p).toBe(true)
  })

  it('refuses the sign-in routes in any case or trailing slash, an unknown page, and anything that could leave the site', () => {
    const refused = [
      '/login', '/LOGIN/', '/auth/callback', '/auth/callback/', '/auth/logout', '/auth/not-admitted', '/nowhere',
      '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '/\t/evil.example',
      '/dataflow?x=\\y', '/dataflow?x=\ny', '', 'dataflow', `/${'a'.repeat(2048)}`,
    ]
    for (const p of refused) expect(isReturnPath(p), JSON.stringify(p)).toBe(false)
    expect(isReturnPath(42)).toBe(false)
  })

  it('refuses everything without a router to ask, when the router throws, and on a catch-all match', () => {
    try {
      setRouteResolver(null)
      expect(isReturnPath('/dataflow?id=m')).toBe(false)
      setRouteResolver(() => {
        throw new Error('no')
      })
      expect(isReturnPath('/dataflow?id=m')).toBe(false)
      setRouteResolver(() => ({ matched: [{ path: '/:pathMatch(.*)*' }], name: 'not-found' }))
      expect(isReturnPath('/anything')).toBe(false)
    } finally {
      setRouteResolver((to) => router.resolve(to))
    }
  })

  it('accepts an address of exactly 2048 characters', () => {
    const p = '/dataflow?id=' + 'm'.repeat(2048 - '/dataflow?id='.length)
    expect(p).toHaveLength(2048)
    expect(isReturnPath(p)).toBe(true)
    expect(isReturnPath(p + 'm')).toBe(false)
  })

  it('remembers a qualifying address; any other request clears it', () => {
    rememberReturnPath('/dataflow?id=m')
    expect(JSON.parse(sessionStorage.getItem(RETURN_PATH_KEY)!).path).toBe('/dataflow?id=m')
    rememberReturnPath('/login')
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('is taken once, as the parsed address under the base', () => {
    rememberReturnPath('/dataflow?id=m&element=e#x')
    expect(takeReturnPath('/', ORIGIN)).toBe('/dataflow?id=m&element=e#x')
    expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
    expect(takeReturnPath('/', ORIGIN)).toBeNull()
    rememberReturnPath('/issues')
    expect(takeReturnPath('/app/', ORIGIN)).toBe('/app/issues')
  })

  it('refuses a planted value that fails again once parsed, is not JSON, or is stale or from the future', () => {
    const now = Date.now()
    for (const path of ['/.//evil.example', '/%2e%2e/x', '/dataflow/../login', '//evil.example', '/login']) {
      plant(path, now)
      expect(takeReturnPath('/', ORIGIN, now), path).toBeNull()
    }
    plant('/%2e%2e/studio/', now)
    expect(takeReturnPath('/app/', ORIGIN, now)).toBeNull()
    // out of the base once parsed, though its tail past the base's length reads as a page
    plant('/%2e%2e/abcddataflow', now)
    expect(takeReturnPath('/app/', ORIGIN, now)).toBeNull()
    sessionStorage.setItem(RETURN_PATH_KEY, 'not json')
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    plant(42, now)
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    plant('/issues', String(now))
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    sessionStorage.setItem(RETURN_PATH_KEY, JSON.stringify({ path: '/issues' }))
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    plant('/dataflow?id=m', now - RETURN_PATH_TTL_MS - 1)
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    plant('/dataflow?id=m', now + 1000)
    expect(takeReturnPath('/', ORIGIN, now)).toBeNull()
    plant('/dataflow?id=m', now - RETURN_PATH_TTL_MS)
    expect(takeReturnPath('/', ORIGIN, now)).toBe('/dataflow?id=m')
  })
})
