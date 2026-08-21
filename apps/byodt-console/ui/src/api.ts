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
// One artifact a package grants. `kind` is public protocol vocabulary — 'code-module' is installed onto
// this deployment, 'application' is used from the portal — and it is what decides whether installing is
// even a thing this artifact does. `latest` is the highest version that has not been withdrawn, and it is
// ABSENT when every published version has been: the console then shows the artifact as unavailable rather
// than as an update it could offer.
export interface CatalogArtifact {
  key: string
  name: string
  kind: string
  target?: string
  description?: string
  latest?: string
}

export interface CatalogPackage {
  key: string
  name: string
  description?: string
  version: string
  modules: CatalogModule[]
  // Always present and never null — the daemon initialises it so a package cannot describe the same
  // absence two different ways (an empty module list beside a null artifact list).
  artifacts: CatalogArtifact[]
  error?: string
  // Whether this deployment is subscribed to the package. Undefined = undetermined (the recipe predates
  // the DEPLOYMENT_PACKAGES variable) — do not gate; false = not subscribed (mounting is inert).
  entitled?: boolean
}

// One mounted stub plus whether a newer content version is available. `currency` is 'current' when the
// pin matches the catalog's latest, 'outdated' when a newer pin exists (then latestPin/latestVersion are
// set), 'unknown' when the catalog could not be consulted, and 'incomplete' when the console owns the
// directory but the platform has nothing loadable in it — see the field below.
export interface MountedModule {
  packageKey: string
  moduleKey: string
  name?: string
  pin: string
  mountedAt?: string
  // 'incomplete' is the mount's half state: the console owns the directory but the module file the
  // platform loads is not in it. It is the daemon's judgement, not a derived one — the marker is written
  // before the stub, so the two stopped being the same question.
  currency: 'current' | 'outdated' | 'unknown' | 'incomplete'
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

// One installed artifact and its update state relative to the catalog. `currency` carries a fourth value
// the mounts do not have: 'unavailable' means every published version has been withdrawn, which is neither
// up to date nor unknown. `kind` and `name` come only from the catalog, so BOTH are empty when it could not
// be reached — an empty kind is not a default and must never be read as one.
export interface InstalledArtifact {
  artifactKey: string
  version: string
  kind?: string
  name?: string
  installedAt?: string
  currency: 'current' | 'outdated' | 'unknown' | 'unavailable'
  latestVersion?: string
}

export interface InstallArtifactRequest {
  artifactKey: string
  version: string
  // Set ONLY after the operator has confirmed a named earlier version. The daemon refuses a downgrade
  // without it, which is what stops a service that withdrew a fixed version from walking a deployment
  // backwards onto a known-bad one.
  allowDowngrade?: boolean
}

export interface InstallArtifactResult {
  status: string
  artifactKey: string
  version: string
  message: string
}

// `consequence` repeats what the removal does to the graph. It is on the answer as well as on the modules
// read because the operator may have arrived from a reload and never seen the confirmation that carried it.
export interface RemoveArtifactResult {
  status: string
  artifactKey: string
  message: string
  consequence: string
}

export interface PackagesResponse {
  packages: CatalogPackage[]
}

// The deployment's knowledge-graph connection, when it has one. It is reported apart from the content
// mounts because it is a different thing — a client for a service, holding no graph data of its own —
// and `version` is the pin the platform actually reads, not a copy kept beside the mount.
export interface KnowledgeGraphConnection {
  version: string
  mountedAt?: string
}

// note is a non-fatal reason (e.g. the catalog was unreachable so currency could not be judged); the
// inventory itself is local and always present. knowledgeGraph is absent unless one is connected.
export interface ModulesResponse {
  modules: MountedModule[]
  knowledgeGraph?: KnowledgeGraphConnection
  // Always an array, like modules. artifactRemovalNotice is present only when there is an artifact it
  // could apply to — it is on this read so the panel can show it BEFORE the operator confirms a removal.
  artifacts: InstalledArtifact[]
  artifactRemovalNotice?: string
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

import type { CloudTokens } from './auth'

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
  // The tokens end with the session. Every gated call needs the session header anyway, so a token kept
  // past this point can only be re-sent on a request that will be rejected again — and request()'s 401
  // path lands here while ContentModules swallows the SessionExpired it throws, which is how a token
  // used to outlive the session that carried it with nothing to notice.
  clearCloudTokens()
}

export function hasSession(): boolean {
  return sessionId !== ''
}

// The operator's Cognito tokens — held in memory ONLY (never persisted; they are obtained fresh on each
// sign-in, and only the derived session id survives a reload). The ID token is attached as a bearer on
// EVERY gated request, so the daemon can forward it to the platform's authenticated module query. The
// access token is attached by NOTHING automatically: it belongs to a different audience and rides on
// its own header, on the one route that forwards it.
//
// One setter and one clearer over both, deliberately. They come from one token exchange and expire on
// one clock, so a pair of independent setters would only make it possible to establish one and forget
// the other.
//
// WHAT AN EMPTY TOKEN MEANS — two states, opposite remedies, and telling them apart is the difference
// between a recovery and a loop:
//   idToken === ''                          a reloaded tab. Both are memory-only and set only in the
//                                           sign-in callback, so this is "sign in again".
//   idToken !== '' && accessToken === ''    the token exchange returned no access_token, i.e. this
//                                           deployment's OIDC_SCOPE lacks the content.access scope.
//                                           Signing in again returns the same empty token forever; the
//                                           remedy is to regenerate the recipe and reconnect.
let idToken = ''
let accessToken = ''

export function setCloudTokens(t: CloudTokens): void {
  idToken = t.idToken
  accessToken = t.accessToken
}

export function clearCloudTokens(): void {
  idToken = ''
  accessToken = ''
}

// cloudAccessToken is read by the callers that forward it, one request at a time. Nothing else reads it
// and request() never attaches it.
export function cloudAccessToken(): string {
  return accessToken
}

// The three states the comment above enumerates, as one value. A caller branches on the state rather than
// re-deriving it from two readers, and the judgement lives beside the comment that defines it — so a
// component cannot end up with fewer arms than there are states, which is exactly how the two empty-token
// cases came to share one remedy and one of them became a loop.
export type CloudCredential = 'ready' | 'signed-out' | 'no-content-scope'

export function cloudCredential(): CloudCredential {
  if (idToken === '') return 'signed-out'
  if (accessToken === '') return 'no-content-scope'
  return 'ready'
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
  // is empty and nothing is attached. The ACCESS token is deliberately not attached here — a different
  // audience cannot share this header, and only the routes that forward it may carry it.
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`)
  const res = await fetch(BASE + path, { ...init, headers })
  if (res.status === 401) {
    clearSession()
    throw new SessionExpired()
  }
  if (!res.ok) {
    // The daemon returns actionable reasons as the response body (e.g. a rejected recipe naming
    // the variable at fault), so surface it — and the status, so callers can branch on
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

const CLOUD_TOKEN_HEADER = 'X-Console-Cloud-Token'

// postEntitled is the ONE call that forwards the operator's access token, and two things about it are
// deliberate.
//
// It is a CALLER of request(), never a bypass of it. The route is session-gated like every other, so
// skipping request() would drop the session header and earn a 401 — which this file turns into
// clearSession() and a bounce to the sign-in card, the exact outcome the daemon returns 400 instead of 401
// to prevent.
//
// And it is its own function rather than a header parameter on post(), because a shared parameter is one
// edit away from attaching this token to a call that must never carry it. The header is omitted rather
// than sent empty: a caller with no token is expected to have re-signed in before it got here.
function postEntitled<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = cloudAccessToken()
  if (token) headers[CLOUD_TOKEN_HEADER] = token
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), headers })
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
export async function mintCloud(tokens: CloudTokens): Promise<string> {
  const res = await fetch(BASE + '/api/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.idToken}` },
  })
  if (res.status === 503) throw new Error('could not verify sign-in — the platform may be starting or busy; retry')
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
  const body = (await res.json()) as { session: string }
  setSession(body.session)
  // Both, in one call. The access token is stored and not sent: this request authenticates to the
  // daemon with the ID token, and the access token is for a different service entirely.
  setCloudTokens(tokens)
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
  // Entitled artifacts. Installing one asks the content service for bytes it hands only to a subscriber,
  // so it forwards the operator's own access token; removing one is a local file operation and carries no
  // credential, exactly like an unmount.
  installArtifact: (req: InstallArtifactRequest) => postEntitled<InstallArtifactResult>('/api/artifacts', req),
  removeArtifact: (key: string) => del<RemoveArtifactResult>(`/api/artifacts/${encodeURIComponent(key)}`),
}
