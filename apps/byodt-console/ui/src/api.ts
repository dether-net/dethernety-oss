// Typed client for the console daemon's /api surface. The interfaces mirror the Go JSON
// tags in internal/daemoncmd (server.go, state_view.go) and internal/initcmd/state.go
// exactly — this file is the one place the wire contract is named on the browser side.

export type Phase = 'pre-cloud' | 'authenticated' | 'post-cloud' | 'platform-unreachable'

export interface ModeView {
  phase: Phase
  authDisabled: boolean
  // Shown in the phase badge. The client/scope/domain the initial PKCE sign-in needs come from the
  // ungated PostureView, not here — so the mode view carries only the issuer.
  oidcIssuer?: string
  // True when the console has written a cloud mode-layer file (lets the UI offer disconnect). Read
  // from disk, not the platform.
  cloudFileWritten: boolean
  // True when the written mode file's intent disagrees with what the platform is actually running —
  // a change is written but not yet applied (in either direction). Drives the "recreate" banner.
  restartPending: boolean
  // The signed-in subject, for display in the header. Present only in cloud posture (a local session
  // mints with no credential, so there is no user); either field may be empty depending on token claims.
  user?: { email?: string; name?: string }
}

// PostureView is the ungated read the sign-in surface needs before any session exists: which sign-in
// to render (posture), and — in cloud — the public OIDC discovery values the PKCE flow runs against.
// Mirrors the daemon's hard five-field projection of the mode file (server.go postureView); it never
// carries the allowlist or the other non-discovery values that file also holds.
export interface PostureView {
  posture: 'cloud' | 'local'
  authDisabled: boolean
  oidcDomain?: string
  oidcClientId?: string
  oidcScope?: string
}

export interface CloudResult {
  status: string
  message: string
}

// ModulesState.status ∈ ok | unreachable | no-assets | did-not-verify | partial | failed |
// skipped-unchanged; ModuleOutcome.outcome ∈ placed | skipped | failed.
export interface ModuleOutcome {
  name: string
  version: string
  outcome: string
  detail?: string
}

export interface ModulesState {
  status: string
  detail?: string
  expected: ModuleOutcome[]
}

export interface IngestState {
  status: string
  statements?: number
  elapsedMs?: number
  detail?: string
  contentHash?: string
}

// A failure banner. `kind` is one of the daemon's failure constants; the UI keys severity and
// copy off it. `modules` is populated only for fewer-modules-registered.
export interface Failure {
  kind: string
  message: string
  modules?: string[]
}

export interface StateView {
  initRan: boolean
  tag?: string
  ranAt?: string
  modules: ModulesState
  ingest: IngestState
  failures: Failure[]
}

// One module in the public catalog, at its package's latest version. contentHash is the pin a mount
// carries.
export interface CatalogModule {
  key: string
  name: string
  version: string
  contentHash: string
  // A short blurb from the content service, shown inline under the module. Optional — absent until the
  // catalog carries it.
  description?: string
}

// One package in the public catalog, resolved to its latest version's mountable modules. `error` is a
// per-package resolution note (e.g. the package's modules could not be loaded) that leaves the rest of
// the catalog intact.
export interface CatalogPackage {
  key: string
  name: string
  description?: string
  version: string
  modules: CatalogModule[]
  error?: string
  // Whether this deployment is subscribed to the package. Undefined = undetermined (the recipe predates
  // the DEPLOYMENT_PACKAGES variable) — do not gate; false = not subscribed (mounting is inert).
  entitled?: boolean
}

// One mounted stub plus whether a newer content version is available. `currency` is 'current' when the
// pin matches the catalog's latest, 'outdated' when a newer pin exists (then latestPin/latestVersion are
// set), and 'unknown' when the catalog could not be consulted.
export interface MountedModule {
  packageKey: string
  moduleKey: string
  name?: string
  pin: string
  mountedAt?: string
  currency: 'current' | 'outdated' | 'unknown'
  latestPin?: string
  latestVersion?: string
}

export interface MountRequest {
  packageKey: string
  moduleKey: string
  pin: string
}

export interface MountResult {
  status: string
  message: string
}

export interface PackagesResponse {
  packages: CatalogPackage[]
}

// note is a non-fatal reason (e.g. the catalog was unreachable so currency could not be judged); the
// inventory itself is local and always present.
export interface ModulesResponse {
  modules: MountedModule[]
  note?: string
}

// SessionExpired is thrown when a gated route returns 401 — the session the daemon minted is no
// longer live (a daemon restart drops in-memory sessions). The caller returns to the sign-in card.
export class SessionExpired extends Error {
  constructor() {
    super('session expired')
    this.name = 'SessionExpired'
  }
}

// ApiError carries a failed request's HTTP status alongside the daemon's plain-text reason, so callers
// can act on the status (e.g. a 403 allowlist rejection needs its own recovery) rather than string-match
// the message. Its message is the reason, so existing `catch (e) { e.message }` sites are unchanged.
export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail || `request failed: ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

const SESSION_HEADER = 'X-Console-Session'
const SESSION_STORAGE_KEY = 'console_session'

// The derived session id is persisted (never a credential — the OIDC ID token stays in memory only,
// see below) so it survives the full-page redirect the cloud PKCE sign-in performs. It is still sent as
// a header, never a cookie, so the anti-CSRF property is unchanged; sessionStorage is same-origin and
// tab-scoped.
let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY) ?? ''

export function setSession(id: string): void {
  sessionId = id
  sessionStorage.setItem(SESSION_STORAGE_KEY, id)
}

export function clearSession(): void {
  sessionId = ''
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
}

export function hasSession(): boolean {
  return sessionId !== ''
}

// The operator's Cognito ID token — held in memory ONLY (never persisted; it is obtained fresh on
// each sign-in) and attached as a bearer only on the cloud re-fetch.
let idToken = ''

export function setIdToken(t: string): void {
  idToken = t
}

export function clearIdToken(): void {
  idToken = ''
}

// The SPA is served under import.meta.env.BASE_URL (e.g. '/console/' behind the shared front door, or
// '/' in isolation). Every request is resolved against it — with the trailing slash trimmed so a
// root-absolute path joins cleanly — so the one build works at either location.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (sessionId) headers.set(SESSION_HEADER, sessionId)
  // In cloud posture the operator's ID token rides along on every gated request, so the daemon can
  // forward it to the platform's authenticated module query. Held in memory only; in local posture it
  // is empty and nothing is attached.
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`)
  const res = await fetch(BASE + path, { ...init, headers })
  if (res.status === 401) {
    clearSession()
    throw new SessionExpired()
  }
  if (!res.ok) {
    // The daemon returns actionable reasons as the response body (e.g. tls/upload's
    // "certificate and key do not match: …"), so surface it — and the status, so callers can branch on
    // it (a 403 allowlist rejection has its own recovery). Pass the raw detail (possibly empty) so a
    // caller's own `e.detail || '…'` fallback still fires; ApiError synthesizes the .message fallback.
    const detail = (await res.text()).trim()
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return request<T>(path, init)
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

// The mint helpers are deliberately not routed through request(): a non-2xx here is a sign-in outcome
// (the daemon never returns 401 on the mint), not an expired session, so it must not trip request()'s
// SessionExpired path. Which one runs is chosen by the posture the sign-in surface read from /api/posture.

// mintLocal establishes a session in local posture (pure-OSS / pre-cloud / own-IdP): the daemon mints
// with no credential — host trust plus the custom header is the whole boundary.
export async function mintLocal(): Promise<string> {
  const res = await fetch(BASE + '/api/session', { method: 'POST' })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
  const body = (await res.json()) as { session: string }
  setSession(body.session)
  return body.session
}

// mintCloud establishes a session in cloud posture by presenting the operator's OIDC ID token, which the
// daemon delegates to the platform for validation. A 503 is "could not verify — retry" (the platform may
// be starting or busy), NOT a definitive token rejection; the caller surfaces it as a retry, not a failure.
export async function mintCloud(token: string): Promise<string> {
  const res = await fetch(BASE + '/api/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 503) throw new Error('could not verify sign-in — the platform may be starting or busy; retry')
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
  const body = (await res.json()) as { session: string }
  setSession(body.session)
  setIdToken(token)
  return body.session
}

export const api = {
  posture: () => get<PostureView>('/api/posture'),
  mode: () => get<ModeView>('/api/mode'),
  state: () => get<StateView>('/api/state'),
  cloudApply: (recipe: string, redirectUri: string) =>
    post<CloudResult>('/api/cloud', { recipe, redirectUri }),
  cloudDisable: () => del<CloudResult>('/api/cloud'),
  // Content mounts. No token: the catalog is public and mounting writes a local file — these carry only
  // the admin session header request() attaches.
  packages: () => get<PackagesResponse>('/api/packages'),
  modules: () => get<ModulesResponse>('/api/modules'),
  mountModule: (req: MountRequest) => post<MountResult>('/api/modules', req),
  unmountModule: (key: string) => del<MountResult>(`/api/modules/${encodeURIComponent(key)}`),
}
