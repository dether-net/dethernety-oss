import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { clearIdToken, clearSession, setSession, type ModeView, type PostureView, type StateView } from '@/api'

// The PKCE module is mocked: the callback tests drive App's exchange paths without real crypto or a
// redirect, and the SSO-button test asserts beginSignIn is invoked.
const completeSignIn = vi.fn()
const beginSignIn = vi.fn()
vi.mock('@/auth', () => ({
  completeSignIn: (...a: unknown[]) => completeSignIn(...a),
  beginSignIn: (...a: unknown[]) => beginSignIn(...a),
  consoleRedirectUri: () => 'http://localhost:3000/console/auth/callback',
}))

const defaultMode: ModeView = {
  phase: 'pre-cloud',
  authDisabled: true,
  cloudFileWritten: false,
  restartPending: false,
}
// Reassigned per test to exercise the cloud phases.
let modeBody: ModeView = { ...defaultMode }
// The posture the SPA reads before any session — local by default (auto-mint); flipped to cloud per test.
let postureBody: PostureView = { posture: 'local', authDisabled: true }

const cloudPosture: PostureView = { posture: 'cloud', authDisabled: false, oidcDomain: 'team.auth', oidcClientId: 'c', oidcScope: 'openid' }

const stateBody: StateView = {
  initRan: true,
  tag: 'v0.5.0',
  ranAt: '2026-08-10T00:00:00Z',
  modules: { status: 'ok', expected: [{ name: 'dethernety-general', version: '1.0.0', outcome: 'placed' }] },
  ingest: { status: 'ok', statements: 26262 },
  failures: [],
}

// Flipped per test to exercise the session-expiry and state-error paths.
let modeStatus = 200
let stateStatus = 200
let lastSessionAuth = '' // the Authorization the mint (POST /api/session) carried — '' in local posture
// The catalog body the content panels fetch; overridden per test to drive a mount.
let packagesBody: unknown = { packages: [] }
// Recovery-path controls: simulate a posture FLIP between mount and the 401-recovery re-fetch. postureCall
// counts /api/posture hits; the 2nd+ hit returns postureBodyAfter (if set), or fails if postureFailOnRefetch.
// mode401Once makes just the first /api/mode call 401 (a transient session drop that then recovers).
let postureCall = 0
let postureBodyAfter: PostureView | null = null
let postureFailOnRefetch = false
let mode401Once = false

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // Requests carry the SPA base prefix in production (e.g. /console/api/…); strip it so these
  // endpoint stubs match regardless of the base the build/test resolves.
  const url = String(input).replace(/^\/console/, '')
  const method = init?.method ?? 'GET'
  if (url === '/api/posture') {
    postureCall++
    if (postureCall > 1 && postureFailOnRefetch) return new Response('unreachable', { status: 500 })
    const body = postureCall > 1 && postureBodyAfter ? postureBodyAfter : postureBody
    return new Response(JSON.stringify(body), { status: 200 })
  }
  if (url === '/api/session' && method === 'POST') {
    lastSessionAuth = new Headers(init?.headers).get('Authorization') ?? ''
    return new Response(JSON.stringify({ session: 'sess-1' }), { status: 200 })
  }
  if (url === '/api/mode') {
    if (mode401Once) {
      mode401Once = false
      return new Response('unauthorized', { status: 401 })
    }
    return modeStatus === 401 ? new Response('unauthorized', { status: 401 }) : new Response(JSON.stringify(modeBody), { status: 200 })
  }
  if (url === '/api/state') {
    // A non-200, non-401 state error returns the daemon's plain-text reason as the body.
    return stateStatus === 200
      ? new Response(JSON.stringify(stateBody), { status: 200 })
      : new Response('reading init state', { status: stateStatus })
  }
  // Content routes the post-cloud content panels poll. Empty is enough to prove the section renders.
  if (url === '/api/packages') return new Response(JSON.stringify(packagesBody), { status: 200 })
  if (url === '/api/modules' && method === 'GET') return new Response(JSON.stringify({ modules: [] }), { status: 200 })
  if (url === '/api/modules' && method === 'POST') return new Response(JSON.stringify({ status: 'mounted', message: 'module mounted' }), { status: 200 })
  if (url === '/api/cloud') return new Response(JSON.stringify({ status: 'applied', message: 'cloud configuration written' }), { status: 200 })
  return new Response('not found', { status: 404 })
})

const realLocation = window.location

beforeEach(() => {
  modeStatus = 200
  stateStatus = 200
  modeBody = { ...defaultMode }
  postureBody = { posture: 'local', authDisabled: true }
  lastSessionAuth = ''
  packagesBody = { packages: [] }
  postureCall = 0
  postureBodyAfter = null
  postureFailOnRefetch = false
  mode401Once = false
  clearSession()
  clearIdToken()
  completeSignIn.mockReset()
  beginSignIn.mockReset()
  window.history.replaceState({}, '', '/')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  // The SSO-button test replaces window.location; restore it so it does not leak into other tests.
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
})

describe('App', () => {
  it('auto-mints in local posture and renders the dashboard (no card)', async () => {
    const w = mount(App)
    await flushPromises()
    const badge = w.find('[data-phase]')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('data-phase')).toBe('pre-cloud')
    expect(w.text()).not.toContain('Sign in with SSO')
    // The local mint carried no bearer.
    expect(lastSessionAuth).toBe('')
    w.unmount()
  })

  it('shows the SSO sign-in card in cloud posture with no session', async () => {
    postureBody = cloudPosture
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Sign in with SSO')
    expect(w.find('[data-phase]').exists()).toBe(false)
    w.unmount()
  })

  it('starts PKCE sign-in from the posture config when the SSO button is clicked', async () => {
    postureBody = cloudPosture
    beginSignIn.mockResolvedValue('https://team.auth/oauth2/authorize?x=1')
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true })
    const w = mount(App)
    await flushPromises()

    await w.findAll('button').find((b) => b.text() === 'Sign in with SSO')!.trigger('click')
    await flushPromises()

    expect(beginSignIn).toHaveBeenCalledTimes(1)
    const [cfg, redirect] = beginSignIn.mock.calls[0]
    expect(cfg).toEqual({ domain: 'team.auth', clientId: 'c', scope: 'openid' })
    expect(redirect).toBe('http://localhost:3000/console/auth/callback')
    expect(assign).toHaveBeenCalledWith('https://team.auth/oauth2/authorize?x=1')
    w.unmount()
  })

  it('returns to the SSO card when a gated route 401s in cloud posture', async () => {
    postureBody = cloudPosture
    setSession('sess-1') // already signed in
    modeStatus = 401
    const w = mount(App)
    await flushPromises()
    expect(w.find('[data-phase]').exists()).toBe(false)
    expect(w.text()).toContain('Sign in with SSO')
    w.unmount()
  })

  it('recovery re-reads posture: a connect flip (local→cloud) lands on the SSO card, not a mint error', async () => {
    // Mounted local + signed in; a Connect then flips the deployment to cloud and flushes the session,
    // so the next poll 401s. Recovery must honor the NEW cloud posture (re-fetched), not the cached local
    // one — otherwise it would mintLocal against a now-cloud daemon and surface "Could not start…".
    postureBody = { posture: 'local', authDisabled: true }
    postureBodyAfter = cloudPosture // the flip: the recovery re-fetch sees cloud
    setSession('sess-1')
    modeStatus = 401
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Sign in with SSO')
    expect(w.text()).not.toContain('Could not start the console session')
    expect(w.find('[data-phase]').exists()).toBe(false)
    w.unmount()
  })

  it('recovery re-reads posture: a disconnect flip (cloud→local) auto-mints back to the dashboard', async () => {
    // Mounted cloud + signed in; a Disconnect flips to local and flushes the session (mode 401 once),
    // then the local mint (no credential) re-establishes and the poll succeeds.
    postureBody = cloudPosture
    postureBodyAfter = { posture: 'local', authDisabled: true } // the flip: recovery re-fetch sees local
    setSession('sess-1')
    mode401Once = true
    const w = mount(App)
    await flushPromises()
    await flushPromises() // mint → onSignedIn → poll
    expect(w.find('[data-phase]').exists()).toBe(true)
    expect(w.text()).not.toContain('Sign in with SSO')
    w.unmount()
  })

  it('surfaces a posture-fetch failure on the recovery path without spinning', async () => {
    postureBody = { posture: 'local', authDisabled: true }
    postureFailOnRefetch = true // the recovery re-fetch of /api/posture fails
    setSession('sess-1')
    modeStatus = 401
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Could not reach the console')
    expect(w.find('[data-phase]').exists()).toBe(false)
    w.unmount()
  })

  it('surfaces a non-401 state error as a banner and stays signed in', async () => {
    stateStatus = 500
    const w = mount(App)
    await flushPromises()
    // The dashboard stays (phase badge renders), and the daemon's reason is shown rather than
    // swallowed — proving both the error-surfacing (App.vue) and the body-reading (api.ts) fix.
    expect(w.find('[data-phase]').exists()).toBe(true)
    expect(w.text()).toContain('Could not load deployment state')
    expect(w.text()).toContain('reading init state')
    w.unmount()
  })

  it('shows the cloud badge in post-cloud and no restart-pending banner', async () => {
    setSession('sess-1')
    modeBody = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
    const w = mount(App)
    await flushPromises()
    expect(w.find('[data-phase]').attributes('data-phase')).toBe('post-cloud')
    expect(w.text()).not.toContain('not yet applied') // neither restart-pending banner is shown
    w.unmount()
  })

  it('completes an initial cloud sign-in callback (no prior session) and signs in', async () => {
    postureBody = cloudPosture
    window.history.replaceState({}, '', '/auth/callback?code=the-code&state=the-state')
    completeSignIn.mockResolvedValue('id-token')
    modeBody = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }

    const w = mount(App)
    await flushPromises()

    expect(completeSignIn).toHaveBeenCalledTimes(1)
    // The mint presented the ID token as a bearer, and the operator lands on the dashboard.
    expect(lastSessionAuth).toBe('Bearer id-token')
    expect(w.find('[data-phase]').exists()).toBe(true)
    expect(window.location.search).toBe('')
    w.unmount()
  })

  it('surfaces a failed initial cloud sign-in and stays on the SSO card', async () => {
    // The callback's only remaining intent is the initial sign-in; a failed exchange (no session yet)
    // surfaces the error and leaves the operator on the sign-in card, not a half-signed-in dashboard.
    postureBody = cloudPosture
    window.history.replaceState({}, '', '/auth/callback?code=c&state=s')
    completeSignIn.mockRejectedValue(new Error('sign-in state mismatch'))
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('sign-in state mismatch')
    expect(w.find('[data-phase]').exists()).toBe(false)
    expect(window.location.search).toBe('')
    w.unmount()
  })

  it('surfaces an OAuth error return and does not attempt an exchange', async () => {
    postureBody = cloudPosture
    setSession('sess-1')
    window.history.replaceState({}, '', '/auth/callback?error=access_denied&error_description=Denied')
    const w = mount(App)
    await flushPromises()
    expect(completeSignIn).not.toHaveBeenCalled()
    expect(w.text()).toContain('Denied')
    expect(window.location.search).toBe('')
    w.unmount()
  })

  it('shows the callback-not-registered notice with the exact value to register', async () => {
    postureBody = cloudPosture
    window.history.replaceState({}, '', '/auth/callback?error=redirect_mismatch')
    const w = mount(App)
    await flushPromises()
    expect(completeSignIn).not.toHaveBeenCalled()
    const notice = w.find('[data-notice]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('not registered')
    expect(notice.text()).toContain('Register this exact value')
    // consoleRedirectUri() is mocked to the console's own callback.
    expect(notice.text()).toContain('http://localhost:3000/console/auth/callback')
    expect(window.location.search).toBe('')
    w.unmount()
  })

  it('renders the content section once the platform is in cloud mode', async () => {
    setSession('sess-1')
    modeBody = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
    const w = mount(App)
    await flushPromises()
    await flushPromises()
    // The unified content panel is mounted (empty catalog + empty inventory here).
    expect(w.find('[data-tab="content"]').exists()).toBe(true)
    expect(w.text()).toContain('The catalog is empty.')
    w.unmount()
  })

  it('refreshes the content panels after a mount from the catalog', async () => {
    setSession('sess-1')
    modeBody = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
    packagesBody = { packages: [{ key: 'p', name: 'P', version: '1', modules: [{ key: 'm', name: 'M', version: '1.0', contentHash: 'sha256:a' }] }] }
    const w = mount(App)
    await flushPromises()
    await flushPromises()

    const modulesGets = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/modules' && (c[1]?.method ?? 'GET') === 'GET').length
    const before = modulesGets()

    // Bands are collapsed by default — expand the package to reveal its per-module Mount.
    await w.get('[data-expand="p"]').trigger('click')
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Mount')!.trigger('click')
    await flushPromises()

    const posts = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/modules' && c[1]?.method === 'POST').length
    expect(posts).toBe(1)
    // onContentChanged bumps the shared reload token, so the sibling inventory panel refetches.
    expect(modulesGets()).toBeGreaterThan(before)
    w.unmount()
  })

  it('hides the content section before the platform is in cloud mode', async () => {
    setSession('sess-1')
    const w = mount(App) // default modeBody is pre-cloud
    await flushPromises()
    await flushPromises()
    expect(w.find('[data-tab="content"]').exists()).toBe(false)
    w.unmount()
  })

  it('warns that a written cloud configuration is not yet applied until the platform restarts', async () => {
    setSession('sess-1')
    // A cloud file is written but the platform is not running it (a pending connect, or a rollback to
    // before the connect) — the console offers re-apply via recreate.
    modeBody = { phase: 'pre-cloud', authDisabled: true, cloudFileWritten: true, restartPending: true }
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Cloud configuration not yet applied')
    expect(w.text()).toContain('rolled back')
    expect(w.text()).toContain('byodt restart')
    w.unmount()
  })

  it('warns that a pending revert to pure open-source is not yet applied', async () => {
    setSession('sess-1')
    // The disconnect restart window: the pure-OSS file is written, the platform is still authenticated.
    modeBody = { phase: 'authenticated', authDisabled: false, cloudFileWritten: false, restartPending: true }
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Revert to pure open-source not yet applied')
    expect(w.text()).toContain('byodt restart')
    w.unmount()
  })

  it('renders the status hero and tab bar; the Content tab is absent before cloud mode', async () => {
    setSession('sess-1') // default modeBody is pre-cloud
    const w = mount(App)
    await flushPromises()
    // At-a-glance verdict is present (stateBody has no failures → healthy).
    expect(w.find('[data-verdict]').exists()).toBe(true)
    expect(w.find('[data-verdict]').attributes('data-verdict')).toBe('healthy')
    // Overview/Cloud tabs exist; Content does not (not post-cloud).
    const tabIds = w.findAll('[data-tab]').map((b) => b.attributes('data-tab'))
    expect(tabIds).toEqual(['overview', 'cloud'])
    w.unmount()
  })

  it('shows the upgrade rail in local posture and its CTA opens the Cloud tab', async () => {
    // Default postureBody is local; the console auto-mints to the dashboard.
    const w = mount(App)
    await flushPromises()
    expect(w.text()).toContain('Connect to cloud')
    const cta = w.findAll('button').find((b) => b.text() === 'Connect this deployment')!
    await cta.trigger('click')
    expect(w.find('[data-tab="cloud"]').attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('shows and selects the Content tab in cloud mode', async () => {
    setSession('sess-1')
    modeBody = { phase: 'post-cloud', authDisabled: false, cloudFileWritten: true, restartPending: false }
    const w = mount(App)
    await flushPromises()
    await flushPromises()
    const content = w.find('[data-tab="content"]')
    expect(content.exists()).toBe(true)
    // Overview is the default; selecting Content flips the aria-selected state.
    expect(w.find('[data-tab="overview"]').attributes('aria-selected')).toBe('true')
    await content.trigger('click')
    expect(content.attributes('aria-selected')).toBe('true')
    expect(w.find('[data-tab="overview"]').attributes('aria-selected')).toBe('false')
    w.unmount()
  })
})
