// Standalone PKCE for the console's cloud sign-in. The operator authenticates against the
// deployment's own per-team Cognito client (from /api/mode), lands back on the console's own
// /auth/callback, and the resulting ID token lives only in memory (see api.ts). This is reimplemented
// rather than shared with dt-ui — the console is a separate app and imports none of it.

const VERIFIER_KEY = 'console_pkce_verifier'
const STATE_KEY = 'console_pkce_state'

export interface OidcConfig {
  domain: string
  clientId: string
  scope: string
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: ArrayBuffer): string {
  const s = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  if (!window.isSecureContext || !crypto.subtle) {
    throw new Error(
      'Cloud sign-in needs a secure context (https, or a localhost address). Enable TLS at the front door first (byodt tls generate).',
    )
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(digest)
}

// OIDC_DOMAIN is a BARE HOST by contract — the recipe producer validates that shape, and the console
// now refuses anything else at the paste. Prepending unconditionally is therefore not a guess, it is
// the contract. The previous `startsWith('http')` form was wrong in both directions: it honoured a
// value that carried its own scheme, letting a recipe name the authorization endpoint this browser is
// sent to outright, and it misread a legitimate bare host that merely begins with those four letters
// (httpbin.example) as a full URL.
function oauthBase(domain: string): string {
  return `https://${domain}`
}

// The console's own PKCE redirect target — its origin plus the SPA base plus auth/callback (e.g.
// https://host/console/auth/callback when fronted under /console/). Distinct from the deployment's
// OIDC_REDIRECT_URI (the front door's own /auth/callback), which CloudPanel derives from the front door origin.
export function consoleRedirectUri(): string {
  return window.location.origin + import.meta.env.BASE_URL + 'auth/callback'
}

// beginSignIn generates PKCE material, stashes the verifier and state, and returns the Cognito
// authorize URL to redirect to.
export async function beginSignIn(cfg: OidcConfig, redirectUri: string): Promise<string> {
  const verifier = randomHex(64)
  const state = randomHex(16)
  const challenge = await challengeFor(verifier)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope || 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${oauthBase(cfg.domain)}/oauth2/authorize?${params.toString()}`
}

// completeSignIn validates the returned state, exchanges the code for tokens, and returns the ID
// token. The stashed PKCE material is cleared regardless of outcome.
export async function completeSignIn(
  cfg: OidcConfig,
  redirectUri: string,
  code: string,
  state: string,
): Promise<string> {
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  if (!expectedState || state !== expectedState) throw new Error('sign-in state mismatch')
  if (!verifier) throw new Error('sign-in verifier missing')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
  const res = await fetch(`${oauthBase(cfg.domain)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  const tokens = (await res.json()) as { id_token?: string }
  if (!tokens.id_token) throw new Error('no id token in the token response')
  return tokens.id_token
}
