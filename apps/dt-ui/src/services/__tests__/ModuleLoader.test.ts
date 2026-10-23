/**
 * ModuleLoader — module frontends load on first use: the manifest on the first ensure(), a
 * module's bundle once per module, every failure a ModuleFrontendError, and a failure forgotten so
 * the page's Retry starts again. The dependencies (manifest query, fetch, auth, bundle evaluation)
 * are injected; the registry is the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FrontendModuleManifest } from '@dethernety/dt-core'

vi.mock('@/stores/modulesStore', () => ({ useModulesStore: () => ({}) }))
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({}) }))
vi.mock('@/composables/useHostContext', () => ({ useHostContext: () => ({}) }))
vi.mock('@/config/environment', () => ({ getConfig: async () => ({ graphqlUrl: '/graphql' }) }))
vi.mock('@jsonforms/core', () => ({}))
vi.mock('@jsonforms/vue', () => ({}))

import { ModuleLoader, HOST_API_VERSION, type ModuleLoaderDeps } from '../ModuleLoader'
import { ComponentRegistry } from '../ComponentRegistry'

type Install = (deps: any) => unknown

// A bundle's body names its module and version; its hash is the real sha256 of that body,
// computed up front (Web Crypto is async) for every module and version the tests use.
const body = (name: string, version: string) => `bundle ${name} ${version}`
const HASHES = new Map(
  await Promise.all(
    ['report', 'other', 'alpha', 'beta', 'down', 'newer', 'later'].flatMap(name =>
      ['v1', 'v2', 'v3'].map(async version => {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body(name, version))))
        return [body(name, version), Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')] as const
      }),
    ),
  ),
)
const sha256 = (text: string) => {
  const hash = HASHES.get(text)
  if (!hash) throw new Error(`no precomputed hash for "${text}"`)
  return hash
}

const entry = (
  name: string,
  components: string[],
  extra: Partial<FrontendModuleManifest> & { bundleVersion?: string } = {},
): FrontendModuleManifest => {
  const { bundleVersion = 'v1', ...rest } = extra
  const hash = sha256(body(name, bundleVersion))
  return {
    name,
    version: '1.0.0',
    available: true,
    hash,
    size: 1,
    url: `/module-bundles/${name}/${hash}/bundle.js`,
    components,
    hostApi: { min: 1, max: 1 },
    ...rest,
  }
}

const registering = (moduleId: string, ...keys: string[]): Install => deps => {
  for (const key of keys) deps.services.componentRegistry.register(key, { name: key }, moduleId)
}

/** Successive manifest responses; the last one repeats. */
const sequence = (...lists: FrontendModuleManifest[][]) => {
  let n = 0
  return async () => lists[Math.min(n++, lists.length - 1)]
}

function harness(opts: {
  manifests: () => Promise<FrontendModuleManifest[]>
  installs: Record<string, Install>
  status?: (url: string, attempt: number) => number
  /** The served body for a URL; by default the body the URL's hash was made from. */
  served?: (url: string) => string
  authDisabled?: boolean
  noHost?: boolean
}) {
  const registry = new ComponentRegistry()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetchManifest = vi.fn(opts.manifests)
  const bodies = new Map<string, string>()
  const attempts = new Map<string, number>()
  const fetch = vi.fn(async (url: string, _init: RequestInit) => {
    const n = (attempts.get(url) ?? 0) + 1
    attempts.set(url, n)
    const status = opts.status?.(url, n) ?? 200
    return new Response(status === 200 ? (opts.served?.(url) ?? bodies.get(url) ?? '') : 'x', { status })
  })
  const auth = {
    disabled: () => opts.authDisabled ?? false,
    ensureValidToken: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    token: () => 'tok',
  }
  const deps: ModuleLoaderDeps = {
    fetchManifest: async () => {
      const list = await fetchManifest()
      for (const m of list) {
        for (const v of ['v1', 'v2', 'v3']) {
          if (HASHES.get(body(m.name, v)) === m.hash) bodies.set(`https://api.test${m.url}`, body(m.name, v))
        }
      }
      return list
    },
    apiUrl: async () => 'https://api.test/graphql',
    fetch: fetch as unknown as typeof globalThis.fetch,
    auth,
    importBundle: async code => ({ default: { install: opts.installs[code.split(' ')[1]] } }),
    registry,
    hostDependencies: () => (opts.noHost ? undefined : ({ useHostContext: () => ({}), services: { componentRegistry: registry } }) as any),
  }
  const urls = () => fetch.mock.calls.map(c => c[0])
  return { loader: new ModuleLoader(deps), registry, fetchManifest, fetch, urls, auth, errors }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ModuleLoader — loading on first use', () => {
  it('constructing the loader requests nothing (main.ts never calls it before mount)', () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: {} })
    expect(h.fetchManifest).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('loads the owner of a key and returns the component it registered', async () => {
    const report = entry('report', ['report_view'])
    const h = harness({ manifests: sequence([report]), installs: { report: registering('report', 'report_view') } })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(h.urls()).toEqual([`https://api.test${report.url}`])
  })

  it('fetches a module once for all its keys, also when asked concurrently', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view', 'report_dialog'])]),
      installs: { report: registering('report', 'report_view', 'report_dialog') },
    })
    await Promise.all([h.loader.ensure('report_view'), h.loader.ensure('report_dialog'), h.loader.ensure('report_view')])
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.fetchManifest).toHaveBeenCalledTimes(1)
  })

  it('makes no request for a component already registered', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: { report: registering('report', 'report_view') } })
    await h.loader.ensure('report_view')
    h.fetch.mockClear()
    h.fetchManifest.mockClear()
    await h.loader.ensure('report_view')
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.fetchManifest).not.toHaveBeenCalled()
  })

  it('joins an ensure() to a prefetch still in flight', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: { report: registering('report', 'report_view') } })
    h.loader.prefetch('report')
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch an unknown, unavailable or incompatible module', async () => {
    const h = harness({
      manifests: sequence([
        entry('down', ['down_view'], { available: false }),
        entry('newer', ['newer_view'], { hostApi: { min: HOST_API_VERSION + 1, max: HOST_API_VERSION + 1 } }),
      ]),
      installs: {},
    })
    for (const name of ['backend-only', 'down', 'newer']) h.loader.prefetch(name)
    await vi.waitFor(() => expect(h.fetchManifest).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.fetch).not.toHaveBeenCalled()
    // Not attempted at all: nothing to fail, and nothing logged.
    expect(h.errors).not.toHaveBeenCalledWith(expect.stringContaining('Failed to load module'), expect.anything())
  })
})

describe('ModuleLoader — failures, and Retry', () => {
  it('forgets a failed load, so Retry loads again', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
      status: (_url, attempt) => (attempt === 1 ? 500 : 200),
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('forgets a failed manifest request, so Retry asks again', async () => {
    let calls = 0
    const h = harness({
      manifests: async () => {
        if (++calls === 1) throw new Error('network')
        return [entry('report', ['report_view'])]
      },
      installs: { report: registering('report', 'report_view') },
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(calls).toBe(2)
  })

  it('reports a key no module owns, and asks for the manifest again on Retry', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])], [entry('report', ['report_view']), entry('later', ['later_view'])]),
      installs: { later: registering('later', 'later_view') },
    })
    await expect(h.loader.ensure('later_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.fetch).not.toHaveBeenCalled()
    await expect(h.loader.ensure('later_view')).resolves.toEqual({ name: 'later_view' })
  })

  it('reports a module that does not register the key it declares, and loads it again on Retry', async () => {
    let installs = 0
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: deps => { if (++installs > 1) registering('report', 'report_view')(deps) } },
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(installs).toBe(2)
  })

  it('reports a bundle whose install() throws, or that has none', async () => {
    const throwing = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: { report: () => { throw new Error('boom') } } })
    await expect(throwing.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    const none = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: {} })
    await expect(none.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
  })

  it('reports a missing host as unloadable', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: { report: registering('report', 'report_view') }, noHost: true })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
  })

  it('refuses a module outside its host API range, without fetching it', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'], { hostApi: { min: HOST_API_VERSION + 1, max: HOST_API_VERSION + 2 } })]),
      installs: { report: registering('report', 'report_view') },
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'host-api' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('reports an unavailable module without fetching it, and notices its recovery on Retry', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'], { available: false })], [entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unavailable' })
    expect(h.fetch).not.toHaveBeenCalled()
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
  })

  it('reports 503 as unavailable, without asking for the manifest again', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: {}, status: () => 503 })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unavailable' })
    expect(h.fetchManifest).toHaveBeenCalledTimes(1)
  })

  it('loads without the hash check where Web Crypto is missing (plain HTTP off localhost)', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
      served: () => body('report', 'v3'),
    })
    vi.stubGlobal('crypto', {})
    try {
      await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses a bundle whose bytes do not match the manifest hash', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
      // Another build of the same module: it would install fine, but its bytes are not the ones listed.
      served: () => body('report', 'v3'),
    })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.registry.hasComponent('report_view')).toBe(false)
  })
})

describe('ModuleLoader — a stale hash (404)', () => {
  const v1 = entry('report', ['report_view'])
  const isV1 = (url: string) => url.includes(v1.hash)

  it('asks for the manifest once more and retries with the new hash', async () => {
    const v2 = entry('report', ['report_view'], { bundleVersion: 'v2' })
    const h = harness({ manifests: sequence([v1], [v2]), installs: { report: registering('report', 'report_view') }, status: url => (isV1(url) ? 404 : 200) })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(h.fetchManifest).toHaveBeenCalledTimes(2)
    expect(h.urls()).toEqual([`https://api.test${v1.url}`, `https://api.test${v2.url}`])
  })

  it('checks the fresh entry too: a new host API range, unavailability, or no entry at all', async () => {
    const newer = entry('report', ['report_view'], { bundleVersion: 'v2', hostApi: { min: HOST_API_VERSION + 1, max: HOST_API_VERSION + 1 } })
    const down = entry('report', ['report_view'], { bundleVersion: 'v2', available: false })
    for (const [fresh, kind] of [[[newer], 'host-api'], [[down], 'unavailable'], [[], 'unloadable']] as const) {
      const h = harness({ manifests: sequence([v1], [...fresh]), installs: { report: registering('report', 'report_view') }, status: url => (isV1(url) ? 404 : 200) })
      await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind })
      expect(h.fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after one manifest refetch when the bundle is still not found', async () => {
    const h = harness({ manifests: sequence([v1]), installs: {}, status: () => 404 })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.fetchManifest).toHaveBeenCalledTimes(2)
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })
})

describe('ModuleLoader — the bundle request', () => {
  it('sends the bearer token after making sure it is valid, and refuses redirects', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: { report: registering('report', 'report_view') } })
    await h.loader.ensure('report_view')
    expect(h.auth.ensureValidToken).toHaveBeenCalled()
    expect(h.fetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer tok' }, redirect: 'error' })
  })

  it('sends no token when authentication is disabled', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
      authDisabled: true,
    })
    await h.loader.ensure('report_view')
    expect(h.auth.ensureValidToken).not.toHaveBeenCalled()
    expect(h.fetch.mock.calls[0][1]).toEqual({ headers: {}, redirect: 'error' })
  })

  it.each([
    ['a protocol-relative URL', '//evil.test/module-bundles/report/h/bundle.js'],
    ['an absolute URL on another origin', 'https://evil.test/module-bundles/report/h/bundle.js'],
    ['a path outside the bundle route', '/graphql'],
  ])('never fetches %s, so the token stays on the API server', async (_case, url) => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'], { url })]), installs: {} })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('on 401 refreshes the token and retries once', async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view'])]),
      installs: { report: registering('report', 'report_view') },
      status: (_url, attempt) => (attempt === 1 ? 401 : 200),
    })
    await expect(h.loader.ensure('report_view')).resolves.toEqual({ name: 'report_view' })
    expect(h.auth.refresh).toHaveBeenCalledTimes(1)
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('reports a second 401 instead of retrying again', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: {}, status: () => 401 })
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('reports a failed token refresh', async () => {
    const h = harness({ manifests: sequence([entry('report', ['report_view'])]), installs: {}, status: () => 401 })
    h.auth.refresh.mockRejectedValueOnce(new Error('No refresh token available'))
    await expect(h.loader.ensure('report_view')).rejects.toMatchObject({ kind: 'unloadable' })
  })
})

describe('ModuleLoader — component ownership', () => {
  it('refuses a key that two modules declare, naming both', async () => {
    const h = harness({
      manifests: sequence([entry('alpha', ['shared_view']), entry('beta', ['shared_view'])]),
      installs: { alpha: registering('alpha', 'shared_view'), beta: registering('beta', 'shared_view') },
    })
    await expect(h.loader.ensure('shared_view')).rejects.toMatchObject({ kind: 'unloadable' })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.errors).toHaveBeenCalledWith(expect.stringContaining('(alpha, beta)'))
  })

  it("lets a module's install() register only the keys it owns", async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view', 'shared_view']), entry('other', ['other_view', 'shared_view'])]),
      installs: { report: registering('report', 'report_view', 'undeclared_view', 'other_view', 'shared_view') },
    })
    await h.loader.ensure('report_view')
    expect(h.registry.getAvailableComponents()).toEqual(['report_view'])
  })

  it("does not let a module unregister another module's key", async () => {
    const h = harness({
      manifests: sequence([entry('report', ['report_view']), entry('other', ['other_view'])]),
      installs: {
        other: registering('other', 'other_view'),
        report: deps => {
          deps.services.componentRegistry.unregister('other_view')
          deps.services.componentRegistry.unregisterModule('other')
          registering('report', 'report_view')(deps)
        },
      },
    })
    await h.loader.ensure('other_view')
    await h.loader.ensure('report_view')
    expect(h.registry.hasComponent('other_view')).toBe(true)
  })
})
