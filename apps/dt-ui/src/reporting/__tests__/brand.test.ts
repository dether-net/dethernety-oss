import { describe, expect, it, vi } from 'vitest'

// The config module reads the environment when it loads; the brand source is given its config directly here.
vi.mock('@/config/environment', () => ({ getConfig: vi.fn() }))

import { createBrandSource, type BrandDeps } from '../brand'

const HASH = 'ab'.repeat(32)
const LOGO_PATH = `/branding/logo/${HASH}`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function logoResponse(type = 'image/png', bytes = PNG, status = 200) {
  return new Response(bytes, { status, headers: { 'content-type': type } })
}

function deps(over: Partial<BrandDeps> & { branding?: unknown } = {}) {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    if (href === '/config') return new Response(JSON.stringify({ branding: over.branding ?? null }), { status: 200 })
    return logoResponse()
  }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>
  const d: BrandDeps = {
    dev: false,
    config: async () => ({
      graphqlUrl: 'https://api.example.com/graphql',
      branding: (over.branding as never) ?? null,
    }),
    fetch,
    ...over,
  }
  return { d, fetch: (over.fetch ?? fetch) as ReturnType<typeof vi.fn> }
}

const BRANDING = { name: 'Example', url: 'https://example.com/', footer: 'Confidential', logoUrl: LOGO_PATH, logoWidth: 320, logoHeight: 80 }

describe('the brand source', () => {
  it('is null when the installation has no brand', async () => {
    const { d, fetch } = deps()
    expect(await createBrandSource(d)()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('inlines a valid logo as a data URI, fetched against the API base', async () => {
    const { d, fetch } = deps({ branding: BRANDING })
    const brand = await createBrandSource(d)()
    expect(brand).toEqual({
      name: 'Example',
      url: 'https://example.com/',
      footer: 'Confidential',
      logo: { dataUri: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`, width: 320, height: 80 },
    })
    expect(fetch).toHaveBeenCalledWith(`https://api.example.com${LOGO_PATH}`, { redirect: 'error' })
    expect(Object.isFrozen(brand)).toBe(true)
  })

  it('refuses a logo over 256 KiB, by its declared length or by what it sends', async () => {
    const big = new Uint8Array(256 * 1024 + 1)
    const declared = vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(big.length) } }))
    const sent = vi.fn(async () => logoResponse('image/png', big))
    for (const fetch of [declared, sent]) {
      const { d } = deps({ branding: BRANDING, fetch: fetch as never })
      expect((await createBrandSource(d)())?.logo).toBeUndefined()
    }
  })

  it('keeps the brand without its logo when the logo cannot be had', async () => {
    for (const response of [logoResponse('image/png', PNG, 404), logoResponse('image/svg+xml'), logoResponse('image/png', new Uint8Array(0))]) {
      const failing = vi.fn(async () => response)
      const { d } = deps({ branding: BRANDING, fetch: failing as never })
      expect(await createBrandSource(d)()).toEqual({ name: 'Example', url: 'https://example.com/', footer: 'Confidential' })
    }
    const throwing = vi.fn(async () => {
      throw new Error('offline')
    })
    const { d } = deps({ branding: BRANDING, fetch: throwing as never })
    expect((await createBrandSource(d)())?.logo).toBeUndefined()
  })

  it('reads the brand once per page load', async () => {
    const { d, fetch } = deps({ branding: BRANDING })
    const brand = createBrandSource(d)
    const [a, b] = await Promise.all([brand(), brand()])
    await brand()
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('in a development build, reads the branding from /config while the rest of the config stays its own', async () => {
    const config = vi.fn(async () => ({ graphqlUrl: 'http://localhost:3003/graphql', branding: null }))
    const { d, fetch } = deps({ dev: true, branding: BRANDING, config })
    const brand = await createBrandSource(d)()
    expect(fetch).toHaveBeenCalledWith('/config')
    expect(fetch).toHaveBeenCalledWith(`http://localhost:3003${LOGO_PATH}`, { redirect: 'error' })
    expect(brand?.name).toBe('Example')
    expect(brand?.logo?.width).toBe(320)
  })

  it('never fails: an error reading the config gives an unbranded report', async () => {
    const { d } = deps({ config: async () => { throw new Error('no config') } })
    expect(await createBrandSource(d)()).toBeNull()
  })
})
