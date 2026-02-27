/**
 * OAuth Callback Server
 *
 * Creates a temporary HTTP server on localhost to receive OAuth callbacks.
 * The server automatically closes after receiving the callback or timing out.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http'
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
  /** Full callback URL */
  callbackUrl: string
  /** Wait for the OAuth callback */
  waitForCallback: () => Promise<CallbackResult>
  /** Close the server */
  close: () => void
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

/**
 * Start a temporary OAuth callback server
 *
 * @param options - Server options
 * @returns Callback server instance
 */
export async function startCallbackServer(options: {
  port?: number
  timeout?: number
} = {}): Promise<CallbackServer> {
  const port = options.port || DEFAULT_CALLBACK_PORT
  const timeout = options.timeout || DEFAULT_TIMEOUT

  return new Promise((resolve, reject) => {
    let server: Server
    let callbackPromise: {
      resolve: (result: CallbackResult) => void
      reject: (error: Error) => void
    }

    // Create the callback promise that will be resolved when we receive the callback
    const waitForCallback = (): Promise<CallbackResult> => {
      return new Promise((res, rej) => {
        callbackPromise = { resolve: res, reject: rej }

        // Set up timeout
        const timeoutId = setTimeout(() => {
          rej(new Error(`OAuth callback timeout after ${timeout}ms`))
          server.close()
        }, timeout)

        // Clear timeout when callback is received
        const originalResolve = callbackPromise.resolve
        callbackPromise.resolve = (result: CallbackResult) => {
          clearTimeout(timeoutId)
          originalResolve(result)
        }
      })
    }

    // Request handler
    const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`)

      debug(`Received request: ${url.pathname}`)

      // Only handle the callback path
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not Found')
        return
      }

      // Check for error response from OAuth provider
      const error = url.searchParams.get('error')
      if (error) {
        const errorDescription = url.searchParams.get('error_description')
        debug(`OAuth error: ${error} - ${errorDescription}`)

        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(ERROR_HTML(error, errorDescription || undefined))

        if (callbackPromise) {
          callbackPromise.reject(new Error(`OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`))
        }
        server.close()
        return
      }

      // Get authorization code and state
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(ERROR_HTML('missing_code', 'Authorization code not received'))

        if (callbackPromise) {
          callbackPromise.reject(new Error('Authorization code not received'))
        }
        server.close()
        return
      }

      debug('Received authorization code')

      // Send success response
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(SUCCESS_HTML)

      // Resolve the callback promise
      if (callbackPromise) {
        callbackPromise.resolve({ code, state: state || '' })
      }

      // Close the server after a short delay to ensure response is sent
      setTimeout(() => server.close(), 100)
    }

    // Create and start server
    server = createServer(handleRequest)

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Close any other applications using this port.`))
      } else {
        reject(err)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      debug(`OAuth callback server started on port ${port}`)

      resolve({
        port,
        callbackUrl: `http://localhost:${port}/callback`,
        waitForCallback,
        close: () => {
          server.close()
          debug('OAuth callback server closed')
        }
      })
    })
  })
}
