/**
 * OAuth Callback Server
 *
 * A temporary loopback HTTP server for one sign-in. It serves two routes:
 * - `/start` redirects the browser to the pending authorization URL, so that URL
 *   (with its state and PKCE challenge) never has to pass through a launcher's
 *   command line;
 * - `/callback` receives the identity provider's redirect.
 * The server closes after the callback or on timeout.
 *
 * What it defends against, and what it does not:
 * - every request must carry the Host of the bound port (DNS rebinding);
 * - web subresource requests are refused by their fetch metadata;
 * - a callback settles the sign-in only with the expected `state`, so a request
 *   that does not know it (a web page, a blind local probe) can neither complete
 *   nor cancel it;
 * - PKCE binds the code to this server's verifier.
 * A local process that can reach the port can still read `/start` while the
 * sign-in is pending, and with it the state and challenge.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
import { timingSafeEqual } from 'crypto'
import { URL } from 'url'
import { debug } from '../config.js'

/** Default callback port */
export const DEFAULT_CALLBACK_PORT = 9876

/** Default timeout for waiting for callback (2 minutes) */
export const DEFAULT_TIMEOUT = 120000

/**
 * Result from OAuth callback
 */
export interface CallbackResult {
  /** Authorization code from OAuth provider */
  code: string
  /** State parameter for CSRF validation */
  state: string
}

/**
 * OAuth callback server instance
 */
export interface CallbackServer {
  /** Port the server is listening on */
  port: number
  /** Full callback URL (the redirect URI registered with the identity provider) */
  callbackUrl: string
  /** Local URL that redirects to the pending authorization URL */
  startUrl: string
  /** Register the authorization URL `/start` redirects to */
  setAuthorizationUrl: (url: string) => void
  /** Wait for the OAuth callback */
  waitForCallback: () => Promise<CallbackResult>
  /** Close the server */
  /** Settle a pending wait as cancelled, then close; resolves once the port is free */
  cancel: () => Promise<void>
  /** Close the server; resolves once the port is free */
  close: () => Promise<void>
}

/** The sign-in wait ended without a callback: cancelled, or its lifetime ran out. */
export class CallbackAbandoned extends Error {
  constructor(readonly reason: 'cancelled' | 'expired') {
    super(reason === 'cancelled' ? 'The sign-in was cancelled' : 'The sign-in window expired')
    this.name = 'CallbackAbandoned'
  }
}

/**
 * The callback port is taken. `otherProgram` is set when only the IPv6 side is
 * taken: this server always binds both, so that holder is not a Dethereal session.
 */
export class CallbackPortBusy extends Error {
  constructor(readonly port: number, readonly otherProgram: boolean) {
    super(`Port ${port} is already in use`)
    this.name = 'CallbackPortBusy'
  }
}

/**
 * Success page HTML shown to user after successful auth
 * Styled to match AWS Cognito Managed Login branding
 */
const SUCCESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful - Dethernety</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #2d3748;
    }
    .container {
      text-align: center;
      background-color: #212121;
      padding: 3rem;
      border-radius: 8px;
      border: 1px solid #4a5568;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      max-width: 400px;
    }
    .checkmark {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background-color: #2a9d8f;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 2rem;
      color: white;
    }
    h1 { color: #ffffff; margin: 0 0 0.75rem; font-size: 1.5rem; }
    p { color: #a0aec0; margin: 0; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Authentication Successful</h1>
    <p>You can close this window and return to your agent.</p>
  </div>
</body>
</html>
`

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Error page HTML shown when auth fails
 */
const ERROR_HTML = (error: string, description?: string) => `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Failed - Dethernety</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #2d3748;
    }
    .container {
      text-align: center;
      background-color: #212121;
      padding: 3rem;
      border-radius: 8px;
      border: 1px solid #4a5568;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      max-width: 400px;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background-color: #e53e3e;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 2rem;
      color: white;
    }
    h1 { color: #ffffff; margin: 0 0 0.75rem; font-size: 1.5rem; }
    p { color: #a0aec0; margin: 0; font-size: 0.95rem; }
    .error-details {
      color: #fc8181;
      margin-top: 1rem;
      font-size: 0.85rem;
      padding: 0.75rem;
      background-color: rgba(229, 62, 62, 0.1);
      border-radius: 4px;
      border: 1px solid rgba(229, 62, 62, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">✗</div>
    <h1>Authentication Failed</h1>
    <p>There was an error during authentication.</p>
    <p class="error-details">${escapeHtml(error)}${description ? `: ${escapeHtml(description)}` : ''}</p>
  </div>
</body>
</html>
`

/** Headers every response carries. */
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
}

/** Headers of the HTML pages: inline styles only, never framed. */
const PAGE_HEADERS = {
  ...BASE_HEADERS,
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
}

/** The OAuth `error` code as RFC 6749 shapes it, or undefined for anything else. */
function oauthErrorCode(value: string | null): string | undefined {
  return value && /^[a-z_]{1,64}$/.test(value) ? value : undefined
}

function page(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, PAGE_HEADERS)
  res.end(html)
}

function plain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

/**
 * Start a temporary OAuth callback server
 *
 * Listens on both loopback addresses: the redirect URI names `localhost`, which
 * browsers may resolve to either, and an address left free could be taken by
 * another process to receive the redirect.
 *
 * @param options.state - The state the authorization request carries; the only one a callback may settle with
 * @param options.port - Port to bind (0 = any free port)
 * @param options.timeout - How long waitForCallback waits
 * @returns Callback server instance
 */
export async function startCallbackServer(options: {
  state: string
  port?: number
  timeout?: number
}): Promise<CallbackServer> {
  const requestedPort = options.port ?? DEFAULT_CALLBACK_PORT
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const expectedState = Buffer.from(options.state)

  let port = requestedPort
  let authorizationUrl: string | undefined
  let closed = false
  const servers: Server[] = []

  // Callback outcome buffering — the handler settles EAGERLY so a redirect
  // that lands before the caller invokes waitForCallback() (cached IdP
  // session → near-instant callback, browser is opened before the wait
  // starts) is captured instead of dropped.
  let settled = false
  let bufferedOutcome: { result?: CallbackResult; error?: Error } | undefined
  let callbackPromise: {
    resolve: (result: CallbackResult) => void
    reject: (error: Error) => void
  } | undefined

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (!closing) {
      closed = true
      closing = Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve())
              server.closeAllConnections()
            })
        )
      ).then(() => debug('OAuth callback server closed'))
    }
    return closing
  }

  const settleCallback = (outcome: { result?: CallbackResult; error?: Error }) => {
    if (settled) return
    settled = true
    bufferedOutcome = outcome
    if (callbackPromise) {
      if (outcome.result) callbackPromise.resolve(outcome.result)
      else callbackPromise.reject(outcome.error!)
    }
    // A short delay lets the response reach the browser first.
    setTimeout(() => void close(), 100).unref()
  }

  const cancel = (): Promise<void> => {
    settleCallback({ error: new CallbackAbandoned('cancelled') })
    return close()
  }

  const waitForCallback = (): Promise<CallbackResult> => {
    return new Promise((res, rej) => {
      // Callback already arrived before the wait started — deliver it now.
      if (settled && bufferedOutcome) {
        if (bufferedOutcome.result) res(bufferedOutcome.result)
        else rej(bufferedOutcome.error!)
        return
      }

      // Arm the timeout only once someone is actually waiting.
      const timeoutId = setTimeout(() => {
        settleCallback({ error: new CallbackAbandoned('expired') })
        void close()
      }, timeout)

      callbackPromise = {
        resolve: (result: CallbackResult) => {
          clearTimeout(timeoutId)
          res(result)
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          rej(error)
        }
      }
    })
  }

  const stateMatches = (given: string | null): boolean => {
    if (given === null) return false
    const candidate = Buffer.from(given)
    return candidate.length === expectedState.length && timingSafeEqual(candidate, expectedState)
  }

  /** Exactly one Host header, naming a loopback name and the bound port. */
  const hostAllowed = (req: IncomingMessage): boolean => {
    const count = req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'host').length
    const host = req.headers.host?.toLowerCase()
    return count === 1 && (host === `127.0.0.1:${port}` || host === `localhost:${port}`)
  }

  const handleStart = (req: IncomingMessage, res: ServerResponse) => {
    const pending = authorizationUrl !== undefined && !settled && !closed
    if (!pending || req.method !== 'GET') {
      plain(res, 404, 'Not Found')
      return
    }
    // Only a browser opening the page gets the redirect: a tool or script
    // fetching /start would otherwise copy the sign-in URL (state, challenge)
    // into whatever it prints. A guard against accidents, not a boundary —
    // headers can be forged.
    if (req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'document') {
      plain(res, 400, 'Open this link in a web browser to sign in.')
      return
    }
    debug('Redirecting to the sign-in page')
    res.writeHead(302, { ...BASE_HEADERS, Location: authorizationUrl!, 'Content-Length': '0' })
    res.end()
  }

  const handleCallback = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (req.method !== 'GET') {
      plain(res, 404, 'Not Found')
      return
    }
    // Nothing a request without the pending state sends is believed or echoed:
    // it neither completes nor cancels the sign-in.
    const validState = stateMatches(url.searchParams.get('state'))
    if (settled && validState) {
      // This sign-in's own response, after it was completed or cancelled: if the
      // user did not just complete it, someone else may have.
      page(res, 400, ERROR_HTML(
        'already_completed',
        'This sign-in was already completed or cancelled. If you did not just finish it, sign out and sign in again'
      ))
      return
    }
    if (settled || !validState) {
      page(res, 400, ERROR_HTML('invalid_request', 'This sign-in response does not belong to a pending sign-in'))
      return
    }

    const error = url.searchParams.get('error')
    if (error !== null) {
      // Only an RFC-shaped error code travels on; the description is the
      // provider's free text and is shown to the user, escaped, and nowhere else.
      const code = oauthErrorCode(error)
      const description = url.searchParams.get('error_description')?.slice(0, 200)
      debug(`OAuth error: ${code ?? 'unrecognised'}`)
      page(res, 400, ERROR_HTML(code ?? 'error', description || undefined))
      settleCallback({ error: new Error(code ? `OAuth error: ${code}` : 'OAuth error') })
      return
    }

    const code = url.searchParams.get('code')
    if (!code) {
      page(res, 400, ERROR_HTML('missing_code', 'Authorization code not received'))
      settleCallback({ error: new Error('Authorization code not received') })
      return
    }

    debug('Received authorization code')
    page(res, 200, SUCCESS_HTML)
    // Settle the callback outcome (buffered if no one is waiting yet)
    settleCallback({ result: { code, state: url.searchParams.get('state')! } })
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (!hostAllowed(req)) {
      plain(res, 400, 'Bad Request')
      return
    }
    // Web pages can reach loopback too; only a top-level navigation is served.
    const fetchMode = req.headers['sec-fetch-mode']
    if (fetchMode !== undefined && fetchMode !== 'navigate') {
      plain(res, 400, 'Bad Request')
      return
    }
    // Origin-form targets only: an absolute or scheme-relative target would be
    // routed by a path the client never asked for.
    const target = req.url ?? ''
    let url: URL
    try {
      if (!target.startsWith('/') || target.startsWith('//')) throw new Error('not origin-form')
      url = new URL(target, `http://localhost:${port}`)
    } catch {
      plain(res, 400, 'Bad Request')
      return
    }

    if (url.pathname === '/start') {
      handleStart(req, res)
    } else if (url.pathname === '/callback') {
      debug('Received callback request')
      handleCallback(req, res, url)
    } else {
      plain(res, 404, 'Not Found')
    }
  }

  const listen = (host: string, onPort: number) =>
    new Promise<Server>((resolve, reject) => {
      const server = createServer(handleRequest)
      server.once('error', reject)
      server.listen(onPort, host, () => {
        server.off('error', reject)
        resolve(server)
      })
    })

  const inUse = (otherProgram: boolean) => new CallbackPortBusy(requestedPort, otherProgram)

  for (let attempt = 0; ; attempt++) {
    let v4: Server
    try {
      v4 = await listen('127.0.0.1', requestedPort)
    } catch (err) {
      throw (err as NodeJS.ErrnoException).code === 'EADDRINUSE' ? inUse(false) : err
    }
    port = (v4.address() as { port: number }).port
    try {
      servers.push(v4, await listen('::1', port))
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
        // No IPv6 loopback on this host: nothing else can take it either.
        servers.push(v4)
        break
      }
      v4.close()
      // An ephemeral port may be free on one address only; try another.
      if (code === 'EADDRINUSE' && requestedPort === 0 && attempt < 5) continue
      throw code === 'EADDRINUSE' ? inUse(true) : err
    }
  }

  debug(`OAuth callback server started on port ${port}`)

  return {
    port,
    callbackUrl: `http://localhost:${port}/callback`,
    startUrl: `http://127.0.0.1:${port}/start`,
    setAuthorizationUrl: (url: string) => {
      authorizationUrl = url
    },
    waitForCallback,
    cancel,
    close
  }
}
