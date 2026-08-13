import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, clearIdToken, clearSession, mintCloud, mintLocal, setIdToken } from '@/api'

// The content methods are thin wrappers over the request helper; these lock the URL, verb, and body so
// the wire contract with the daemon cannot drift silently.
let lastUrl = ''
let lastInit: RequestInit | undefined
let sessionStatus = 200 // flipped to drive the cloud-mint "retry" (503) path

function authOf(init?: RequestInit): string {
  return new Headers(init?.headers).get('Authorization') ?? ''
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  lastUrl = String(input)
  lastInit = init
  if (lastUrl === '/api/posture') {
    return new Response(JSON.stringify({ posture: 'cloud', authDisabled: false }), { status: 200 })
  }
  if (lastUrl === '/api/session') {
    return sessionStatus === 200
      ? new Response(JSON.stringify({ session: 'sess-1' }), { status: 200 })
      : new Response('could not verify', { status: sessionStatus })
  }
  if (lastUrl === '/api/packages') return new Response(JSON.stringify({ packages: [] }), { status: 200 })
  if (lastUrl === '/api/modules' && (init?.method ?? 'GET') === 'GET') {
    return new Response(JSON.stringify({ modules: [] }), { status: 200 })
  }
  return new Response(JSON.stringify({ status: 'ok', message: 'done' }), { status: 200 })
})

beforeEach(() => {
  clearSession()
  clearIdToken()
  sessionStatus = 200
  lastUrl = ''
  lastInit = undefined
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('api content methods', () => {
  it('GETs the catalog', async () => {
    await api.packages()
    expect(lastUrl).toBe('/api/packages')
    expect(lastInit?.method ?? 'GET').toBe('GET')
  })

  it('GETs the mounted-modules inventory', async () => {
    await api.modules()
    expect(lastUrl).toBe('/api/modules')
    expect(lastInit?.method ?? 'GET').toBe('GET')
  })

  it('POSTs a mount carrying packageKey, moduleKey and pin', async () => {
    await api.mountModule({ packageKey: 'acme-cloud', moduleKey: 'acme-compute', pin: 'sha256:abc' })
    expect(lastUrl).toBe('/api/modules')
    expect(lastInit?.method).toBe('POST')
    expect(JSON.parse(String(lastInit?.body))).toEqual({
      packageKey: 'acme-cloud',
      moduleKey: 'acme-compute',
      pin: 'sha256:abc',
    })
  })

  it('DELETEs a mount by its encoded key', async () => {
    await api.unmountModule('acme-compute')
    expect(lastUrl).toBe('/api/modules/acme-compute')
    expect(lastInit?.method).toBe('DELETE')
  })
})

describe('api sign-in (posture-driven)', () => {
  it('GETs the ungated posture', async () => {
    const p = await api.posture()
    expect(lastUrl).toBe('/api/posture')
    expect(lastInit?.method ?? 'GET').toBe('GET')
    expect(p.posture).toBe('cloud')
  })

  it('mints a local session with no credential', async () => {
    const sess = await mintLocal()
    expect(lastUrl).toBe('/api/session')
    expect(lastInit?.method).toBe('POST')
    expect(authOf(lastInit)).toBe('') // local carries no bearer
    expect(sess).toBe('sess-1')
  })

  it('mints a cloud session by presenting the ID token as a bearer', async () => {
    const sess = await mintCloud('id-tok')
    expect(lastUrl).toBe('/api/session')
    expect(lastInit?.method).toBe('POST')
    expect(authOf(lastInit)).toBe('Bearer id-tok')
    expect(sess).toBe('sess-1')
  })

  it('treats a 503 cloud mint as a retry, not a failure', async () => {
    sessionStatus = 503
    await expect(mintCloud('id-tok')).rejects.toThrow(/retry/i)
  })

  it('attaches the ID token as a bearer on gated requests once it is set, and drops it when cleared', async () => {
    setIdToken('the-id-token')
    await api.state()
    expect(authOf(lastInit)).toBe('Bearer the-id-token')
    clearIdToken()
    await api.state()
    expect(authOf(lastInit)).toBe('')
  })
})
