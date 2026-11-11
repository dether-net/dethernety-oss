/**
 * Failures of the identity provider's token and revocation endpoints, described
 * without their bodies.
 *
 * An endpoint's error body can echo the submitted form — the authorization code,
 * the verifier or the refresh token — and these messages reach the model. Only the
 * HTTP status and a standard OAuth error code survive.
 */

/** The error codes RFC 6749 and RFC 7009 define for these endpoints. */
const OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'unsupported_token_type',
  'access_denied',
  'server_error',
  'temporarily_unavailable'
])

/** A failed endpoint response: the status and, when standard, the OAuth error code. */
export class TokenEndpointError extends Error {
  constructor(
    what: string,
    readonly status: number,
    readonly oauthError?: string
  ) {
    super(`${what} failed: HTTP ${status}${oauthError ? ` (${oauthError})` : ''}`)
    this.name = 'TokenEndpointError'
  }
}

/** Build the error for a failed response, reading only its OAuth `error` field. */
export async function endpointFailure(
  what: string,
  response: { status: number; text(): Promise<string> }
): Promise<TokenEndpointError> {
  let code: string | undefined
  try {
    const parsed = JSON.parse(await response.text()) as { error?: unknown }
    if (typeof parsed.error === 'string' && OAUTH_ERRORS.has(parsed.error)) code = parsed.error
  } catch {
    // Not JSON: the status alone is reported.
  }
  return new TokenEndpointError(what, response.status, code)
}
