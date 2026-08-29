import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The SPA is served under `import.meta.env.BASE_URL` — '/' standalone, '/console/' behind the shared front
 * door — and `api.ts` prefixes every request with it. Nothing exercised that.
 *
 * `vitest.config.ts` sets `base: '/console/'` and its comment claimed that made BASE_URL '/console/' in
 * tests, "otherwise the base-path threading is never exercised". Measured: under vitest the value is '/',
 * so the claim was false and the threading was indeed never exercised — every URL assertion in api.test.ts
 * is root-relative and passes only because the prefix is empty.
 *
 * Stubbed and re-imported rather than configured, because `BASE` is computed once at module load: a config
 * value cannot be varied per test, and the case that matters is the non-empty one the production build
 * actually ships.
 */
describe('the SPA base path is threaded onto every request', () => {
  let lastUrl = ''

  beforeEach(() => {
    lastUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        lastUrl = String(input)
        return new Response(JSON.stringify({ packages: [] }), { status: 200 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('prefixes requests when the SPA is served from a sub-path', async () => {
    vi.stubEnv('BASE_URL', '/console/')
    vi.resetModules()
    const { api } = await import('@/api')
    await api.packages()
    expect(lastUrl).toBe('/console/api/packages')
  })

  it('leaves them root-relative when it is served from the root', async () => {
    vi.stubEnv('BASE_URL', '/')
    vi.resetModules()
    const { api } = await import('@/api')
    await api.packages()
    expect(lastUrl).toBe('/api/packages')
  })
})
