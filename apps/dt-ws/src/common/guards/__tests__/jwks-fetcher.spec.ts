import { createJwksFetcher, FetchLike } from '../jwks-fetcher';

/**
 * The JWKS fetcher stands in for jwks-rsa's own request, so every rule that
 * request no longer applies (timeout, a usable return shape) is pinned here.
 */

const JWKS_URI = 'https://idp.example.com/oauth2/jwks?secret=s3cr3t';
const KEYS = [{ kid: 'k1', kty: 'RSA', n: 'abc', e: 'AQAB' }];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** A fetch that answers once with `response` and records what it was asked. */
function fetchReturning(response: Response): jest.Mock<ReturnType<FetchLike>, Parameters<FetchLike>> {
  return jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => response);
}

/** A fetch that never answers, rejecting only when its signal aborts. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  });

/** A body that streams `chunkCount` chunks of `chunkSize` bytes. */
function streamingBody(chunkSize: number, chunkCount: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === chunkCount) return controller.close();
      sent++;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x20));
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

describe('createJwksFetcher()', () => {
  it('returns the keys of a valid JWKS document', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ keys: KEYS, extra: 'ignored' }));
    const fetcher = createJwksFetcher({ fetchImpl });

    await expect(fetcher(JWKS_URI)).resolves.toEqual({ keys: KEYS });
  });

  it('asks fetch to refuse redirects and passes a signal', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ keys: KEYS }));
    await createJwksFetcher({ fetchImpl })(JWKS_URI);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(JWKS_URI);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('times out a request that never answers', async () => {
    const fetcher = createJwksFetcher({ fetchImpl: hangingFetch, timeoutMs: 20 });

    const err = await rejection(fetcher(JWKS_URI));
    expect(err.message).toBe('JWKS request to idp.example.com failed: timeout');
  });

  it('times out a body that stalls after the headers', async () => {
    const stalled = new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { status: 200 });
    const fetcher = createJwksFetcher({ fetchImpl: fetchReturning(stalled), timeoutMs: 20 });

    const err = await rejection(fetcher(JWKS_URI));
    expect(err.message).toBe('JWKS request to idp.example.com failed: timeout');
  });

  describe('URL rules', () => {
    it.each([
      'http://localhost:8080/jwks',
      'http://127.0.0.1/jwks',
      'http://127.10.20.30:9000/jwks',
      'http://[::1]:8080/jwks',
    ])('allows http to a loopback host: %s', async (uri) => {
      const fetchImpl = fetchReturning(jsonResponse({ keys: KEYS }));
      await expect(createJwksFetcher({ fetchImpl })(uri)).resolves.toEqual({ keys: KEYS });
    });

    it.each([
      'http://idp.example.com/jwks',
      'http://10.0.0.5/jwks',
      'http://localhost.example.com/jwks',
      'ftp://idp.example.com/jwks',
      'file:///etc/jwks.json',
    ])('refuses anything else without calling fetch: %s', async (uri) => {
      const fetchImpl = fetchReturning(jsonResponse({ keys: KEYS }));
      const err = await rejection(createJwksFetcher({ fetchImpl })(uri));

      expect(err.message).toMatch(/must be https \(or http on a loopback host\)$/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses credentials in the URL without repeating them', async () => {
      const fetchImpl = fetchReturning(jsonResponse({ keys: KEYS }));
      const err = await rejection(createJwksFetcher({ fetchImpl })('https://user:pw@idp.example.com/jwks'));

      expect(err.message).toBe('JWKS URI for idp.example.com must not carry credentials');
      expect(err.message).not.toContain('pw');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses a value that is not a URL', async () => {
      const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(jsonResponse({})) })('not a url'));
      expect(err.message).toBe('JWKS URI is not a valid URL');
    });
  });

  it('rejects a non-2xx answer without its body', async () => {
    const response = new Response('<html>upstream says no</html>', { status: 502 });
    const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(response) })(JWKS_URI));

    expect(err.message).toBe('JWKS endpoint at idp.example.com answered HTTP 502');
  });

  describe('body cap', () => {
    it('rejects a declared Content-Length over the cap before reading', async () => {
      const response = new Response(streamingBody(16, 1), { status: 200, headers: { 'Content-Length': '2048' } });
      const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(response), maxBodyBytes: 1024 })(JWKS_URI));

      expect(err.message).toBe('JWKS response from idp.example.com exceeds 1024 bytes');
    });

    it('stops reading a body without Content-Length once it passes the cap', async () => {
      const body = streamingBody(256, 1000);
      const response = new Response(body, { status: 200 });
      const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(response), maxBodyBytes: 1024 })(JWKS_URI));

      expect(err.message).toBe('JWKS response from idp.example.com exceeds 1024 bytes');
    });

    it('accepts a body exactly at the cap', async () => {
      const doc = JSON.stringify({ keys: KEYS });
      const padded = doc.padEnd(1024, ' ');
      const response = new Response(padded, { status: 200 });

      await expect(createJwksFetcher({ fetchImpl: fetchReturning(response), maxBodyBytes: 1024 })(JWKS_URI))
        .resolves.toEqual({ keys: KEYS });
    });
  });

  describe('document shape', () => {
    it('rejects a body that is not JSON, without quoting it', async () => {
      const response = new Response('<html>login page</html>', { status: 200 });
      const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(response) })(JWKS_URI));

      expect(err.message).toBe('JWKS response from idp.example.com is not JSON');
    });

    it.each([
      ['an object without keys', { issuer: 'x' }],
      ['keys that are not an array', { keys: { kid: 'k1' } }],
      ['a bare array', KEYS],
      ['null', null],
      ['a string', 'keys'],
    ])('rejects %s', async (_label, body) => {
      const err = await rejection(createJwksFetcher({ fetchImpl: fetchReturning(jsonResponse(body)) })(JWKS_URI));
      expect(err.message).toBe('JWKS response from idp.example.com has no keys array');
    });
  });

  it('names the host but never the URL when fetch itself fails', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    };
    const err = await rejection(createJwksFetcher({ fetchImpl })(JWKS_URI));

    expect(err.message).toBe('JWKS request to idp.example.com failed: fetch failed (unexpected redirect)');
    expect(err.message).not.toContain('s3cr3t');
    expect(err.message).not.toContain('/oauth2/jwks');
  });

  it('masks the credentials a proxy error carries, in the message and in the cause', async () => {
    const proxyUrl = 'http://alice:pa@ss@proxy.example:3128';
    const fetchImpl: FetchLike = async () => {
      throw new TypeError(`proxy ${proxyUrl} refused`, { cause: new Error(`Invalid proxy URL: ${proxyUrl}`) });
    };
    const err = await rejection(createJwksFetcher({ fetchImpl })(JWKS_URI));

    expect(err.message).toBe(
      'JWKS request to idp.example.com failed: proxy http://***@proxy.example:3128 refused '
        + '(Invalid proxy URL: http://***@proxy.example:3128)',
    );
    expect(err.message).not.toMatch(/alice|pa@ss/);
  });
});
