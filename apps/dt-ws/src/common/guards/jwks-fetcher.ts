/**
 * The JWKS fetch behind the JWT guard, handed to jwks-rsa as its `fetcher`.
 *
 * It goes through the global `fetch`, so the request follows whatever the
 * process routes `fetch` through, and trusts Node's default roots (which
 * include NODE_EXTRA_CA_CERTS). jwks-rsa's own `https.request` path does
 * neither once an explicit agent is passed.
 *
 * Kept free of jwks-rsa imports so unit tests can load it.
 *
 * Rules:
 *   - https only, or http to a loopback host;
 *   - `redirect: 'error'`: a 3xx would let another origin supply the keys;
 *   - a bounded timeout, covering the body read (jwks-rsa's own 30 s default
 *     does not apply to a custom fetcher);
 *   - a non-2xx answer, an oversized body, non-JSON, or JSON without a `keys`
 *     array is an error;
 *   - errors name the host at most, never the URL.
 */

/** The `fetch`-shaped function the fetcher calls. Global `fetch` by default; a
 * test injects a mock here (no sockets). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The shape jwks-rsa expects back: it reads `keys` and nothing else. */
export interface JwksDocument {
  keys: unknown[];
}

export interface JwksFetcherOptions {
  /** Injected in tests; defaults to the Node global `fetch`. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/** jwks-rsa's own default request timeout. */
export const JWKS_FETCH_TIMEOUT_MS = 30_000;

/** A JWKS document is a few kilobytes; anything near this is not one. */
export const JWKS_MAX_BODY_BYTES = 1024 * 1024;

export class JwksFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwksFetchError';
  }
}

export function createJwksFetcher(
  options: JwksFetcherOptions = {},
): (jwksUri: string) => Promise<JwksDocument> {
  // Bind so a bare global `fetch` keeps its expected `this`.
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? JWKS_FETCH_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? JWKS_MAX_BODY_BYTES;

  return async (jwksUri: string): Promise<JwksDocument> => {
    const url = checkJwksUrl(jwksUri);
    const host = url.host;
    const signal = AbortSignal.timeout(timeoutMs);

    let body: Buffer;
    try {
      const response = await fetchImpl(url.href, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new JwksFetchError(`JWKS endpoint at ${host} answered HTTP ${response.status}`);
      }
      body = await readCapped(response, maxBodyBytes, signal, host);
    } catch (err) {
      if (err instanceof JwksFetchError) throw err;
      throw new JwksFetchError(`JWKS request to ${host} failed: ${describe(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      // The parser's message quotes the body, so it is not passed on.
      throw new JwksFetchError(`JWKS response from ${host} is not JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as JwksDocument).keys)) {
      throw new JwksFetchError(`JWKS response from ${host} has no keys array`);
    }
    return { keys: (parsed as JwksDocument).keys };
  };
}

function checkJwksUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JwksFetchError('JWKS URI is not a valid URL');
  }
  // fetch() refuses credentials in the URL with a message that repeats it.
  if (url.username || url.password) {
    throw new JwksFetchError(`JWKS URI for ${url.hostname} must not carry credentials`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
  throw new JwksFetchError(`JWKS URI for ${url.hostname} must be https (or http on a loopback host)`);
}

function isLoopbackHost(hostname: string): boolean {
  // URL has already normalised IPv4 to dotted quads and wrapped IPv6 in brackets.
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/** Read the body, aborting once it passes `maxBytes`. Content-Length is checked
 * first but not relied on: a chunked answer has none. */
async function readCapped(response: Response, maxBytes: number, signal: AbortSignal, host: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new JwksFetchError(`JWKS response from ${host} exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  // Global fetch aborts its own body stream on the signal; an injected fetch may
  // not, so a stalled read is cancelled here as well.
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JwksFetchError(`JWKS response from ${host} exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// Read by shape, not `instanceof Error`: the abort reason is a DOMException, which
// is not an Error from every realm.
type ErrorLike = { name?: unknown; message?: unknown; cause?: unknown };

function describe(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'unknown error';
  const { name, message, cause } = err as ErrorLike;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (typeof message !== 'string') return 'unknown error';
  // fetch() reports every network failure as "fetch failed"; the reason is the cause.
  const causeMessage = typeof cause === 'object' && cause !== null ? (cause as ErrorLike).message : undefined;
  return typeof causeMessage === 'string'
    ? `${redactUserinfo(message)} (${redactUserinfo(causeMessage)})`
    : redactUserinfo(message);
}

/** `text` with the user and password of any URL in it masked: a proxy's error can
 * carry its address in full, and the guard logs these messages. */
function redactUserinfo(text: string): string {
  return text.replace(/:\/\/[^/?#\s]*@/g, '://***@');
}
