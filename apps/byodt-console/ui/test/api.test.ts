import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, cloudAccessToken, clearCloudTokens, clearSession, mintCloud, mintLocal, setCloudTokens, setSession } from '@/api'

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
  clearCloudTokens()
  sessionStatus = 200
  lastUrl = ''
  lastInit = undefined
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('api content methods', () => {
  // The catalog is the SECOND route to forward the operator's access token, and it had to be tested here
  // for the reason the install comment below records: every component test mocks api.packages wholesale,
  // so nothing anywhere else reaches the header. Without this the token could be dropped and both suites
  // would stay green while every deployment reported its subscription as unknown.
  it('GETs the catalog carrying the operator access token, which the subscription half needs', async () => {
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.packages()
    expect(lastUrl).toBe('/api/packages')
    expect(lastInit?.method ?? 'GET').toBe('GET')
    expect(new Headers(lastInit?.headers).get('X-Console-Cloud-Token')).toBe('the-access-token')
    // Both, on their own headers: two tokens for two audiences cannot share one.
    expect(authOf(lastInit)).toBe('Bearer the-id-token')
  })

  it('omits the cloud-token header on the catalog, and still asks, when there is no access token', async () => {
    // The ordinary state of a reloaded tab: the tokens are memory-only and only the session survives. The
    // call still goes out — the daemon answers with entitlement undetermined rather than refusing, so the
    // catalog renders and nothing is gated.
    setCloudTokens({ idToken: 'the-id-token', accessToken: '' })
    await api.packages()
    expect(lastUrl).toBe('/api/packages')
    expect(new Headers(lastInit?.headers).get('X-Console-Cloud-Token')).toBeNull()
  })

  it('GETs the mounted-modules inventory, and carries no access token doing it', async () => {
    // Its sibling on the same panel forwards the token; this one reads the local modules directory and
    // must not. Asserted because the two calls sit one line apart in the api object.
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.modules()
    expect(lastUrl).toBe('/api/modules')
    expect(lastInit?.method ?? 'GET').toBe('GET')
    expect(new Headers(lastInit?.headers).get('X-Console-Cloud-Token')).toBeNull()
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

  // postEntitled is the ONE call that forwards the operator's access token, and until these two cases it
  // was the only wire contract in this file with no test at all: every component test mocks
  // api.installArtifact wholesale, so nothing anywhere reached the header. Deleting the line that attaches
  // it left both suites green while every install answered "a cloud sign-in is required" in production.
  it('POSTs an install carrying the operator access token as well as the session and the ID token', async () => {
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.installArtifact({ artifactKey: 'acme-risk', version: '1.3.0' })
    expect(lastUrl).toBe('/api/artifacts')
    expect(lastInit?.method).toBe('POST')
    expect(JSON.parse(String(lastInit?.body))).toEqual({ artifactKey: 'acme-risk', version: '1.3.0' })
    const headers = new Headers(lastInit?.headers)
    expect(headers.get('X-Console-Cloud-Token')).toBe('the-access-token')
    // Both, on their own headers: two tokens for two audiences cannot share one.
    expect(authOf(lastInit)).toBe('Bearer the-id-token')
  })

  it('omits the cloud-token header when there is no access token, rather than sending it empty', async () => {
    setCloudTokens({ idToken: 'the-id-token', accessToken: '' })
    await api.installArtifact({ artifactKey: 'acme-risk', version: '1.3.0' })
    expect(new Headers(lastInit?.headers).get('X-Console-Cloud-Token')).toBeNull()
  })

  it('DELETEs an artifact without the access token — removal is a local file operation', async () => {
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.removeArtifact('acme-risk')
    expect(lastUrl).toBe('/api/artifacts/acme-risk')
    expect(lastInit?.method).toBe('DELETE')
    expect(new Headers(lastInit?.headers).get('X-Console-Cloud-Token')).toBeNull()
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
    const sess = await mintCloud({ idToken: 'id-tok', accessToken: 'acc-tok' })
    expect(lastUrl).toBe('/api/session')
    expect(lastInit?.method).toBe('POST')
    expect(authOf(lastInit)).toBe('Bearer id-tok')
    expect(sess).toBe('sess-1')
  })

  it('treats a 503 cloud mint as a retry, not a failure', async () => {
    sessionStatus = 503
    await expect(mintCloud({ idToken: 'id-tok', accessToken: 'acc-tok' })).rejects.toThrow(/retry/i)
  })

  it('attaches the ID token as a bearer on gated requests once it is set, and drops it when cleared', async () => {
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.state()
    expect(authOf(lastInit)).toBe('Bearer the-id-token')
    clearCloudTokens()
    await api.state()
    expect(authOf(lastInit)).toBe('')
  })

  it('carries the console session header on every gated request', async () => {
    // Asserted nowhere until now, in a suite whose beforeEach clears the session — so every URL and header
    // case in this file ran with no session id and the header was never emitted at all. It is the console's
    // own authentication, so "nothing asserts it" and "it is attached" were indistinguishable.
    setSession('sess-1')
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    for (const call of [() => api.state(), () => api.packages(), () => api.modules()]) {
      await call()
      expect(new Headers(lastInit?.headers).get('X-Console-Session')).toBe('sess-1')
    }
  })

  it('never attaches the access token to a gated request', async () => {
    // Two tokens for two audiences. The access token belongs to the content service and is carried
    // only by the routes that forward it — nothing may attach it automatically, on any header.
    setCloudTokens({ idToken: 'the-id-token', accessToken: 'the-access-token' })
    await api.state()
    const headers = new Headers(lastInit?.headers)
    expect(headers.get('X-Console-Cloud-Token')).toBeNull()
    expect(authOf(lastInit)).toBe('Bearer the-id-token')
  })

  it('stores the access token on a cloud mint and clears it with the session', async () => {
    await mintCloud({ idToken: 'id-tok', accessToken: 'acc-tok' })
    expect(cloudAccessToken()).toBe('acc-tok')
    // The session and the tokens are one lifetime: request()'s 401 path calls clearSession() alone,
    // and a token that outlived it could only be re-sent on a request that would be rejected again.
    clearSession()
    expect(cloudAccessToken()).toBe('')
  })
})
