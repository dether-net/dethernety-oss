import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginSignIn, completeSignIn } from '@/auth'

const cfg = { domain: 'team.auth.eu-central-1.amazoncognito.com', clientId: 'clientid123', scope: 'openid profile email' }
const redirect = 'http://localhost:3000/console/auth/callback'

function setSecureContext(v: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value: v, configurable: true })
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('auth (PKCE)', () => {
  it('builds a Cognito authorize URL with S256 PKCE and stashes verifier + state', async () => {
    setSecureContext(true)
    const url = await beginSignIn(cfg, redirect)
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(`https://${cfg.domain}/oauth2/authorize`)
    expect(u.searchParams.get('client_id')).toBe('clientid123')
    expect(u.searchParams.get('redirect_uri')).toBe(redirect)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBeTruthy()
    // state is echoed in the URL and stashed for the callback to validate.
    expect(u.searchParams.get('state')).toBeTruthy()
    expect(sessionStorage.getItem('console_pkce_state')).toBe(u.searchParams.get('state'))
    expect(sessionStorage.getItem('console_pkce_verifier')).toBeTruthy()
  })

  it('refuses to start sign-in outside a secure context', async () => {
    setSecureContext(false)
    await expect(beginSignIn(cfg, redirect)).rejects.toThrow(/secure context/i)
  })

  it('exchanges the code for the ID token and validates state', async () => {
    sessionStorage.setItem('console_pkce_state', 'st-1')
    sessionStorage.setItem('console_pkce_verifier', 'ver-1')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id_token: 'idtok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const idToken = await completeSignIn(cfg, redirect, 'the-code', 'st-1')
    expect(idToken).toBe('idtok')
    // The token endpoint was hit; the PKCE material is cleared.
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://${cfg.domain}/oauth2/token`)
    expect(sessionStorage.getItem('console_pkce_verifier')).toBeNull()
  })

  it('rejects a state mismatch', async () => {
    sessionStorage.setItem('console_pkce_state', 'st-1')
    sessionStorage.setItem('console_pkce_verifier', 'ver-1')
    await expect(completeSignIn(cfg, redirect, 'the-code', 'WRONG')).rejects.toThrow(/state mismatch/i)
  })
})
